// modules/group-lots/__tests__/tenant11c-group-lot-truth.integration.spec.ts · PC-56 TENANT-11c — LIVE proof against real Postgres
// + RLS + the in-process wallet + payments' own settlement handler (no infra mocks). Each block fails on HEAD 405ef03:
//   A1  create + pledge resolve to the group-lots module (idempotent, audited with ip); the console pledges FOR a member only as
//       THIS lot's coordinator; an ambassador's role cannot act on another coordinator's lot (HEAD: both routes died 42703);
//   A7  a member withdraws before the lot lists, and cannot after;
//   A5  extend once (≤ 48 h) then refused; members told; cancel takes a lookup reason, releases pledges, tells members in their
//       language; nudge reaches the non-pledging grower once per 24 h;
//   A2  list creates ONE published listing, the coordinator's, for the pledged quantity (min order = the lot); the order's
//       completion, run AS kv_relay exactly as the relay delivers it (payments' settlement + hop 1 in ONE relay transaction),
//       then hop 2 in kv_app, marks the lot sold and HOLDS the seller net; a redelivery moves nothing;
//   A3  prepare computes the shares (bigint, remainder largest-first) and moves NO money; a confirm by the preparer is refused by
//       the DB trigger and nothing moves; a confirm by a second tenant_admin posts every farmer's share + the fee in ONE txn and
//       stamps the pledges; a second confirm moves 0;
//   A6  a member reads progress + only their own pledge (no other id, no phone); the coordinator reads the masked table + KYC;
//   0188 as kv_app: the settlement's figures are not writable; maker ≠ checker probed directly on the table; tenant B sees nothing.
import { composeOrderSettlement } from '../../payments/services/order-settlement.service';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { makeTenant, makeUser, ensureUnitCurrency } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { QuotaService } from '../../../core/quota/quota.service';
import { TxContext } from '../../../core/database/unit-of-work';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { ListingRepository } from '../../listings/repositories/listing.repository';
import { PriceHistoryRepository } from '../../listings/repositories/price-history.repository';
import { ListingAttributeRepository } from '../../listings/repositories/listing-attribute.repository';
import { ListingMediaRepository } from '../../listings/repositories/listing-media.repository';
import { ListingService } from '../../listings/services/listing.service';
import { SettlementPricingService } from '../../payments/services/settlement-pricing.service';
import { CommissionRuleRepository } from '../../payments/repositories/commission-rule.repository';
import { TaxRuleRepository } from '../../payments/repositories/tax-rule.repository';
import { SettlementLineRepository } from '../../payments/repositories/settlement-line.repository';
import { OrderCompletedHandler } from '../../payments/events/handlers/order-completed.handler';
import { CouponMoneyService } from '../../promotions/services/coupon-money.service';
import { CouponRedemptionRepository } from '../../promotions/repositories/coupon-redemption.repository';
import { GroupLotRepository } from '../repositories/group-lot.repository';
import { GroupLotSettlementRepository } from '../repositories/group-lot-settlement.repository';
import { GroupLotService } from '../services/group-lot.service';
import { GroupLotOrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { GroupLotSaleSettledHandler } from '../events/handlers/sale-settled.handler';
import { GroupLotActor, groupLotActor } from '../policies/group-lot.policies';
import { OutboxEvent } from '../../../core/outbox/event-envelope';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }
const key = () => `idem-${randomUUID()}`;
const H = 3600_000;
const IP = '10.0.0.7';

run('PC-56 TENANT-11c · group lots — settle pays farmers from the real sale, maker ≠ checker (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let svc: GroupLotService; let settle: OrderCompletedHandler; let hop1: GroupLotOrderCompletedHandler; let hop2: GroupLotSaleSettledHandler;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const kavita = randomUUID(); const admin1 = randomUUID(); const admin2 = randomUUID(); const amb = randomUUID(); const buyer = randomUUID();
  const suresh = randomUUID(); const meera = randomUUID(); const ramesh = randomUUID(); const hansa = randomUUID(); const outsider = randomUUID();
  let productId = ''; let categoryId = '';
  let L1 = ''; let L1No = ''; let listingId = ''; let orderId = '';
  const phones: Record<string, string> = {};

  const coordActor: GroupLotActor = { userId: kavita, canCoordinate: true, canManage: false, canApprove: false };
  const admin1Actor: GroupLotActor = { userId: admin1, canCoordinate: true, canManage: true, canApprove: true };
  const admin2Actor: GroupLotActor = { userId: admin2, canCoordinate: true, canManage: true, canApprove: true };
  const member = (u: string): GroupLotActor => ({ userId: u, canCoordinate: false, canManage: false, canApprove: false });
  let ambActor: GroupLotActor;

  const bal = async (u: string, code: 'main' | 'hold') => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0)::text b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code=$2`, [u, code])).rows[0]?.b ?? '0');
  const legsOf = async (idemKey: string) => (await admin.query(
    `SELECT wa.owner_user_id, wa.account_code, le.amount_minor::text AS amt, lv.code AS txn_type
       FROM ledger_transactions lt JOIN ledger_entries le ON le.txn_id = lt.id JOIN wallet_accounts wa ON wa.id = le.account_id JOIN lookup_values lv ON lv.id = lt.txn_type_id
      WHERE lt.idempotency_key = $1 ORDER BY le.amount_minor`, [idemKey])).rows as Array<{ owner_user_id: string | null; account_code: string; amt: string; txn_type: string }>;
  const auditOf = async (entityId: string, action: string) => (await admin.query(`SELECT * FROM audit_log WHERE entity_id=$1 AND action=$2 ORDER BY created_at`, [entityId, action])).rows;
  const outboxOf = async (lotId: string, type: string) => (await admin.query(`SELECT * FROM outbox_events WHERE aggregate_id=$1 AND event_type=$2 ORDER BY id`, [lotId, type])).rows;
  const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string }) => e.code ?? String(e));

  /** The relay's own transaction, AS kv_relay — committed, as OutboxDispatcher.relayOne would run it. */
  async function asRelay<T>(tenantId: string, fn: (tx: TxContext) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_relay');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const tx: TxContext = { query: (sql: string, p?: readonly unknown[]) => c.query(sql, p as unknown[]) as never, tenantId, userId: 'system' };
      const out = await fn(tx);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  /** kv_app on its own connection, RLS-bound to a tenant — for the table-level probes. */
  async function asApp<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c: PoolClient = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app');
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      return await fn(c);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  const addRole = async (u: string, role: string) => {
    const r = (await admin.query(`SELECT id FROM roles WHERE code=$1`, [role])).rows[0].id;
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1,$2,$3,true) ON CONFLICT DO NOTHING`, [u, tenantA, r]);
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B');
    const names: Record<string, string> = { [kavita]: 'Kavita Ben Desai', [admin1]: 'Admin One', [admin2]: 'Admin Two', [amb]: 'Village Ambassador', [buyer]: 'Buyer Bhai',
      [suresh]: 'Suresh Bhai Bhatt', [meera]: 'Meera Ben Joshi', [ramesh]: 'Ramesh Bhai Patel', [hansa]: 'Hansa Ben Vaghela', [outsider]: 'Out Sider' };
    const mid = () => String(Math.floor(10000 + Math.random() * 89999));
    for (const [u, n] of Object.entries(names)) {
      await makeUser(admin, u as ReturnType<typeof randomUUID>);
      phones[u] = `+9196${mid()}402`;
      await admin.query(`UPDATE users SET full_name=$2, phone=$3 WHERE id=$1`, [u, n, phones[u]]);
    }
    await addRole(kavita, 'fpo_coordinator'); await addRole(admin1, 'tenant_admin'); await addRole(admin2, 'tenant_admin'); await addRole(amb, 'ambassador');
    for (const u of [suresh, meera, ramesh, hansa, kavita]) await addRole(u, 'farmer');
    await addRole(buyer, 'customer');
    await admin.query(`UPDATE user_tenant_roles SET kyc_status='verified' WHERE tenant_id=$1 AND user_id = ANY($2::uuid[])`, [tenantA, [suresh, meera]]);
    await admin.query(`UPDATE user_tenant_roles SET kyc_status='pending' WHERE tenant_id=$1 AND user_id=$2`, [tenantA, ramesh]);
    await ensureUnitCurrency(admin, 'quintal');
    categoryId = randomUUID(); const code = `c${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Oilseeds',$3::ltree,1,true)`, [categoryId, code, code]);
    productId = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,'Sesame, white','quintal',$3,true, to_tsvector('simple','sesame'))`, [productId, categoryId, tenantA]);
    // Hansa grows sesame on her own parcel (a crop season) and has not pledged — the nudge's audience.
    const parcel = randomUUID();
    await admin.query(`INSERT INTO land_parcels (id, tenant_id, owner_user_id, area_value) VALUES ($1,$2,$3,2.5)`, [parcel, tenantA, hansa]);
    await admin.query(`INSERT INTO crop_seasons (tenant_id, parcel_id, product_id, season, year) VALUES ($1,$2,$3,'kharif',2026)`, [tenantA, parcel, productId]);

    const ambPerms = (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id=rp.role_id WHERE r.code='ambassador'`)).rows.map((x: { permission_code: string }) => x.permission_code);
    ambActor = groupLotActor({ userId: amb, permissions: new Set(ambPerms) } as never);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const cache = new InMemoryCacheService(); const flags = new FlagsService(pools, cache);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const listings = new ListingService(uow, outbox, new AllowAllQuota(), idem, cache, metrics, new ListingRepository(replica as never), new PriceHistoryRepository(replica as never), new ListingAttributeRepository(), new ListingMediaRepository(), audit);
    svc = new GroupLotService(uow, outbox, idem, metrics, wallet, audit, new GroupLotRepository(replica as never), new GroupLotSettlementRepository(replica as never), listings, new UiMessageRepository(replica as never));
    // `commission_split` is a GLOBAL flag row that two payments specs switch ON while they run; in a parallel run that turns
    // this handler onto its split path. Until PC-56 HOTFIX-2 that path read `commission_rules` as kv_relay and died 42501; it now
    // reads the rules in kv_app's unit of work and survives the flag (the relay-as-kv_relay gate proves it). The pin stays for a
    // different reason: this spec's balances assert the UNSPLIT seller net (seller Main = gross), so the handler runs here with
    // the flag pinned to its seeded default instead of to whatever a neighbouring spec last wrote.
    const pinnedFlags = { isEnabled: async (key: string, c?: unknown) => (key === 'commission_split' ? false : flags.isEnabled(key, c as never)) } as unknown as FlagsService;
    settle = new OrderCompletedHandler(composeOrderSettlement({ wallet: wallet, flags: pinnedFlags, replica, lines: new SettlementLineRepository(), couponMoney: new CouponMoneyService(wallet, new CouponRedemptionRepository(replica as never)), uow: uow }));
    hop1 = new GroupLotOrderCompletedHandler(svc);
    hop2 = new GroupLotSaleSettledHandler(svc);
  }, 120_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tenantA, tenantB]]).catch(() => undefined);
    await pools?.onModuleDestroy(); await admin?.end();
  });

  const lotDto = (over: Record<string, unknown> = {}) => ({ productId, targetQuantity: '50', unitCode: 'quintal', pledgeDeadline: new Date(Date.now() + 24 * H).toISOString(), coordinationFeeBps: 50, ...over }) as never;

  it('A1 · create + pledge resolve to the group-lots module — idempotent, audited with ip; GL number; on-behalf only as THIS lot\'s coordinator', async () => {
    const k = key();
    const a = await svc.create(tenantA, coordActor, k, lotDto(), IP);
    const again = await svc.create(tenantA, coordActor, k, lotDto(), IP);
    expect(again.id).toBe(a.id);
    L1 = a.id; L1No = a.lotNo!;
    expect(L1No).toMatch(/^GL-\d{4}-\d{4}-\d{2}$/);
    expect((await admin.query(`SELECT count(*)::int n FROM group_lots WHERE tenant_id=$1 AND id=$2`, [tenantA, L1])).rows[0].n).toBe(1);
    const created = await auditOf(L1, 'group_lot.created');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actor_user_id: kavita, ip: IP });
    expect(created[0].new_value).toMatchObject({ lotNo: L1No, targetQuantity: '50.000', coordinationFeeBps: 50, coordinatorUserId: kavita, appointed: false });

    const pk = key();
    await svc.pledge(tenantA, member(suresh), pk, L1, { quantity: '18' }, IP);
    await svc.pledge(tenantA, member(suresh), pk, L1, { quantity: '18' }, IP);           // replay — one pledge, one add
    await svc.pledge(tenantA, member(meera), key(), L1, { quantity: '12' }, IP);
    await svc.pledge(tenantA, coordActor, key(), L1, { farmerUserId: ramesh, quantity: '12' }, IP);   // the coordinator, for a member
    const pl = (await admin.query(`SELECT farmer_user_id, quantity::text q, status, recorded_by FROM group_lot_pledges WHERE group_lot_id=$1 ORDER BY quantity DESC, farmer_user_id`, [L1])).rows;
    expect(pl.find((x: any) => x.farmer_user_id === suresh)).toMatchObject({ q: '18.000', status: 'active', recorded_by: suresh });
    expect(pl.find((x: any) => x.farmer_user_id === ramesh)).toMatchObject({ q: '12.000', recorded_by: kavita });
    expect((await admin.query(`SELECT pledged_quantity::text q FROM group_lots WHERE id=$1`, [L1])).rows[0].q).toBe('42.000');
    const pAudit = await auditOf(L1, 'group_lot.pledged');
    expect(pAudit).toHaveLength(3);
    expect(pAudit[2]).toMatchObject({ actor_user_id: kavita, ip: IP });
    expect(pAudit[2].new_value).toMatchObject({ farmerUserId: ramesh, onBehalf: true, pledgedQuantity: '42.000' });
    expect(pAudit[2].old_value).toMatchObject({ pledgedQuantity: '30.000' });

    // a member may not pledge FOR another member; an outsider (no role in the tenant) cannot be pledged for
    expect(await codeOf(svc.pledge(tenantA, member(meera), key(), L1, { farmerUserId: hansa, quantity: '1' }, IP))).toBe('GROUP_LOT_NOT_COORDINATOR');
    expect(await codeOf(svc.pledge(tenantA, coordActor, key(), L1, { farmerUserId: outsider, quantity: '1' }, IP))).toBe('GROUP_LOT_NOT_A_MEMBER');
  }, 60_000);

  it('F-23 · the ambassador ROLE holds no group_lot.coordinate, and even WITH it cannot act on another coordinator\'s lot', async () => {
    expect(ambActor.canCoordinate).toBe(false);
    expect(await codeOf(svc.create(tenantA, ambActor, key(), lotDto(), IP))).toBe('GROUP_LOT_FORBIDDEN');
    const withCoordinate: GroupLotActor = { ...ambActor, canCoordinate: true };   // what 0128 gave the role, role-wide
    expect(await codeOf(svc.markReady(tenantA, withCoordinate, L1, { reason: 'taking over this lot' }, IP))).toBe('GROUP_LOT_NOT_COORDINATOR');
    expect(await codeOf(svc.pledge(tenantA, withCoordinate, key(), L1, { farmerUserId: hansa, quantity: '1' }, IP))).toBe('GROUP_LOT_NOT_COORDINATOR');
    expect(await codeOf(svc.cancel(tenantA, withCoordinate, L1, { reasonCode: 'quality' }, IP))).toBe('GROUP_LOT_NOT_COORDINATOR');
    expect(await codeOf(svc.nudge(tenantA, withCoordinate, L1, {}, IP))).toBe('GROUP_LOT_NOT_COORDINATOR');
    // appointing another member is tenant_admin's (group_lot.manage) and needs the appointee's recorded consent
    expect(await codeOf(svc.create(tenantA, coordActor, key(), lotDto({ coordinatorUserId: meera }), IP))).toBe('GROUP_LOT_FORBIDDEN');
    expect(await codeOf(svc.create(tenantA, admin1Actor, key(), lotDto({ coordinatorUserId: meera }), IP))).toBe('GROUP_LOT_CONSENT_REQUIRED');
    const ap = await svc.create(tenantA, admin1Actor, key(), lotDto({ coordinatorUserId: meera, consent: { channel: 'otp', note: 'confirmed on call' } }), IP);
    expect((await admin.query(`SELECT coordinator_user_id, appointed_by, consent_id FROM group_lots WHERE id=$1`, [ap.id])).rows[0]).toMatchObject({ coordinator_user_id: meera, appointed_by: admin1 });
    expect((await admin.query(`SELECT act, channel, recorded_by, coordinator_user_id FROM group_lot_consents WHERE group_lot_id=$1`, [ap.id])).rows).toEqual([{ act: 'appoint', channel: 'otp', recorded_by: admin1, coordinator_user_id: meera }]);
    // the appointee coordinates THAT lot without holding any group-lot verb
    await expect(svc.markReady(tenantA, member(meera), ap.id, { reason: 'small trial lot' }, IP)).resolves.toMatchObject({ status: 'ready' });
  }, 60_000);

  it('A7 · a pledge is a promise, not a lock: withdraw before the lot lists (and re-pledge)', async () => {
    const w = await svc.withdraw(tenantA, member(ramesh), L1, IP);
    expect(w).toMatchObject({ pledgedQuantity: '30.000', myPledge: { status: 'withdrawn' } });
    expect((await auditOf(L1, 'group_lot.pledge_withdrawn'))[0]).toMatchObject({ actor_user_id: ramesh, ip: IP });
    expect(await codeOf(svc.withdraw(tenantA, member(ramesh), L1, IP))).toBe('GROUP_LOT_NO_PLEDGE');
    await svc.pledge(tenantA, member(ramesh), key(), L1, { quantity: '10.5' }, IP);
    expect((await admin.query(`SELECT quantity::text q, status FROM group_lot_pledges WHERE group_lot_id=$1 AND farmer_user_id=$2`, [L1, ramesh])).rows[0]).toEqual({ q: '10.500', status: 'active' });
    expect((await admin.query(`SELECT pledged_quantity::text q FROM group_lots WHERE id=$1`, [L1])).rows[0].q).toBe('40.500');
  }, 30_000);

  it('A5 · extend ONCE (≤ 48 h), then refused; every active pledger is told the new deadline', async () => {
    const cur = new Date((await admin.query(`SELECT pledge_deadline FROM group_lots WHERE id=$1`, [L1])).rows[0].pledge_deadline).getTime();
    expect(await codeOf(svc.extend(tenantA, coordActor, L1, { pledgeDeadline: new Date(cur + 49 * H).toISOString(), reason: 'three members close' }, IP))).toBe('GROUP_LOT_EXTENSION_TOO_LONG');
    const e = await svc.extend(tenantA, coordActor, L1, { pledgeDeadline: new Date(cur + 48 * H).toISOString(), reason: 'three members are close to pledging' }, IP);
    expect(e).toMatchObject({ extendedOnce: true, notified: 3 });
    expect(await codeOf(svc.extend(tenantA, coordActor, L1, { pledgeDeadline: new Date(cur + 47 * H).toISOString(), reason: 'once more please' }, IP))).toBe('GROUP_LOT_ALREADY_EXTENDED');
    const a = (await auditOf(L1, 'group_lot.deadline_extended'))[0];
    expect(a).toMatchObject({ actor_user_id: kavita, reason: 'three members are close to pledging', ip: IP });
    expect(a.old_value.extendedOnce).toBe(false);
    const ev = (await outboxOf(L1, 'group_lot.deadline_extended'))[0];
    expect([...ev.payload.recipientUserIds].sort()).toEqual([suresh, meera, ramesh].sort());
    expect(ev.payload).toMatchObject({ lotNo: L1No, product: 'Sesame, white' });
    expect(ev.payload.deadline).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
    // the DB is the wall behind the entity: a second extension by SQL is refused too
    expect(await codeOf(admin.query(`UPDATE group_lots SET pledge_deadline = pledge_deadline + interval '1 hour' WHERE id=$1`, [L1]))).toBe('23514');
  }, 30_000);

  it('A5 · nudge reaches the grower who has not pledged (crop season on her parcel), once per 24 h', async () => {
    const n = await svc.nudge(tenantA, coordActor, L1, { reason: 'deadline approaching' }, IP);
    expect(n).toMatchObject({ recipients: 1, truncated: false, audienceRule: 'crop_season_or_listing', voice: { built: false } });
    const ev = (await outboxOf(L1, 'group_lot.nudge'))[0];
    expect(ev.payload.recipientUserIds).toEqual([hansa]);
    expect(ev.payload).toMatchObject({ lotNo: L1No, product: 'Sesame, white', progress: '81%' });
    expect(await codeOf(svc.nudge(tenantA, coordActor, L1, {}, IP))).toBe('GROUP_LOT_NUDGE_TOO_SOON');
    expect((await auditOf(L1, 'group_lot.nudged'))[0].new_value).toMatchObject({ recipients: 1, audienceRule: 'crop_season_or_listing' });
  }, 30_000);

  it('A6 / F-19 · a member reads progress + ONLY their own pledge; the coordinator reads the masked table with KYC', async () => {
    const m = await svc.getById(tenantA, member(suresh), L1);
    expect(m.pledges).toBeNull();
    expect(m.pledgesRestricted).toBe(true);
    expect(m.myPledge).toMatchObject({ quantity: '18.000', status: 'active' });
    expect(m).toMatchObject({ lotNo: L1No, productName: 'Sesame, white', coordinatorShortName: 'Kavita D.', memberCount: 3, pledgedQuantity: '40.500' });
    const json = JSON.stringify(m);
    for (const other of [meera, ramesh]) expect(json).not.toContain(other);
    for (const ph of Object.values(phones)) expect(json).not.toContain(ph);
    expect(m.viewerCan).toMatchObject({ coordinate: false, extend: false, cancel: false, withdraw: true, pledgeSelf: true, pledgeOnBehalf: false });

    const c = await svc.getById(tenantA, coordActor, L1);
    expect(c.pledgesRestricted).toBe(false);
    const rows = c.pledges as Array<Record<string, unknown>>;
    expect(rows.map((r) => [r.memberShortName, r.quantity, r.kycStatus, r.status])).toEqual([
      ['Suresh B.', '18.000', 'verified', 'active'], ['Meera J.', '12.000', 'verified', 'active'], ['Ramesh P.', '10.500', 'pending', 'active']]);
    expect(rows[0].memberPhoneMasked).toBe(`+91 96••• ••402`);
    expect(JSON.stringify(c)).not.toContain(phones[suresh]);
    expect(c.summary).toEqual({ activeCount: 3, activeQuantity: '40.500', allVerified: false, withdrawnCount: 0 });
    expect(c.pooled).toMatchObject({ available: false, salesCount: 0, needed: 3, pooledPerUnitMinor: null, solo: { built: false } });
  }, 30_000);

  it('A2 · ready below target needs a reason; LIST creates ONE published listing — the coordinator\'s, the pledged quantity, the whole lot', async () => {
    expect(await codeOf(svc.markReady(tenantA, coordActor, L1, {}, IP))).toBe('GROUP_LOT_READY_REASON_REQUIRED');
    await svc.markReady(tenantA, coordActor, L1, { reason: 'list at 40.5 qtl — still the pooled tier' }, IP);
    expect((await auditOf(L1, 'group_lot.ready'))[0]).toMatchObject({ reason: 'list at 40.5 qtl — still the pooled tier', ip: IP });
    const lk = key();
    const r = await svc.listLot(tenantA, coordActor, lk, L1, { pricePerUnitMinor: '1250001' }, IP);
    const again = await svc.listLot(tenantA, coordActor, lk, L1, { pricePerUnitMinor: '1250001' }, IP);
    listingId = r.listing.id;
    expect(again.listing.id).toBe(listingId);
    const l = (await admin.query(`SELECT seller_user_id, group_lot_id, quantity_total::text qt, min_order_qty::text mo, unit_code, price_minor::text p, status::text s, sale_type::text st, title FROM listings WHERE id=$1`, [listingId])).rows[0];
    expect(l).toMatchObject({ seller_user_id: kavita, group_lot_id: L1, unit_code: 'quintal', p: '1250001', s: 'published', st: 'group_lot', title: `Sesame, white — ${L1No}` });
    expect(Number(l.qt)).toBe(40.5); expect(Number(l.mo)).toBe(40.5);
    expect((await admin.query(`SELECT count(*)::int n FROM listings WHERE group_lot_id=$1`, [L1])).rows[0].n).toBe(1);
    expect((await admin.query(`SELECT status, listing_id, listed_at IS NOT NULL AS listed FROM group_lots WHERE id=$1`, [L1])).rows[0]).toEqual({ status: 'listed', listing_id: listingId, listed: true });
    expect((await auditOf(L1, 'group_lot.listed'))[0].new_value).toMatchObject({ listingId, quantity: '40.500', pricePerUnitMinor: '1250001', sellerUserId: kavita });
    // once listed, a pledge can no longer be withdrawn
    expect(await codeOf(svc.withdraw(tenantA, member(meera), L1, IP))).toBe('GROUP_LOT_WITHDRAW_CLOSED');
  }, 30_000);

  it('A2 · the order\'s completion — AS the relay delivers it — marks the lot sold and HOLDS the seller net; a redelivery moves nothing', async () => {
    orderId = randomUUID();
    const total = 50625040n;   // 40.5 qtl × ₹12,500.01, the line as the order module floors it
    await admin.query(`INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, subtotal_minor, total_minor, status) VALUES ($1,$2,$3,$4,$5,$6,$6,'completed')`,
      [orderId, tenantA, `ORD-${randomUUID().slice(0, 12)}`, buyer, kavita, total.toString()]);
    await admin.query(`INSERT INTO order_items (order_id, order_created_at, tenant_id, listing_id, product_id, title_snapshot, quantity, unit_code, unit_price_minor, line_total_minor)
      SELECT $1, o.created_at, $2, $3, $4, 'Sesame, white', 40.5, 'quintal', 1250001, $5 FROM orders o WHERE o.id=$1`, [orderId, tenantA, listingId, productId, total.toString()]);
    // the buyer's money sits in platform escrow, as checkout + payment left it
    await uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${orderId}`, initiatedBy: 'system',
      legs: [{ account: platform(PlatformAccount.Escrow), amountMinor: total }, { account: platform(PlatformAccount.Gateway), amountMinor: -total }] }), { userId: 'system' });
    const event = { id: randomUUID(), tenantId: tenantA, aggregateType: 'order', aggregateId: orderId, eventType: 'orders.order_completed',
      payload: { sellerUserId: kavita, buyerUserId: buyer, totalMinor: total.toString(), deliveryFeeMinor: '0', platformFeeMinor: '0' } } as unknown as OutboxEvent;
    // ONE relay transaction, AS kv_relay: payments settles the seller, then hop 1 enqueues the lot's sale (both commit together)
    await asRelay(tenantA, async (tx) => { await settle.handle(event, tx); await hop1.handle(event, tx); });
    expect(await bal(kavita, 'main')).toBe(total);                                   // payments paid the seller (unchanged path)
    const queued = await outboxOf(L1, 'group_lot.sale_settled');
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ groupLotId: L1, orderId });
    // hop 2, delivered: kv_app's unit of work records the sale and holds the proceeds in ONE transaction
    const evt2 = { id: String(queued[0].id), tenantId: tenantA, aggregateType: 'group_lot', aggregateId: L1, eventType: 'group_lot.sale_settled', payload: queued[0].payload } as OutboxEvent;
    await hop2.handle(evt2);
    const lot = (await admin.query(`SELECT status, sale_order_id, gross_proceeds_minor::text g, hold_txn_id, sold_at IS NOT NULL AS sold FROM group_lots WHERE id=$1`, [L1])).rows[0];
    expect(lot).toMatchObject({ status: 'sold', sale_order_id: orderId, g: total.toString(), sold: true });
    expect(await bal(kavita, 'main')).toBe(0n);
    expect(await bal(kavita, 'hold')).toBe(total);
    expect(await legsOf(`gl-hold:${L1}`)).toEqual([
      { owner_user_id: kavita, account_code: 'main', amt: `-${total}`, txn_type: 'group_lot_hold' },
      { owner_user_id: kavita, account_code: 'hold', amt: total.toString(), txn_type: 'group_lot_hold' }]);
    expect((await auditOf(L1, 'group_lot.sold'))[0]).toMatchObject({ actor_user_id: null });
    expect((await auditOf(L1, 'group_lot.sold'))[0].new_value).toMatchObject({ grossProceedsMinor: total.toString(), sellerNetMinor: total.toString(), orderId });
    // a redelivery of either hop moves nothing
    await hop2.handle(evt2);
    expect(await bal(kavita, 'hold')).toBe(total);
    expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key=$1`, [`gl-hold:${L1}`])).rows[0].n).toBe(1);
  }, 60_000);

  it('A3 · PREPARE computes the shares (bigint, remainder largest-first) and moves NO money', async () => {
    const before = { hold: await bal(kavita, 'hold'), s: await bal(suresh, 'main') };
    const p = await svc.prepare(tenantA, admin1Actor, L1, IP);
    // gross 50,625,040; fee round(gross × 50 / 10000) = 253,125; net 50,371,915 split 18 : 12 : 10.5 → floors 22,387,517 /
    // 14,925,011 / 13,059,385 = 50,371,913; the 2 leftover paise go to the two largest pledges.
    expect(p.settlement).toMatchObject({ status: 'prepared', grossMinor: '50625040', feeMinor: '253125', netMinor: '50371915' });
    const shares = Object.fromEntries((await admin.query(`SELECT farmer_user_id, share_minor::text s FROM group_lot_settlement_lines l JOIN group_lot_settlements s ON s.id=l.settlement_id WHERE s.group_lot_id=$1`, [L1])).rows.map((x: any) => [x.farmer_user_id, x.s]));
    expect(shares).toEqual({ [suresh]: '22387518', [meera]: '14925012', [ramesh]: '13059385' });
    expect(BigInt(shares[suresh]) + BigInt(shares[meera]) + BigInt(shares[ramesh]) + 253125n).toBe(50625040n);
    expect(await bal(kavita, 'hold')).toBe(before.hold);
    expect(await bal(suresh, 'main')).toBe(before.s);
    expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key=$1`, [`gl-settle:${L1}`])).rows[0].n).toBe(0);
    expect((await auditOf(L1, 'group_lot.settlement_prepared'))[0].new_value).toMatchObject({ movedMinor: '0', lines: 3 });
    expect(await codeOf(svc.prepare(tenantA, coordActor, L1, IP))).toBe('GROUP_LOT_ALREADY_PREPARED');
  }, 30_000);

  it('A3 · maker ≠ checker: the PREPARER\'s confirm is refused by the DB trigger and nothing moves; the coordinator holds no approve', async () => {
    const hold = await bal(kavita, 'hold');
    expect(await codeOf(svc.confirm(tenantA, admin1Actor, key(), L1, { reason: 'all pledges verified' }, IP))).toBe('GROUP_LOT_CHECKER_IS_MAKER');
    expect(await bal(kavita, 'hold')).toBe(hold);
    expect(await bal(suresh, 'main')).toBe(0n);
    expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key=$1`, [`gl-settle:${L1}`])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT status FROM group_lot_settlements WHERE group_lot_id=$1`, [L1])).rows[0].status).toBe('prepared');
    expect(await codeOf(svc.confirm(tenantA, coordActor, key(), L1, {}, IP))).toBe('GROUP_LOT_FORBIDDEN');
    // and the wall itself, probed as kv_app directly on the table: confirmed_by = prepared_by → check_violation
    const sid = (await admin.query(`SELECT id FROM group_lot_settlements WHERE group_lot_id=$1`, [L1])).rows[0].id;
    expect(await asApp(tenantA, (c) => codeOf(c.query(`UPDATE group_lot_settlements SET status='confirmed', confirmed_by=$2, confirmed_at=now(), settlement_txn_id=$3 WHERE id=$1`, [sid, admin1, randomUUID()])))).toBe('23514');
    expect(await asApp(tenantA, (c) => codeOf(c.query(`UPDATE group_lot_settlements SET status='confirmed', confirmed_by=$2, confirmed_at=now(), settlement_txn_id=$3 WHERE id=$1`, [sid, kavita, randomUUID()])))).toBe('23514');
  }, 30_000);

  it('A3 · a SECOND tenant_admin confirms: ONE txn pays every farmer\'s share + the fee from the hold; pledges stamped; a second confirm moves 0', async () => {
    const c = await svc.confirm(tenantA, admin2Actor, key(), L1, { reason: 'pledges and sale checked' }, IP);
    expect(c).toMatchObject({ movedMinor: '50625040', alreadyConfirmed: false });
    expect(await bal(kavita, 'hold')).toBe(0n);
    expect(await bal(suresh, 'main')).toBe(22387518n);
    expect(await bal(meera, 'main')).toBe(14925012n);
    expect(await bal(ramesh, 'main')).toBe(13059385n);
    expect(await bal(kavita, 'main')).toBe(253125n);
    const legs = await legsOf(`gl-settle:${L1}`);
    expect(legs.map((l) => [l.owner_user_id, l.account_code, l.amt])).toEqual([
      [kavita, 'hold', '-50625040'], [kavita, 'main', '253125'], [ramesh, 'main', '13059385'], [meera, 'main', '14925012'], [suresh, 'main', '22387518']]);
    expect(new Set(legs.map((l) => l.txn_type))).toEqual(new Set(['group_lot_settle']));
    const stamped = (await admin.query(`SELECT farmer_user_id, settled_share_minor::text s, settlement_txn_id FROM group_lot_pledges WHERE group_lot_id=$1 AND status='active'`, [L1])).rows;
    expect(stamped.every((x: any) => x.settlement_txn_id === c.settlementTxnId)).toBe(true);
    expect((await admin.query(`SELECT status, settlement_txn_id FROM group_lots WHERE id=$1`, [L1])).rows[0]).toEqual({ status: 'settled', settlement_txn_id: c.settlementTxnId });
    const a = (await auditOf(L1, 'group_lot.settled'))[0];
    expect(a).toMatchObject({ actor_user_id: admin2, reason: 'pledges and sale checked', ip: IP });
    expect(a.new_value).toMatchObject({ paidMembers: 3, preparedBy: admin1, grossMinor: '50625040' });
    const notices = await outboxOf(L1, 'group_lot.settled');
    expect(notices.map((n: any) => [n.payload.recipientUserIds[0], n.payload.share]).sort()).toEqual([
      [meera, 'INR 149,250.12'], [ramesh, 'INR 130,593.85'], [suresh, 'INR 223,875.18']].sort());
    // a second confirm (a new key) moves nothing
    const again = await svc.confirm(tenantA, admin2Actor, key(), L1, {}, IP);
    expect(again).toMatchObject({ movedMinor: '0' });
    expect(await bal(suresh, 'main')).toBe(22387518n);
    expect((await admin.query(`SELECT count(*)::int n FROM ledger_transactions WHERE idempotency_key=$1`, [`gl-settle:${L1}`])).rows[0].n).toBe(1);
    // the member's own read shows their own settled line only
    const m = await svc.getById(tenantA, member(meera), L1);
    expect(m.settlement).toMatchObject({ status: 'confirmed', linesRestricted: true });
    expect(m.settlement!.lines).toEqual([expect.objectContaining({ shareMinor: '14925012', isMine: true })]);
  }, 60_000);

  it('A5 · cancel takes a lookup reason (`other` needs the words), releases pledges, withdraws the listing, tells members in their language', async () => {
    const L2 = (await svc.create(tenantA, coordActor, key(), lotDto(), IP)).id;
    await svc.pledge(tenantA, member(suresh), key(), L2, { quantity: '5' }, IP);
    await svc.pledge(tenantA, member(meera), key(), L2, { quantity: '7' }, IP);
    await svc.markReady(tenantA, coordActor, L2, { reason: 'small trial lot' }, IP);
    const lst = await svc.listLot(tenantA, coordActor, key(), L2, { pricePerUnitMinor: '1000000' }, IP);
    expect(await codeOf(svc.cancel(tenantA, coordActor, L2, { reasonCode: 'nonsense' }, IP))).toBe('GROUP_LOT_CANCEL_REASON_REQUIRED');
    expect(await codeOf(svc.cancel(tenantA, coordActor, L2, { reasonCode: 'other' }, IP))).toBe('GROUP_LOT_CANCEL_TEXT_REQUIRED');
    const c = await svc.cancel(tenantA, coordActor, L2, { reasonCode: 'target_missed' }, IP);
    expect(c).toMatchObject({ status: 'cancelled', notified: 2, cancelReasonCode: 'target_missed' });
    expect((await admin.query(`SELECT status::text s FROM listings WHERE id=$1`, [lst.listing.id])).rows[0].s).toBe('archived');
    expect((await admin.query(`SELECT DISTINCT status FROM group_lot_pledges WHERE group_lot_id=$1`, [L2])).rows).toEqual([{ status: 'released' }]);
    const ev = (await outboxOf(L2, 'group_lot.cancelled'))[0];
    expect(ev.payload.reason).toMatchObject({ en: 'the target was not reached by the deadline', gu: 'અંતિમ તારીખ સુધીમાં લક્ષ્ય પૂરું ન થયું' });
    expect([...ev.payload.recipientUserIds].sort()).toEqual([suresh, meera].sort());
    expect((await auditOf(L2, 'group_lot.cancelled'))[0]).toMatchObject({ reason: 'Target missed by the deadline', ip: IP });
  }, 60_000);

  it('0188 as kv_app · the settlement\'s figures are not writable; lines and consents are append-only; tenant B sees nothing', async () => {
    const sid = (await admin.query(`SELECT id FROM group_lot_settlements WHERE group_lot_id=$1`, [L1])).rows[0].id;
    expect(await asApp(tenantA, (c) => codeOf(c.query(`UPDATE group_lot_settlements SET gross_minor = 1 WHERE id=$1`, [sid])))).toBe('42501');
    expect(await asApp(tenantA, (c) => codeOf(c.query(`DELETE FROM group_lot_settlement_lines WHERE settlement_id=$1`, [sid])))).toBe('42501');
    expect(await asApp(tenantA, (c) => codeOf(c.query(`UPDATE group_lots SET gross_proceeds_minor = 1 WHERE id=$1`, [L1])))).toBe('23514');
    expect(await asApp(tenantB, async (c) => Number((await c.query(`SELECT count(*) n FROM group_lot_settlements`)).rows[0].n))).toBe(0);
    expect(await asApp(tenantB, async (c) => Number((await c.query(`SELECT count(*) n FROM group_lot_consents`)).rows[0].n))).toBe(0);
    expect((await admin.query(`SELECT has_table_privilege('kv_relay','group_lots','UPDATE') u, has_table_privilege('kv_relay','group_lot_settlements','SELECT') s`)).rows[0]).toEqual({ u: false, s: false });
  }, 30_000);
});
