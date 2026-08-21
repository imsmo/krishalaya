// modules/tenancy/__tests__/saas-invoice.integration.spec.ts
// REAL Postgres proof of API-W3-06. Proves:
//   1. the renewal run raises + issues ONE invoice per (subscription, period) with a gap-free invoice_no + an
//      outbox event, and is idempotent (a second run does not double-bill);
//   2. payments.payment_succeeded (referenceType='saas_invoice') RECORDS A RECEIPT in saas_invoice_payments,
//      re-SUMs paid_minor and lets the arithmetic settle the invoice; a re-delivered event is a no-op;
//   2b. PC-56 TENANT-4d-2: TWO HALF PAYMENTS SETTLE THE INVOICE, against real Postgres. Under the old
//      single-amount rule the second half computed 'partially_paid', found it already there, and returned
//      false — leaving a fully-paid invoice part-paid for ever with paid_minor at 0;
//   3. an overdue sweep moves an owing past-due invoice → overdue;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's invoice.
// Provisions a full tenant row + an active subscription directly (provisioning/subscribe are other planes).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { TxContext } from '../../../core/database/unit-of-work';

import { SaasInvoiceRepository } from '../repositories/saas-invoice.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { SaasInvoiceService } from '../services/saas-invoice.service';
import { RenewalInvoicesJob } from '../jobs/renewal-invoices.job';
import { SaasInvoicePaymentHandler } from '../events/handlers/payment-succeeded.handler';
import { BillingTaxRate } from '../read-models/billing-tax-rate';
import { taxOn } from '../domain/proration';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('tenancy SaaS invoicing (integration, real Postgres + RLS + relay)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let invoices: SaasInvoiceService; let invRepo: SaasInvoiceRepository; let subRepo: SubscriptionRepository;
  let renewalJob: RenewalInvoicesJob; let payHandler: SaasInvoicePaymentHandler; let taxRate: BillingTaxRate;
  let payerId = '';
  let isSuperuser = false;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const planA = randomUUID(); const subA = randomUUID();
  const periodEnd = new Date();   // due now → eligible for renewal
  let invoiceId = '';

  async function provisionTenant(id: string, slug: string) {
    await admin.query(`INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('tenant_type','Tenant Type', false) ON CONFLICT (code) DO NOTHING`);
    const lt = await admin.query(`INSERT INTO lookup_values (type_code, tenant_id, code, default_name) VALUES ('tenant_type', NULL, 'fpo', 'FPO') ON CONFLICT (type_code, tenant_id, code) DO UPDATE SET default_name=EXCLUDED.default_name RETURNING id`);
    // [PC-56 TENANT-6d-7] **THIS SUITE HAS BEEN RED SINCE `countries.currency_code` WAS MADE NOT NULL (0001).**
    // `INSERT ... ON CONFLICT DO NOTHING` still checks NOT NULL on the proposed tuple BEFORE it looks for a conflict, so
    // this fixture threw on every run whether or not 'IN' already existed — and 'IN' always does, because core/0002
    // seeds it. Found while widening a dairy wave's live pattern to `tenancy`; the columns are supplied rather than the
    // insert removed, so the fixture still says what it depends on.
    await admin.query(
      `INSERT INTO countries (code, default_name, currency_code, phone_prefix) VALUES ('IN','India','INR','+91')
       ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status) VALUES ($1,$2,$3,$4,$5,'IN','active') ON CONFLICT (id) DO NOTHING`, [id, slug, `${slug} Legal`, slug, lt.rows[0].id]);
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await provisionTenant(tenantA, 'acme'); await provisionTenant(tenantB, 'globex');
    // A real payer: `saas_invoice_payments.recorded_by` is NOT NULL (0092) precisely so a receipt cannot exist
    // with nobody attached to it, and the handler now refuses to record one without a payer.
    payerId = await makeUser(admin, randomUUID());
    // The tenant's GST identity, so 0146's snapshot has something real to copy onto the invoice.
    await admin.query(`UPDATE tenants SET gstin='24AABCU9603R1Z5' WHERE id=$1`, [tenantA]);
    // a plan + an active subscription for tenant A whose period ends now
    await admin.query(`INSERT INTO plans (id, code, default_name, country_code, currency_code, monthly_price_minor, annual_price_minor, is_active, version) VALUES ($1,'growth','Growth','IN','INR',99900,999000,true,1) ON CONFLICT (id) DO NOTHING`, [planA]);
    await admin.query(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, billing_cycle, price_minor, currency_code, discount_pct, current_period_start, current_period_end, cancel_at_period_end)
       VALUES ($1,$2,$3,'active','monthly',99900,'INR',0, now() - interval '1 month', $4, false) ON CONFLICT (id) DO NOTHING`,
      [subA, tenantA, planA, periodEnd]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    invRepo = new SaasInvoiceRepository(replica as any);
    subRepo = new SubscriptionRepository(replica as any);
    // PC-56 TENANT-4d-5 added the billing-notice enricher to this service's constructor. A no-op here on
    // purpose: these integration specs exercise the money arithmetic and RLS against real Postgres, and
    // returning the payload unchanged is exactly what the real service does for a tenant with billing
    // notices switched off — which is the default on every deployment. The notice plane has its own
    // behavioural suite (tenant4d5-billing-notices.spec.ts).
    const noNotices = { enrich: async (_tx: unknown, _t: string, _e: string, payload: unknown) => payload } as never;
    invoices = new SaasInvoiceService(uow, outbox, metrics, audit, invRepo, noNotices);
    taxRate = new BillingTaxRate(pools);
    renewalJob = new RenewalInvoicesJob(admin, subRepo, invoices, taxRate);
    payHandler = new SaasInvoicePaymentHandler(invoices);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('renewal run raises + issues one invoice (idempotent per period)', async () => {
    const first = await renewalJob.run(50, periodEnd);
    expect(first.raised).toBeGreaterThanOrEqual(1);
    const second = await renewalJob.run(50, periodEnd);   // same period → skipped
    expect(second.raised).toBe(0);
    const rows = await admin.query(`SELECT id, status, invoice_no, subtotal_minor, tax_minor, total_minor, tax_bp, period_tag, bill_to_gstin, bill_to_legal_name FROM saas_invoices WHERE tenant_id=$1 AND subscription_id=$2`, [tenantA, subA]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].status).toBe('issued');
    expect(rows.rows[0].invoice_no).toMatch(/^SINV-\d{6}-\d{6}$/);
    // PC-56 TENANT-4d-2 · THE RENEWAL INVOICE NOW CARRIES TAX. It used to be raised with `taxMinor: 0n` while an
    // UPGRADE invoice through PlanChangeService carried GST from the very same setting, so half the invoices this
    // platform raises were tax-free and W120's "(incl. GST)" was true of the other half only.
    const rate = await taxRate.current();
    expect(rate.readFailed).toBe(false);                       // 0126's definition is applied in this database
    expect(String(rows.rows[0].subtotal_minor)).toBe('99900');
    expect(String(rows.rows[0].tax_minor)).toBe(taxOn(99900n, rate.bp).toString());
    expect(String(rows.rows[0].total_minor)).toBe((99900n + taxOn(99900n, rate.bp)).toString());
    expect(Number(rows.rows[0].tax_bp)).toBe(rate.bp);          // frozen, not read live from the setting
    // The period is a COLUMN now, with a unique index over it — not a substring of the document number.
    expect(rows.rows[0].period_tag).toMatch(/^\d{6}$/);
    // The billed identity as at issue, so a later profile edit cannot re-address a document already sent.
    expect(rows.rows[0].bill_to_gstin).toBe('24AABCU9603R1Z5');
    expect(rows.rows[0].bill_to_legal_name).toBe('acme Legal');
    invoiceId = rows.rows[0].id;
    const ev = await admin.query(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_id=$1 AND event_type='tenancy.saas_invoice_issued'`, [invoiceId]);
    expect(ev.rows[0].c).toBe(1);
  });

  it('payment_succeeded (saas_invoice) RECORDS a receipt, re-sums paid_minor and settles the invoice; re-delivery is a no-op', async () => {
    const relay = async (paymentId: string, amountMinor: string) => {
      const c = await pools.writer(0).connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantA]);
        const tx: TxContext = { query: (sql, params) => c.query(sql, params as any) as any, tenantId: tenantA, userId: 'system' };
        await payHandler.handle({ tenantId: tenantA, aggregateType: 'payment', aggregateId: randomUUID(), eventType: 'payments.payment_succeeded', payload: {
          v: 1, referenceType: 'saas_invoice', referenceId: invoiceId, amountMinor,
          // The EVIDENCE the payload used to omit — which is why the consumer could only assert an outcome.
          paymentId, payerUserId: payerId, currencyCode: 'INR', method: 'upi', gatewayPaymentId: `pay_gw_${paymentId.slice(0, 8)}`,
          capturedAt: new Date().toISOString(),
        } } as any, tx);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    };
    const total = (await admin.query(`SELECT total_minor::text t FROM saas_invoices WHERE id=$1`, [invoiceId])).rows[0].t as string;
    const paymentId = randomUUID();
    await relay(paymentId, total);
    let row = await admin.query(`SELECT status, paid_at, paid_minor::text pm FROM saas_invoices WHERE id=$1`, [invoiceId]);
    expect(row.rows[0].status).toBe('paid'); expect(row.rows[0].paid_at).not.toBeNull();
    // THE COLUMN 0092 ADDED IS NOW WRITTEN BY THIS PLANE TOO. Before, the tenant realm typed 'paid' and left
    // paid_minor at 0, so the operator's collection queue showed the whole invoice outstanding on a settled bill.
    expect(row.rows[0].pm).toBe(total);
    // And the money is a RECORD, with a reference an auditor can match — not just a status.
    const rec = await admin.query(`SELECT amount_minor::text am, method, reference, recorded_by FROM saas_invoice_payments WHERE invoice_id=$1 AND deleted_at IS NULL`, [invoiceId]);
    expect(rec.rowCount).toBe(1);
    expect(rec.rows[0].am).toBe(total);
    expect(rec.rows[0].method).toBe('upi');
    expect(rec.rows[0].recorded_by).toBe(payerId);
    await relay(paymentId, total);   // idempotent re-delivery — same payment id, so the receipt is not duplicated
    row = await admin.query(`SELECT status, paid_minor::text pm FROM saas_invoices WHERE id=$1`, [invoiceId]);
    expect(row.rows[0].status).toBe('paid');
    expect(row.rows[0].pm).toBe(total);
    expect((await admin.query(`SELECT count(*)::int c FROM saas_invoice_payments WHERE invoice_id=$1 AND deleted_at IS NULL`, [invoiceId])).rows[0].c).toBe(1);
    const paidEv = await admin.query(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_id=$1 AND event_type='tenancy.saas_invoice_paid'`, [invoiceId]);
    expect(paidEv.rows[0].c).toBe(1);   // only the first application emitted
  });

  /**
   * THE DEFECT, PROVEN AGAINST REAL POSTGRES. Two payments of half each. Under the rule this wave replaced, the
   * second one was compared against the invoice TOTAL on its own, computed 'partially_paid', found the invoice
   * already there and returned false — so a fully-paid invoice stayed part-paid for ever and no row anywhere
   * recorded that the second half had arrived.
   */
  it('TWO HALF PAYMENTS settle one invoice (and paid_minor is the SUM, never an increment)', async () => {
    const id = randomUUID();
    await admin.query(
      `INSERT INTO saas_invoices (id, tenant_id, subscription_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor, due_date, line_items, period_tag)
       VALUES ($1,$2,NULL,$3,'issued','INR',100000,0,100000, (now() + interval '10 days')::date, '[]'::jsonb, NULL)`,
      [id, tenantA, `SINV-999999-${Math.floor(Math.random() * 1e6)}`]);

    const half = async (paymentId: string) => {
      const c = await pools.writer(0).connect();
      try {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantA]);
        const tx: TxContext = { query: (sql, params) => c.query(sql, params as any) as any, tenantId: tenantA, userId: 'system' };
        await payHandler.handle({ tenantId: tenantA, aggregateType: 'payment', aggregateId: randomUUID(), eventType: 'payments.payment_succeeded', payload: {
          v: 1, referenceType: 'saas_invoice', referenceId: id, amountMinor: '50000',
          paymentId, payerUserId: payerId, currencyCode: 'INR', method: null, gatewayPaymentId: null, capturedAt: new Date().toISOString(),
        } } as any, tx);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
    };

    await half(randomUUID());
    let row = await admin.query(`SELECT status, paid_minor::text pm FROM saas_invoices WHERE id=$1`, [id]);
    expect(row.rows[0].status).toBe('partially_paid');
    expect(row.rows[0].pm).toBe('50000');

    await half(randomUUID());
    row = await admin.query(`SELECT status, paid_minor::text pm, paid_at FROM saas_invoices WHERE id=$1`, [id]);
    expect(row.rows[0].status).toBe('paid');            // ← this was 'partially_paid' before this wave
    expect(row.rows[0].pm).toBe('100000');
    expect(row.rows[0].paid_at).not.toBeNull();
    // Both halves are on the record, each with its own reference. 'gateway' because the PSP reported no
    // instrument — an honest value, not a guessed 'upi'.
    const recs = await admin.query(`SELECT method FROM saas_invoice_payments WHERE invoice_id=$1 AND deleted_at IS NULL`, [id]);
    expect(recs.rowCount).toBe(2);
    expect(recs.rows.every((r: any) => r.method === 'gateway')).toBe(true);
  });

  it('overdue sweep moves an owing past-due invoice to overdue', async () => {
    // raise a fresh issued invoice with a past due_date
    const id = randomUUID();
    await admin.query(
      `INSERT INTO saas_invoices (id, tenant_id, subscription_id, invoice_no, status, currency_code, subtotal_minor, tax_minor, total_minor, due_date, line_items)
       VALUES ($1,$2,$3,$4,'issued','INR',50000,0,50000, (now() - interval '5 days')::date, '[]'::jsonb)`,
      [id, tenantA, subA, `SINV-000000-${Math.floor(Math.random() * 1e6)}`]);
    const ok = await invoices.markOverdue(tenantA, id);
    expect(ok).toBe(true);
    const row = await admin.query(`SELECT status FROM saas_invoices WHERE id=$1`, [id]);
    expect(row.rows[0].status).toBe('overdue');
  });

  it('RLS: tenant B cannot see tenant A\'s invoice', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM saas_invoices WHERE id=$1`, [invoiceId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[saas-invoice] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
