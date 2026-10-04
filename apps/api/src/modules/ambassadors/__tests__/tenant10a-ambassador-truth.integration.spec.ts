// modules/ambassadors/__tests__/tenant10a-ambassador-truth.integration.spec.ts · PC-56 TENANT-10a — real PG16, the harness's
// database (the real migrations through 0184 + seeds), every tenant-realm query as `kv_app` under RLS.
//   1. A1 / F-1 (DEV-55) — two earnings accrue → ONE run line stamps BOTH → a second run finds nothing owed and the
//      wallet is unchanged; the audit row names the checker (PC-56 TENANT-SW-b: exception run, tenant Main, maker-checker);
//   2. A1 — the stamp mismatch rolls the wallet leg back (a row stamped behind the payout's back);
//   3. A8 / F-17 — two rows in the SAME millisecond, page size 1: page two is the second row (earnings, roster, referral desk);
//   4. A5 / F-6 — kv_app under a tenant READS the platform plan and CANNOT insert or update a NULL-tenant plan; its own works;
//   5. A10 / F-18 — a second OPEN copy of one code is refused by the partial unique index;
//   6. A4 / F-5 — the sale commission's base is the goods subtotal, and the 6th sale on one farmer accrues nothing;
//   7. F-27 — the sale-commission handler run with the relay's transaction AS kv_relay accrues (it used to die 42501);
//   8. A11 / A12 — the roster and the referral desk name people by short name + MASKED phone; the summaries are real.
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { CommissionPlanRepository } from '../repositories/commission-plan.repository';
import { AmbassadorEarningRepository } from '../repositories/ambassador-earning.repository';
import { ReferralRepository } from '../repositories/referral.repository';
import { AmbassadorEarningService } from '../services/ambassador-earning.service';
import { PayoutRunService } from '../services/payout-run.service';
import { PayoutRunRepository } from '../repositories/payout-run.repository';
import { AmbassadorProfileService } from '../services/ambassador-profile.service';
import { AmbassadorRosterReadModel } from '../read-models/ambassador-roster.read-model';
import { ReferralDeskReadModel } from '../read-models/referral-desk.read-model';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { decodeCursor } from '../domain/cursor';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;

run('PC-56 TENANT-10a · ambassador truth (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let replica: PgReadReplicaProvider;
  let earnings: AmbassadorEarningService; let profiles: AmbassadorProfileService; let roster: AmbassadorRosterReadModel; let desk: ReferralDeskReadModel; let runs: PayoutRunService;
  let eRepo: AmbassadorEarningRepository; let pRepo: AmbassadorProfileRepository; let rRepo: ReferralRepository;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const adminUser = randomUUID(); const ambUser = randomUUID(); const amb2User = randomUUID(); const farmer = randomUUID(); const buyer = randomUUID(); const checkerUser = randomUUID();
  let ambassadorId = ''; let ambassador2Id = '';
  const mgr = { userId: adminUser, canManage: true };

  const bal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const plan = async (code: string) => (await admin.query(`SELECT id FROM commission_plans_ambassador WHERE tenant_id IS NULL AND event_code=$1 AND deleted_at IS NULL LIMIT 1`, [code])).rows[0].id as string;
  const earn = async (ambId: string, amount: number, createdAtSql = 'now()') =>
    (await admin.query(`INSERT INTO ambassador_earnings (tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor, created_at)
       VALUES ($1,$2,$3,'farmer_onboarded','referral',gen_random_uuid(),$4, ${createdAtSql}) RETURNING id, created_at::text AS raw`, [tenantA, ambId, await plan('farmer_onboarded'), amount])).rows[0] as { id: string; raw: string };
  async function asRole<T>(role: string, tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const out = await fn(c); await c.query('ROLLBACK'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  const sqlState = async (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? 'error');

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [adminUser, ambUser, amb2User, farmer, buyer, checkerUser]) await makeUser(admin, u);
    // PC-56 TENANT-SW-b: two tenant_admins (maker + checker) and a funded tenant Main (ambassador pay leaves the TENANT's wallet)
    for (const u of [adminUser, checkerUser]) await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'tenant_admin' ON CONFLICT DO NOTHING`, [u, tenantA]);
    await admin.query(`UPDATE users SET full_name = 'Dinesh Bhai Makwana' WHERE id = $1`, [ambUser]);
    await admin.query(`UPDATE users SET full_name = 'Meera Ben Joshi' WHERE id = $1`, [farmer]);
    for (const u of [ambUser, amb2User, farmer]) await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code = 'farmer' ON CONFLICT DO NOTHING`, [u, tenantA]);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const wallet = new InProcessWalletClient(new LedgerRepository());
    pRepo = new AmbassadorProfileRepository(replica as any); eRepo = new AmbassadorEarningRepository(replica as any); rRepo = new ReferralRepository(replica as any);
    roster = new AmbassadorRosterReadModel(replica as any); desk = new ReferralDeskReadModel(replica as any);
    earnings = new AmbassadorEarningService(uow, outbox, idem, metrics, wallet, audit, new CommissionPlanRepository(replica as any), eRepo, pRepo);
    runs = new PayoutRunService(uow, outbox, idem, metrics, wallet, audit, new PayoutRunRepository(replica as any), eRepo, pRepo);
    await uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund-tenant:${randomUUID()}`, initiatedBy: 'system',
      legs: [{ account: { kind: 'tenant', tenantId: tenantA, accountCode: 'main' }, amountMinor: 1_000_000n }, { account: { kind: 'platform', accountCode: 'gateway' }, amountMinor: -1_000_000n }] }), { userId: 'system' });
    profiles = new AmbassadorProfileService(uow, outbox, metrics, idem, audit, pRepo, roster);
    ambassadorId = (await profiles.enroll(tenantA, mgr, { userId: ambUser, clusterRegionIds: [], kioskEnabled: true, aepsEnabled: false, monthlyStipendMinor: '0' }, `k-${randomUUID()}`, null)).id;
    ambassador2Id = (await profiles.enroll(tenantA, mgr, { userId: amb2User, clusterRegionIds: [], kioskEnabled: false, aepsEnabled: true, monthlyStipendMinor: '0' }, `k-${randomUUID()}`, null)).id;
  }, 60000);
  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  // PC-56 TENANT-SW-b: the 10a payout is an EXCEPTION RUN — prepared by one tenant_admin, confirmed (and paid) by ANOTHER, from the TENANT
  // Main wallet. The 10a guarantees are re-proven through it: both earnings stamped by ONE line, nothing paid twice, the stamp mismatch rolls
  // the line's wallet leg back.
  it('A1 · ambassador payout: two earnings → ONE line stamps BOTH → a second run finds nothing owed and the wallet is unchanged', async () => {
    await earn(ambassadorId, 2500); await earn(ambassadorId, 5000);
    const before = await bal(ambUser);
    const prepared: any = await runs.prepareByPerson(tenantA, { userId: adminUser }, { kind: 'exception', ambassadorId, reason: 'weekly earnings run' }, `idem-${randomUUID()}`);
    const out: any = await runs.confirm(tenantA, { userId: checkerUser }, prepared.id, 'weekly earnings run', `idem-${randomUUID()}`);
    expect(out).toMatchObject({ paid: 1, paidMinor: '7500', status: 'paid' });
    const lineId = (await admin.query(`SELECT id FROM ambassador_payout_run_lines WHERE run_id=$1`, [prepared.id])).rows[0].id;
    const rows = (await admin.query(`SELECT payout_id FROM ambassador_earnings WHERE ambassador_id=$1`, [ambassadorId])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.payout_id === lineId)).toBe(true);                // DEV-55: both were NULL here at 9743e8b
    const afterFirst = await bal(ambUser);
    expect(afterFirst - before).toBe(7500n);
    await expect(runs.prepareByPerson(tenantA, { userId: adminUser }, { kind: 'exception', ambassadorId, reason: 'weekly earnings run' }, `idem-${randomUUID()}`)).rejects.toMatchObject({ code: 'AMB_RUN_NOTHING_OWED' });
    expect(await bal(ambUser)).toBe(afterFirst);                                   // no double pay
    const a = (await admin.query(`SELECT actor_user_id, reason, new_value FROM audit_log WHERE action='ambassador.payout.run' AND entity_id=$1`, [ambassadorId])).rows;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ actor_user_id: checkerUser, reason: 'weekly earnings run' });
    expect(a[0].new_value).toMatchObject({ payoutId: lineId, totalMinor: '7500', count: 2, source: 'tenant_main' });
    const txn = (await admin.query(`SELECT initiated_by, idempotency_key FROM ledger_transactions WHERE reference_id=$1`, [lineId])).rows[0];
    expect(txn.initiated_by).toBe(checkerUser);
    expect(txn.idempotency_key).toBe(`ambrun:${prepared.id}:${ambassadorId}`);
  }, 30000);

  it('A1 · ambassador payout mismatch: a stamp that misses a locked row rolls the line\'s WALLET LEG back (nothing paid)', async () => {
    await earn(ambassador2Id, 1000);
    const before = await bal(amb2User);
    const prepared: any = await runs.prepareByPerson(tenantA, { userId: adminUser }, { kind: 'exception', ambassadorId: ambassador2Id, reason: 'weekly earnings run' }, `idem-${randomUUID()}`);
    // Simulate the DEV-55 class: the repository stamps fewer rows than it locked.
    const real = eRepo.markPaid.bind(eRepo);
    const spy = jest.spyOn(eRepo, 'markPaid').mockImplementation(async (tx, t, keys, p) => { await real(tx, t, keys, p); return keys.length - 1; });
    const out: any = await runs.confirm(tenantA, { userId: checkerUser }, prepared.id, 'weekly earnings run', `idem-${randomUUID()}`);
    spy.mockRestore();
    expect(out).toMatchObject({ paid: 0, failed: 1 });
    expect((await admin.query(`SELECT status, failure_code FROM ambassador_payout_run_lines WHERE run_id=$1`, [prepared.id])).rows[0]).toEqual({ status: 'failed', failure_code: 'PAYOUT_MARK_MISMATCH' });
    expect(await bal(amb2User)).toBe(before);
    expect((await admin.query(`SELECT count(*)::int n FROM ambassador_earnings WHERE ambassador_id=$1 AND payout_id IS NULL`, [ambassador2Id])).rows[0].n).toBe(1);
    const paid: any = await runs.payAgain(tenantA, { userId: checkerUser }, prepared.id, 'weekly earnings run (re-run)', `idem-${randomUUID()}`);
    expect(paid).toMatchObject({ paid: 1, paidMinor: '1000', status: 'paid' });
  }, 30000);

  it('A8 · ambassador earnings: two rows in the SAME millisecond, page size 1 → page two is the second row', async () => {
    // ONE statement, so both rows share the statement's now() — the same millisecond, different microseconds
    const pl = await plan('farmer_onboarded');
    const two = (await admin.query(`INSERT INTO ambassador_earnings (tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor, created_at)
       VALUES ($1,$2,$3,'farmer_onboarded','referral',gen_random_uuid(),11, date_trunc('milliseconds', now()) + interval '456 microseconds'),
              ($1,$2,$3,'farmer_onboarded','referral',gen_random_uuid(),12, date_trunc('milliseconds', now()) + interval '123 microseconds')
       RETURNING id, amount_minor, created_at::text AS raw`, [tenantA, ambassadorId, pl])).rows;
    const a = two.find((r) => String(r.amount_minor) === '11')!; const b = two.find((r) => String(r.amount_minor) === '12')!;
    expect(a.raw.slice(0, 23)).toBe(b.raw.slice(0, 23));                          // same millisecond
    const p1 = await earnings.listForAmbassador(tenantA, ambassadorId, { unpaidOnly: true, limit: 1 });
    expect(p1.items.map((x: any) => x.id)).toEqual([a.id]);
    const p2 = await earnings.listForAmbassador(tenantA, ambassadorId, { unpaidOnly: true, limit: 1, cursor: decodeCursor(p1.nextCursor) });
    expect(p2.items.map((x: any) => x.id)).toEqual([b.id]);                       // the ms cursor skipped this row
  });

  it('A8 · ambassador roster and referral desk keysets are microsecond-exact too', async () => {
    const t = randomUUID(); await makeTenant(admin, t, 'C');
    const u1 = await makeUser(admin); const u2 = await makeUser(admin);
    const ins = await admin.query(`INSERT INTO ambassador_profiles (user_id, tenant_id, created_at) VALUES ($1,$3, date_trunc('milliseconds', now()) + interval '900 microseconds'),
      ($2,$3, date_trunc('milliseconds', now()) + interval '100 microseconds') RETURNING id`, [u1, u2, t]);
    const p1 = await roster.roster(t, { sort: 'recent', limit: 1 });
    expect(p1.total).toBe(2);
    const p2 = await roster.roster(t, { sort: 'recent', limit: 1, cursor: p1.nextCursor ?? undefined });
    expect([p1.items[0].id, p2.items[0]?.id].sort()).toEqual(ins.rows.map((r) => r.id).sort());
    await admin.query(`INSERT INTO referrals (tenant_id, referrer_user_id, code, created_at) VALUES ($1,$2,'CODEAAA1', date_trunc('milliseconds', now()) + interval '800 microseconds'),
      ($1,$2,'CODEAAA2', date_trunc('milliseconds', now()) + interval '200 microseconds')`, [t, u1]);
    const r1 = await desk.list(t, { limit: 1 });
    const r2 = await desk.list(t, { limit: 1, cursor: r1.nextCursor ?? undefined });
    expect([r1.items[0].code, r2.items[0]?.code]).toEqual(['CODEAAA1', 'CODEAAA2']);
  });

  it('A5 · ambassador commission plans: kv_app READS the platform plan and cannot INSERT or UPDATE a NULL-tenant plan', async () => {
    const pid = await plan('first_sale_facilitated');
    expect(await asRole('kv_app', tenantA, async (c) => (await c.query(`SELECT id FROM commission_plans_ambassador WHERE id=$1`, [pid])).rows.length)).toBe(1);
    expect(await asRole('kv_app', tenantA, (c) => sqlState(c.query(`INSERT INTO commission_plans_ambassador (tenant_id, event_code, amount_minor) VALUES (NULL, 'farmer_onboarded', 999999)`)))).toBe('42501');
    // UPDATE of the platform row: USING (tenant_id = current) admits no row — nothing is rewritten, silently zero.
    const n = await asRole('kv_app', tenantA, async (c) => (await c.query(`UPDATE commission_plans_ambassador SET amount_minor = 999999 WHERE id=$1`, [pid])).rowCount);
    expect(n).toBe(0);
    // a tenant moving its own row to NULL is refused by WITH CHECK
    expect(await asRole('kv_app', tenantA, async (c) => {
      const mine = (await c.query(`INSERT INTO commission_plans_ambassador (tenant_id, event_code, amount_minor) VALUES ($1, 'farmer_onboarded', 3000) RETURNING id`, [tenantA])).rows[0].id;
      return sqlState(c.query(`UPDATE commission_plans_ambassador SET tenant_id = NULL WHERE id=$1`, [mine]));
    })).toBe('42501');
    // another tenant's override is invisible
    expect(await asRole('kv_app', tenantB, async (c) => {
      await c.query(`SET LOCAL ROLE NONE`); await c.query(`INSERT INTO commission_plans_ambassador (tenant_id, event_code, amount_minor) VALUES ($1, 'farmer_onboarded', 3000)`, [tenantA]);
      await c.query(`SET LOCAL ROLE kv_app`);
      return (await c.query(`SELECT 1 FROM commission_plans_ambassador WHERE tenant_id=$1`, [tenantA])).rows.length;
    })).toBe(0);
    const pol = (await admin.query(`SELECT polname, polcmd FROM pg_policy WHERE polrelid='commission_plans_ambassador'::regclass ORDER BY polname`)).rows.map((r) => `${r.polname}:${r.polcmd}`);
    expect(pol).toEqual(['cpa_admin_realm:*', 'cpa_insert_own:a', 'cpa_read:r', 'cpa_update_own:w']);
  });

  it('A10 · ambassador referral codes: a second OPEN copy of one code is refused (23505)', async () => {
    await admin.query(`INSERT INTO referrals (tenant_id, referrer_user_id, code) VALUES ($1,$2,'ONECODE1')`, [tenantA, ambUser]);
    expect(await sqlState(admin.query(`INSERT INTO referrals (tenant_id, referrer_user_id, code) VALUES ($1,$2,'ONECODE1')`, [tenantA, amb2User]))).toBe('23505');
    // a CLAIMED copy (referee set) is not an open code
    expect(await sqlState(admin.query(`INSERT INTO referrals (tenant_id, referrer_user_id, referee_user_id, code, status) VALUES ($1,$2,$3,'ONECODE1','signed_up')`, [tenantA, amb2User, buyer]))).toBe('ok');
  });

  it('A4 + F-27 · ambassador sale commission: run AS kv_relay, base = goods subtotal, the 6th sale on one farmer pays nothing', async () => {
    await admin.query(`INSERT INTO referrals (tenant_id, referrer_user_id, referee_user_id, code, status) VALUES ($1,$2,$3,'DINESH22','activated')`, [tenantA, ambUser, farmer]);
    const handler = new OrderCompletedHandler(uow, rRepo, pRepo, earnings);
    const orderIds: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = randomUUID(); orderIds.push(id);
      await admin.query(`INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, delivery_fee_minor, platform_fee_minor, total_minor, status, version, created_at)
        VALUES ($1,$2,$3,$4,$5,'direct','INR',400000,30000,22000,452000,'completed',1, now())`, [id, tenantA, `KV-${id.slice(0, 8)}`, buyer, farmer]);
      // the relay's own transaction, AS kv_relay (the worker's role): before F-27 the handler queried through it and died 42501
      await asRole('kv_relay', tenantA, async (c) => {
        const relayTx = { query: (sql: string, p?: readonly unknown[]) => c.query(sql, p as unknown[]) as never, tenantId: tenantA, userId: 'system' };
        await handler.handle({ id: String(i), tenantId: tenantA, aggregateType: 'order', aggregateId: id, eventType: 'orders.order_completed', payload: { sellerUserId: farmer, totalMinor: '452000' } } as never, relayTx as never);
      });
    }
    const rows = (await admin.query(`SELECT reference_id, amount_minor::text a, subject_user_id FROM ambassador_earnings WHERE ambassador_id=$1 AND event_code='first_sale_facilitated' ORDER BY created_at`, [ambassadorId])).rows;
    expect(rows).toHaveLength(5);                                                   // max_sales_per_farmer: 5
    expect(rows.every((r) => r.a === '4000')).toBe(true);                           // 1% of 400000 (goods), not of 452000
    expect(rows.every((r) => r.subject_user_id === farmer)).toBe(true);
    expect(rows.map((r) => r.reference_id)).toEqual(orderIds.slice(0, 5));
  }, 60000);

  it('A11 / A12 · ambassador roster + referral desk: short name, MASKED phone, owed, onboarded 30d, summaries', async () => {
    await admin.query(`UPDATE referrals SET activated_at = now() WHERE code='DINESH22' AND tenant_id=$1`, [tenantA]);
    const page = await roster.roster(tenantA, { sort: 'owed', limit: 50 });
    const me = page.items.find((x) => x.id === ambassadorId)!;
    const phone = (await admin.query(`SELECT phone FROM users WHERE id=$1`, [ambUser])).rows[0].phone as string;
    expect(me.displayName).toBe('Dinesh Bhai M.');
    expect(me.phoneMasked).toMatch(/^\+91 \d{2}••• ••\d{3}$/);
    expect(JSON.stringify(page)).not.toContain(phone.slice(3));                    // the full number never crosses
    expect(BigInt(me.owedMinor)).toBe(20000n + 23n);                                // 5 × 4000 sale + 11 + 12 unpaid
    expect(me.onboarded30d).toBe(1);
    expect(page.items[0].id).toBe(ambassadorId);                                    // Owed ▾
    const s = await roster.summary(tenantA);
    expect(s).toMatchObject({ activeCount: 2, kioskCount: 1, aepsCount: 1, onboarded30d: 1, uncoveredVillages: null, uncoveredReason: 'tenant_village_set_not_recorded' });
    expect(BigInt(s.owedThisWeekMinor)).toBe(20023n);
    expect(s.newMembers30d).toBeGreaterThanOrEqual(3);
    const d = await desk.list(tenantA, { limit: 50 });
    const row = d.items.find((x) => x.code === 'DINESH22')!;
    expect(row.referrer).toMatchObject({ displayName: 'Dinesh Bhai M.', isAmbassador: true });
    expect(row.referee).toMatchObject({ displayName: 'Meera Ben J.' });
    expect(row.reward).toEqual({ state: 'not_configured' });
    const open = d.items.find((x) => x.code === 'ONECODE1' && x.status === 'invited')!;
    expect(open.referee).toBeNull();                                                // "not yet joined" — no invitee column
    const ds = await desk.summary(tenantA);
    expect(ds).toMatchObject({ rewardsPaid30dMinor: null, rewardsPaidReason: 'reward_rule_not_configured', activated30d: 1 });
    expect(ds.invites30d).toBeGreaterThanOrEqual(3);
  });
});
