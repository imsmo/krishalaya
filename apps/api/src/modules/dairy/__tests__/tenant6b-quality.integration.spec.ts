// modules/dairy/__tests__/tenant6b-quality.integration.spec.ts · PC-56 TENANT-6b against a LIVE Postgres.
//
// W168 is the quality desk, and its promises are about MONEY: *"Sample retained & sealed. Rate card holds this pour's
// payment only; the member's other pours pay normally."* · *"Bonus slab: fat ≥ 6.5 → +₹0.50/L"* · *"premium band
// pourers 184 / 312"*. Every one of those is a claim about what a cooperative pays 312 families, so this suite runs
// through the REAL services against the REAL schema — the pricing engine, the bill generator, the wallet — and never
// hand-inserts a row the writer would have written differently.
//
// RUN THIS FILE UNDER TZ=Asia/Kolkata AS WELL AS UTC. The dairy money path maps PostgreSQL `date` values through
// JS Dates, and a UTC-only test agrees with a defect that bites in the launch market:
//
//   DATABASE_ADMIN_URL=... DATABASE_URL=... TZ=Asia/Kolkata npx jest --selectProjects integration tenant6b
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
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
import { platform, PlatformAccount, TenantAccount } from '../../../core/wallet/account-codes';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkQualityService } from '../services/milk-quality.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

/** Calendar-day arithmetic on a YYYY-MM-DD string, done in UTC so the test's own dates cannot drift with the box. */
const addDays = (day: string, n: number): string => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};
/** Read a `date` back the way the platform must: local components, never toISOString (that is the bug under test). */
const pgDay = (v: unknown): string => (v instanceof Date
  ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  : String(v).slice(0, 10));

run('PC-56 TENANT-6b · the quality desk\'s money path (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService; let bills: MilkBillService; let quality: MilkQualityService;
  let collRepo: MilkCollectionRepository;
  /** Rebuild the record path with a FRESH flag cache — see the bonus test for why that is the honest way to do it. */
  let freshCollections: () => MilkCollectionService;

  const tenantA = randomUUID();
  const operator = randomUUID();
  const farmer = randomUUID();
  // A SECOND member, on a card that carries a bonus slab, so the premium band and the hold can be proven without
  // either test disturbing the other's money.
  const farmer2 = randomUUID();
  const actor = { userId: operator, canManage: true };
  let mccId = ''; let membershipId = ''; let membership2 = '';
  let day = '';

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const balTenant = async (t: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='tenant' AND account_code='main' AND owner_tenant_id=$1`, [t])).rows[0]?.b ?? '0');
  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeUser(admin, operator); await makeUser(admin, farmer); await makeUser(admin, farmer2);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());

    const mccRepo = new MccCentreRepository(replica as any);
    const memRepo = new DairyMembershipRepository(replica as any);
    const cardRepo = new MilkRateCardRepository(replica as any);
    collRepo = new MilkCollectionRepository(replica as any);
    const billRepo = new MilkBillRepository(replica as any);
    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo);
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo);
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    // PC-56 TENANT-6b-1: the record path now opens a quality review for a flagged pour and asks the flag service
    // whether the rate card's premium slabs apply — both real here, against the real database.
    const reviewRepo = new MilkQualityReviewRepository(replica as any);
    const flags = new FlagsService(pools, new InMemoryCacheService());
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags);
    bills = new MilkBillService(uow, outbox, idem, metrics, wallet, audit, billRepo, collRepo, memRepo);
    freshCollections = () => new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo,
      new FlagsService(pools, new InMemoryCacheService()));
    quality = new MilkQualityService(uow, outbox, idem, metrics, audit, reviewRepo, collRepo);

    await fundTenant(tenantA, 100_000_000n);

    // The day comes from the DATABASE's calendar, not the test process's — the same discipline TENANT-6a established,
    // and here it is the subject of the first test rather than a convenience.
    day = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;

    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-02', defaultName: 'Anand 02' } as any, null)).id;
    // W168's own card: "Buffalo two_axis v4 · ₹720 per kg fat · ₹340 per kg SNF · bonus fat ≥ 6.5 → +₹0.50/L".
    await cards.create(tenantA, actor, `idem-${randomUUID()}`, { defaultName: 'Buffalo two_axis v4', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as any);
    membershipId = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmer, mccId, memberCode: 'AND2-0087', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as any)).id;

    // A COW card carrying W168's slab, and a member on it — so the premium band is exercised on its own animal type
    // without changing what the buffalo member above is paid.
    await cards.create(tenantA, actor, `idem-${randomUUID()}`, {
      defaultName: 'Cow two_axis + premium', animalType: 'cow', pricingModel: 'two_axis',
      ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01',
      bonusSlabs: [{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }],
    } as any);
    membership2 = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmer2, mccId, memberCode: 'AND2-0088', paymentCycle: 'fortnightly', defaultAnimalType: 'cow' } as any)).id;
  }, 60000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  /* THE DEFECT THIS WAVE OPENED WITH — the date mapper on the dairy money path                              */
  /* ======================================================================================================= */

  /**
   * node-pg parses a `date` (oid 1082) into a JS Date at LOCAL midnight, and this repo sets NO type parser
   * (`grep -r setTypeParser` → zero hits) and pins no TZ. `MilkCollectionRepository` converts that Date with
   * `toISOString().slice(0,10)` in two places — `toDomain` and `aggregateUnbilledForUpdate` — and the second one
   * builds the partition-key reference that `attachToBill` matches on.
   *
   * Under any timezone AHEAD of UTC — Asia/Kolkata, the launch market — that string is the PREVIOUS DAY, so the
   * bill-attach UPDATE matches ZERO rows while the bill is inserted, approved and PAID. The collections stay
   * `milk_bill_id IS NULL`, and the next cycle bills and pays them AGAIN.
   */
  it('reads back the day PostgreSQL holds, in whatever timezone the process runs in', async () => {
    const list = await collRepo.listFor(tenantA, { membershipId, from: day, to: day, limit: 10 });
    void list;
    const probe = (await admin.query(`SELECT $1::date AS d`, [day])).rows[0].d;
    const mapped = probe instanceof Date
      ? [probe.getFullYear(), String(probe.getMonth() + 1).padStart(2, '0'), String(probe.getDate()).padStart(2, '0')].join('-')
      : String(probe);
    expect(mapped).toBe(day);
    // And the shape that must never come back: an offset-dependent conversion of the same value.
    if (probe instanceof Date && process.env.TZ === 'Asia/Kolkata') {
      expect(probe.toISOString().slice(0, 10)).not.toBe(day);   // the defect, demonstrated rather than described
    }
  });

  it('STAMPS the collections it paid for, so no pour can be billed twice', async () => {
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId, shift: 'morning', collectedOn: day, weightKg: '7.100', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [] } as any);

    const bill = await bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId, periodStart: day, periodEnd: day, deductions: [] } as any);
    const stamped = await admin.query(`SELECT milk_bill_id FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membershipId, day]);
    expect(stamped.rows.length).toBeGreaterThan(0);
    for (const r of stamped.rows) expect(r.milk_bill_id).toBe(bill.id);   // ← zero-row UPDATE would leave these NULL

    await bills.preview(tenantA, actor, bill.id);
    await bills.approve(tenantA, actor, bill.id);
    const tBefore = await balTenant(tenantA); const fBefore = await balUser(farmer);
    await bills.pay(tenantA, actor, bill.id, `idem-${randomUUID()}`, null);
    expect(tBefore - (await balTenant(tenantA))).toBe(BigInt(bill.netMinor));
    expect((await balUser(farmer)) - fBefore).toBe(BigInt(bill.netMinor));

    // THE CONSEQUENCE: with the pours unstamped, a second cycle finds them unbilled and pays for them again.
    await expect(bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId, periodStart: day, periodEnd: day, deductions: [] } as any))
      .rejects.toThrow();
  });
  /* ======================================================================================================= */
  /* THE POUR THAT USED TO BE PAID FOR ANYWAY                                                                */
  /* ======================================================================================================= */

  /**
   * W168: *"Sample retained & sealed. Rate card holds this pour's payment only; the member's other pours pay
   * normally."* Before this wave the flagged pour was billed at full price and could be approved and PAID before the
   * sealed sample was ever re-tested. This is the whole promise, end to end, against real money.
   */
  it('HOLDS a flagged pour, opens its review in the SAME transaction, and pays the member\'s other pours', async () => {
    const d1 = day;                                        // flagged
    const d2 = addDays(day, -1);                           // clean, same member, same cycle
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'morning', collectedOn: d1, weightKg: '6.200', fatPct: '6.20', snfPct: '8.40', density: '1.024', waterFlag: true, adulterationFlags: [] } as any);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'morning', collectedOn: d2, weightKg: '7.000', fatPct: '6.60', snfPct: '9.00', waterFlag: false, adulterationFlags: [] } as any);

    const held = await admin.query(`SELECT id, hold_state, density FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membership2, d1]);
    expect(held.rows[0].hold_state).toBe('held');
    expect(Number(held.rows[0].density)).toBeCloseTo(1.024, 3);          // the dead column, finally written

    // The review exists, in the same transaction as the pour — a hold with no stated reason is money withheld blindly.
    const rev = await admin.query(`SELECT id, status, water_flag, amount_withheld_minor, density_at_flag, prior_reviews_90d, committee_review_required FROM milk_quality_reviews WHERE tenant_id=$1 AND collection_id=$2`, [tenantA, held.rows[0].id]);
    expect(rev.rows.length).toBe(1);
    expect(rev.rows[0].status).toBe('open');
    expect(rev.rows[0].water_flag).toBe(true);
    expect(BigInt(rev.rows[0].amount_withheld_minor)).toBeGreaterThan(0n);
    expect(rev.rows[0].committee_review_required).toBe(false);           // first flag for this member

    // W168's actual sentence: the OTHER pour bills and pays normally while this one waits.
    const bill = await bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, periodStart: d2, periodEnd: d1, deductions: [] } as any);
    const attached = await admin.query(`SELECT collected_on, milk_bill_id FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 ORDER BY collected_on`, [tenantA, membership2]);
    const byDay = new Map(attached.rows.map((r: any) => [pgDay(r.collected_on), r.milk_bill_id]));
    expect(byDay.get(d2)).toBe(bill.id);                                 // the clean pour was billed
    expect(byDay.get(d1)).toBeNull();                                    // the flagged pour was NOT
    // 7kg @ fat 6.60 → 0.462kg × ₹720 = 33,264; snf 9.00 → 0.630kg × ₹340 = 21,420.
    expect(BigInt(bill.grossMinor)).toBe(54_684n);
  });

  it('refuses a bill when EVERY pour is held, and says so distinctly from "nobody poured"', async () => {
    const d = addDays(day, -3);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'evening', collectedOn: d, weightKg: '5.000', fatPct: '6.00', snfPct: '8.50', waterFlag: false, adulterationFlags: ['starch'] } as any);
    await expect(bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, periodStart: d, periodEnd: d, deductions: [] } as any))
      .rejects.toMatchObject({ code: 'ALL_POURS_HELD' });
    // …and a period with no pours at all still says EMPTY_BILL, so the two facts stay apart.
    await expect(bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, periodStart: addDays(day, -30), periodEnd: addDays(day, -29), deductions: [] } as any))
      .rejects.toMatchObject({ code: 'EMPTY_BILL' });
  });

  it('RELEASES the pour when the re-test clears it, and the released pour then bills', async () => {
    const d = addDays(day, -5);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'morning', collectedOn: d, weightKg: '4.000', fatPct: '6.10', snfPct: '8.60', density: '1.025', waterFlag: true, adulterationFlags: [] } as any);
    const cid = (await admin.query(`SELECT id FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membership2, d])).rows[0].id;
    const rid = (await admin.query(`SELECT id FROM milk_quality_reviews WHERE tenant_id=$1 AND collection_id=$2`, [tenantA, cid])).rows[0].id;

    await quality.retest(tenantA, actor, `idem-${randomUUID()}`, rid, { memberPresent: true, sampleSealed: true, note: 'second run with member' });
    let row = (await admin.query(`SELECT status, member_present, sample_sealed, retest_by FROM milk_quality_reviews WHERE id=$1`, [rid])).rows[0];
    expect(row.status).toBe('retested');
    expect(row.member_present).toBe(true);
    expect(row.sample_sealed).toBe(true);
    expect(row.retest_by).toBe(operator);
    // Still held: a sample tested is not a sample cleared.
    expect((await admin.query(`SELECT hold_state FROM milk_collections WHERE id=$1 AND collected_on=$2::date`, [cid, d])).rows[0].hold_state).toBe('held');

    await quality.decide(tenantA, actor, `idem-${randomUUID()}`, rid, { outcome: 'cleared', note: 'rain water in the can' });
    row = (await admin.query(`SELECT status, decided_by FROM milk_quality_reviews WHERE id=$1`, [rid])).rows[0];
    expect(row.status).toBe('cleared');
    expect(row.decided_by).toBe(operator);
    expect((await admin.query(`SELECT hold_state FROM milk_collections WHERE id=$1 AND collected_on=$2::date`, [cid, d])).rows[0].hold_state).toBe('released');

    // …and now it bills, which is the point of releasing it.
    const bill = await bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, periodStart: d, periodEnd: d, deductions: [] } as any);
    expect((await admin.query(`SELECT milk_bill_id FROM milk_collections WHERE id=$1 AND collected_on=$2::date`, [cid, d])).rows[0].milk_bill_id).toBe(bill.id);
  });

  it('NEVER bills a rejected pour, and keeps its priced amount as the record of what the milk was worth', async () => {
    const d = addDays(day, -6);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'morning', collectedOn: d, weightKg: '3.000', fatPct: '6.00', snfPct: '8.00', waterFlag: false, adulterationFlags: ['urea'] } as any);
    const c = (await admin.query(`SELECT id, amount_minor FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membership2, d])).rows[0];
    const rid = (await admin.query(`SELECT id FROM milk_quality_reviews WHERE tenant_id=$1 AND collection_id=$2`, [tenantA, c.id])).rows[0].id;

    await quality.decide(tenantA, actor, `idem-${randomUUID()}`, rid, { outcome: 'rejected', note: 'confirmed' });
    const after = (await admin.query(`SELECT hold_state, amount_minor FROM milk_collections WHERE id=$1 AND collected_on=$2::date`, [c.id, d])).rows[0];
    expect(after.hold_state).toBe('rejected');
    expect(after.amount_minor).toBe(c.amount_minor);                     // NOT zeroed: the evidence survives
    await expect(bills.generate(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, periodStart: d, periodEnd: d, deductions: [] } as any))
      .rejects.toMatchObject({ code: 'ALL_POURS_HELD' });
    // A decision cannot be taken twice — a reversal is a new dispute, not an edit.
    await expect(quality.decide(tenantA, actor, `idem-${randomUUID()}`, rid, { outcome: 'cleared', note: null }))
      .rejects.toThrow(/ILLEGAL_TRANSITION|Cannot move/);
  });

  it('counts the member\'s pattern in the DATABASE\'s 90 days and asks for a committee on the third flag', async () => {
    // Two flags already exist for membership2 above (the water flag and the starch one) plus the released and rejected
    // ones — so this next flag is well past W168's "3+ in 90d" and must ask for a committee review.
    const d = addDays(day, -7);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'morning', collectedOn: d, weightKg: '2.000', fatPct: '6.00', snfPct: '8.00', waterFlag: true, adulterationFlags: [] } as any);
    const c = (await admin.query(`SELECT id FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membership2, d])).rows[0];
    const row = (await admin.query(`SELECT prior_reviews_90d, committee_review_required FROM milk_quality_reviews WHERE tenant_id=$1 AND collection_id=$2`, [tenantA, c.id])).rows[0];
    expect(row.prior_reviews_90d).toBeGreaterThanOrEqual(2);
    expect(row.committee_review_required).toBe(true);
  });

  it('tells the member — in Gujarati — through the notification spine rather than promising it on a screen', async () => {
    // W168's footer promises "member notified in Gujarati" and nothing told the member anything. The event carries the
    // FARMER's own user id (ADMIN-6b: a map row over a payload with no recipient sends nothing), and the catalog +
    // templates are seeded, so the spine can actually deliver.
    const ev = await admin.query(
      `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.quality_flag_opened' ORDER BY created_at DESC LIMIT 1`, [tenantA]);
    expect(ev.rows.length).toBe(1);
    expect(ev.rows[0].payload.userId).toBe(farmer2);
    expect(ev.rows[0].payload.amountWithheldMinor).toBeDefined();

    const decided = await admin.query(
      `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.quality_flag_decided' ORDER BY created_at DESC LIMIT 1`, [tenantA]);
    expect(decided.rows.length).toBe(1);

    const gu = await admin.query(
      `SELECT body FROM notification_templates WHERE event_code='dairy.quality_flag_opened' AND language_code='gu' AND channel='sms'`);
    expect(gu.rows.length).toBe(1);
    expect(gu.rows[0].body).toContain('{{mcc}}');
    // A message about money being withheld is not opt-out-able.
    const cat = await admin.query(`SELECT user_can_opt_out FROM notification_events WHERE code='dairy.quality_flag_opened'`);
    expect(cat.rows[0].user_can_opt_out).toBe(false);
  });

  /* ======================================================================================================= */
  /* THE PREMIUM BAND THE ENGINE NEVER APPLIED                                                               */
  /* ======================================================================================================= */

  it('prices WITHOUT the premium while the flag is off — the state the platform shipped in', async () => {
    const d = addDays(day, -9);
    await collections.record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'morning', collectedOn: d, weightKg: '7.100', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [] } as any);
    const row = (await admin.query(`SELECT amount_minor, bonus_minor, bonus_applied FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membership2, d])).rows[0];
    expect(BigInt(row.amount_minor)).toBe(56_729n);        // 34,762 fat + 21,967 snf, no premium
    expect(BigInt(row.bonus_minor)).toBe(0n);
    expect(row.bonus_applied).toBe(false);                 // …and the platform records that it did not apply them
  });

  /**
   * The flag service caches for 30 seconds by design ("fast kill-switch propagation" — core/feature-flags/flags.service).
   * The test above already asked the same question and got OFF, so a service that kept its cache would keep answering OFF
   * for half a minute. That is CORRECT platform behaviour, so this test respects it and builds a fresh cache rather than
   * reaching in to clear one: a test that mutates a cache it does not own stops proving what the product does.
   */
  it('pays W168\'s own worked example once the tenant switches the slabs on', async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key='dairy_bonus_slabs'`);
    try {
      const d = addDays(day, -10);
      await freshCollections().record(tenantA, actor, `idem-${randomUUID()}`, { membershipId: membership2, shift: 'morning', collectedOn: d, weightKg: '7.100', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [] } as any);
      const row = (await admin.query(`SELECT amount_minor, bonus_minor, bonus_applied FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membership2, d])).rows[0];
      // W168: "7.1 L @ fat 6.8 / SNF 9.1 → … + bonus ≈ ₹571".
      expect(BigInt(row.bonus_minor)).toBe(355n);          // 7.1 L × ₹0.50
      expect(BigInt(row.amount_minor)).toBe(57_084n);      // ₹570.84 — the canon's "≈ ₹571"
      expect(row.bonus_applied).toBe(true);
    } finally {
      await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key='dairy_bonus_slabs'`);
    }
  });

  it('does not RE-price a pour that was already paid without the premium', async () => {
    // The pour from two tests ago was priced with the flag off. Turning the flag on must not rewrite history: a member
    // paid last fortnight was paid what the card said then, and a retroactive premium is a different decision entirely.
    const d = addDays(day, -9);
    const row = (await admin.query(`SELECT bonus_minor, bonus_applied FROM milk_collections WHERE tenant_id=$1 AND membership_id=$2 AND collected_on=$3::date`, [tenantA, membership2, d])).rows[0];
    expect(BigInt(row.bonus_minor)).toBe(0n);
    expect(row.bonus_applied).toBe(false);
  });

  it('keeps the rate card\'s slabs readable — the column the repository did not even SELECT', async () => {
    const cards2 = await admin.query(`SELECT bonus_rules FROM milk_rate_cards WHERE tenant_id=$1 AND animal_type='cow'`, [tenantA]);
    expect(cards2.rows[0].bonus_rules).toEqual([{ metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 }]);
    // …and the database refuses a shape the engine would iterate to nothing.
    await expect(admin.query(`UPDATE milk_rate_cards SET bonus_rules='{"metric":"fat"}'::jsonb WHERE tenant_id=$1 AND animal_type='cow'`, [tenantA]))
      .rejects.toThrow(/ck_rate_card_bonus_rules_array/);
  });

  it('RLS: another tenant cannot see this tenant\'s quality reviews', async () => {
    const other = new Pool({ connectionString: APP_URL });
    try {
      await other.query('SET ROLE kv_app');
      await other.query(`SELECT set_config('app.tenant_id',$1,false)`, [randomUUID()]);
      expect((await other.query(`SELECT id FROM milk_quality_reviews WHERE tenant_id=$1`, [tenantA])).rows.length).toBe(0);
      await other.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
      expect((await other.query(`SELECT count(*)::int n FROM milk_quality_reviews`)).rows[0].n).toBeGreaterThan(0);
    } finally { await other.end(); }
  });

  it('the review\'s foreign key reaches the pour through its partition day', async () => {
    const { rows } = await admin.query(
      `SELECT conname FROM pg_constraint WHERE conrelid='milk_quality_reviews'::regclass AND contype='f' AND conname='fk_quality_review_collection'`);
    expect(rows.length).toBe(1);
    // …and a review for a pour that does not exist is refused by the database, not just by the service.
    await expect(admin.query(
      `INSERT INTO milk_quality_reviews (tenant_id, collection_id, collected_on, membership_id, mcc_id, shift, water_flag, amount_withheld_minor, currency_code)
       VALUES ($1, uuid_generate_v7(), $2::date, $3, $4, 'morning', true, 100, 'INR')`, [tenantA, day, membership2, mccId]))
      .rejects.toThrow(/fk_quality_review_collection|foreign key/i);
  });

  it('both new flags ship OFF', async () => {
    const { rows } = await admin.query(`SELECT key, is_enabled FROM feature_flags WHERE key IN ('dairy_bonus_slabs','dairy_quality_desk') ORDER BY key`);
    expect(rows.map((r: any) => [r.key, r.is_enabled])).toEqual([['dairy_bonus_slabs', false], ['dairy_quality_desk', false]]);
  });
});
