// modules/payments/__tests__/tenant-swa-commission-zones-cod-pod.integration.spec.ts · PC-56 TENANT-SW-a — LIVE proof against real
// Postgres + RLS, through the REAL AppModule (DI exactly as production wires it) and, for settlement, the REAL OutboxDispatcher LOGGED IN
// as kv_relay. Founder decisions: PLATFORM SHARE = PLAN FLOOR · FREEZE AT PLACEMENT + 7-DAY NOTICE + CHECKER · COD CASH IS A LEDGER FACT ·
// ESCROW HOLDS ONLY ON A FLAGGED POD. Each block fails on HEAD e2e042a:
//   A1  `platformShareBps` refused by the DTO (strict) AND by the trigger (a tenant row whose share ≠ the plan floor); a confirmed rule
//       carries the PLAN's figure (1200 bps on this tenant's plan), never the tenant's;
//   A3  effective_from < next IST midnight + 7 days refused by the service AND the database (proposal + rule row); a proposal needs a
//       SECOND tenant_admin (the trigger refuses the proposer); a one-admin tenant is told so; the job applies at the effective midnight
//       and tells every member (en/hi/gu maps); no tenant row is written without a confirmed proposal; a tenant rule is never edited;
//   A2  the commission rule is FROZEN at placement and settlement uses it even after a later rule is in force (zero-sum); an order
//       with no snapshot is resolved once at completion and recorded;
//   A4  charged_to = buyer adds a buyer charge at placement and settles the seller on the full goods value (zero-sum);
//   B   zone quote = zone charge with buyer_charges ON; the zone id is on the order; an unserviceable pincode is refused kindly; zone
//       create / fee re-point need a checker; a fee may point only at a W150-approved definition; the zone gate refuses raw writes;
//   C   COD collect → rider cash-in-hand negative + escrow funded → settlement runs; remit + reconcile (two people) → rider at zero and
//       the bank clearing fact; the cap refuses at delivery; a shortfall lands on the ORDER and holds settlement until paid; the cash
//       day close needs a second person, accounts for every open remittance, and is idempotent;
//   D   POD auto-clears on its timer; a flagged POD holds settlement (the completion is deferred) and approve releases it through the
//       outbox (settles once); reject needs a checker and opens a qty_mismatch dispute with the POD evidence; the driver and the
//       dispatcher cannot review;
//   µs  rows written in ONE transaction page exactly once.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { makeTenant, makeUser, ensureUnitCurrency, makePlan, activateSubscription, ListingFixture } from '../../../../test/helpers/fixtures';
import { OutboxDispatcher, OutboxHandlerRegistry, RelayOutcome } from '../../../core/outbox/outbox.dispatcher';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { platform, PlatformAccount, userCashInHand } from '../../../core/wallet/account-codes';
import { uuidv7 } from '../../../core/database/uuid.util';
import { CommissionRuleService } from '../services/commission-rule.service';
import { CreateCommissionRuleSchema } from '../dto/create-commission-rule.dto';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { SettlementHoldReleasedHandler } from '../events/handlers/settlement-hold-released.handler';
import { ChargePricingService } from '../services/charge-pricing.service';
import { addDays, istToday } from '../domain/commission-proposal';
import { CheckoutService } from '../../orders/services/checkout.service';
import { DeliveryZoneService } from '../../logistics/services/delivery-zone.service';
import { ShipmentService } from '../../logistics/services/shipment.service';
import { CodRemittanceService } from '../../logistics/services/cod-remittance.service';
import { CodLedgerService } from '../../logistics/services/cod-ledger.service';
import { PodReviewService, PodAutoClearJob } from '../../logistics/services/pod-review.service';
import { SettingProposalsJob } from '../../tenancy/jobs/setting-proposals.job';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const key = () => `swa-${randomUUID()}`;
const IP = '10.0.56.1';
const WHY = 'Board resolution 21/2026: direct-sale commission for the kharif season, agreed at the AGM';
const FLAGS = ['buyer_charges', 'commission_split', 'cod_ledger', 'pod_review', 'tenant_commission_rules', 'logistics'];

run('PC-56 TENANT-SW-a · commission, zones, COD, POD (integration, real Postgres, real AppModule, settlement as kv_relay)', () => {
  let app: INestApplication; let admin: Pool; let relayPool: Pool; let uow: UnitOfWork; let wallet: WalletPort;
  let rules: CommissionRuleService; let checkout: CheckoutService; let zones: DeliveryZoneService; let ships: ShipmentService;
  let remits: CodRemittanceService; let cod: CodLedgerService; let pod: PodReviewService; let job: SettingProposalsJob; let podJob: PodAutoClearJob;
  let charges: ChargePricingService; let settleRegistry: OutboxHandlerRegistry;
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];
  const tA = randomUUID(); const tOne = randomUUID();
  const a1 = randomUUID(); const a2 = randomUUID(); const solo = randomUUID(); const c1 = randomUUID();
  const buyer = randomUUID(); const seller = randomUUID(); const rider = randomUUID();
  let listing: ListingFixture; let addrServed = ''; let addrUnserved = ''; let defApproved = ''; let defUnapproved = ''; let zoneId = '';
  const today = istToday();
  const mgr = (u: string) => ({ userId: u, canManage: true });
  const lead = (u: string) => ({ userId: u, canPropose: true });
  const codeOf = (p: Promise<unknown>) => p.then(() => 'ok', (e: { code?: string; message?: string }) => e.code ?? String(e.message ?? e));
  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const addRole = async (u: string, role: string, tenant: string) => {
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code=$3 ON CONFLICT DO NOTHING`, [u, tenant, role]);
  };
  /** kv_app, inside a transaction that always rolls back: a raw probe of what the DATABASE allows (no service in the way). */
  async function asApp<T>(tenantId: string, userId: string | null, fn: (probe: (sql: string, p?: unknown[]) => Promise<string>, c: PoolClient) => Promise<T>): Promise<T> {
    const c = await admin.connect();
    try {
      await c.query('SET SESSION AUTHORIZATION kv_app'); await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [userId ?? '']);
      const probe = async (sql: string, p: unknown[] = []) => {
        await c.query('SAVEPOINT p');
        try { await c.query(sql, p); await c.query('RELEASE SAVEPOINT p'); return 'ok'; }
        catch (e) { await c.query('ROLLBACK TO SAVEPOINT p'); const x = e as { code?: string; message?: string }; return `${x.code}:${(x.message ?? '').match(/\[([A-Z0-9_]+)\]/)?.[1] ?? ''}`; }
      };
      return await fn(probe, c);
    } finally { await c.query('ROLLBACK').catch(() => undefined); await c.query('RESET SESSION AUTHORIZATION').catch(() => undefined); c.release(); }
  }
  /** TIME TRAVEL ONLY: a superuser statement with triggers off (session_replication_role = replica) — used to put a rule "in force today"
   *  that the 7-day law would only allow next week, or to age a POD timer. CHECK constraints still apply; the walls under test are not
   *  bypassed by any assertion below — every refusal is asserted through kv_app or a service. */
  async function travel(sql: string, p: unknown[] = []): Promise<any[]> {
    const c = await admin.connect();
    try { await c.query(`SET session_replication_role = replica`); return (await c.query(sql, p)).rows; }
    finally { await c.query(`SET session_replication_role = origin`).catch(() => undefined); c.release(); }
  }
  async function relay(eventType: string, aggregateId: string, payload: Record<string, unknown>): Promise<RelayOutcome> {
    const id = (await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'order',$2,$3,$4::jsonb) RETURNING id`,
      [tA, aggregateId, eventType, JSON.stringify(payload)])).rows[0].id as string;
    return new OutboxDispatcher(relayPool, settleRegistry, { inc: () => undefined, observe: () => undefined } as never).relayById(String(id));
  }
  async function legsOf(idemKey: string): Promise<Array<{ owner_kind: string; account_code: string; amt: bigint; owner_user_id: string | null }>> {
    const r = await admin.query(`SELECT wa.owner_kind, wa.account_code, wa.owner_user_id, le.amount_minor::text amt FROM ledger_transactions lt JOIN ledger_entries le ON le.txn_id = lt.id
                                   JOIN wallet_accounts wa ON wa.id = le.account_id WHERE lt.idempotency_key=$1`, [idemKey]);
    return r.rows.map((x) => ({ ...x, amt: BigInt(x.amt) }));
  }
  const sum = (legs: Array<{ amt: bigint }>) => legs.reduce((a, l) => a + l.amt, 0n);
  const leg = (legs: Array<{ account_code: string; amt: bigint }>, code: string) => legs.filter((l) => l.account_code === code).reduce((a, l) => a + l.amt, 0n);
  async function makeListing(): Promise<ListingFixture> {
    await ensureUnitCurrency(admin, 'quintal');
    const categoryId = randomUUID(); const code = `s${randomUUID().replace(/-/g, '').slice(0, 14)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'Groundnut',$3::ltree,1,true)`, [categoryId, code, code]);
    const productId = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,'Groundnut','quintal',$3,true, to_tsvector('simple','groundnut'))`, [productId, categoryId, tA]);
    const id = randomUUID();
    await admin.query(`INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
                       VALUES ($1,$2,$3,$4,$5,'Groundnut',1000,1000,1,'quintal',50000,'INR','published','public')`, [id, tA, seller, productId, categoryId]);
    return { id, tenantId: tA, sellerId: seller, productId, categoryId };
  }
  async function fillCart(qty: number): Promise<void> {
    await admin.query(`UPDATE carts SET status='converted' WHERE tenant_id=$1 AND user_id=$2 AND status='active'`, [tA, buyer]);
    const cart = (await admin.query(`INSERT INTO carts (tenant_id, user_id) VALUES ($1,$2) RETURNING id`, [tA, buyer])).rows[0].id;
    await admin.query(`INSERT INTO cart_items (cart_id, listing_id, quantity, added_price_minor) VALUES ($1,$2,$3,50000)`, [cart, listing.id, qty]);
  }
  /** A confirmed order as checkout + payment leave it (gate shape), id v7 so the repositories' prune finds it. */
  async function makeOrder(status: string, o: { total?: bigint; subtotal?: bigint } = {}): Promise<string> {
    const id = uuidv7(); const total = o.total ?? 452000n; const subtotal = o.subtotal ?? 400000n;
    await admin.query(
      `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, delivery_fee_minor, platform_fee_minor, total_minor, status, version, created_at)
       VALUES ($1,$2,$3,$4,$5,'direct','INR',$6,$7,$8,$9,$10,1, uuid_v7_time($1))`,
      [id, tA, `SWA-${id.slice(0, 12)}`, buyer, seller, subtotal.toString(), ((total - subtotal) / 2n).toString(), ((total - subtotal) / 2n).toString(), total.toString(), status]);
    await admin.query(`INSERT INTO dispute_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [tA, id, buyer, seller]);
    return id;
  }
  const payloadOf = async (orderId: string) => {
    const o = await q1(`SELECT total_minor::text t, delivery_fee_minor::text d, platform_fee_minor::text p, buyer_commission_minor::text b FROM orders WHERE id=$1`, [orderId]);
    return { v: 1, orderId, buyerUserId: buyer, sellerUserId: seller, totalMinor: o.t, deliveryFeeMinor: o.d, platformFeeMinor: o.p, buyerCommissionMinor: o.b, source: 'direct', countryCode: 'IN' };
  };
  /** A COD shipment driven to out-for-delivery through the service (rider r, dispatched by `dispatcher`), returning its delivery OTP. */
  async function shipmentOut(orderId: string, codMinor: bigint, dispatcher: string): Promise<{ id: string; otp: string }> {
    const s = await ships.create(tA, mgr(a1), key(), { orderId, codMinor: codMinor.toString() } as never);
    await ships.assign(tA, mgr(a1), s.id, { riderUserId: rider } as never, IP);
    await ships.markPickedUp(tA, { userId: rider, canManage: false }, s.id, null, IP);
    await ships.markOutForDelivery(tA, mgr(dispatcher), s.id, IP);
    const otp = (await q1(`SELECT payload->>'otp' otp FROM outbox_events WHERE aggregate_id::text=$1 AND event_type='logistics.delivery_otp_issued' ORDER BY created_at DESC LIMIT 1`, [s.id])).otp as string;
    return { id: s.id, otp };
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    let relayUrl = process.env.RELAY_TEST_DATABASE_URL;
    if (!relayUrl) { await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`); const u = new URL(APP_URL as string); u.username = 'kv_relay'; u.password = 'dev'; relayUrl = u.toString(); }
    relayPool = new Pool({ connectionString: relayUrl, max: 3, application_name: 'swa-settlement' });
    await makeTenant(admin, tA, 'SW-a Anand FPO'); await makeTenant(admin, tOne, 'SW-a Solo FPO');
    for (const u of [a1, a2, solo, c1, buyer, seller, rider]) await makeUser(admin, u as ReturnType<typeof randomUUID>);
    await addRole(a1, 'tenant_admin', tA); await addRole(a2, 'tenant_admin', tA); await addRole(solo, 'tenant_admin', tOne); await addRole(c1, 'fpo_coordinator', tA);
    await addRole(buyer, 'customer', tA); await addRole(seller, 'farmer', tA); await addRole(rider, 'delivery_partner', tA);
    // A1: this tenant's PLAN carries the platform share floor (1200 bps) — the admin realm writes plans; the superuser here stands in for it
    const plan = await makePlan(admin);
    await admin.query(`UPDATE plans SET commission_platform_share_bps=1200 WHERE id=$1`, [plan]);
    await activateSubscription(admin, tA, plan);
    listing = await makeListing();
    addrServed = (await admin.query(`INSERT INTO addresses (user_id, tenant_id, line1, pincode, country_code) VALUES ($1,$2,'Near the dairy','380001','IN') RETURNING id`, [buyer, tA])).rows[0].id;
    addrUnserved = (await admin.query(`INSERT INTO addresses (user_id, tenant_id, line1, pincode, country_code) VALUES ($1,$2,'Hill road','110001','IN') RETURNING id`, [buyer, tA])).rows[0].id;
    // a W150-APPROVED tenant delivery-fee definition (flat ₹75) — born from an applied charge_change_proposal signed by a different person
    const cp = randomUUID(); defApproved = randomUUID(); defUnapproved = randomUUID();
    await travel(`INSERT INTO charge_definitions (id, tenant_id, charge_code, calc_method, config, effective_from, is_active, label, proposal_id) VALUES ($1,$2,'zone_delivery','flat','{"fee_minor":7500}', CURRENT_DATE - 1, true, 'Zone 1 flat', $3)`, [defApproved, tA, cp]);
    await travel(`INSERT INTO charge_change_proposals (id, tenant_id, charge_code, action, label, calc_method, config, effective_from, status, proposed_by, proposal_note, decided_by, decided_at, decision_note, applied_at, applied_definition_id)
                  VALUES ($1,$2,'zone_delivery','add','Zone 1 flat','flat','{"fee_minor":7500}', CURRENT_DATE - 1, 'applied', $3, 'Zone one flat delivery fee for the season', $4, now(), 'approved by the second administrator', now(), $5)`, [cp, tA, a1, a2, defApproved]);
    await travel(`INSERT INTO charge_definitions (id, tenant_id, charge_code, calc_method, config, effective_from, effective_to, is_active, label) VALUES ($1,$2,'zone_fee_unapproved','flat','{"fee_minor":1}', CURRENT_DATE - 1, NULL, true, 'nobody approved me')`, [defUnapproved, tA]);
    for (const k of FLAGS) {
      const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key=$1`, [k])).rows[0];
      if (!row) continue;
      flagBackup.push(row);
      const r = row.is_enabled ? { ...(row.rules ?? {}), tenant_ids: [...((row.rules ?? {}).tenant_ids ?? []), tA, tOne] } : { tenant_ids: [tA, tOne] };
      await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=$2, rules=$3::jsonb WHERE key=$1`, [k, row.is_enabled ? row.rollout_pct : 0, JSON.stringify(r)]);
    }
    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'swa-access-secret-swa-access-secret-32';
    process.env.AUTH_HASH_PEPPER = process.env.AUTH_HASH_PEPPER || 'swa-hash-pepper-swa-hash-pepper-32bytes';
    process.env.SHARD_COUNT = process.env.SHARD_COUNT || '1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require('../../../app.module') as typeof import('../../../app.module');
    app = await NestFactory.create(AppModule, { logger: false });
    await app.init();
    uow = app.get<UnitOfWork>(UNIT_OF_WORK); wallet = app.get<WalletPort>(WALLET_SERVICE);
    rules = app.get(CommissionRuleService); checkout = app.get(CheckoutService); zones = app.get(DeliveryZoneService); ships = app.get(ShipmentService);
    remits = app.get(CodRemittanceService); cod = app.get(CodLedgerService); pod = app.get(PodReviewService); job = app.get(SettingProposalsJob);
    podJob = app.get(PodAutoClearJob); charges = app.get(ChargePricingService);
    settleRegistry = new OutboxHandlerRegistry(); settleRegistry.register(app.get(OrderCompletedHandler)); settleRegistry.register(app.get(SettlementHoldReleasedHandler));
  }, 240_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[tA, tOne]]).catch(() => undefined);
    for (const f of flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [f.key, f.is_enabled, f.rollout_pct, JSON.stringify(f.rules ?? {})]).catch(() => undefined);
    await app?.close().catch(() => undefined); await relayPool?.end().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  /* ======================================================================================================================== */
  it('A1 · the DTO refuses platformShareBps by name (strict); a confirmed rule carries the PLAN floor; the trigger refuses any other share', async () => {
    const base = { rateBps: 300, effectiveFrom: addDays(today, 8), reason: WHY };
    const bad = CreateCommissionRuleSchema.safeParse({ ...base, platformShareBps: 0 });
    expect(bad.success).toBe(false);
    expect(JSON.stringify((bad as { error: unknown }).error)).toContain('platformShareBps');
    expect(CreateCommissionRuleSchema.safeParse(base).success).toBe(true);

    const p = await rules.proposeCreate(tA, mgr(a1), key(), CreateCommissionRuleSchema.parse({ ...base, source: 'direct' }), IP);
    expect(p.rule?.platformShareBps).toBe(1200);                                           // the plan's figure, shown at proposal
    const c = await rules.confirm(tA, mgr(a2), key(), p.id, IP);
    expect(c.status).toBe('confirmed');
    const row = await q1(`SELECT platform_share_bps, effective_from::text ef, proposal_id, rate_bps FROM commission_rules WHERE id=$1`, [c.ruleId]);
    expect(row).toEqual({ platform_share_bps: 1200, ef: addDays(today, 8), proposal_id: p.id, rate_bps: 300 });
    expect((await rules.policy(tA)).platformShareBps).toBe(1200);

    await asApp(tA, a2, async (probe, conn) => {
      // the same confirmed proposal cited, the same terms — but a share of 0: the TRIGGER refuses it before anything else could
      await conn.query(`SELECT set_config('app.commission_proposal_id', $1, true)`, [p.id]);
      expect(await probe(`INSERT INTO commission_rules (id, tenant_id, source, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from, is_active, proposal_id)
                          VALUES ($1,$2,'direct',300,0,0,'seller',100,$3::date,true,$4)`, [c.ruleId, tA, addDays(today, 8), p.id])).toBe('23514:COMMISSION_SHARE_NOT_PLAN_FLOOR');
      await conn.query(`SELECT set_config('app.commission_proposal_id', '', true)`);
      expect(await probe(`INSERT INTO commission_rules (tenant_id, source, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from) VALUES ($1,'direct',200,0,1200,'seller',1,$2::date)`, [tA, addDays(today, 30)]))
        .toBe('23514:COMMISSION_PROPOSAL_REQUIRED');
      expect(await probe(`UPDATE commission_rules SET rate_bps=1 WHERE id=$1`, [c.ruleId])).toBe('23514:COMMISSION_PROPOSAL_REQUIRED');
      // F-6 · the 0175 split: a platform default can be neither written nor created from the tenant realm
      expect(await probe(`INSERT INTO commission_rules (tenant_id, source, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from) VALUES (NULL,'direct',1,0,0,'seller',1,CURRENT_DATE)`)).toBe('42501:');
      const plat = (await admin.query(`SELECT id FROM commission_rules WHERE tenant_id IS NULL AND source='direct' AND deleted_at IS NULL LIMIT 1`)).rows[0].id;
      await conn.query('SAVEPOINT u'); const upd = await conn.query(`UPDATE commission_rules SET rate_bps=1 WHERE id=$1`, [plat]); await conn.query('ROLLBACK TO SAVEPOINT u');
      expect(upd.rowCount).toBe(0);                                                          // invisible to UPDATE: no USING match
      expect(await probe(`UPDATE plans SET commission_platform_share_bps=0`)).toBe('42501:PLAN_SHARE_ADMIN_REALM');
    });
  });

  it('A3 · 7-day notice + midnight refused by service AND database; a second tenant_admin confirms; one-admin tenant told; the job applies at the effective midnight with a member notice', async () => {
    expect(await codeOf(rules.proposeCreate(tA, mgr(a1), key(), CreateCommissionRuleSchema.parse({ rateBps: 250, effectiveFrom: addDays(today, 7), reason: WHY }), IP))).toBe('COMMISSION_NOTICE_7_DAYS');
    expect(await codeOf(rules.proposeCreate(tA, mgr(a1), key(), CreateCommissionRuleSchema.parse({ rateBps: 250, effectiveFrom: addDays(today, -30), reason: WHY }), IP))).toBe('COMMISSION_NOTICE_7_DAYS');
    expect(await codeOf(rules.proposeCreate(tOne, mgr(solo), key(), CreateCommissionRuleSchema.parse({ rateBps: 250, effectiveFrom: addDays(today, 9), reason: WHY }), IP))).toBe('NEEDS_SECOND_ADMIN');
    const p = await rules.proposeCreate(tA, mgr(a1), key(), CreateCommissionRuleSchema.parse({ rateBps: 250, source: 'auction', effectiveFrom: addDays(today, 8), reason: WHY }), IP);
    expect(await codeOf(rules.confirm(tA, mgr(a1), key(), p.id, IP))).toBe('COMMISSION_CHECKER_IS_MAKER');   // the TRIGGER, named
    await asApp(tA, a1, async (probe) => {
      // the database refuses a back-dated / short-notice proposal on its own, and the proposer confirming through raw SQL
      expect(await probe(`INSERT INTO commission_rule_proposals (tenant_id, kind, rate_bps, fixed_minor, charged_to, priority, effective_from, reason, proposed_by, proposed_at, expires_at)
                          VALUES ($1,'create',100,0,'seller',100,$2::date,$3,$4, now(), now() + interval '7 days')`, [tA, today, WHY, a1])).toBe('23514:COMMISSION_NOTICE_7_DAYS');
      expect(await probe(`UPDATE commission_rule_proposals SET status='confirmed', confirmed_by=$2, confirmed_at=now(), rule_id=gen_random_uuid() WHERE id=$1`, [p.id, a1])).toBe('23514:COMMISSION_CHECKER_IS_MAKER');
    });
    // the database refuses a rule row that starts sooner than 7 IST days, even citing a "confirmed" two-person proposal
    const fake = randomUUID(); const fakeRule = randomUUID();
    await travel(`INSERT INTO commission_rule_proposals (id, tenant_id, kind, rate_bps, fixed_minor, charged_to, priority, effective_from, reason, proposed_by, proposed_at, expires_at, status, confirmed_by, confirmed_at, rule_id)
                  VALUES ($1,$2,'create',100,0,'seller',100,$3::date,$4,$5, now(), now() + interval '7 days', 'confirmed', $6, now(), $7)`, [fake, tA, today, WHY, a1, a2, fakeRule]);
    await asApp(tA, a2, async (probe, conn) => {
      await conn.query(`SELECT set_config('app.commission_proposal_id', $1, true)`, [fake]);
      expect(await probe(`INSERT INTO commission_rules (id, tenant_id, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from, is_active, proposal_id)
                          VALUES ($1,$2,100,0,1200,'seller',100,$3::date,true,$4)`, [fakeRule, tA, today, fake])).toBe('23514:COMMISSION_NOTICE_7_DAYS');
    });
    const c = await rules.confirm(tA, mgr(a2), key(), p.id, IP);
    // not due: the job leaves it confirmed
    await job.sweep(admin);
    expect((await q1(`SELECT status FROM commission_rule_proposals WHERE id=$1`, [p.id])).status).toBe('confirmed');
    // TIME TRAVEL to its effective day: the job applies it and tells every member, in three languages
    await travel(`UPDATE commission_rule_proposals SET effective_from=$2::date WHERE id=$1`, [p.id, today]);
    await travel(`UPDATE commission_rules SET effective_from=$2::date WHERE id=$1`, [c.ruleId, today]);
    await job.sweep(admin);
    expect((await q1(`SELECT status FROM commission_rule_proposals WHERE id=$1`, [p.id])).status).toBe('applied');
    const ev = await q1(`SELECT payload FROM outbox_events WHERE event_type='tenancy.commission_rule_effective' AND aggregate_id::text=$1`, [p.id]);
    expect(ev.payload.recipientUserIds).toEqual(expect.arrayContaining([a1, a2, buyer, seller]));
    expect(Object.keys(ev.payload.change).sort()).toEqual(['en', 'gu', 'hi']);
    expect(ev.payload.rate).toBe('2.50%');
    expect(await count(`SELECT count(*) n FROM audit_log WHERE entity_id=$1 AND action IN ('payments.commission_rule_proposed','payments.commission_rule_confirmed','payments.commission_rule_applied') AND reason=$2`, [p.id, WHY])).toBe(3);
    await travel(`UPDATE commission_rules SET is_active=false WHERE id=$1`, [c.ruleId]);   // out of the way of the settlement tests
  });

  it('A2 · the rule is FROZEN at placement; settlement uses it even after a later rule is in force (zero-sum); no-snapshot orders resolve once and record', async () => {
    await fillCart(8);                                                                           // goods 400000
    const r1 = await checkout.checkout(tA, buyer, key(), { deliveryAddressId: addrServed } as never).catch(async (e) => {
      // zones are created by the B test; with none active, zones do not apply and the generic fee is used — either way the snapshot is frozen
      throw e;
    });
    const o1 = r1.orders[0].id;
    const snap = (await q1(`SELECT commission_snapshot s FROM orders WHERE id=$1`, [o1])).s;
    expect(snap).toMatchObject({ v: 1, scope: 'platform', rateBps: 350, platformShareBps: 1000, chargedTo: 'seller', resolvedOn: today });
    // a LATER tenant rule, in force today (time travel past the 7-day law): 9% on direct sales
    const later = (await travel(`INSERT INTO commission_rules (tenant_id, source, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from, is_active)
                                 VALUES ($1,'direct',900,0,1200,'seller',50,$2::date,true) RETURNING id`, [tA, today]))[0].id;
    const out = await relay('orders.order_completed', o1, await payloadOf(o1));
    expect(out.status === 'failed' ? String((out as { error: unknown }).error) : out.status).toBe('published');
    const legs = await legsOf(`settle:${o1}`);
    expect(sum(legs)).toBe(0n);
    const line = await q1(`SELECT gross_minor::text g, commission_minor::text c FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [tA, o1]);
    expect(line.g).toBe('400000');
    expect(line.c).toBe(String((400000n * 350n) / 10000n));                                     // 3.5% frozen — NOT the later 9%
    // a NEW order placed now freezes the later rule
    await fillCart(8);
    const o2 = (await checkout.checkout(tA, buyer, key(), { deliveryAddressId: addrServed } as never)).orders[0].id;
    expect((await q1(`SELECT commission_snapshot s FROM orders WHERE id=$1`, [o2])).s).toMatchObject({ ruleId: later, rateBps: 900, platformShareBps: 1200, scope: 'tenant' });
    // the snapshot is frozen at the database too
    expect(await asApp(tA, a1, (probe) => probe(`UPDATE orders SET commission_snapshot='{"v":1}'::jsonb WHERE id=$1`, [o2]))).toBe('23514:ORDER_SNAPSHOT_FROZEN');
    await travel(`UPDATE commission_rules SET is_active=false WHERE id=$1`, [later]);
    // an order placed before 0196 (no snapshot): resolved ONCE on its placement date at completion, and recorded
    const legacy = await makeOrder('completed');
    expect((await q1(`SELECT commission_snapshot s FROM orders WHERE id=$1`, [legacy])).s).toBeNull();
    expect((await relay('orders.order_completed', legacy, await payloadOf(legacy))).status).toBe('published');
    expect((await q1(`SELECT commission_snapshot s FROM orders WHERE id=$1`, [legacy])).s).toMatchObject({ resolvedAtCompletion: true, resolvedOn: today, rateBps: 350 });
    expect(sum(await legsOf(`settle:${legacy}`))).toBe(0n);
  });

  it('A4 · charged_to = buyer: a buyer charge at placement; the seller is settled on the full goods value; zero-sum', async () => {
    const buyerRule = (await travel(`INSERT INTO commission_rules (tenant_id, source, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_from, is_active)
                                     VALUES ($1,'direct',500,0,1200,'buyer',1,$2::date,true) RETURNING id`, [tA, today]))[0].id;
    await fillCart(8);
    const o = (await checkout.checkout(tA, buyer, key(), { deliveryAddressId: addrServed } as never)).orders[0].id;
    const row = await q1(`SELECT subtotal_minor::text s, total_minor::text t, delivery_fee_minor::text d, platform_fee_minor::text p, buyer_commission_minor::text b, commission_snapshot cs, charge_snapshot ch FROM orders WHERE id=$1`, [o]);
    const gstBps = BigInt((await q1(`SELECT rate_bps FROM tax_rules WHERE country_code='IN' AND tax_code='gst' AND category_id IS NULL AND is_active ORDER BY effective_from DESC LIMIT 1`)).rate_bps);
    const C = (400000n * 500n) / 10000n; const G = (C * gstBps) / 10000n;                    // 5% + the platform's recorded GST rate on it
    expect(row.b).toBe((C + G).toString());
    expect(BigInt(row.t)).toBe(400000n + BigInt(row.d) + BigInt(row.p) + C + G);                // the buyer pays it, in the total
    expect(row.cs).toMatchObject({ ruleId: buyerRule, chargedTo: 'buyer', buyerCharge: { commissionMinor: C.toString(), gstMinor: G.toString() } });
    expect((row.ch.charges as Array<{ code: string }>).map((x) => x.code)).toContain('buyer_commission');
    expect((await relay('orders.order_completed', o, await payloadOf(o))).status).toBe('published');
    const legs = await legsOf(`settle:${o}`);
    expect(sum(legs)).toBe(0n);
    const line = await q1(`SELECT gross_minor::text g, commission_minor::text c, tds_minor::text tds, net_minor::text n, buyer_commission_minor::text bc, buyer_commission_gst_minor::text bg, tenant_commission_minor::text tc FROM settlement_lines WHERE order_id=$1`, [o]);
    expect(line.g).toBe('400000'); expect(line.c).toBe('0');                                     // nothing taken from the seller for commission
    expect(BigInt(line.n)).toBe(400000n - BigInt(line.tds));                                     // full goods value (less statutory TDS)
    expect(line.bc).toBe(C.toString()); expect(line.bg).toBe(G.toString());
    expect(BigInt(line.tc)).toBe(C - (C * 1200n) / 10000n);                                     // tenant keeps the commission less the plan's share
    expect(leg(legs, 'gst_payable')).toBe(G);
    await travel(`UPDATE commission_rules SET is_active=false WHERE id=$1`, [buyerRule]);
  });

  it('B · zones: lead + checker, fee only from a W150-approved definition, quote = charge with buyer_charges ON, the zone on the order, unserviceable refused kindly', async () => {
    const p = await zones.propose(tA, lead(c1), key(), { kind: 'create', defaultName: 'Anand city', pincodes: ['380001'], regionIds: [], chargeDefinitionId: defApproved, reason: WHY } as never, IP);
    expect(await codeOf(zones.confirm(tA, lead(c1), key(), p.id, IP))).toBe('ZONE_CHECKER_IS_MAKER');
    await zones.confirm(tA, lead(a1), key(), p.id, IP);
    zoneId = p.zoneId;
    expect(await q1(`SELECT is_active, charge_definition_id, proposal_id FROM delivery_zones WHERE id=$1`, [zoneId])).toEqual({ is_active: true, charge_definition_id: defApproved, proposal_id: p.id });
    expect(await codeOf(zones.propose(tA, lead(c1), key(), { kind: 'repoint_fee', zoneId, chargeDefinitionId: defUnapproved, reason: WHY } as never, IP))).toBe('ZONE_FEE_NOT_APPROVED');
    await asApp(tA, a1, async (probe) => {
      expect(await probe(`UPDATE delivery_zones SET charge_definition_id=$2 WHERE id=$1`, [zoneId, defUnapproved])).toBe('23514:ZONE_PROPOSAL_REQUIRED');
      expect(await probe(`UPDATE delivery_zones SET is_active=false WHERE id=$1`, [zoneId])).toBe('23514:ZONE_PROPOSAL_REQUIRED');
      expect(await probe(`INSERT INTO delivery_zone_proposals (tenant_id, kind, zone_id, charge_definition_id, reason, proposed_by, proposed_at, expires_at) VALUES ($1,'repoint_fee',$2,$3,$4,$5, now(), now()+interval '7 days')`,
        [tA, zoneId, defUnapproved, WHY, a1])).toBe('23514:ZONE_FEE_NOT_APPROVED');
    });
    // the quote and the charge are the same number, and it is the ZONE's — not the generic delivery_fee
    await fillCart(8);
    const quote = await checkout.deliveryMethods(tA, buyer, { pincode: '380001' });
    expect(quote.methods).toEqual([expect.objectContaining({ id: zoneId, feeMinor: '7500' })]);
    expect(await codeOf(checkout.checkout(tA, buyer, key(), { deliveryAddressId: addrUnserved } as never))).toBe('UNSERVICEABLE_PINCODE');
    const err = await checkout.checkout(tA, buyer, key(), { deliveryAddressId: addrUnserved } as never).catch((e) => e);
    expect(err.message).toBe("We don't deliver here yet");
    const o = (await checkout.checkout(tA, buyer, key(), { deliveryAddressId: addrServed, deliveryMethodId: zoneId } as never)).orders[0].id;
    const row = await q1(`SELECT delivery_fee_minor::text d, delivery_zone_id z, delivery_method_id m, charge_snapshot ch FROM orders WHERE id=$1`, [o]);
    expect(row).toMatchObject({ d: '7500', z: zoneId, m: zoneId });
    expect((row.ch.charges as Array<{ code: string; zoneId?: string; definitionId: string }>).find((x) => x.code === 'delivery_fee')).toMatchObject({ zoneId, definitionId: defApproved });
    const generic = await uow.run(tA, (tx) => charges.quote(tx, tA, 'delivery_fee', { amountMinor: 400000n }), { userId: buyer });
    expect(generic).not.toBe(7500n);                                                              // the slab placement USED to charge
    // Orders 30d is a real count of orders.delivery_zone_id
    expect((await zones.getById(tA, zoneId)).orders30d).toBeGreaterThanOrEqual(1);
    // a zone's name / pincodes stay a direct, reasoned, audited edit
    await zones.update(tA, lead(c1), zoneId, { pincodes: ['380001', '380002'], reason: 'Added the new colony across the canal' } as never, IP);
    expect((await zones.serviceability(tA, '380002')).serviceable).toBe(true);
  });

  it('C · COD: collect → rider owes, escrow funded → settlement runs; remit + reconcile (two people) → rider at zero, bank clearing; cap; shortfall on the ORDER; cash day', async () => {
    // collect at the door
    const o = await makeOrder('confirmed');
    const s = await shipmentOut(o, 452000n, a2);
    await ships.markDelivered(tA, { userId: rider, canManage: false }, s.id, { otp: s.otp, cashCollectedMinor: '452000', podMediaId: randomUUID() } as never, IP);
    const collect = await legsOf(`cod-collect:${s.id}`);
    expect(sum(collect)).toBe(0n);
    expect(leg(collect, 'escrow')).toBe(452000n);
    expect(leg(collect, 'cash_in_hand')).toBe(-452000n);
    const riderBal = async () => uow.run(tA, (tx) => wallet.balanceMinor(tx, userCashInHand(rider)), { userId: a1 });
    expect(await riderBal()).toBe(-452000n);                                                      // the rider OWES the escrow
    // POD row for the shipment is born awaiting; the completion settles (nothing flagged)
    expect((await relay('orders.order_completed', o, await payloadOf(o))).status).toBe('published');
    expect(sum(await legsOf(`settle:${o}`))).toBe(0n);
    expect(leg(await legsOf(`settle:${o}`), 'escrow')).toBe(-452000n);                         // released what COD funded
    // remit (a1 banks it) + reconcile (a2 — a1 is refused): rider back to zero, the bank deposit is the clearing fact
    const rem = await remits.create(tA, mgr(a1), key(), { riderUserId: rider, expectedAmountMinor: '452000', reason: 'evening cash run from the Anand route' }, IP);
    await remits.deposit(tA, mgr(a1), rem.id, { depositRef: 'SBI-ANAND-0091', depositMethod: 'bank_branch' }, IP);
    expect(await codeOf(remits.reconcile(tA, mgr(a1), rem.id, undefined, IP))).toBe('FORBIDDEN');
    const rec = await remits.reconcile(tA, mgr(a2), rem.id, 'matched the branch statement', IP);
    expect(rec.ledgerRemittedMinor).toBe('452000');
    const remit = await legsOf(`cod-remit:${rem.id}`);
    expect(sum(remit)).toBe(0n);
    expect(leg(remit, 'cash_in_hand')).toBe(452000n);
    expect(leg(remit, 'cash_clearing')).toBe(-452000n);
    expect(await riderBal()).toBe(0n);
    // the per-rider cap (₹10,000 seeded): a collection past it is refused at delivery — the delivery rolls back
    const big = await makeOrder('confirmed', { total: 1200000n, subtotal: 1100000n });
    const sb = await shipmentOut(big, 1200000n, a2);
    expect(await codeOf(ships.markDelivered(tA, { userId: rider, canManage: false }, sb.id, { otp: sb.otp, cashCollectedMinor: '1200000' } as never, IP))).toBe('COD_RIDER_CAP');
    expect((await q1(`SELECT status FROM shipments WHERE id=$1`, [sb.id])).status).toBe('out_for_delivery');
    // a short-paid delivery: the shortfall is on the ORDER (buyer owes), the order's settlement holds until it is paid
    const so = await makeOrder('confirmed', { total: 100000n, subtotal: 90000n });
    const ss = await shipmentOut(so, 100000n, a2);
    expect(await codeOf(ships.markDelivered(tA, { userId: rider, canManage: false }, ss.id, { otp: ss.otp, cashCollectedMinor: '80000' } as never, IP))).toBe('COD_COLLECTION_INVALID');   // no reason
    await ships.markDelivered(tA, { userId: rider, canManage: false }, ss.id, { otp: ss.otp, cashCollectedMinor: '80000', shortfallReason: 'Buyer paid 800, will send the rest by UPI' } as never, IP);
    const sf = await q1(`SELECT id, order_id, buyer_user_id, amount_minor::text a, status FROM cod_shortfalls WHERE shipment_id=$1`, [ss.id]);
    expect(sf).toMatchObject({ order_id: so, buyer_user_id: buyer, a: '20000', status: 'open' });
    expect((await q1(`SELECT settlement_hold_reason h FROM orders WHERE id=$1`, [so])).h).toBe('cod_shortfall');
    expect(await riderBal()).toBe(-80000n);                                                       // the rider owes only what he took
    expect((await relay('orders.order_completed', so, await payloadOf(so))).status).toBe('published');
    expect(await count(`SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`settle:${so}`])).toBe(0);   // deferred
    await cod.collectShortfall(tA, mgr(a1), key(), sf.id, { depositRef: 'UPI-77812' }, IP);
    expect(sum(await legsOf(`cod-shortfall:${sf.id}`))).toBe(0n);
    expect((await q1(`SELECT settlement_hold_reason h FROM orders WHERE id=$1`, [so])).h).toBeNull();
    const rel = await q1(`SELECT aggregate_id::text a FROM outbox_events WHERE event_type='payments.settlement_hold_released' AND aggregate_id::text=$1`, [so]);
    expect(rel).toBeDefined();
    expect((await relay('payments.settlement_hold_released', so, { v: 1, orderId: so })).status).toBe('published');
    expect(sum(await legsOf(`settle:${so}`))).toBe(0n);
    // the cash day: opened by a1, closed only by a different person, only when every open remittance of the day is accounted for
    const open = await remits.create(tA, mgr(a1), key(), { riderUserId: rider, reason: 'short-paid run still with the rider' }, IP);
    await cod.openDay(tA, mgr(a1), key(), IP);
    expect(await codeOf(cod.closeDay(tA, mgr(a2), key(), today, { carries: [] }, IP))).toBe('COD_DAY_OPEN_ITEMS');
    expect(await codeOf(cod.closeDay(tA, mgr(a1), key(), today, { carries: [{ remittanceId: open.id, reason: 'rider deposits tomorrow morning' }] }, IP))).toBe('COD_DAY_CHECKER_IS_MAKER');
    const closed = await cod.closeDay(tA, mgr(a2), key(), today, { carries: [{ remittanceId: open.id, reason: 'rider deposits tomorrow morning' }] }, IP);
    expect(closed.changed).toBe(true);
    const ledgerRowsBefore = await count(`SELECT count(*) n FROM ledger_transactions WHERE tenant_id=$1`, [tA]);
    const again = await cod.closeDay(tA, mgr(a2), key(), today, { carries: [] }, IP);
    expect(again.changed).toBe(false);                                                            // a re-run moves nothing
    expect(await count(`SELECT count(*) n FROM ledger_transactions WHERE tenant_id=$1`, [tA])).toBe(ledgerRowsBefore);
    // the tiles are ledger facts
    const board = await cod.board(tA, mgr(a1));
    expect(board.tiles.inRiderHandsMinor).toBe('80000');
    expect(BigInt(board.tiles.collectedTodayMinor)).toBeGreaterThanOrEqual(532000n);
    expect(board.riderCapMinor).toBe('1000000');
  });

  it('D · POD: driver / dispatcher refused; a flagged POD holds settlement and approve releases it through the outbox (once); timer auto-clears; reject needs a checker and opens a dispute with evidence', async () => {
    const o = await makeOrder('confirmed');
    const media = randomUUID();
    const s = await shipmentOut(o, 0n, a2);   // prepaid (no COD): the POD law is independent of cash
    await ships.markDelivered(tA, { userId: rider, canManage: false }, s.id, { otp: s.otp, podMediaId: media } as never, IP);
    const rv = await q1(`SELECT id, status, driver_user_id d, dispatcher_user_id x, extract(epoch from timer_due_at - delivered_at)::int gap FROM pod_reviews WHERE shipment_id=$1`, [s.id]);
    expect(rv).toMatchObject({ status: 'awaiting', d: rider, x: a2, gap: 7200 });
    expect(await codeOf(pod.flag(tA, mgr(rider), key(), rv.id, { reason: 'mismatch' }, IP))).toBe('POD_REVIEWER_IS_DRIVER');
    expect(await codeOf(pod.flag(tA, mgr(a2), key(), rv.id, { reason: 'mismatch' }, IP))).toBe('POD_REVIEWER_IS_DRIVER');   // the dispatcher too
    await pod.flag(tA, mgr(a1), key(), rv.id, { reason: 'weight_variance', varianceMinor: '50000', note: 'two bags short on the slip' }, IP);
    expect((await q1(`SELECT settlement_hold_reason h FROM orders WHERE id=$1`, [o])).h).toBe('pod_review');
    expect((await relay('orders.order_completed', o, await payloadOf(o))).status).toBe('published');
    expect(await count(`SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`settle:${o}`])).toBe(0);    // HELD
    expect(await count(`SELECT count(*) n FROM settlement_deferrals WHERE order_id=$1`, [o])).toBe(1);
    await pod.approve(tA, mgr(c1), key(), rv.id, 'slip re-weighed, matches', IP);
    expect((await relay('payments.settlement_hold_released', o, { v: 1, orderId: o })).status).toBe('published');
    expect(sum(await legsOf(`settle:${o}`))).toBe(0n);
    expect((await relay('payments.settlement_hold_released', o, { v: 1, orderId: o })).status).toBe('published');           // redelivery
    expect(await count(`SELECT count(*) n FROM ledger_transactions WHERE idempotency_key=$1`, [`settle:${o}`])).toBe(1);   // once
    // the 2-hour timer: an unflagged review past its timer clears itself (the registered job)
    const o2 = await makeOrder('confirmed'); const s2 = await shipmentOut(o2, 0n, a2);
    await ships.markDelivered(tA, { userId: rider, canManage: false }, s2.id, { otp: s2.otp } as never, IP);
    await travel(`UPDATE pod_reviews SET delivered_at = now() - interval '3 hours', timer_due_at = now() - interval '1 hour' WHERE shipment_id=$1`, [s2.id]);
    await podJob.sweep(admin);
    expect((await q1(`SELECT status FROM pod_reviews WHERE shipment_id=$1`, [s2.id])).status).toBe('auto_cleared');
    // reject is two people, and opens a qty_mismatch dispute carrying the POD photo (scope = the whole order: no variance entered)
    const o3 = await makeOrder('confirmed'); const s3 = await shipmentOut(o3, 0n, a2);
    await ships.markDelivered(tA, { userId: rider, canManage: false }, s3.id, { otp: s3.otp, podMediaId: media } as never, IP);
    const r3 = (await q1(`SELECT id FROM pod_reviews WHERE shipment_id=$1`, [s3.id])).id;
    await pod.flag(tA, mgr(a1), key(), r3, { reason: 'wrong_recipient' }, IP);
    await pod.proposeReject(tA, mgr(a1), key(), r3, 'handed to a neighbour, buyer never received it', IP);
    expect(await codeOf(pod.confirmReject(tA, mgr(a1), key(), r3, IP))).toBe('POD_REJECT_NEEDS_CHECKER');
    const done = await pod.confirmReject(tA, mgr(c1), key(), r3, IP);
    expect(done.status).toBe('rejected');
    const d = await q1(`SELECT opened_via, pod_review_id, evidence_media_ids, disputed_amount_minor::text amt, raised_by, against_user, opened_by_staff FROM disputes WHERE id=$1`, [done.disputeId]);
    expect(d).toMatchObject({ opened_via: 'pod_review', pod_review_id: r3, evidence_media_ids: [media], amt: '452000', raised_by: buyer, against_user: seller, opened_by_staff: c1 });
    expect(await count(`SELECT count(*) n FROM disputes d JOIN lookup_values lv ON lv.id = d.reason_id WHERE d.id=$1 AND lv.code='qty_mismatch'`, [done.disputeId])).toBe(1);
    expect((await q1(`SELECT settlement_hold_reason h FROM orders WHERE id=$1`, [o3])).h).toBeNull();   // the dispute now governs the money
    // tiles from real rows
    const board = await pod.board(tA, mgr(a1), { limit: 50 });
    expect(board.tiles.autoClearedToday).toBeGreaterThanOrEqual(1);
    expect(board.weighbridge.recorded).toBe(false);
  });

  it('µs · rows written in ONE transaction (one created_at) page exactly once', async () => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      for (let i = 0; i < 3; i++) {
        await c.query(`INSERT INTO commission_rule_proposals (tenant_id, kind, rate_bps, fixed_minor, charged_to, priority, effective_from, reason, proposed_by, proposed_at, expires_at)
                       VALUES ($1,'create',$2,0,'seller',100,$3::date,$4,$5, now(), now() + interval '7 days')`, [tOne, 100 + i, addDays(today, 10 + i), WHY, solo]);
      }
      await c.query('COMMIT');
    } finally { c.release(); }
    const p1 = await rules.listProposals(tOne, solo, { limit: 2 });
    const p2 = await rules.listProposals(tOne, solo, { limit: 2, cursor: p1.nextCursor ?? undefined });
    const ids = [...p1.items, ...p2.items].map((x) => x.id);
    expect(ids.length).toBe(3); expect(new Set(ids).size).toBe(3);
  });
});
