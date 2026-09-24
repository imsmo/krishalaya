// modules/education/__tests__/tenant7dm-earnings.integration.spec.ts · PC-56 TENANT-7d-money · THE EARNINGS against a REAL
// Postgres (the harness builds the database from the real chain, 0001…0174 + seeds), as `kv_app` under RLS.
// What this proves that the unit specs cannot:
//   • a purchase in a NON-INR course currency posts legs netting to zero in THAT currency (AED at 2, JPY at 0 minor
//     units) — `ledger_entries.currency_code` and the `wallet_accounts` rows name it, the line snapshots the scale;
//   • the tenant's share is applied from the tenant's RULE with the platform's 80/18/2 default; a tenant override is
//     proposed by one finance person and decided by another (the service AND 0174's CHECK on a direct UPDATE);
//   • the instructor's balance is Σ lines — held while no agreement is accepted, released hold → main (one balanced
//     wallet transaction) in the acceptance's own transaction;
//   • a royalty payout is refused without an accepted agreement, beyond Σ lines, and without instructor-role KYC (0125);
//     once queued it rides the batch: NEVER claimed unbatched (the repository AND 0174's trigger on a direct UPDATE),
//     the maker cannot approve their own batch (TENANT-4b), and the money moves only once the batch is approved;
//   • an idempotent replay posts no second leg and no second line; RLS hides another tenant's lines, agreements and
//     rules while every tenant reads the platform default; the line is append-only by trigger;
//   • every ledger transaction in the database nets to zero and every cached balance equals Σ its entries;
//   • the export dataset yields one row per line and refuses `dataset_disabled` when the screen's flag is off.
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
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';
import { UiMessageRepository } from '../../../core/i18n/ui-message.repository';
import { InstructorRepository } from '../repositories/instructor.repository';
import { CourseRepository } from '../repositories/course.repository';
import { CourseLessonRepository } from '../repositories/course-lesson.repository';
import { EnrollmentRepository } from '../repositories/enrollment.repository';
import { InstructorEarningsRepository } from '../repositories/instructor-earnings.repository';
import { InstructorService } from '../services/instructor.service';
import { CourseService } from '../services/course.service';
import { LessonService } from '../services/lesson.service';
import { EnrollmentService } from '../services/enrollment.service';
import { InstructorEarningsService, EarningsActor } from '../services/instructor-earnings.service';
import { InstructorEarningsDataset } from '../exports/instructor-earnings.dataset';
import { PayoutService } from '../../payments/services/payout.service';
import { PayoutRepository } from '../../payments/repositories/payout.repository';
import { PayoutBatchRepository } from '../../payments/repositories/payout-batch.repository';
import { PayoutApprovalService } from '../../payments/services/payout-approval.service';
import { OrgWalletReadModel } from '../../payments/read-models/org-wallet.read-model';
import { SandboxPayoutGateway } from '../../payments/gateway/sandbox-payout.gateway';
import { RoleKycRequiredError } from '../../payments/domain/payments.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('PC-56 TENANT-7d-money · the earnings (integration, real Postgres + RLS + 0174)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let instructors: InstructorService; let courses: CourseService; let lessons: LessonService; let enroll: EnrollmentService;
  let earnings: InstructorEarningsService; let earningsOff: InstructorEarningsService; let dataset: InstructorEarningsDataset; let approval: PayoutApprovalService; let payoutRepo: PayoutRepository;
  const tenantA = randomUUID(); const tenantU = randomUUID(); const tenantJ = randomUUID(); const tenantB = randomUUID();
  const instr = randomUUID(); const learner = randomUUID(); const learner2 = randomUUID(); const desk = randomUUID(); const fin1 = randomUUID(); const fin2 = randomUUID(); const member = randomUUID();
  const A = (userId: string, o: Partial<EarningsActor> = {}): EarningsActor => ({ userId, canAuthor: false, canPublish: false, isAdmin: false, canHost: false, canModerate: false, canFinance: false, ...o });
  const I = A(instr, { canAuthor: true }); const L = A(learner); const L2 = A(learner2); const D = A(desk, { canPublish: true, isAdmin: true }); const F1 = A(fin1, { canFinance: true }); const F2 = A(fin2, { canFinance: true }); const M = A(member);
  const key = () => `t7dm-${randomUUID()}`;
  let courseA = ''; let instructorA = ''; let agreementId = ''; let firstEnrollment = ''; let ruleId = ''; let bankAccountId = ''; let payoutId = '';
  const bal = async (u: string, code: string, cur = 'INR') => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code=$2 AND owner_user_id=$1 AND currency_code=$3`, [u, code, cur])).rows[0]?.b ?? '0');
  const tenantBal = async (t: string, cur: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='tenant' AND account_code='commission' AND owner_tenant_id=$1 AND currency_code=$2`, [t, cur])).rows[0]?.b ?? '0');
  const fund = (tenant: string, u: string, amt: bigint, cur = 'INR') => uow.run(tenant, (tx) => wallet.post(tx, { tenantId: tenant, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u, cur), amountMinor: amt }, { account: platform(PlatformAccount.Gateway, cur), amountMinor: -amt }] }), { userId: 'system' });
  const legsOf = async (txnId: string) => (await admin.query(`SELECT e.amount_minor::text AS a, e.currency_code AS c, w.owner_kind AS k, w.account_code AS code, w.currency_code AS wc FROM ledger_entries e JOIN wallet_accounts w ON w.id=e.account_id WHERE e.txn_id=$1 ORDER BY e.amount_minor`, [txnId])).rows;
  const roleRow = (u: string, t: string, role: string, kyc = 'verified') => admin.query(`INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active) SELECT gen_random_uuid(), $1, $2, r.id, $4, true FROM roles r WHERE r.code=$3 ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [u, t, role, kyc]);
  const makeServices = (flags: FlagsService) => {
    const shards = new ShardRouter(new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' }));
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    const iRepo = new InstructorRepository(replica as any); const cRepo = new CourseRepository(replica as any); const lRepo = new CourseLessonRepository(replica as any); const eRepo = new EnrollmentRepository(replica as any);
    const rRepo = new InstructorEarningsRepository(replica as any);
    payoutRepo = new PayoutRepository(replica as any);
    const payouts = new PayoutService(uow, outbox, idem, metrics, wallet, new SandboxPayoutGateway('success'), audit, payoutRepo);
    const svcI = new InstructorService(uow, metrics, iRepo, audit, idem, cRepo);
    const svcL = new LessonService(uow, metrics, audit, idem, cRepo, lRepo, iRepo);
    const svcC = new CourseService(uow, outbox, metrics, audit, idem, cRepo, lRepo, iRepo, svcL);
    const svcE = new EnrollmentService(uow, outbox, idem, metrics, wallet, cRepo, iRepo, eRepo, rRepo, flags);
    const svcR = new InstructorEarningsService(uow, outbox, idem, metrics, wallet, audit, flags, iRepo, rRepo, payouts);
    return { svcI, svcL, svcC, svcE, svcR, ds: new InstructorEarningsDataset(svcR, new UiMessageRepository(replica as any)), approval: new PayoutApprovalService(uow, new PayoutBatchRepository(pools), new OrgWalletReadModel(pools)) };
  };
  /** The two-key path 7a describes: the instructor creates FREE, the desk PRICES it, two ready lessons, submit, publish. */
  const publishPaid = async (tenant: string, author: EarningsActor, priceMajor: string) => {
    const c: any = await courses.create(tenant, author, key(), { defaultTitle: 'Silage Making Masterclass', topicCode: 'crop_care', level: 'basic', priceMajor: '0', certEnabled: '0' }, null);
    await courses.update(tenant, D, key(), c.id, { defaultTitle: 'Silage Making Masterclass', topicCode: 'crop_care', level: 'basic', priceMajor, certEnabled: '0' }, null);
    for (const n of [1, 2]) {
      const l: any = await lessons.create(tenant, author, key(), c.id, { defaultTitle: `Lesson ${n}`, contentKind: 'article', body: `Silage lesson ${n}` }, null);
      await lessons.act(tenant, author, key(), c.id, l.id, 'ready', 'complete and checked', null);
    }
    await courses.act(tenant, author, key(), c.id, 'submit', 'ready for the desk', null);
    await courses.act(tenant, D, key(), c.id, 'publish', 'checked by the desk', null);
    return c.id as string;
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    for (const [t, n] of [[tenantA, 'A'], [tenantU, 'U'], [tenantJ, 'J'], [tenantB, 'B']] as const) await makeTenant(admin, t, n);
    await admin.query(`UPDATE tenants SET country_code='AE' WHERE id=$1`, [tenantU]);
    await admin.query(`UPDATE tenants SET country_code='JP' WHERE id=$1`, [tenantJ]);
    for (const u of [instr, learner, learner2, desk, fin1, fin2, member]) await makeUser(admin, u);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    uow = new PgUnitOfWork(pools, new ShardRouter(config));
    wallet = new InProcessWalletClient(new LedgerRepository());
    // the two flags ship OFF (0174); a service built BEFORE the flip proves W418's flagged-off state
    const off = makeServices(new FlagsService(pools, new InMemoryCacheService()));
    earningsOff = off.svcR;
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key IN ('course_royalty_split','instructor_earnings')`);
    const on = makeServices(new FlagsService(pools, new InMemoryCacheService()));
    instructors = on.svcI; lessons = on.svcL; courses = on.svcC; enroll = on.svcE; earnings = on.svcR; dataset = on.ds; approval = on.approval;
    for (const [t, cur] of [[tenantA, 'INR'], [tenantU, 'AED'], [tenantJ, 'JPY']] as const) { await fund(t, learner, 10_000_000n, cur); await fund(t, learner2, 10_000_000n, cur); }
    app = new Pool({ connectionString: APP_URL });
  }, 60000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('0174 seeds: the two flags OFF by default, the vocabulary, the purpose → role map, the platform default 80/18/2 rule', async () => {
    expect((await admin.query(`SELECT key FROM feature_flags WHERE key IN ('course_royalty_split','instructor_earnings')`)).rows).toHaveLength(2);
    expect((await admin.query(`SELECT count(*)::int AS n FROM lookup_values WHERE tenant_id IS NULL AND ((type_code='payout_purpose' AND code='course_royalty') OR (type_code='ledger_txn_type' AND code='course_royalty_release'))`)).rows[0].n).toBe(2);   // exactly one each — WHERE NOT EXISTS, not ON CONFLICT
    expect((await admin.query(`SELECT (meta->>'rides_batch')::boolean AS r FROM lookup_values WHERE type_code='payout_purpose' AND code='course_royalty'`)).rows[0].r).toBe(true);
    expect((await admin.query(`SELECT role_code FROM payout_purpose_roles WHERE purpose_code='course_royalty'`)).rows.map((r) => r.role_code)).toEqual(['instructor']);
    expect((await admin.query(`SELECT instructor_share_bps, tenant_share_bps, platform_share_bps FROM course_royalty_rules WHERE tenant_id IS NULL AND status='active'`)).rows).toEqual([{ instructor_share_bps: 8000, tenant_share_bps: 1800, platform_share_bps: 200 }]);
    expect((await admin.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('course_royalty_rules','instructor_agreements','instructor_royalty_lines')`)).rows.every((r) => r.relrowsecurity && r.relforcerowsecurity)).toBe(true);
    expect((await admin.query(`SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee='kv_app' AND table_name='instructor_royalty_lines' AND privilege_type='DELETE'`)).rows[0].n).toBe(0);
  });

  it('W418 flagged OFF is a sentence with a code (EARNINGS_DISABLED), never a page of zeroes', async () => {
    await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key='instructor_earnings'`);
    try {
      await expect(earningsOff.view(tenantA, I)).rejects.toMatchObject({ code: 'EARNINGS_DISABLED', details: { flag: 'instructor_earnings' } });
      await expect(earningsOff.requestPayout(tenantA, I, key(), { amountMinor: '1', currencyCode: 'INR', bankAccountId: randomUUID() })).rejects.toMatchObject({ code: 'EARNINGS_DISABLED' });
    } finally { await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key='instructor_earnings'`); }
  });

  it('the tenant\'s rule: the finance desk proposes ONLY the instructor share (the platform\'s copied, the tenant\'s the remainder); one proposal at a time; the proposer cannot decide (service AND a 23514 at the wall); a second person approves', async () => {
    const before = await earnings.ruleView(tenantA, F1);
    expect(before.inForce).toMatchObject({ source: 'platform', instructorShareBps: 8000, tenantShareBps: 1800, platformShareBps: 200 });
    await expect(earnings.proposeRule(tenantA, D, key(), { instructorShareBps: 7500 }, null)).rejects.toMatchObject({ code: 'ROYALTY_RULE_REFUSED', details: { refusals: ['NOT_FINANCE'] } });
    const p: any = await earnings.proposeRule(tenantA, F1, key(), { instructorShareBps: 7500, note: 'the cooperative hosts the classes' }, null);
    ruleId = p.id;
    expect(p).toMatchObject({ status: 'proposed', instructorBps: 7500, tenantBps: 2300, platformBps: 200 });
    await expect(earnings.proposeRule(tenantA, F2, key(), { instructorShareBps: 7000 }, null)).rejects.toMatchObject({ details: { refusals: ['PROPOSAL_ALREADY_OPEN'] } });
    await expect(earnings.decideRule(tenantA, F1, key(), ruleId, 'approve', null, null)).rejects.toMatchObject({ details: { refusals: ['MAKER_IS_CHECKER'] } });
    await expect(earnings.decideRule(tenantA, F2, key(), ruleId, 'reject', null, null)).rejects.toMatchObject({ details: { refusals: ['REASON_REQUIRED'] } });
    await expect(admin.query(`UPDATE course_royalty_rules SET status='active', decided_by=proposed_by, decided_at=now(), effective_from=now() WHERE id=$1`, [ruleId])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`UPDATE course_royalty_rules SET instructor_share_bps=7501 WHERE id=$1`, [ruleId])).rejects.toMatchObject({ code: '23514' });   // ck_crr_bps_whole
    expect(await earnings.decideRule(tenantA, F2, key(), ruleId, 'approve', null, null)).toEqual({ id: ruleId, status: 'active' });
    const after = await earnings.ruleView(tenantA, F2);
    expect(after.inForce).toMatchObject({ source: 'tenant', id: ruleId, instructorShareBps: 7500, tenantShareBps: 2300, platformShareBps: 200 });
    expect(after.platformDefault).toMatchObject({ instructorShareBps: 8000 });
    await expect(earnings.decideRule(tenantA, F2, key(), ruleId, 'approve', null, null)).rejects.toMatchObject({ details: { refusals: ['ILLEGAL_FROM_STATUS'] } });
  });

  it('a purchase with NO accepted agreement: four legs in the course\'s currency netting to zero by the TENANT\'S rule, the instructor leg HELD, one line held_pending_agreement; the replay posts nothing twice', async () => {
    const me: any = await instructors.saveProfile(tenantA, I, key(), { displayName: 'Dr. Kalpana Joshi', bio: 'Dairy scientist with Anand FPO.', languages: 'gu,hi', visibility: 'public' }, null);
    instructorA = me.id;
    courseA = await publishPaid(tenantA, I, '149.00');
    const holdBefore = await bal(instr, 'hold'); const mainBefore = await bal(instr, 'main');
    const k = key();
    const e: any = await enroll.enroll(tenantA, L, courseA, k);
    firstEnrollment = e.id;
    expect(e).toMatchObject({ pricePaidMinor: '14900', currencyCode: 'INR' });
    const line = (await admin.query(`SELECT * FROM instructor_royalty_lines WHERE enrollment_id=$1`, [e.id])).rows[0];
    expect(line).toMatchObject({ tenant_id: tenantA, instructor_id: instructorA, currency_code: 'INR', minor_units: 2, gross_minor: '14900', instructor_minor: '11175', tenant_minor: '3427', platform_minor: '298', instructor_share_bps: 7500, tenant_share_bps: 2300, platform_share_bps: 200, rule_id: ruleId, agreement_id: null, state: 'held_pending_agreement' });
    const legs = await legsOf(line.ledger_txn_id);
    expect(legs.map((l) => [l.k, l.code, l.a, l.c])).toEqual([['user', 'main', '-14900', 'INR'], ['platform', 'fees', '298', 'INR'], ['tenant', 'commission', '3427', 'INR'], ['user', 'hold', '11175', 'INR']]);
    expect(legs.reduce((s, l) => s + BigInt(l.a), 0n)).toBe(0n);
    expect((await bal(instr, 'hold')) - holdBefore).toBe(11175n); expect(await bal(instr, 'main')).toBe(mainBefore);
    expect(await tenantBal(tenantA, 'INR')).toBe(3427n);
    // the replay: same key ⇒ the same enrollment, one line, one ledger transaction
    expect(((await enroll.enroll(tenantA, L, courseA, k)) as any).id).toBe(e.id);
    expect((await admin.query(`SELECT count(*)::int AS n FROM instructor_royalty_lines WHERE course_id=$1`, [courseA])).rows[0].n).toBe(1);
    expect((await admin.query(`SELECT count(*)::int AS n FROM ledger_transactions WHERE reference_type='enrollment' AND reference_id=$1`, [e.id])).rows[0].n).toBe(1);
    // and a direct replay of the wallet key posts no second leg either
    const again = await uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'course_purchase', idempotencyKey: `coursebuy:${e.id}`, legs: [{ account: userMain(learner), amountMinor: -1n }, { account: platform(PlatformAccount.Fees), amountMinor: 1n }] }), { userId: learner });
    expect(again).toMatchObject({ txnId: line.ledger_txn_id, alreadyApplied: true });
    expect((await admin.query(`SELECT count(*)::int AS n FROM ledger_entries WHERE txn_id=$1`, [line.ledger_txn_id])).rows[0].n).toBe(4);
    // the outbox carries the split, never a verdict alone
    const ev = (await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='education.course_purchased'`, [e.id])).rows[0].payload;
    expect(ev).toMatchObject({ v: 2, currencyCode: 'INR', minorUnits: 2, instructorMinor: '11175', tenantMinor: '3427', platformMinor: '298', instructorLeg: 'held_pending_agreement', ledgerTxnId: line.ledger_txn_id });
  });

  it('W418 over the ledger: one tile per currency, Gross/share/tenant/platform/held as SUMS, MTD = lifetime this month, available 0 while held; the payout is refused AGREEMENT_NOT_ACCEPTED', async () => {
    const v = await earnings.view(tenantA, I);
    expect(v.instructor).toMatchObject({ id: instructorA, isSelf: true, royaltyBps: 8000 });
    expect(v.timezone).toBe('Asia/Kolkata'); expect(v.monthStart).toBe(`${v.today.slice(0, 7)}-01`);
    expect(v.tiles).toHaveLength(1);
    expect(v.tiles[0]).toMatchObject({ currencyCode: 'INR', minorUnits: 2, lifetime: { gross: '14900', instructor: '11175', tenant: '3427', platform: '298', held: '11175', heldLines: 1, released: '0', purchases: 1 }, paidOut: '0', pending: '0', available: '0' });
    expect(v.tiles[0].mtd).toMatchObject({ gross: '14900', purchases: 1 });
    expect(v.agreement).toMatchObject({ current: null, offered: null, history: [] });
    expect(v.rule).toMatchObject({ source: 'tenant', instructorShareBps: 7500 });
    expect(v.courses.find((c) => c.courseId === courseA)).toMatchObject({ enrollments: 1, paid: 1, gross: '14900', instructor: '11175', tenantPlatform: '3725', priceMinor: '14900', currencyCode: 'INR', minorUnits: 2 });
    expect(v.payoutRefusals).toEqual([{ currencyCode: 'INR', refusals: ['AGREEMENT_NOT_ACCEPTED', 'ROYALTY_INSUFFICIENT'] }]);
    expect(v.refusedByName).toEqual(['monthlyLaneClock', 'refunds', 'cachedFigures', 'retry']);
    await admin.query(`INSERT INTO bank_accounts (id, user_id, tenant_id, account_kind, upi_id, vault_ref) VALUES ($1,$2,$3,'upi','kalpana@upi','fa_instr')`, [bankAccountId = randomUUID(), instr, tenantA]);
    await expect(earnings.requestPayout(tenantA, I, key(), { amountMinor: '1000', currencyCode: 'INR', bankAccountId })).rejects.toMatchObject({ code: 'ROYALTY_PAYOUT_REFUSED', details: { refusals: ['AGREEMENT_NOT_ACCEPTED', 'ROYALTY_INSUFFICIENT'] } });
    expect((await admin.query(`SELECT count(*)::int AS n FROM payouts WHERE user_id=$1`, [instr])).rows[0].n).toBe(0);
  });

  it('the agreement: the desk offers (never the instructor — the verdict AND 0174\'s trigger), the desk cannot accept, the instructor accepts and every held line is RELEASED hold → main in one balanced transaction', async () => {
    await expect(earnings.offerAgreement(tenantA, I, key(), instructorA, {}, null)).rejects.toMatchObject({ details: { refusals: ['NOT_DESK'] } });
    await expect(admin.query(`INSERT INTO instructor_agreements (tenant_id, instructor_id, version, instructor_share_bps, tenant_share_bps, platform_share_bps, offered_by) VALUES ($1,$2,99,8000,1800,200,$3)`, [tenantA, instructorA, instr])).rejects.toMatchObject({ code: '23514' });
    const o: any = await earnings.offerAgreement(tenantA, D, key(), instructorA, { termsNote: 'Royalty per the cooperative rule; paid on the monthly batch.' }, null);
    agreementId = o.id;
    expect(o).toMatchObject({ version: 1, status: 'offered', instructorBps: 7500, tenantBps: 2300, platformBps: 200 });   // the rule in force's shares
    await expect(earnings.offerAgreement(tenantA, D, key(), instructorA, {}, null)).rejects.toMatchObject({ details: { refusals: ['OFFER_ALREADY_OPEN'] } });
    await expect(earnings.actAgreement(tenantA, D, key(), agreementId, 'accept', null)).rejects.toMatchObject({ details: { refusals: ['NOT_INSTRUCTOR'] } });
    await expect(admin.query(`UPDATE instructor_agreements SET status='accepted', accepted_by=$2, accepted_at=now() WHERE id=$1`, [agreementId, desk])).rejects.toMatchObject({ code: '23514' });   // only the instructor's own user
    expect((await earnings.view(tenantA, I)).agreement.offered).toMatchObject({ id: agreementId, version: 1 });
    const holdBefore = await bal(instr, 'hold'); const mainBefore = await bal(instr, 'main');
    const k = key();
    const acc: any = await earnings.actAgreement(tenantA, I, k, agreementId, 'accept', null);
    expect(acc).toMatchObject({ status: 'accepted', released: [{ currencyCode: 'INR', amountMinor: '11175', lines: 1 }] });
    expect(holdBefore - (await bal(instr, 'hold'))).toBe(11175n); expect((await bal(instr, 'main')) - mainBefore).toBe(11175n);
    const rel = await legsOf(acc.released[0].txnId);
    expect(rel.map((l) => [l.code, l.a, l.c])).toEqual([['hold', '-11175', 'INR'], ['main', '11175', 'INR']]);
    expect((await admin.query(`SELECT state, release_txn_id FROM instructor_royalty_lines WHERE enrollment_id=$1`, [firstEnrollment])).rows[0]).toEqual({ state: 'released', release_txn_id: acc.released[0].txnId });
    expect(((await earnings.actAgreement(tenantA, I, k, agreementId, 'accept', null)) as any).released).toEqual(acc.released);   // the key replays; no second release
    await expect(earnings.actAgreement(tenantA, I, key(), agreementId, 'accept', null)).rejects.toMatchObject({ details: { refusals: ['ILLEGAL_FROM_STATUS'] } });
    expect((await admin.query(`SELECT count(*)::int AS n FROM ledger_transactions WHERE reference_type='instructor_agreement' AND reference_id=$1`, [agreementId])).rows[0].n).toBe(1);
  });

  it('a purchase AFTER acceptance: the agreement\'s snapshot, paid to MAIN, paid_to_wallet — and the balance is Σ lines', async () => {
    const mainBefore = await bal(instr, 'main');
    const e: any = await enroll.enroll(tenantA, L2, courseA, key());
    expect((await admin.query(`SELECT instructor_minor, tenant_minor, platform_minor, agreement_id, rule_id, state FROM instructor_royalty_lines WHERE enrollment_id=$1`, [e.id])).rows[0]).toEqual({ instructor_minor: '11175', tenant_minor: '3427', platform_minor: '298', agreement_id: agreementId, rule_id: null, state: 'paid_to_wallet' });
    expect((await bal(instr, 'main')) - mainBefore).toBe(11175n);
    const v = await earnings.view(tenantA, I);
    expect(v.tiles[0]).toMatchObject({ lifetime: { gross: '29800', instructor: '22350', tenant: '6854', platform: '596', held: '0', released: '22350', purchases: 2 }, available: '22350', paidOut: '0' });
    expect(v.instructor.royaltyBps).toBe(7500);   // the ACCEPTED agreement's share, not the row's 8000
    expect(BigInt(v.tiles[0].lifetime.instructor)).toBe((await admin.query(`SELECT SUM(instructor_minor)::text AS s FROM instructor_royalty_lines WHERE instructor_id=$1`, [instructorA])).rows[0].s === '22350' ? 22350n : -1n);
    const st = await earnings.statement(tenantA, I, { limit: 1 });
    expect(st.items).toHaveLength(1); expect(st.items[0].enrollmentId).toBe(e.id); expect(st.nextCursor).toBeTruthy();
    const [c, id] = Buffer.from(st.nextCursor!, 'base64').toString().split('|');
    const page2 = await earnings.statement(tenantA, I, { cursor: { c, id }, limit: 1 });
    expect(page2.items[0].enrollmentId).toBe(firstEnrollment); expect(page2.items[0].state).toBe('released');
    expect((await earnings.statement(tenantA, I, { cursor: { c: page2.items[0].occurredAt.toISOString(), id: page2.items[0].id }, limit: 1 })).items).toHaveLength(0);
  });

  it('a NON-INR course currency: AED (2 minor units) by the platform default 80/18/2 — legs and wallet rows name AED; JPY (ZERO minor units) posts whole yen and the line snapshots scale 0', async () => {
    const IU = A(instr, { canAuthor: true });
    await instructors.become(tenantU, IU, 'Dubai instructor'); await instructors.become(tenantJ, IU, 'Tokyo instructor');
    const cU = await publishPaid(tenantU, IU, '149.00');
    const eU: any = await enroll.enroll(tenantU, L, cU, key());
    expect(eU.currencyCode).toBe('AED');
    const lU = (await admin.query(`SELECT * FROM instructor_royalty_lines WHERE enrollment_id=$1`, [eU.id])).rows[0];
    expect(lU).toMatchObject({ currency_code: 'AED', minor_units: 2, gross_minor: '14900', instructor_minor: '11920', tenant_minor: '2682', platform_minor: '298', instructor_share_bps: 8000, state: 'held_pending_agreement' });
    const legsU = await legsOf(lU.ledger_txn_id);
    expect(legsU.every((l) => l.c === 'AED' && l.wc === 'AED')).toBe(true);
    expect(legsU.reduce((s, l) => s + BigInt(l.a), 0n)).toBe(0n);
    expect(await bal(instr, 'hold', 'AED')).toBe(11920n); expect(await bal(instr, 'hold', 'INR')).toBe(0n);   // the dirhams did NOT land in the rupee wallet
    expect(await tenantBal(tenantU, 'AED')).toBe(2682n);
    const cJ = await publishPaid(tenantJ, IU, '5160');
    const eJ: any = await enroll.enroll(tenantJ, L, cJ, key());
    const lJ = (await admin.query(`SELECT * FROM instructor_royalty_lines WHERE enrollment_id=$1`, [eJ.id])).rows[0];
    expect(lJ).toMatchObject({ currency_code: 'JPY', minor_units: 0, gross_minor: '5160', instructor_minor: '4128', tenant_minor: '929', platform_minor: '103' });
    const legsJ = await legsOf(lJ.ledger_txn_id);
    expect(legsJ.map((l) => [l.code, l.a, l.c])).toEqual([['main', '-5160', 'JPY'], ['fees', '103', 'JPY'], ['commission', '929', 'JPY'], ['hold', '4128', 'JPY']]);
    const vJ = await earnings.view(tenantJ, IU);
    expect(vJ.timezone).toBe('Asia/Tokyo');
    expect(vJ.tiles).toEqual([expect.objectContaining({ currencyCode: 'JPY', minorUnits: 0, lifetime: expect.objectContaining({ gross: '5160', instructor: '4128', held: '4128' }) })]);
    // (a currency the platform holds no scale for is refused at the purchase — pinned in the unit spec; not probed here because 7a's live spec owns the no-scale currency fixture)
  });

  it('money OUT rides the plane: refused ROYALTY_INSUFFICIENT beyond Σ lines; refused BY NAME without instructor-role KYC (0125); queued with purpose course_royalty; NEVER claimed unbatched (repository AND trigger); the maker cannot approve; the money moves only from an approved batch', async () => {
    await expect(earnings.requestPayout(tenantA, I, key(), { amountMinor: '22351', currencyCode: 'INR', bankAccountId })).rejects.toMatchObject({ code: 'ROYALTY_PAYOUT_REFUSED', details: { refusals: ['ROYALTY_INSUFFICIENT'], available: '22350' } });
    await roleRow(instr, tenantA, 'farmer');   // verified as a FARMER only: royalty is claimed as an instructor
    await expect(earnings.requestPayout(tenantA, I, key(), { amountMinor: '10000', currencyCode: 'INR', bankAccountId })).rejects.toBeInstanceOf(RoleKycRequiredError);
    await roleRow(instr, tenantA, 'instructor', 'pending');
    await expect(earnings.requestPayout(tenantA, I, key(), { amountMinor: '10000', currencyCode: 'INR', bankAccountId })).rejects.toMatchObject({ details: expect.objectContaining({ purpose: 'course_royalty', decidingRole: 'instructor', decidingStatus: 'pending' }) });
    await admin.query(`UPDATE user_tenant_roles SET kyc_status='verified' WHERE user_id=$1 AND tenant_id=$2 AND role_id=(SELECT id FROM roles WHERE code='instructor')`, [instr, tenantA]);
    const mainBefore = await bal(instr, 'main');
    const k = key();
    const p: any = await earnings.requestPayout(tenantA, I, k, { amountMinor: '10000', currencyCode: 'INR', bankAccountId });
    payoutId = p.payoutId;
    expect(p).toMatchObject({ status: 'queued', amountMinor: '10000' });
    expect(((await earnings.requestPayout(tenantA, I, k, { amountMinor: '10000', currencyCode: 'INR', bankAccountId })) as any).payoutId).toBe(payoutId);   // the key replays
    expect(mainBefore - (await bal(instr, 'main'))).toBe(10000n);   // reserved from the instructor's wallet into platform payouts — in INR
    const row = (await admin.query(`SELECT p.status, p.batch_id, p.currency_code, lv.code AS purpose FROM payouts p JOIN lookup_values lv ON lv.id=p.purpose_id WHERE p.id=$1`, [payoutId])).rows[0];
    expect(row).toEqual({ status: 'queued', batch_id: null, currency_code: 'INR', purpose: 'course_royalty' });
    expect((await legsOf((await admin.query(`SELECT ledger_txn_id FROM payouts WHERE id=$1`, [payoutId])).rows[0].ledger_txn_id)).every((l) => l.c === 'INR')).toBe(true);
    const v = await earnings.view(tenantA, I);
    expect(v.tiles[0]).toMatchObject({ paidOut: '10000', pending: '10000', available: '12350' });
    expect(v.payouts[0]).toMatchObject({ id: payoutId, status: 'queued', batchId: null });
    // NEVER claimed unbatched: the executor's claim skips it …
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      const claimed = await payoutRepo.claimQueued({ query: (sql: string, params?: readonly unknown[]) => client.query(sql, params as unknown[]) } as any, 1000);
      expect(claimed.map((c) => c.id)).not.toContain(payoutId);
      await client.query('ROLLBACK');
    } finally { client.release(); }
    // … and the wall refuses a direct claim (0174's fix-forward of 0114's trigger)
    await expect(admin.query(`UPDATE payouts SET status='processing' WHERE id=$1`, [payoutId])).rejects.toMatchObject({ code: '23514' });
    // the tenant maker batches it (TENANT-4b); the maker cannot approve their own batch; an unapproved batch still refuses.
    // The tenant's checker threshold is set to 0 (a tenant SETTING — 0143) so THIS batch needs two humans; the destination is
    // penny-verified and the tenant's main wallet funded so 4b's pre-flight passes (its funds check reads the TENANT's main —
    // named in the report: a royalty was already reserved from the payee's wallet).
    await admin.query(`INSERT INTO tenant_settings (tenant_id, key, value) VALUES ($1, 'payouts.batch_checker_threshold_minor', '0'::jsonb) ON CONFLICT (tenant_id, key) DO UPDATE SET value='0'::jsonb`, [tenantA]);
    await admin.query(`UPDATE bank_accounts SET penny_verified_at=now() WHERE id=$1`, [bankAccountId]);
    await uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund-tenant:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: { kind: 'tenant', tenantId: tenantA, accountCode: 'main', currencyCode: 'INR' }, amountMinor: 50_000n }, { account: platform(PlatformAccount.Gateway), amountMinor: -50_000n }] }), { userId: 'system' });
    const prep = await approval.prepare(tenantA, fin1, { batchType: 'course_royalty', executeAt: new Date(Date.now() + 3_600_000) });
    expect(prep).toMatchObject({ claimed: 1, itemsTotalMinor: '10000' });
    expect((await admin.query(`SELECT batch_id, (SELECT status FROM payout_batches b WHERE b.id=p.batch_id) AS bs FROM payouts p WHERE id=$1`, [payoutId])).rows[0]).toEqual({ batch_id: prep.batchId, bs: 'pending_approval' });
    await expect(approval.decide(tenantA, fin1, prep.batchId, { decision: 'approved' })).rejects.toThrow(/a different person must approve/);
    await expect(admin.query(`UPDATE payouts SET status='processing' WHERE id=$1`, [payoutId])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`UPDATE payout_batches SET status='approved', decided_by=prepared_by, decided_at=now() WHERE id=$1`, [prep.batchId])).rejects.toMatchObject({ code: '23514' });   // maker = checker at the wall (0143)
    // THE SECOND SIGNATURE, through 4b's own service — which 0114's evidence CHECK and the blind replica read had made impossible before 0174/this wave
    const decided = await approval.decide(tenantA, fin2, prep.batchId, { decision: 'approved' });
    expect(decided).toMatchObject({ batchId: prep.batchId, status: 'approved' });
    expect(decided.preflight.passed).toBe(true);
    expect((await admin.query(`SELECT status, decided_by FROM payout_batches WHERE id=$1`, [prep.batchId])).rows[0]).toEqual({ status: 'approved', decided_by: fin2 });
    expect((await admin.query(`UPDATE payouts SET status='processing' WHERE id=$1 RETURNING status`, [payoutId])).rows[0].status).toBe('processing');
    await admin.query(`UPDATE payouts SET status='queued' WHERE id=$1`, [payoutId]);   // put back for the ledger check below; the run itself is the executor's (4b)
  });

  it('who reads: the finance desk reads any instructor by id; the education desk without the finance verb is told NOT_FINANCE; a member with no row is 404-shaped', async () => {
    expect((await earnings.view(tenantA, F1, instructorA)).instructor).toMatchObject({ id: instructorA, isSelf: false });
    await expect(earnings.view(tenantA, D, instructorA)).rejects.toMatchObject({ code: 'EDUCATION_FORBIDDEN' });
    await expect(earnings.view(tenantA, M)).rejects.toMatchObject({ code: 'INSTRUCTOR_NOT_FOUND' });
    await expect(earnings.statement(tenantA, M, { limit: 10 })).rejects.toMatchObject({ code: 'INSTRUCTOR_NOT_FOUND' });
    await expect(earnings.view(tenantB, F1, instructorA)).rejects.toMatchObject({ code: 'INSTRUCTOR_NOT_FOUND' });   // another tenant's instructor is not a row here
  });

  it('RLS: tenant B as kv_app reads 0 of A\'s lines, agreements and rules — and every tenant reads the platform default rule; the line is append-only by trigger', async () => {
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await app.query(`SELECT count(*)::int AS n FROM instructor_royalty_lines`)).rows[0].n).toBe(0);
    expect((await app.query(`SELECT count(*)::int AS n FROM instructor_agreements`)).rows[0].n).toBe(0);
    expect((await app.query(`SELECT tenant_id FROM course_royalty_rules`)).rows).toEqual([{ tenant_id: null }]);
    await expect(app.query(`INSERT INTO course_royalty_rules (tenant_id, instructor_share_bps, tenant_share_bps, platform_share_bps, proposed_by) VALUES (NULL, 9000, 800, 200, $1)`, [fin1])).rejects.toMatchObject({ code: '42501' });   // a tenant cannot write a platform rule
    await app.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await app.query(`SELECT count(*)::int AS n FROM instructor_royalty_lines`)).rows[0].n).toBe(2);
    expect((await app.query(`SELECT count(*)::int AS n FROM course_royalty_rules`)).rows[0].n).toBe(2);
    await expect(admin.query(`UPDATE instructor_royalty_lines SET gross_minor=gross_minor+1, tenant_minor=tenant_minor+1 WHERE enrollment_id=$1`, [firstEnrollment])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`UPDATE instructor_royalty_lines SET state='held_pending_agreement' WHERE enrollment_id=$1`, [firstEnrollment])).rejects.toMatchObject({ code: '23514' });
    await expect(admin.query(`UPDATE instructor_royalty_lines SET currency_code='AED' WHERE enrollment_id=$1`, [firstEnrollment])).rejects.toMatchObject({ code: '23514' });
    await expect(app.query(`DELETE FROM instructor_royalty_lines WHERE enrollment_id=$1`, [firstEnrollment])).rejects.toMatchObject({ code: '42501' });   // DELETE granted to nobody in the app realm
    expect((await admin.query(`SELECT count(*)::int AS n FROM instructor_royalty_lines WHERE enrollment_id=$1`, [firstEnrollment])).rows[0].n).toBe(1);
  });

  it('the ledger invariants over the WHOLE test database: every transaction nets to zero; every cached balance equals Σ its entries', async () => {
    const unbalanced = await admin.query(`SELECT txn_id, SUM(amount_minor)::text AS s FROM ledger_entries GROUP BY txn_id HAVING SUM(amount_minor) <> 0`);
    expect(unbalanced.rows).toEqual([]);
    const drift = await admin.query(`SELECT a.id FROM wallet_accounts a LEFT JOIN ledger_entries e ON e.account_id=a.id GROUP BY a.id, a.cached_balance_minor HAVING a.cached_balance_minor <> COALESCE(SUM(e.amount_minor),0)`);
    expect(drift.rows).toEqual([]);
    const mixed = await admin.query(`SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING count(DISTINCT currency_code) > 1`);
    expect(mixed.rows).toEqual([]);
    expect(Number((await admin.query(`SELECT count(DISTINCT txn_id)::int AS n FROM ledger_entries`)).rows[0].n)).toBeGreaterThan(5);
  });

  it('the export dataset: one row per line at each line\'s own scale, notes carrying the held count; dataset_disabled when the screen\'s flag is off', async () => {
    const out = await dataset.produce({ tenantId: tenantA, requestedBy: instr, today: '2026-09-24' });
    expect(out.kind).toBe('file');
    if (out.kind !== 'file') return;
    const rows: unknown[][] = [];
    for await (const r of out.file.rows) rows.push([...r]);
    expect((await earnings.statement(tenantA, I, { limit: 100 })).items).toHaveLength(2);
    expect(rows).toHaveLength(2);
    expect(rows[0].slice(4, 11)).toEqual(['INR', '149.00', '111.75', '34.27', '2.98', '7500', 'paid_to_wallet']);
    expect(rows[1][10]).toBe('released');
    expect(out.file.notes.some((n) => /no totals/.test(n))).toBe(true);
    expect(out.file.notes.some((n) => /held_pending_agreement/.test(n))).toBe(false);
    const outU = await dataset.produce({ tenantId: tenantU, requestedBy: instr, today: '2026-09-24' });
    expect(outU.kind === 'file' && outU.file.notes.some((n) => /^1 line\(s\) are held_pending_agreement/.test(n))).toBe(true);
    await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key='instructor_earnings'`);
    const flags = new FlagsService(pools, new InMemoryCacheService());
    const cold = makeServices(flags);
    expect(await cold.ds.produce({ tenantId: tenantA, requestedBy: instr, today: '2026-09-24' })).toMatchObject({ kind: 'refused', code: 'dataset_disabled' });
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key='instructor_earnings'`);
  });
});
