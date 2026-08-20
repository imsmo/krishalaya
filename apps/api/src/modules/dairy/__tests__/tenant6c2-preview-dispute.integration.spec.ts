// modules/dairy/__tests__/tenant6c2-preview-dispute.integration.spec.ts · PC-56 TENANT-6c-2, LIVE Postgres.
//
// W169: *"Preview goes to every member in Gujarati BEFORE money moves — surprises are for birthdays, not milk money."*
//
// Three things here can only be proven against the real database:
//   1. **THE TEMPLATE GATE.** 0122's send-time gate INNER JOINs `notification_template_versions` on
//      `serving_version_id`, and the base seed file never wrote one — 42 of 123 platform templates resolved to NULL and
//      every send was recorded as `no_template`, silently, including all ten of TENANT-6b-1's dairy quality rows. A unit
//      test can assert the SQL exists; only a live count can prove nothing is left unversioned, and only a live
//      `resolve()` can prove the Gujarati copy actually comes back.
//   2. **THE PARTIAL UNIQUE INDEX.** Voiding a bill is only a correction if a new one can be built for the same
//      fortnight afterwards. Under the total UNIQUE constraint it was a one-way door.
//   3. **THE APPEND-ONLY GRANT** on a dispute's testimony.
//
// RUN UNDER TZ=Asia/Kolkata AS WELL AS UTC.
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { NotificationTemplateRepository } from '../../communication/repositories/notification-template.repository';

import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MilkBillDisputeRepository } from '../repositories/milk-bill-dispute.repository';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MccCentreService } from '../services/mcc-centre.service';
import { DairyMembershipService } from '../services/dairy-membership.service';
import { MilkRateCardService } from '../services/milk-rate-card.service';
import { MilkCollectionService } from '../services/milk-collection.service';
import { MilkBillService } from '../services/milk-bill.service';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillDeductionConsentRepository } from '../repositories/milk-bill-deduction-consent.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { MilkBillDeductionService } from '../services/milk-bill-deduction.service';
import { LoanService } from '../../fintech/services/loan.service';
import { LoanRepository } from '../../fintech/repositories/loan.repository';
import { LoanRepaymentRepository } from '../../fintech/repositories/loan-repayment.repository';
import { MilkBillDisputeService } from '../services/milk-bill-dispute.service';
import { DairyBillCycleService } from '../services/dairy-bill-cycle.service';
import { previousCycleWindow } from '../domain/dairy-cycle';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-6c-2 · the preview, the window and the dispute (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let mccs: MccCentreService; let memberships: DairyMembershipService; let cards: MilkRateCardService;
  let collections: MilkCollectionService; let bills: MilkBillService;
  let cycles: DairyBillCycleService; let cycleRepo: DairyBillCycleRepository;
  let disputes: MilkBillDisputeService; let disputeRepo: MilkBillDisputeRepository;
  let templates: NotificationTemplateRepository; let billRepo: MilkBillRepository;

  const tenantA = randomUUID();
  const operator = randomUUID();
  const checker = randomUUID();
  const farmerA = randomUUID();
  const outsider = randomUUID();
  // [PC-56 TENANT-6c-3] `canCloseSettlement` is 0144's `settlement.close`, which W169 names on both the preview and
  // the approve. These fixtures drive one operator through the whole desk, so they carry both keys; the wave's own
  // spec is where the refusals live.
  const actor = { userId: operator, canManage: true, canCloseSettlement: true };
  let mccId = ''; let memA = ''; let cycleId = ''; let billId = '';
  let win = { from: '', to: '', cycle: 'fortnightly' as const, basis: 'derived_from_membership_preference' as const };

  const balUser = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const fundTenant = (t: string, amount: bigint) => uow.run(t, (tx) => wallet.post(tx, { tenantId: t, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system',
    legs: [{ account: { kind: 'tenant', tenantId: t, accountCode: TenantAccount.Main, currencyCode: 'INR' }, amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    for (const u of [operator, checker, farmerA, outsider]) await makeUser(admin, u);

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

    const mccRepo = new MccCentreRepository(replica as never);
    const memRepo = new DairyMembershipRepository(replica as never);
    const cardRepo = new MilkRateCardRepository(replica as never);
    const collRepo = new MilkCollectionRepository(replica as never);
    billRepo = new MilkBillRepository(replica as never);
    const reviewRepo = new MilkQualityReviewRepository(replica as never);
    cycleRepo = new DairyBillCycleRepository(replica as never);
    disputeRepo = new MilkBillDisputeRepository(replica as never);
    templates = new NotificationTemplateRepository(replica as never);
    const flags = new FlagsService(pools, new InMemoryCacheService());

    mccs = new MccCentreService(uow, outbox, idem, metrics, audit, mccRepo);
    memberships = new DairyMembershipService(uow, outbox, idem, metrics, memRepo, mccRepo);
    cards = new MilkRateCardService(uow, outbox, idem, metrics, cardRepo);
    collections = new MilkCollectionService(uow, outbox, idem, metrics, collRepo, cardRepo, memRepo, reviewRepo, flags);
    const lineRepo = new MilkBillDeductionRepository(replica as never);
    const typeRepo = new DairyDeductionTypeRepository(replica as never);
    const creditRepo = new DairyMemberCreditRepository(replica as never);
    const consentRepo = new MilkBillDeductionConsentRepository(replica as never);
    const applier = new MilkBillDeductionService(wallet, outbox, lineRepo, creditRepo, typeRepo,
      new LoanService(uow, outbox, idem, metrics, audit, wallet, new LoanRepository(replica as never), new LoanRepaymentRepository(replica as never)));
    bills = new MilkBillService(uow, outbox, idem, metrics, wallet, audit, billRepo, collRepo, memRepo, cycleRepo,
      // [PC-56 TENANT-6c-4] the deduction's destination: the lines, the vocabulary, the credits, the consent, the
      // applier that posts each line to what it pays, and the recovery kill-switch.
      lineRepo, typeRepo, creditRepo, consentRepo, applier, flags);
    cycles = new DairyBillCycleService(uow, outbox, metrics, idem, cycleRepo, collRepo, bills, billRepo, memRepo);
    disputes = new MilkBillDisputeService(uow, outbox, idem, metrics, audit, disputeRepo, billRepo, memRepo, cycleRepo, bills);

    await fundTenant(tenantA, 100_000_000n);

    const today = (await admin.query(`SELECT current_date::text AS d`)).rows[0].d;
    const prev = previousCycleWindow(today, 'fortnightly');
    win = { ...win, from: prev.from, to: prev.to };

    mccId = (await mccs.create(tenantA, actor, `idem-${randomUUID()}`, { code: 'MCC-AND-02', defaultName: 'Anand 02' } as never, null)).id;
    await cards.create(tenantA, actor, `idem-${randomUUID()}`, { defaultName: 'Buffalo two_axis v4', animalType: 'buffalo', pricingModel: 'two_axis', ratePerKgFatMinor: '72000', ratePerKgSnfMinor: '34000', effectiveFrom: '2026-01-01' } as never);
    memA = (await memberships.create(tenantA, actor, `idem-${randomUUID()}`, { farmerUserId: farmerA, mccId, memberCode: 'AND2-0087', paymentCycle: 'fortnightly', defaultAnimalType: 'buffalo' } as never)).id;

    await collections.record(tenantA, actor, `idem-${randomUUID()}`, {
      membershipId: memA, mccId, shift: 'morning', collectedOn: prev.to,
      weightKg: '8.615', fatPct: '6.80', snfPct: '9.10', waterFlag: false, adulterationFlags: [],
    } as never);

    await cycles.ensureCycles(tenantA);
    await cycles.closeDue(tenantA, new Date());
    await cycles.buildBills(tenantA);
    cycleId = (await uow.run(tenantA, (tx) => cycleRepo.findByWindow(tx, tenantA, win), { userId: 'system' }))!.id;
    billId = (await admin.query(`SELECT id FROM milk_bills WHERE tenant_id=$1 AND membership_id=$2`, [tenantA, memA])).rows[0].id;
  }, 120000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  /* ======================================================================================================= */
  describe('THE TEMPLATE GATE — every seeded notification was silently dead', () => {
    it('leaves NO ACTIVE platform template without a serving version', async () => {
      const r = await admin.query(
        `SELECT count(*)::int AS n FROM notification_templates
          WHERE tenant_id IS NULL AND is_active = true AND serving_version_id IS NULL AND deleted_at IS NULL`);
      // Before this wave: 42 unversioned. `order.confirmed`, `payment.success`, `auth.otp`, `wage.paid`, every
      // `dispute.*`, and all of TENANT-6b-1's dairy quality rows — each resolving to NULL through 0122's send-time gate,
      // each send recorded as `no_template`. The cause: 0122 backfilled the templates the MIGRATIONS inserted, and
      // SEEDS RUN AFTER MIGRATIONS, so nothing this seed file has added since 0122 was ever versioned.
      expect(r.rows[0].n).toBe(0);
    });

    it('and leaves the INACTIVE ones unserved, which is the point of the lifecycle', async () => {
      // 0101's ruling: a `DLT_*` placeholder is not a DLT registration, and an active SMS template carrying one means
      // "the platform believes it texted a farmer while the aggregator silently rejected the send". Those rows keep a
      // `draft` version and NO serving pointer, so the gate stops them.
      const r = await admin.query(
        `SELECT v.lifecycle FROM notification_templates t
           JOIN notification_template_versions v ON v.template_id = t.id AND v.version_no = 1
          WHERE t.tenant_id IS NULL AND t.is_active = false`);
      expect(r.rowCount).toBeGreaterThan(0);
      for (const row of r.rows as Array<{ lifecycle: string }>) expect(row.lifecycle).toBe('draft');
      const served = await admin.query(
        `SELECT count(*)::int AS n FROM notification_templates WHERE tenant_id IS NULL AND is_active = false AND serving_version_id IS NOT NULL`);
      expect(served.rows[0].n).toBe(0);
    });

    it('A PLACEHOLDER DLT ID IS NOT A REGISTRATION — every dairy SMS row is deactivated until one exists', async () => {
      // TENANT-6b-1 seeded six `DLT_DAIRY_FLAG_*` rows as ACTIVE, in the wave whose whole point was W168's "member
      // notified in Gujarati" — and this wave was about to add four more of exactly the same shape.
      const r = await admin.query(
        `SELECT count(*) FILTER (WHERE is_active)::int AS active, count(*)::int AS total
           FROM notification_templates WHERE channel='sms' AND tenant_id IS NULL AND provider_template_ref LIKE 'DLT_DAIRY_%'`);
      expect(Number(r.rows[0].total)).toBeGreaterThanOrEqual(9);
      expect(Number(r.rows[0].active)).toBe(0);
    });

    it('so the VERNACULAR promise is kept through the channels that work: push + in-app in all three languages', async () => {
      // With SMS correctly silent, an English-only push row would tell a Gujarati farmer in English — which is how
      // 6b-1's rows shipped. All four dairy events now have gu and hi on both live channels.
      for (const code of ['dairy.bill_previewed', 'dairy.bill_dispute_resolved', 'dairy.quality_flag_opened', 'dairy.quality_flag_decided']) {
        for (const channel of ['push', 'inapp']) {
          for (const lang of ['en', 'hi', 'gu']) {
            expect(await templates.resolve(tenantA, code, channel, lang)).not.toBeNull();
          }
        }
      }
    });

    it('every version it wrote is APPROVED and hash-stamped, so the gate actually opens', async () => {
      const r = await admin.query(
        `SELECT count(*)::int AS bad FROM notification_templates t
           JOIN notification_template_versions v ON v.id = t.serving_version_id
          WHERE t.tenant_id IS NULL AND (v.lifecycle <> 'approved' OR v.body_sha256 IS NULL OR v.body <> t.body)`);
      expect(r.rows[0].bad).toBe(0);
    });

    it('resolves W169\'s preview copy IN GUJARATI through the real send-time gate', async () => {
      const gu = await templates.resolve(tenantA, 'dairy.bill_previewed', 'inapp', 'gu');
      expect(gu).not.toBeNull();
      // Rendered, not merely present: the promise is a MESSAGE a farmer can read, so the assertion goes through the
      // same interpolation the sender uses and checks that the figures land and no token leaks.
      const rendered = gu!.render({ period: '01-15 Jul', litres: '8.615', net: 'Rs 8,412', deductions: 'Rs 0', window_ends: 'Fri 9:00 am' }).body;
      expect(rendered).toMatch(/[઀-૿]/);          // Gujarati script — "in Gujarati" is the promise
      expect(rendered).toContain('Rs 8,412');
      expect(rendered).toContain('Fri 9:00 am');
      expect(rendered).not.toContain('{{');
      expect(gu!.versionId).not.toBeNull();       // and it is serving an APPROVED version, which is the whole finding
      for (const lang of ['hi', 'en']) expect(await templates.resolve(tenantA, 'dairy.bill_previewed', 'inapp', lang)).not.toBeNull();
      // The SMS row exists and is deliberately NOT servable — see the DLT test above.
      expect(await templates.resolve(tenantA, 'dairy.bill_previewed', 'sms', 'gu')).toBeNull();
    });

    it('TENANT-6b-1\'s quality messages resolve now too — the wave that built them sent nothing', async () => {
      expect(await templates.resolve(tenantA, 'dairy.quality_flag_opened', 'inapp', 'gu')).not.toBeNull();
      expect(await templates.resolve(tenantA, 'dairy.quality_flag_decided', 'inapp', 'gu')).not.toBeNull();
    });

    it('money copy a farmer cannot mute needs TWO humans to reword — 0122\'s own rule, applied', async () => {
      const r = await admin.query(
        `SELECT v.needs_second_person FROM notification_templates t
           JOIN notification_template_versions v ON v.id = t.serving_version_id
          WHERE t.event_code='dairy.bill_previewed' AND t.tenant_id IS NULL LIMIT 1`);
      // `user_can_opt_out = false` on this event, so 0122's formula makes its wording second-person-locked. Hardcoding
      // `false` here — which the first draft of this seed block did — would have quietly downgraded the governance on a
      // notice about 312 families' money.
      expect(r.rows[0].needs_second_person).toBe(true);
    });

    it('a tenant cannot override this copy AT ALL — the platform guards notices a farmer cannot mute', async () => {
      // Discovered by trying it: the database refuses a tenant override on an opt-out-locked or critical event. So the
      // backfill's `tenant_id IS NULL` scope is belt-and-braces here rather than the only guard — and a cooperative
      // cannot reword the notice that tells its own members what they are being paid.
      await expect(admin.query(
        `INSERT INTO notification_templates (event_code, channel, language_code, tenant_id, subject, body, is_active)
         VALUES ('dairy.bill_previewed','inapp','en',$1,'x','tenant override awaiting approval',true)`, [tenantA]))
        .rejects.toThrow(/platform-controlled|no tenant override/i);
    });
  });

  /* ======================================================================================================= */
  describe('the preview, on the cycle', () => {
    it('moves the cycle, sets every bill\'s window, and queues a message NAMING THE MEMBER', async () => {
      const out = await cycles.previewCycle(tenantA, actor, cycleId);
      expect(out).toMatchObject({ previewed: 1, failed: 0, remaining: 0 });

      const cyc = await uow.run(tenantA, (tx) => cycleRepo.getForUpdate(tx, tenantA, cycleId), { userId: 'system' });
      expect(cyc!.status).toBe('previewed');
      expect(cyc!.previewedBy).toBe(operator);
      expect(cyc!.toProps().billsPreviewed).toBe(1);

      const bill = await admin.query(`SELECT status, dispute_window_ends, previewed_at FROM milk_bills WHERE id=$1`, [billId]);
      expect(bill.rows[0].status).toBe('previewed');
      // The column that has had a reader in apps/mobile since 0009 and NO WRITER anywhere until this wave.
      expect(bill.rows[0].dispute_window_ends).not.toBeNull();
      expect(bill.rows[0].previewed_at).not.toBeNull();

      const ev = await admin.query(
        `SELECT event_type, payload FROM outbox_events WHERE tenant_id=$1 AND aggregate_id=$2 ORDER BY created_at`, [tenantA, billId]);
      const previewed = ev.rows.find((r: { event_type: string }) => r.event_type === 'dairy.bill_previewed');
      expect(previewed).toBeDefined();
      // ADMIN-6b's finding, four waves running: a map row over a payload with no recipient sends nothing.
      expect(previewed.payload.userId).toBe(farmerA);
      expect(previewed.payload.windowEndsAt).toBeTruthy();
    });

    it('the window is 24 hours by default, from the SETTING and not from a literal', async () => {
      const seeded = (await admin.query(`SELECT default_value #>> '{}' AS v FROM setting_definitions WHERE key='dairy.dispute_window_hours'`)).rows[0];
      expect(seeded.v).toBe('24');
      const r = await admin.query(
        `SELECT extract(epoch FROM (dispute_window_ends - previewed_at))::int AS secs FROM milk_bills WHERE id=$1`, [billId]);
      expect(r.rows[0].secs).toBe(24 * 3600);
    });

    it('a RE-PRESS is a no-op rather than a second message', async () => {
      const before = (await admin.query(
        `SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.bill_previewed'`, [tenantA])).rows[0].n;
      const out = await cycles.previewCycle(tenantA, actor, cycleId);
      expect(out).toMatchObject({ previewed: 0, remaining: 0 });
      const after = (await admin.query(
        `SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.bill_previewed'`, [tenantA])).rows[0].n;
      expect(after).toBe(before);
    });
  });

  /* ======================================================================================================= */
  describe('the window, ENFORCED', () => {
    it('REFUSES to pay while the member still has time, and moves not a rupee', async () => {
      await bills.approve(tenantA, actor, billId);
      const before = await balUser(farmerA);
      await expect(bills.pay(tenantA, actor, billId, `idem-${randomUUID()}`, null))
        .rejects.toMatchObject({ code: 'DISPUTE_WINDOW_OPEN' });
      expect(await balUser(farmerA)).toBe(before);
      expect((await admin.query(`SELECT status FROM milk_bills WHERE id=$1`, [billId])).rows[0].status).toBe('approved');
      // Before this wave `pay()` checked the status and nothing else, so the 24h promise — had anything written the
      // window — would have been decoration.
    });

    it('pays once the window has shut', async () => {
      const ends = (await admin.query(`SELECT dispute_window_ends FROM milk_bills WHERE id=$1`, [billId])).rows[0].dispute_window_ends;
      const after = new Date(new Date(ends).getTime() + 1000);
      const before = await balUser(farmerA);
      const paid = await bills.pay(tenantA, actor, billId, `idem-${randomUUID()}`, null, after);
      expect(paid.status).toBe('paid');
      expect(await balUser(farmerA) - before).toBe(BigInt(paid.netMinor));
    });
  });

  /* ======================================================================================================= */
  describe('the dispute, end to end on a second fortnight', () => {
    let secondBill = '';
    let secondCycle = '';
    let windowEnds: Date;

    it('builds and previews another cycle to object to', async () => {
      // A DIFFERENT window, because the first fortnight's bill is paid and terminal.
      const earlier = previousCycleWindow(win.from, 'fortnightly');
      await collections.record(tenantA, actor, `idem-${randomUUID()}`, {
        membershipId: memA, mccId, shift: 'morning', collectedOn: earlier.to,
        weightKg: '7.250', fatPct: '6.50', snfPct: '9.00', waterFlag: false, adulterationFlags: [],
      } as never);
      const c = await uow.run(tenantA, (tx) => cycleRepo.ensure(tx, tenantA, earlier), { userId: 'system' });
      secondCycle = c.id;
      await cycles.closeDue(tenantA, new Date());
      await cycles.buildBills(tenantA);
      await cycles.previewCycle(tenantA, actor, secondCycle);
      const r = await admin.query(`SELECT id, status, dispute_window_ends FROM milk_bills WHERE tenant_id=$1 AND cycle_id=$2`, [tenantA, secondCycle]);
      expect(r.rowCount).toBe(1);
      secondBill = r.rows[0].id;
      windowEnds = new Date(r.rows[0].dispute_window_ends);
      expect(r.rows[0].status).toBe('previewed');
    });

    it('a NON-MEMBER gets 404, not 403 — bill ids are not probeable', async () => {
      await expect(disputes.raise(tenantA, outsider, secondBill, 'this is not even my bill', `idem-${randomUUID()}`, null))
        .rejects.toMatchObject({ code: 'MILK_BILL_NOT_FOUND' });
    });

    it('the MEMBER objects, with no dairy permission anywhere near it', async () => {
      const d = await disputes.raise(tenantA, farmerA, secondBill, 'my litres are short by about four', `idem-${randomUUID()}`, null);
      expect(d.status).toBe('open');
      expect(d.raisedByUserId).toBe(farmerA);
      expect((await admin.query(`SELECT status FROM milk_bills WHERE id=$1`, [secondBill])).rows[0].status).toBe('disputed');
      // "disputed pauses one bill, never the cycle" — the cycle is untouched.
      expect((await admin.query(`SELECT status FROM dairy_bill_cycles WHERE id=$1`, [secondCycle])).rows[0].status).toBe('previewed');
      // And the window it was raised inside is COPIED onto the dispute, so it stays arguable after a re-preview.
      const row = await admin.query(`SELECT window_ended_at FROM milk_bill_disputes WHERE id=$1`, [d.id]);
      expect(new Date(row.rows[0].window_ended_at).getTime()).toBe(windowEnds.getTime());
    });

    it('a SECOND open objection on the same bill is refused by the database as well as the domain', async () => {
      await expect(disputes.raise(tenantA, farmerA, secondBill, 'and the deduction looks wrong too', `idem-${randomUUID()}`, null))
        .rejects.toMatchObject({ code: 'DISPUTE_ALREADY_OPEN' });
      const d = (await admin.query(`SELECT id, membership_id, raised_by_user_id, window_ended_at FROM milk_bill_disputes WHERE bill_id=$1`, [secondBill])).rows[0];
      await expect(admin.query(
        `INSERT INTO milk_bill_disputes (tenant_id, bill_id, membership_id, raised_by_user_id, reason, window_ended_at, status)
         VALUES ($1,$2,$3,$4,'a hand-written second objection',$5,'open')`,
        [tenantA, secondBill, d.membership_id, d.raised_by_user_id, d.window_ended_at]))
        .rejects.toThrow(/uq_milk_bill_dispute_open/);
    });

    it('a disputed bill CANNOT be paid, window or no window', async () => {
      await expect(bills.pay(tenantA, actor, secondBill, `idem-${randomUUID()}`, null, new Date(windowEnds.getTime() + 10_000)))
        .rejects.toMatchObject({ code: 'BILL_NOT_PAYABLE' });
    });

    it('the app role cannot rewrite what the member SAID', async () => {
      const priv = await admin.query(
        `SELECT 1 FROM information_schema.column_privileges
          WHERE table_name='milk_bill_disputes' AND grantee='kv_app' AND privilege_type='UPDATE' AND column_name IN ('reason','raised_by_user_id','raised_at','window_ended_at')`);
      expect(priv.rowCount).toBe(0);
      const tablePriv = await admin.query(
        `SELECT 1 FROM information_schema.table_privileges WHERE table_name='milk_bill_disputes' AND grantee='kv_app' AND privilege_type='UPDATE'`);
      expect(tablePriv.rowCount).toBe(0);   // 0157's lesson: REVOKE first or the column grant is decoration
      await expect(uow.run(tenantA, (tx) => tx.query(`UPDATE milk_bill_disputes SET reason='rewritten' WHERE bill_id=$1`, [secondBill]), { userId: 'system' }))
        .rejects.toThrow(/permission denied/i);
    });

    it('a REJECTED answer re-previews the bill with a FRESH window and notifies the member', async () => {
      const d = (await admin.query(`SELECT id FROM milk_bill_disputes WHERE bill_id=$1 AND status='open'`, [secondBill])).rows[0];
      const at = new Date(windowEnds.getTime() + 60_000);
      await disputes.resolve(tenantA, actor, d.id, { outcome: 'rejected', note: 'Checked against the counter slips; the litres match.', voidBill: false }, null, at);

      const bill = (await admin.query(`SELECT status, dispute_window_ends FROM milk_bills WHERE id=$1`, [secondBill])).rows[0];
      expect(bill.status).toBe('previewed');
      expect(new Date(bill.dispute_window_ends).getTime()).toBe(at.getTime() + 24 * 3_600_000);
      const row = (await admin.query(`SELECT status, resolved_by, resolution_note, voided_bill FROM milk_bill_disputes WHERE id=$1`, [d.id])).rows[0];
      expect(row).toMatchObject({ status: 'rejected', resolved_by: operator, voided_bill: false });
      expect(row.resolution_note).toContain('counter slips');
      const ev = await admin.query(
        `SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='dairy.bill_dispute_resolved' ORDER BY created_at DESC LIMIT 1`, [tenantA]);
      expect(ev.rows[0].payload.userId).toBe(farmerA);
    });

    it('an UPHELD answer VOIDS the bill, releases its pours, and the cycle rebuilds it', async () => {
      // The whole point of the partial unique index. Under the old total UNIQUE constraint this member could never be
      // built another bill for this fortnight, so voiding a wrong bill was a one-way door.
      const d2 = await disputes.raise(tenantA, farmerA, secondBill, 'still short, please check the slip again', `idem-${randomUUID()}`, null);
      await disputes.resolve(tenantA, actor, d2.id, { outcome: 'upheld', note: 'Weight re-keyed from the slip; rebuilding this bill.', voidBill: true }, null);

      const voided = (await admin.query(`SELECT status, voided_by, void_reason, deleted_at FROM milk_bills WHERE id=$1`, [secondBill])).rows[0];
      expect(voided).toMatchObject({ status: 'voided', voided_by: operator });
      expect(voided.deleted_at).not.toBeNull();
      expect(voided.void_reason).toContain('re-keyed');

      const released = await admin.query(`SELECT count(*)::int AS n FROM milk_collections WHERE tenant_id=$1 AND milk_bill_id IS NULL AND membership_id=$2`, [tenantA, memA]);
      expect(released.rows[0].n).toBeGreaterThan(0);

      // AND A NEW ONE IS BUILT for the same fortnight — the property the index change exists for.
      const fresh = (await uow.run(tenantA, (tx) => cycleRepo.getForUpdate(tx, tenantA, secondCycle), { userId: 'system' }))!;
      const out = await cycles.generateFor(tenantA, fresh);
      expect(out.generated).toBe(1);
      const live = await admin.query(`SELECT id, status FROM milk_bills WHERE tenant_id=$1 AND cycle_id=$2 AND deleted_at IS NULL`, [tenantA, secondCycle]);
      expect(live.rowCount).toBe(1);
      expect(live.rows[0].id).not.toBe(secondBill);
      expect(live.rows[0].status).toBe('draft');
    }, 20000);
  });

  /* ======================================================================================================= */
  describe('what 0158 says out loud', () => {
    it('a resolution cannot exist without its decider, time AND note', async () => {
      const d = (await admin.query(`SELECT id FROM milk_bill_disputes WHERE status <> 'open' LIMIT 1`)).rows[0];
      // Erasing any ONE of the three breaks it: a decision with no decider, no time, or no explanation is not a
      // resolution, and W169's tile claims last cycle's disputes were "resolved".
      for (const col of ['resolved_by', 'resolved_at', 'resolution_note']) {
        await expect(admin.query(`UPDATE milk_bill_disputes SET ${col}=NULL WHERE id=$1`, [d.id]))
          .rejects.toThrow(/ck_milk_bill_dispute_resolution/);
      }
      // And back to `open` while keeping the stamps is the same contradiction from the other side.
      await expect(admin.query(`UPDATE milk_bill_disputes SET status='open' WHERE id=$1`, [d.id]))
        .rejects.toThrow(/ck_milk_bill_dispute_resolution/);
      await expect(admin.query(`UPDATE milk_bill_disputes SET resolution_note='no' WHERE id=$1`, [d.id]))
        .rejects.toThrow(/ck_milk_bill_dispute_note/);
    });

    it('only an UPHELD query may have voided the bill', async () => {
      const d = (await admin.query(`SELECT id FROM milk_bill_disputes WHERE status='rejected' LIMIT 1`)).rows[0];
      await expect(admin.query(`UPDATE milk_bill_disputes SET voided_bill=true WHERE id=$1`, [d.id]))
        .rejects.toThrow(/ck_milk_bill_dispute_void/);
    });

    it('a member\'s testimony has a floor', async () => {
      const d = (await admin.query(`SELECT tenant_id, bill_id, membership_id, raised_by_user_id, window_ended_at FROM milk_bill_disputes LIMIT 1`)).rows[0];
      await expect(admin.query(
        `INSERT INTO milk_bill_disputes (tenant_id, bill_id, membership_id, raised_by_user_id, reason, window_ended_at, status)
         VALUES ($1,$2,$3,$4,'  short  ',$5,'upheld')`,
        [d.tenant_id, d.bill_id, d.membership_id, d.raised_by_user_id, d.window_ended_at]))
        .rejects.toThrow(/ck_milk_bill_dispute_reason/);
    });

    it('a previewed bill must carry the window it promised', async () => {
      await expect(admin.query(`UPDATE milk_bills SET dispute_window_ends=NULL WHERE id=$1`, [billId]))
        .rejects.toThrow(/ck_milk_bill_preview_window/);
    });

    it('a cycle cannot be set to a status this programme cannot reach', async () => {
      // [PC-56 TENANT-6c-3] This assertion named `approved` when it was written, because 6c-2 deliberately stopped at
      // `previewed` — there was no checker and no `settlement.close` check, so a cycle the software called "approved"
      // would have been one person's press. 0159 built the second signature and the vocabulary moved, so the same
      // property is now asserted at the wave's NEW edge: `paid` is still unreachable, because the deduction has no
      // destination and the payout batch behind "one bank trip" does not exist.
      await expect(admin.query(`UPDATE dairy_bill_cycles SET status='paid' WHERE id=$1`, [cycleId]))
        .rejects.toThrow(/ck_dairy_bill_cycle_status/);
    });

    it('the flag gating the preview ships OFF, and the DISPUTE is not behind it', async () => {
      const r = await admin.query(`SELECT is_enabled FROM feature_flags WHERE key='dairy_cycle_preview'`);
      expect(r.rows[0].is_enabled).toBe(false);
      // The member's right to object, and the pay-time window check, are deliberately outside any flag — 0156's ruling
      // for the pour-level hold: a farmer's money must not depend on whether a screen is switched on. Proven by the
      // dispute tests above, which never touched a flag.
    });

    it('RLS isolates disputes between tenants', async () => {
      const other = randomUUID();
      await makeTenant(admin, other, 'B');
      const seen = await uow.run(other, (tx) => tx.query(`SELECT count(*)::int c FROM milk_bill_disputes`), { userId: 'system' });
      expect((seen.rows[0] as { c: number }).c).toBe(0);
    });
  });
});
