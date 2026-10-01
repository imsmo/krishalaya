// modules/audit/__tests__/tenant9c-auditor.integration.spec.ts · PC-56 TENANT-9c · THE AUDITOR REALM AGAINST THE REAL SCHEMA,
// as kv_app under RLS (the harness's `krishalaya_test`, built from every migration + seed).
//
// WHAT ONLY A REAL DATABASE PROVES: that another tenant's ledger entries never appear through the funnel — on a ledger whose
// tables carry NO row-level policy, where the only thing between tenant A and tenant B is the SQL; that a platform account's
// chain really does interleave two tenants (so withholding its link is a fact, not a preference); that a read writes its
// `audit_read_log` row under FORCE'd RLS; that `AuditWriter.log` can now record a tenant row at all; that 0181's wall refuses
// kv_app a NULL-tenant audit row; and that the auditor's permission set in the database is exactly five reads.
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Pool } from 'pg';
import { Reflector } from '@nestjs/core';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import type { ObjectStore } from '../../../core/media/s3-presign.service';
import { DatasetRegistry } from '../../../core/exports-plane/dataset.registry';
import { ExportJobRepository } from '../../../core/exports-plane/export-job.repository';
import { ExportDownloadRepository } from '../../../core/exports-plane/export-download.repository';
import { ExportPlaneService, EXPORT_PLANE_FLAG } from '../../../core/exports-plane/export-plane.service';
import { ExportWorker } from '../../../core/exports-plane/export-worker';
import { entryHash } from '../../../core/wallet/hash-chain';
import { runWithContext, type RequestContext } from '../../../core/tenancy-context/request-context';
import { AuditorReadOnlyGuard } from '../../../core/auth/auditor-read-only.guard';
import { AuditorLedgerReadModel } from '../../payments/read-models/auditor-ledger.read-model';
import { InvoicesController } from '../../payments/controllers/v1/invoices.controller';
import { CreditNoteService } from '../../payments/services/credit-note.service';
import { canIssueCreditNote } from '../../payments/policies/payments.policies';
import { AuditRepository } from '../repositories/audit.repository';
import { AuditReadLogRepository } from '../repositories/audit-read-log.repository';
import { AuditorClockRepository } from '../repositories/auditor-clock.repository';
import { AuditorComplianceReadModel } from '../read-models/auditor-compliance.read-model';
import { AuditService } from '../services/audit.service';
import { AuditorService } from '../services/auditor.service';
import { AuditTrailDataset, CompliancePackDataset, LedgerEntriesDataset } from '../exports/auditor.datasets';
import { MASK } from '../domain/audit-diff-mask';
import { UNSIGNED_NOTE } from '../domain/auditor-realm';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObjectStream(key: string, body: Readable): Promise<void> {
    const cs: Buffer[] = []; for await (const c of body) cs.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    this.objects.set(key, Buffer.concat(cs));
  }
  async getObjectStream(key: string): Promise<Readable> { return Readable.from([this.objects.get(key) ?? Buffer.alloc(0)]); }
}

run('PC-56 TENANT-9c · the auditor realm (live, kv_app under RLS)', () => {
  let admin: Pool; let app: Pool; let pools: PgPoolProvider; let flagCache: InMemoryCacheService;
  let uow: PgUnitOfWork; let replica: PgReadReplicaProvider; let auditWriter: AuditWriter;
  let trailSvc: AuditService; let auditor: AuditorService; let ledger: AuditorLedgerReadModel; let worker: ExportWorker; let store: MemoryStore;
  const tA = randomUUID(); const tB = randomUUID();
  const auditorU = randomUUID(); const adminU = randomUUID(); const supportU = randomUUID(); const memberU = randomUUID(); const adminB = randomUUID();
  const txA1 = randomUUID(); const txA2 = randomUUID(); const txB1 = randomUUID(); const txA3 = randomUUID();
  let accA = ''; let accB = ''; let escrow = ''; let wallet = '';
  const today = () => admin.query<{ d: string }>(`SELECT to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d`).then((r) => r.rows[0].d);
  const permsOf = async (role: string) => new Set<string>((await admin.query(
    `SELECT rp.permission_code AS p FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = $1`, [role])).rows.map((x) => x.p));
  const grant = (u: string, code: string, t = tA) => admin.query(
    `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, is_active) SELECT $1, $2, $3, r.id, true FROM roles r WHERE r.code = $4`, [randomUUID(), u, t, code]);
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, tier) VALUES ($1,'itest',$2,100,'experiment')
                       ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, rollout_pct = 100`, [key, on]);
    await flagCache.del(`flag:${key}`); await flagCache.del('flags:all');
  };
  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  const asApp = async <T>(tenant: string, fn: (c: import('pg').PoolClient) => Promise<T>): Promise<T> => {
    const c = await app.connect();
    try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]); return await fn(c); }
    finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  };
  let auditorActor: { userId: string; roles: string[]; permissions: Set<string>; requestId: string };
  let priorFlags: Array<{ key: string; is_enabled: boolean }> = [];

  /** Post one entry the way the wallet writer chains it: prev = the account's last hash; balance after = cached + amount. */
  const post = async (txn: string, tenant: string, account: string, amount: bigint, at: string) => {
    const a = (await admin.query(`SELECT cached_balance_minor::text AS b, last_entry_hash AS h FROM wallet_accounts WHERE id = $1`, [account])).rows[0];
    const after = BigInt(a.b) + amount;
    const h = entryHash(a.h ?? null, txn, account, amount, after);
    await admin.query(`INSERT INTO ledger_entries (txn_id, account_id, tenant_id, amount_minor, currency_code, balance_after_minor, prev_hash, entry_hash, created_at)
                       VALUES ($1,$2,$3,$4,'INR',$5,$6,$7,$8::timestamptz)`, [txn, account, tenant, amount.toString(), after.toString(), a.h ?? null, h, at]);
    await admin.query(`UPDATE wallet_accounts SET cached_balance_minor = $2, last_entry_hash = $3 WHERE id = $1`, [account, after.toString(), h]);
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tA, 'Auditor A'); await makeTenant(admin, tB, 'Auditor B');
    for (const u of [auditorU, adminU, supportU, memberU, adminB]) await makeUser(admin, u);
    await grant(auditorU, 'auditor'); await grant(adminU, 'tenant_admin'); await grant(supportU, 'support_agent'); await grant(memberU, 'farmer'); await grant(adminB, 'tenant_admin', tB);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    replica = new PgReadReplicaProvider(pools, shards);
    auditWriter = new AuditWriter(pools);
    flagCache = new InMemoryCacheService();
    const flags = new FlagsService(pools, flagCache);
    const metrics = new PromMetrics();
    const ui = new UiMessageRepository(replica as never);
    const trailRepo = new AuditRepository(replica as never);
    const readLog = new AuditReadLogRepository(uow, replica as never);
    const clocks = new AuditorClockRepository(replica as never);
    ledger = new AuditorLedgerReadModel(replica as never);
    const pack = new AuditorComplianceReadModel(replica as never);
    const registry = new DatasetRegistry();
    registry.register(new AuditTrailDataset(trailRepo, clocks, ui, flags));
    registry.register(new LedgerEntriesDataset(ledger, clocks, ui, flags));
    registry.register(new CompliancePackDataset(ledger, pack, clocks, ui, flags));
    store = new MemoryStore();
    const jobs = new ExportJobRepository(replica as never);
    const plane = new ExportPlaneService(uow, new PgOutboxWriter(), new PgIdempotencyService(pools), metrics, registry, store as unknown as ObjectStore, auditWriter, flags, jobs, new ExportDownloadRepository(replica as never), config);
    worker = new ExportWorker(uow, new PgOutboxWriter(), replica as never, metrics, registry, store as unknown as ObjectStore, jobs);
    trailSvc = new AuditService(trailRepo, readLog, clocks, flags, uow, auditWriter);
    auditor = new AuditorService(flags, clocks, readLog, trailRepo, ledger, pack, plane);
    // The flags are GLOBAL rows other suites read in parallel: remember them and put them back exactly as found.
    priorFlags = (await admin.query(`SELECT key, is_enabled FROM feature_flags WHERE key IN ('audit_trail', $1)`, [EXPORT_PLANE_FLAG])).rows;
    await setFlag('audit_trail', true); await setFlag(EXPORT_PLANE_FLAG, true);
    auditorActor = { userId: auditorU, roles: ['auditor'], permissions: await permsOf('auditor'), requestId: 'req-9c' };

    // ---- THE LEDGER: A owns `main`; B owns `main`; one PLATFORM escrow account both tenants' money events post to. ----
    const mk = async (kind: string, tenant: string | null, user: string | null, code: string) => (await admin.query(
      `INSERT INTO wallet_accounts (owner_kind, owner_tenant_id, owner_user_id, account_code, currency_code, shard_no) VALUES ($1::wallet_owner_kind,$2,$3,$4,'INR',0) RETURNING id::text AS id`,
      [kind, tenant, user, code])).rows[0].id as string;
    accA = await mk('tenant', tA, null, 'main');
    accB = await mk('tenant', tB, null, 'main');
    escrow = await mk('platform', null, null, `escrow_9c_${randomUUID().slice(0, 8)}`);
    wallet = await mk('user', null, memberU, `wallet_9c_${randomUUID().slice(0, 6)}`);
    const d = await today();
    const at = (h: number) => `${d}T0${h}:00:00.123456+05:30`;
    for (const [id, t, h] of [[txA1, tA, 1], [txB1, tB, 2], [txA2, tA, 3], [txA3, tA, 4]] as Array<[string, string, number]>) {
      await admin.query(`INSERT INTO ledger_transactions (id, txn_type_id, tenant_id, reference_type, description, idempotency_key, created_at)
                         SELECT $1, lv.id, $2, 'probe', '9c probe', $3, $4::timestamptz FROM lookup_values lv
                          WHERE lv.type_code = 'ledger_txn_type' AND lv.tenant_id IS NULL ORDER BY lv.code LIMIT 1`, [id, t, `9c-${id}`, at(h)]);
    }
    await post(txA1, tA, escrow, -100000n, at(1)); await post(txA1, tA, accA, 100000n, at(1));       // A: escrow → A main
    await post(txB1, tB, escrow, -50000n, at(2)); await post(txB1, tB, accB, 50000n, at(2));         // B: escrow → B main (interleaves the stripe)
    await post(txA2, tA, accA, -30000n, at(3)); await post(txA2, tA, wallet, 30000n, at(3));         // A: A main → a member's wallet
    // A cross-cooperative money event of A's whose other legs are attributed to B (one on B's own account, one on the shared
    // escrow): A may see its own leg and that two more exist — never the neighbour's legs themselves (pinned after the
    // mutation pass found the SQL filter and the domain's other-tenant belt each covering for the other).
    await post(txA3, tA, accA, -7000n, at(4)); await post(txA3, tB, accB, 5000n, at(4)); await post(txA3, tB, escrow, 2000n, at(4));
  }, 240000);

  afterAll(async () => {
    // The export plane's queue is ONE cross-tenant FIFO whose ETA reads the last runs: leave nothing of ours in it.
    await admin?.query(`DELETE FROM tenant_export_downloads WHERE tenant_id = ANY($1::uuid[])`, [[tA, tB]]).catch(() => undefined);
    await admin?.query(`DELETE FROM tenant_export_jobs WHERE tenant_id = ANY($1::uuid[])`, [[tA, tB]]).catch(() => undefined);
    for (const f of priorFlags) await admin?.query(`UPDATE feature_flags SET is_enabled = $2 WHERE key = $1`, [f.key, f.is_enabled]).catch(() => undefined);
    if (!priorFlags.some((f) => f.key === 'audit_trail')) await admin?.query(`DELETE FROM feature_flags WHERE key = 'audit_trail' AND description = 'itest'`).catch(() => undefined);
    await pools?.onModuleDestroy(); await app?.end(); await admin?.end();
  });

  it('F-8/F-18 · the auditor\'s permission set in the database is EXACTLY five reads; the credit-note verb is tenant_admin\'s', async () => {
    expect([...(await permsOf('auditor'))].sort()).toEqual(['audit.read', 'governance.read', 'kyc.read', 'ledger.read', 'report.view']);
    const holders = (await admin.query(`SELECT r.code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE rp.permission_code = 'payments.credit_note.issue' ORDER BY 1`)).rows.map((x) => x.code);
    expect(holders).toEqual(['tenant_admin']);
  });

  it('F-8 · THE SURVEY\'S PROBE RE-RUN: an auditor issuing a GST credit note is refused at the guard (recorded) AND at the service', async () => {
    const roles = (await admin.query(`SELECT r.code FROM user_tenant_roles u JOIN roles r ON r.id = u.role_id WHERE u.user_id = $1 AND u.tenant_id = $2`, [auditorU, tA])).rows.map((x) => x.code);
    const ctx: RequestContext = { tenantId: tA, userId: auditorU, sessionId: 's', requestId: 'req-9c-f8', lang: 'en', roles, permissions: await permsOf('auditor'), shardId: 0 };
    const guard = new AuditorReadOnlyGuard(new Reflector(), auditWriter);
    const exec = { getType: () => 'http', getHandler: () => InvoicesController.prototype.issueCreditNote, getClass: () => InvoicesController,
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', originalUrl: `/v1/invoices/${randomUUID()}/credit-notes` }) }) } as never;
    const err = await runWithContext(ctx, () => guard.canActivate(exec).then(() => null, (e) => e as { code: string; httpStatus: number; message: string }));
    // eslint-disable-next-line no-console
    console.log(`[9c F-8 probe] auditor roles=${JSON.stringify(roles)} POST /v1/invoices/:id/credit-notes → ${err?.httpStatus} ${err?.code}: ${err?.message}`);
    expect(err).toMatchObject({ code: 'AUDITOR_READ_ONLY', httpStatus: 403 });
    const rec = (await admin.query(`SELECT actor_role, action, new_value FROM audit_log WHERE tenant_id = $1 AND action = 'auditor.write_refused' AND actor_user_id = $2`, [tA, auditorU])).rows;
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ actor_role: 'auditor', new_value: { method: 'POST' } });
    // Behind the guard, the service's own gate (defence in depth): report.view is no longer enough.
    const svc = new CreditNoteService(uow, new PromMetrics(), auditWriter, {} as never, {} as never, {} as never);
    const input = { invoiceId: randomUUID(), approvalId: randomUUID(), reasonCode: 'rate_error', reasonText: 'wrong rate applied on line 2' };
    for (const role of ['auditor', 'support_agent', 'gov_officer']) {
      const c = { permissions: await permsOf(role) } as RequestContext;
      expect([role, await svc.issue(tA, { userId: auditorU, canIssue: canIssueCreditNote(c) }, input).then(() => 'ok', (e) => e.code)]).toEqual([role, 'CREDIT_NOTE_FORBIDDEN']);
    }
    const adminCtx = { permissions: await permsOf('tenant_admin') } as RequestContext;
    expect(canIssueCreditNote(adminCtx)).toBe(true);
    expect(await svc.issue(tA, { userId: adminU, canIssue: true }, input).then(() => 'ok', (e) => e.code)).not.toBe('CREDIT_NOTE_FORBIDDEN');
  });

  it('F-12 · 0181\'s wall, as kv_app: a platform (NULL-tenant) audit row is refused; so is another tenant\'s; the trail cannot be edited', async () => {
    const forged = await asApp(tA, (c) => pgCode(c.query(`INSERT INTO audit_log (tenant_id, action) VALUES (NULL, 'platform.forged_by_tenant_ctx')`)));
    // eslint-disable-next-line no-console
    console.log(`[9c F-12 probe] kv_app under tenant ${tA}: INSERT audit_log (NULL tenant) → ${forged}`);
    expect(forged).toBe('42501');
    expect(await asApp(tA, (c) => pgCode(c.query(`INSERT INTO audit_log (tenant_id, action) VALUES ($1, 'x')`, [tB])))).toBe('42501');
    expect(await asApp(tA, (c) => pgCode(c.query(`INSERT INTO audit_log (tenant_id, action, actor_role) VALUES ($1, 'itest.own', 'auditor')`, [tA])))).toBe('ok');
    expect(await asApp(tA, (c) => pgCode(c.query(`UPDATE audit_log SET action = 'x' WHERE tenant_id = $1`, [tA])))).toBe('42501');
    expect(await asApp(tA, (c) => pgCode(c.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [tA])))).toBe('42501');
    expect(await asApp(tA, (c) => pgCode(c.query(`INSERT INTO audit_read_log (tenant_id, actor_user_id, actor_role, purpose, surface, row_count) VALUES (NULL, $1, 'auditor', 'trail_page', 'x', 0)`, [auditorU])))).toBe('42501');
    expect(await asApp(tA, (c) => pgCode(c.query(`INSERT INTO audit_read_log (tenant_id, actor_user_id, actor_role, purpose, surface, row_count) VALUES ($1, $2, 'auditor', 'trail_page', 'x', 0)`, [tB, auditorU])))).toBe('42501');
    expect(await asApp(tA, (c) => pgCode(c.query(`INSERT INTO audit_read_log (tenant_id, actor_user_id, actor_role, purpose, surface, row_count) VALUES ($1, $2, 'auditor', 'gossip', 'x', 0)`, [tA, auditorU])))).toBe('23503');
    expect(await asApp(tA, (c) => pgCode(c.query(`UPDATE audit_read_log SET row_count = 1 WHERE tenant_id = $1`, [tA])))).toBe('42501');
    // AuditWriter.log (no business tx) can record a TENANT row now — it could not under FORCE'd RLS before (found on the way).
    await auditWriter.log({ tenantId: tA, actorUserId: adminU, action: 'itest.log_path', entityType: 'probe' });
    expect((await admin.query(`SELECT actor_role FROM audit_log WHERE tenant_id = $1 AND action = 'itest.log_path'`, [tA])).rows).toEqual([{ actor_role: 'system' }]);
  });

  it('F-10 · ANOTHER TENANT\'S LEDGER ENTRIES NEVER APPEAR THROUGH THE FUNNEL — and the shared stripe really interleaves them', async () => {
    const d = await today();
    const win = { fromDay: d, toDay: d, zone: 'Asia/Kolkata' };
    const a = await ledger.page(tA, win, { limit: 50 });
    const b = await ledger.page(tB, win, { limit: 50 });
    const aTx = a.items.map((t) => t.txnId); const bTx = b.items.map((t) => t.txnId);
    expect(aTx).toEqual(expect.arrayContaining([txA1, txA2, txA3])); expect(aTx).not.toContain(txB1);
    expect(bTx).toContain(txB1); expect(bTx).not.toContain(txA1); expect(bTx).not.toContain(txA2);
    const aEntries = a.items.flatMap((t) => t.legs.map((l) => l.entryId));
    const bEntryIds = (await admin.query(`SELECT id::text FROM ledger_entries WHERE tenant_id = $1`, [tB])).rows.map((x) => x.id);
    expect(aEntries.filter((e) => bEntryIds.includes(e))).toEqual([]);
    expect(a.items.flatMap((t) => t.legs.map((l) => l.accountLabel))).not.toContain(accB);
    // The platform stripe: B's escrow entry's prev_hash IS A's escrow entry — the neighbour's row.
    const esc = (await admin.query(`SELECT tenant_id::text AS t, prev_hash, entry_hash FROM ledger_entries WHERE account_id = $1 ORDER BY id`, [escrow])).rows;
    expect(esc.map((x) => x.t)).toEqual([tA, tB, tB]);
    expect(esc[1].prev_hash).toBe(esc[0].entry_hash);
    // …so A's view of its escrow leg WITHHOLDS the link and the balance, by name.
    const a1 = a.items.find((t) => t.txnId === txA1)!;
    const escLeg = a1.legs.find((l) => l.kind === 'platform')!;
    expect(escLeg.hashLink).toEqual({ kind: 'withheld', reason: 'shared_stripe' });
    expect(escLeg.balanceAfterMinor).toBeNull();
    const own = a1.legs.find((l) => l.kind === 'tenant_own')!;
    expect(own.hashLink).toMatchObject({ kind: 'linked', genesis: true });
    expect(a1.foot).toMatchObject({ sumMinor: '0', foots: true, complete: true, legsVisible: 2, legsTotal: 2 });
    const a2 = a.items.find((t) => t.txnId === txA2)!;
    expect(a2.legs.find((l) => l.kind === 'tenant_own')!.hashLink).toMatchObject({ kind: 'linked', genesis: false });
    expect(a2.legs.find((l) => l.kind === 'member_wallet')!).toMatchObject({ balanceAfterMinor: null, accountLabel: expect.stringMatching(/^member ··[0-9a-f]{4}$/), hashLink: { kind: 'withheld', reason: 'member_wallet' } });
    // The cross-cooperative event: A's own leg only; the second leg is counted, never shown; it cannot be footed here.
    const a3 = a.items.find((t) => t.txnId === txA3)!;
    expect(a3.legs.map((l) => l.kind)).toEqual(['tenant_own']);
    expect(a3.foot).toMatchObject({ legsVisible: 1, legsTotal: 3, complete: false, foots: false });
    // Zero-sum and the own-account truths, whole window.
    expect(await ledger.zeroSum(tA, win)).toEqual({ checked: 3, foot: 2, notFoot: 0, incomplete: 1 });
    const accts = await ledger.ownAccounts(tA, 'INR');
    expect(accts.map((x) => x.accountCode)).toEqual(['main']);
    expect(accts[0]).toMatchObject({ entryCount: 3, balance: { equal: true }, chain: { kind: 'intact', checked: 3 }, headMatches: true });
    expect(await ledger.txnCount(tA, win)).toBe(3);
    // A keyset walk of one per page loses nothing and repeats nothing.
    const seen: string[] = []; let cursor: string | undefined;
    for (let i = 0; i < 6; i++) { const p = await ledger.page(tA, win, { limit: 1, cursor }); seen.push(...p.items.map((t) => t.txnId)); if (!p.nextCursor) break; cursor = p.nextCursor; }
    expect(seen.filter((x) => x === txA1 || x === txA2 || x === txA3)).toEqual([txA3, txA2, txA1]);
  });

  it('W200 · the overview: facts and refusals, never "verified" over the shared stripe; the view itself is RECORDED', async () => {
    const o = await auditor.overview(tA, auditorActor, {});
    expect(o.clock).toMatchObject({ zone: 'Asia/Kolkata', currency: 'INR', fiscalYear: { declared: true, startMonth: 4 } });
    expect(o.integrity.sharedChains).toMatchObject({ verdict: 'unverifiable', reason: 'shared_stripe' });
    expect(o.integrity.zeroSum).toMatchObject({ foot: 2, incomplete: 1 });
    expect(o.integrity.ownAccounts).toEqual([expect.objectContaining({ accountCode: 'main', chain: 'intact', balanceEqualsSum: true, headMatches: true })]);
    expect(JSON.stringify(o)).not.toMatch(/"verified":true|"intact":true/);
    expect(o.scope.filter((s) => s.held).map((s) => s.code)).toEqual(['ledger', 'trail', 'kyc', 'governance', 'reports']);
    expect(o.session).toMatchObject({ auditor: true, readOnly: true });
    const r = (await admin.query(`SELECT purpose, actor_role, row_count, span_first, surface FROM audit_read_log WHERE id = $1 AND tenant_id = $2`, [o.logged.readId, tA])).rows;
    expect(r).toEqual([{ purpose: 'auditor_overview', actor_role: 'auditor', row_count: o.latest.length, span_first: o.latest[0]?.txnId ?? null, surface: 'GET /v1/auditor/overview' }]);
    // Tenant B's context sees none of A's read rows.
    expect(await asApp(tB, async (c) => (await c.query(`SELECT count(*)::int AS n FROM audit_read_log WHERE tenant_id = $1`, [tA])).rows[0].n)).toBe(0);
    // A tenant_admin is not the auditor: the overview is auditor-scoped (ledger.read).
    await expect(auditor.overview(tA, { userId: adminU, roles: ['tenant_admin'], permissions: await permsOf('tenant_admin'), requestId: null }, {})).rejects.toMatchObject({ code: 'AUDITOR_SCOPE_ONLY' });
    // A window over the canon's bound is refused, not clipped.
    await expect(auditor.ledgerPage(tA, auditorActor, { from: '2026-01-01', to: '2026-06-01' })).rejects.toMatchObject({ code: 'AUDIT_WINDOW_REFUSED', details: { code: 'WINDOW_TOO_WIDE', maxDays: 92 } });
    const lp = await auditor.ledgerPage(tA, auditorActor, {});
    expect((await admin.query(`SELECT purpose, row_count FROM audit_read_log WHERE id = $1`, [lp.logged.readId])).rows[0]).toEqual({ purpose: 'ledger_page', row_count: lp.items.length });
  });

  it('F-9 · the trail: MASKED by default, actor_role written at write time, every read logged; a RECORDED reveal unmasks one row', async () => {
    const ctx: RequestContext = { tenantId: tA, userId: adminU, sessionId: 's', requestId: 'req-9c-w', lang: 'en', roles: ['tenant_admin'], permissions: new Set(), shardId: 0 };
    await runWithContext(ctx, () => uow.run(tA, (tx) => auditWriter.write(tx, { tenantId: tA, actorUserId: adminU, action: 'itest.member_edit', entityType: 'user', newValue: { phone: '+919812345678', status: 'active', owner: { email: 'x@y.in' } } })));
    const page = await trailSvc.list(tA, { userId: auditorU, canRead: true, roles: ['auditor'], permissions: auditorActor.permissions, requestId: 'req-9c-t' }, { action: 'itest.member_edit', limit: 10 } as never);
    expect(page.items).toHaveLength(1);
    const e = page.items[0];
    expect(e).toMatchObject({ actorRole: 'tenant_admin', actorRoleRecorded: true, masked: true, newValue: { phone: MASK, status: 'active', owner: { email: MASK } }, maskedFields: ['owner.email', 'phone'] });
    expect(JSON.stringify(page)).not.toContain('9812345678');
    expect(page.window).toMatchObject({ maxDays: 92, zone: 'Asia/Kolkata' });
    const logged = (await admin.query(`SELECT purpose, row_count, span_first, span_last, filter->>'action' AS action, window_from IS NOT NULL AS has_window FROM audit_read_log WHERE tenant_id = $1 AND actor_user_id = $2 AND purpose = 'trail_page' ORDER BY created_at DESC LIMIT 1`, [tA, auditorU])).rows[0];
    expect(logged).toEqual({ purpose: 'trail_page', row_count: 1, span_first: e.id, span_last: e.id, action: 'itest.member_edit', has_window: true });
    // A pre-0181 row (no writer recorded a role) prints "not recorded": actorRoleRecorded false.
    await admin.query(`INSERT INTO audit_log (tenant_id, action) VALUES ($1, 'itest.legacy')`, [tA]);
    const legacy = await trailSvc.list(tA, { userId: auditorU, canRead: true, roles: ['auditor'] }, { action: 'itest.legacy', limit: 5 } as never);
    expect(legacy.items[0]).toMatchObject({ actorRole: null, actorRoleRecorded: false });
    // The auditor holds no reveal; a short reason is refused; the reveal is recorded BEFORE the value comes back.
    await expect(trailSvc.reveal(tA, { userId: auditorU, canRead: true, roles: ['auditor'], permissions: auditorActor.permissions }, e.id, 'checking the phone number on file', null)).rejects.toMatchObject({ code: 'AUDIT_REVEAL_REFUSED', details: { code: 'NO_PERMISSION' } });
    const adminActor = { userId: adminU, canRead: true, roles: ['tenant_admin'], permissions: await permsOf('tenant_admin'), requestId: 'req-9c-r' };
    expect(adminActor.permissions.has('member.pii.reveal')).toBe(true);
    await expect(trailSvc.reveal(tA, adminActor, e.id, 'too short', null)).rejects.toMatchObject({ details: { code: 'REVEAL_REASON_TOO_SHORT', min: 20 } });
    const open = await trailSvc.reveal(tA, adminActor, e.id, 'member disputes the phone change on 12 Jul', '10.0.0.9');
    expect(open).toMatchObject({ masked: false, newValue: { phone: '+919812345678', owner: { email: 'x@y.in' } } });
    const rv = (await admin.query(`SELECT purpose, filter FROM audit_read_log WHERE tenant_id = $1 AND actor_user_id = $2 AND purpose = 'trail_reveal'`, [tA, adminU])).rows;
    expect(rv).toHaveLength(1);
    expect(rv[0].filter).toMatchObject({ id: e.id, fields: ['owner.email', 'phone'], reason: 'member disputes the phone change on 12 Jul' });
    const trailRow = (await admin.query(`SELECT new_value, reason, actor_role FROM audit_log WHERE tenant_id = $1 AND action = 'audit.entry.revealed'`, [tA])).rows;
    expect(trailRow).toHaveLength(1);
    expect(trailRow[0].new_value).toEqual({ entryId: e.id, fields: ['owner.email', 'phone'] });
    expect(JSON.stringify(trailRow[0])).not.toContain('9812345678');
    // The console's hand-off: the reveal's own read-log id lets ITS actor re-open the row unmasked (15 min); nobody else's.
    expect(open.revealGrant).toMatch(/^\d+$/);
    expect(await trailSvc.getById(tA, adminActor, e.id, open.revealGrant)).toMatchObject({ masked: false, newValue: { phone: '+919812345678' } });
    expect(await trailSvc.getById(tA, { userId: auditorU, canRead: true, roles: ['auditor'] }, e.id, open.revealGrant)).toMatchObject({ masked: true, newValue: { phone: MASK } });
    expect(await trailSvc.getById(tA, adminActor, e.id, '1')).toMatchObject({ masked: true });
    // One entry opened → a trail_entry row.
    await trailSvc.getById(tA, { userId: auditorU, canRead: true, roles: ['auditor'] }, e.id);
    expect((await admin.query(`SELECT count(*)::int AS n FROM audit_read_log WHERE tenant_id = $1 AND purpose = 'trail_entry' AND span_first = $2`, [tA, e.id])).rows[0].n).toBe(4);
    // The flag OFF is a named state, not a 404.
    await setFlag('audit_trail', false);
    await expect(trailSvc.list(tA, { userId: auditorU, canRead: true, roles: ['auditor'] }, { limit: 5 } as never)).rejects.toMatchObject({ code: 'AUDITOR_REALM_OFF' });
    await setFlag('audit_trail', true);
  });

  it('F-11 · THE REALM\'S ONE ACT: the export enqueue → ready; the receipt carries the UNSIGNED note; A\'s file never holds B\'s rows', async () => {
    const d = await today();
    // THE PLANE'S QUEUE IS ONE CROSS-TENANT FIFO (and its ETA reads the last runs), which 6e-2's own suite asserts is
    // empty while it runs in parallel: each file here is enqueued, made, read and REMOVED before the next, so at most one
    // of ours exists at any moment, for the length of its own assertions.
    const oneFile = async (datasetCode: 'ledger.entries' | 'audit.trail' | 'compliance.pack', params: Record<string, string>, also?: (jobId: string) => Promise<void>) => {
      const job = await auditor.enqueueExport(tA, auditorActor, `k-${randomUUID()}`, { datasetCode, params: params as never }, '10.0.0.1');
      try {
        expect(job.status).toBe('queued');
        expect((await admin.query(`SELECT count(*)::int AS n FROM audit_read_log WHERE tenant_id = $1 AND purpose = 'export_enqueue' AND span_first = $2`, [tA, job.id])).rows[0].n).toBe(1);
        expect(await worker.generate({ id: job.id, tenantId: tA })).toBe('ready');
        const view = (await auditor.exportsList(tA, auditorActor, {})).items.find((j) => j.id === job.id)!;
        const key = (await admin.query(`SELECT storage_key FROM tenant_export_jobs WHERE id = $1`, [job.id])).rows[0].storage_key;
        if (also) await also(job.id);
        return { view, csv: store.objects.get(key)!.toString('utf8') };
      } finally {
        await admin.query(`DELETE FROM tenant_export_downloads WHERE job_id = $1`, [job.id]);
        await admin.query(`DELETE FROM tenant_export_jobs WHERE id = $1`, [job.id]);
      }
    };
    const ledgerFile = await oneFile('ledger.entries', { from: d, to: d }, async (jobId) => {
      // Tenant B's admin never sees A's job.
      expect((await auditor.exportsList(tB, { userId: adminB, roles: ['tenant_admin'], permissions: await permsOf('tenant_admin'), requestId: null }, {})).items.map((x) => x.id)).not.toContain(jobId);
    });
    expect(ledgerFile.view.status).toBe('ready');
    expect(ledgerFile.view.receipt!.notes[0]).toBe(UNSIGNED_NOTE);
    expect(ledgerFile.view.receipt!.notes.join(' ')).toMatch(/WITHHELD/);
    const csv = ledgerFile.csv;
    expect(csv).toContain(txA1); expect(csv).toContain(txA2); expect(csv).not.toContain(txB1); expect(csv).not.toContain(accB);
    expect(csv).toContain('withheld_shared_stripe'); expect(csv).toContain('linked_genesis');
    expect(ledgerFile.view.receipt!.rowCount).toBe(5);
    expect(csv.split('\n').filter((l) => l.includes(txA3))).toHaveLength(1);
    // A pack section is its own file, also unsigned; the trail export is masked as on screen.
    const packFile = await oneFile('compliance.pack', { section: 'ledger', from: d, to: d });
    expect(packFile.view.receipt!.notes[0]).toBe(UNSIGNED_NOTE);
    expect(packFile.csv).toContain('platform_account_chains');
    const trailFile = await oneFile('audit.trail', { from: d, to: d });
    expect(trailFile.view.receipt!.notes[0]).toBe(UNSIGNED_NOTE);
    expect(trailFile.csv).toContain('itest.member_edit'); expect(trailFile.csv).not.toContain('9812345678'); expect(trailFile.csv).toContain(MASK);
    // A window over one year is refused by the producer's own schema — nothing becomes a row.
    await expect(auditor.enqueueExport(tA, auditorActor, `k-${randomUUID()}`, { datasetCode: 'ledger.entries', params: { from: '2024-01-01', to: d } }, null)).rejects.toMatchObject({ code: 'EXPORT_PARAMS_INVALID' });
    expect((await admin.query(`SELECT count(*)::int AS n FROM tenant_export_jobs WHERE tenant_id = $1`, [tA])).rows[0].n).toBe(0);
  });

  it('W437 · the pack computed on read: the quarter from the DECLARED fiscal year; a tenant override moves it; unsigned by name', async () => {
    const p = await auditor.compliancePack(tA, auditorActor, {});
    expect(p.attestation).toEqual({ status: 'unsigned', signable: false, reason: 'no_signing_key' });
    expect(p.quarter).not.toBeNull();
    expect(p.window.from).toBe(p.quarter!.start);
    expect(p.sections.ledger).toMatchObject({ sharedChains: 'unverifiable' });
    expect(p.sections.privacy.members).toBeGreaterThanOrEqual(4);
    expect((await admin.query(`SELECT purpose FROM audit_read_log WHERE id = $1`, [p.logged.readId])).rows[0].purpose).toBe('compliance_pack');
    expect((await admin.query(`SELECT tenant_fiscal_year_start_month($1) AS m`, [tA])).rows[0].m).toBe(4);
    await admin.query(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'finance.fiscal_year_start_month', '7'::jsonb)`, [tB]);
    expect((await admin.query(`SELECT tenant_fiscal_year_start_month($1) AS m`, [tB])).rows[0].m).toBe(7);
    const clockB = await new AuditorClockRepository(replica as never).clockOf(tB);
    expect(clockB).toMatchObject({ fyMonth: 7, zone: 'Asia/Kolkata', currency: 'INR' });
  });
});
