// modules/payments/__tests__/billing-documents.integration.spec.ts
// REAL proof that ledger splits become the seller's STATEMENT and the buyer's GST INVOICE, against
// a live Postgres:
//   1. settling two orders writes two settlement_lines; generating the seller's statement aggregates
//      them (gross/commission/tax/net), allocates a sequential statement_no, links the lines, and is
//      idempotent (re-run returns the same statement);
//   2. the trade-invoice handler generates one GST invoice per order (idempotent) with a CGST/SGST
//      tax_breakup, readable by the buyer but NOT a stranger (404 — IDOR-safe);
//   3. cross-tenant: tenant B sees neither tenant A's statement nor its settlement lines (RLS).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { TxContext } from '../../../core/database/unit-of-work';

import { SettlementLineRepository } from '../repositories/settlement-line.repository';
import { SettlementStatementRepository } from '../repositories/settlement-statement.repository';
import { TradeInvoiceRepository } from '../repositories/trade-invoice.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { SettlementStatementService } from '../services/settlement-statement.service';
import { TradeInvoiceService } from '../services/trade-invoice.service';
import { DocumentPdfService } from '../services/document-pdf.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { TranslationService } from '../../../core/i18n/translation.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('billing documents: statements + GST invoices (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let uow: PgUnitOfWork;
  let lines: SettlementLineRepository;
  let statements: SettlementStatementService;
  let invoices: TradeInvoiceService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const seller = randomUUID();
  const buyer = randomUUID();
  const stranger = randomUUID();
  const finance = randomUUID();
  const FROM = '2026-04-01';
  const TO = '2026-05-01';
  let statementId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, seller); await makeUser(admin, buyer);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    lines = new SettlementLineRepository();
    const stmtRepo = new SettlementStatementRepository(replica as any);
    const invRepo = new TradeInvoiceRepository(replica as any);
    // document_pdfs flag is OFF by default → PDF rendering is a no-op here (no S3 contacted); the DEV-27
    // (Q23 badge) TenantService dep is likewise never reached with the flag off, so `null as any` mirrors
    // the pre-existing `media: null as any` convention on this same line rather than standing up the
    // full TenantService dependency graph for a test that never exercises it.
    const docPdf = new DocumentPdfService(uow, metrics, new FlagsService(pools, new InMemoryCacheService()), null as any, stmtRepo, invRepo, new TranslationService(), null as any);
    statements = new SettlementStatementService(uow, metrics, audit, lines, stmtRepo, docPdf);
    // QA-FIX (DEV-27, gate repair per playbook HARD RULE 9): this fixture's TradeInvoiceService
    // construction was stale — that constructor gained `store: ObjectStore` + `documentPdf:
    // DocumentPdfService` params at commit 14cbabdf ("P1-4 · Invoice download") without this test file
    // being updated, so it failed to COMPILE at HEAD (pre-existing, unrelated to DEV-27's own diff —
    // confirmed via `git show HEAD` reproducing the identical 3-arg call). Neither dependency is
    // exercised by this file's assertions (only generateForOrder/getByOrder are called, never
    // downloadUrlForOrder), so `null as any`/the already-constructed `docPdf` mirror this file's own
    // existing no-op-dependency convention rather than standing up a real ObjectStore.
    invoices = new TradeInvoiceService(metrics, null as any, new TaxRuleRepository(replica as any), invRepo, docPdf);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  // write a settlement line directly (as the OrderCompletedHandler would) within a tenant tx
  const writeLine = (orderId: string, gross: bigint, commission: bigint, gst: bigint, tds: bigint) =>
    uow.run(tenantA, async (tx: TxContext) => lines.insert(tx, { tenantId: tenantA, sellerUserId: seller, orderId, grossMinor: gross, commissionMinor: commission, gstMinor: gst, tdsMinor: tds, netMinor: gross - commission - gst - tds }), { userId: 'system' });

  it('aggregates two settlement lines into one statement (idempotent, sequential number)', async () => {
    // backdate the lines into the billing period (created_at default now() would be outside FROM/TO)
    await writeLine(randomUUID(), 1_000_000n, 35_000n, 1_750n, 10_000n);   // net 953,250
    await writeLine(randomUUID(), 500_000n, 17_500n, 875n, 0n);            // net 481,625
    await admin.query(`UPDATE settlement_lines SET created_at='2026-04-15T00:00:00Z' WHERE tenant_id=$1 AND seller_user_id=$2 AND statement_id IS NULL`, [tenantA, seller]);

    const s = await statements.generate(tenantA, seller, FROM, TO, finance, '127.0.0.1');
    statementId = s.id;
    expect(s.grossMinor).toBe('1500000');
    expect(s.commissionMinor).toBe('52500');
    expect(s.taxMinor).toBe('12625');                  // gst(2625) + tds(10000)
    expect(s.netMinor).toBe('1434875');                // 1,500,000 − 52,500 − 12,625
    expect(s.statementNo).toMatch(/^STMT-2026-04-\d{6}$/);

    // idempotent: re-running the same period returns the same statement, no new one
    const again = await statements.generate(tenantA, seller, FROM, TO, finance, '127.0.0.1');
    expect(again.id).toBe(s.id);
    const cnt = await admin.query(`SELECT count(*)::int n FROM settlement_statements WHERE tenant_id=$1 AND seller_user_id=$2`, [tenantA, seller]);
    expect(cnt.rows[0].n).toBe(1);
    // the lines are now linked to the statement (won't be double-counted next cycle)
    const linked = await admin.query(`SELECT count(*)::int n FROM settlement_lines WHERE statement_id=$1`, [s.id]);
    expect(linked.rows[0].n).toBe(2);
  });

  it('generates one GST invoice per order with a CGST/SGST breakup; idempotent', async () => {
    const orderId = randomUUID();
    await uow.run(tenantA, async (tx) => invoices.generateForOrder(tx, { tenantId: tenantA, orderId, buyerUserId: buyer, sellerUserId: seller, totalMinor: 1_000_000n }), { userId: 'system' });
    await uow.run(tenantA, async (tx) => invoices.generateForOrder(tx, { tenantId: tenantA, orderId, buyerUserId: buyer, sellerUserId: seller, totalMinor: 1_000_000n }), { userId: 'system' });   // replay

    const rows = await admin.query(`SELECT invoice_no, total_minor, tax_breakup FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [tenantA, orderId]);
    expect(rows.rowCount).toBe(1);                      // exactly one invoice per order
    expect(rows.rows[0].invoice_no).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(String(rows.rows[0].total_minor)).toBe('1000000');
    const bk = rows.rows[0].tax_breakup;
    expect(BigInt(bk.cgstMinor) + BigInt(bk.sgstMinor)).toBe(25000n);   // 5% GST split, exact

    // the buyer can read it; a stranger cannot (404 → null)
    const seen = await invoices.getByOrder(tenantA, { userId: buyer, canModerate: false }, orderId);
    expect(seen.orderId).toBe(orderId);
    await expect(invoices.getByOrder(tenantA, { userId: stranger, canModerate: false }, orderId)).rejects.toBeTruthy();
  });

  it('RLS: tenant B sees neither tenant A\'s statement nor its settlement lines', async () => {
    const countAs = async (t: string, table: string, idCol: string, id: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM ${table} WHERE ${idCol}=$1`, [id]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[billing] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA, 'settlement_statements', 'id', statementId)).toBe(1); return; }
    expect(await countAs(tenantA, 'settlement_statements', 'id', statementId)).toBe(1);
    expect(await countAs(tenantB, 'settlement_statements', 'id', statementId)).toBe(0);
    expect(await countAs(tenantB, 'settlement_lines', 'statement_id', statementId)).toBe(0);
  });
});
