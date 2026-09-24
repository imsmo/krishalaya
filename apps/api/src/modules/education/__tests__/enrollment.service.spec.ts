// modules/education/__tests__/enrollment.service.spec.ts · EnrollmentService unit tests with fakes.
// Pins: free course = instant enroll (no wallet); paid course = a ZERO-SUM learner→instructor(royalty)+platform
// transfer in-tx (txnType course_purchase); can't enroll an unpublished course or your own; double-enroll 409;
// reads 404 for a non-owner (no IDOR).
import { EnrollmentService } from '../services/enrollment.service';
import { Course } from '../domain/course.entity';
import { Instructor } from '../domain/instructor.entity';
import { CourseNotPublishedError, CannotEnrollOwnCourseError, AlreadyEnrolledError, EnrollmentNotFoundError } from '../domain/education.errors';

const course = (over: Partial<any> = {}) => Course.rehydrate({ id: 'c1', tenantId: 't1', instructorId: 'i1', defaultTitle: 'Soil', topicId: null, audienceRoleIds: [], level: 'basic', priceMinor: 50000n, currencyCode: 'INR', certEnabled: false, coverMediaId: null, status: 'published', ...over });
const instructor = (over: Partial<any> = {}) => Instructor.rehydrate({ id: 'i1', userId: 'instr', tenantId: 't1', bio: null, royaltyBps: 8000, isVerified: true, ...over });

function harness(opts: { course?: Course | null; instructor?: Instructor | null; existing?: boolean; flagOn?: boolean; rule?: any; agreement?: any; minorUnits?: number | null } = {}) {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 'tx1', alreadyApplied: false })) };
  const courses = { getById: jest.fn(async () => (opts.course === undefined ? course() : opts.course)) };
  const instructors = { getById: jest.fn(async () => (opts.instructor === undefined ? instructor() : opts.instructor)) };
  const enrollments = { findByCourseLearner: jest.fn(async () => (opts.existing ? {} : null)), insert: jest.fn(), getByIdForLearner: jest.fn(async () => null) };
  // PC-56 TENANT-7d-money: the split's facts — the currency's scale, the flag, the rule in force, the accepted agreement — and the line.
  const earnings = {
    minorUnitsOf: jest.fn(async () => (opts.minorUnits === undefined ? 2 : opts.minorUnits)),
    ruleInForce: jest.fn(async () => (opts.rule === undefined ? { id: 'rule1', instructorShareBps: 8000, tenantShareBps: 1800, platformShareBps: 200 } : opts.rule)),
    acceptedAgreement: jest.fn(async () => opts.agreement ?? null),
    insertLine: jest.fn(),
  };
  const flags = { isEnabled: jest.fn(async () => opts.flagOn ?? false) };
  const svc = new EnrollmentService(uow as any, outbox as any, idem as any, metrics as any, wallet as any, courses as any, instructors as any, enrollments as any, earnings as any, flags as any);
  return { svc, wallet, enrollments, earnings, outbox };
}
const learner = { userId: 'learner', canAuthor: false, canPublish: false, isAdmin: false, canHost: false, canModerate: false };

describe('EnrollmentService.enroll', () => {
  it('free course → instant enroll, no wallet movement', async () => {
    const { svc, wallet, enrollments } = harness({ course: course({ priceMinor: 0n }) });
    const out = await svc.enroll('t1', learner, 'c1', 'idem-1');
    expect(wallet.post).not.toHaveBeenCalled();
    expect(enrollments.insert).toHaveBeenCalledTimes(1); expect(out.pricePaidMinor).toBe('0');
  });
  it('paid course → ZERO-SUM learner→instructor(80%)+platform transfer in-tx', async () => {
    const { svc, wallet } = harness();
    const out = await svc.enroll('t1', learner, 'c1', 'idem-2');
    expect(wallet.post).toHaveBeenCalledTimes(1);
    const arg: any = (wallet.post.mock.calls as any[])[0][1];
    expect(arg.txnType).toBe('course_purchase'); expect(arg.idempotencyKey).toMatch(/^coursebuy:/);
    const sum = arg.legs.reduce((a: bigint, l: any) => a + l.amountMinor, 0n);
    expect(sum).toBe(0n);                                                            // ZERO-SUM
    expect(arg.legs.find((l: any) => l.amountMinor < 0n).account.userId).toBe('learner');  // learner debited
    expect(arg.legs.find((l: any) => l.account.userId === 'instr').amountMinor).toBe(40000n); // 80% of 50000
    expect(out.pricePaidMinor).toBe('50000');
  });
  it('rejects an unpublished course', async () => {
    const { svc } = harness({ course: course({ status: 'draft' }) });
    await expect(svc.enroll('t1', learner, 'c1', 'idem-3')).rejects.toBeInstanceOf(CourseNotPublishedError);
  });
  it('rejects enrolling in your own course', async () => {
    const { svc } = harness({ instructor: instructor({ userId: 'learner' }) });
    await expect(svc.enroll('t1', learner, 'c1', 'idem-4')).rejects.toBeInstanceOf(CannotEnrollOwnCourseError);
  });
  it('rejects a double enrollment', async () => {
    const { svc } = harness({ existing: true });
    await expect(svc.enroll('t1', learner, 'c1', 'idem-5')).rejects.toBeInstanceOf(AlreadyEnrolledError);
  });
  /* ---- PC-56 TENANT-7d-money · THE EARNINGS ---- */
  const legsOf = (wallet: any) => (wallet.post.mock.calls as any[])[0][1].legs as Array<{ account: any; amountMinor: bigint }>;
  it('every leg carries the COURSE\'s currency, never a default (an AED course posts dirham legs)', async () => {
    const { svc, wallet, earnings } = harness({ course: course({ currencyCode: 'AED' }) });
    await svc.enroll('t1', learner, 'c1', 'idem-7');
    expect(legsOf(wallet).every((l) => l.account.currencyCode === 'AED')).toBe(true);
    expect((earnings.insertLine.mock.calls as any[])[0][1]).toMatchObject({ currencyCode: 'AED', minorUnits: 2, grossMinor: 50000n });
  });
  it('a currency the platform holds no scale for is refused — never assumed to be two decimals', async () => {
    const { svc, wallet } = harness({ minorUnits: null });
    await expect(svc.enroll('t1', learner, 'c1', 'idem-8')).rejects.toMatchObject({ code: 'COURSE_INVALID' });
    expect(wallet.post).not.toHaveBeenCalled();
  });
  it('flag OFF: the pre-0174 shape — the row\'s royalty to MAIN, the remainder to platform fees, tenant 0 — and a line saying exactly that', async () => {
    const { svc, wallet, earnings } = harness();
    await svc.enroll('t1', learner, 'c1', 'idem-9');
    const legs = legsOf(wallet);
    expect(legs.find((l) => l.account.userId === 'instr')!.account.accountCode).toBe('main');
    expect(legs.find((l) => l.account.kind === 'tenant')).toBeUndefined();
    expect(legs.find((l) => l.account.kind === 'platform')!.amountMinor).toBe(10000n);
    expect((earnings.insertLine.mock.calls as any[])[0][1]).toMatchObject({ instructorMinor: 40000n, tenantMinor: 0n, platformMinor: 10000n, instructorShareBps: 8000, tenantShareBps: 0, platformShareBps: 2000, ruleId: null, agreementId: null, state: 'paid_to_wallet', ledgerTxnId: 'tx1' });
    expect(earnings.ruleInForce).not.toHaveBeenCalled();
  });
  it('flag ON, no accepted agreement: the rule in force splits four ways, the instructor leg is HELD, the line is held_pending_agreement', async () => {
    const { svc, wallet, earnings, outbox } = harness({ flagOn: true, course: course({ priceMinor: 14900n }) });
    await svc.enroll('t1', learner, 'c1', 'idem-10');
    const legs = legsOf(wallet);
    expect(legs.reduce((a, l) => a + l.amountMinor, 0n)).toBe(0n);
    expect(legs.find((l) => l.account.userId === 'instr')).toMatchObject({ account: { accountCode: 'hold' }, amountMinor: 11920n });   // floor(14900 × 0.80)
    expect(legs.find((l) => l.account.kind === 'tenant')).toMatchObject({ account: { accountCode: 'commission', tenantId: 't1' }, amountMinor: 2682n });   // the remainder (2682 = 14900 − 11920 − 298)
    expect(legs.find((l) => l.account.kind === 'platform')!.amountMinor).toBe(298n);   // floor(14900 × 0.02)
    expect((earnings.insertLine.mock.calls as any[])[0][1]).toMatchObject({ grossMinor: 14900n, instructorMinor: 11920n, tenantMinor: 2682n, platformMinor: 298n, ruleId: 'rule1', state: 'held_pending_agreement' });
    const purchased = (outbox.write.mock.calls as any[]).map((c) => c[1]).find((e) => e.eventType === 'education.course_purchased' || /purchased/i.test(e.eventType));
    expect(purchased.payload).toMatchObject({ v: 2, currencyCode: 'INR', instructorLeg: 'held_pending_agreement', tenantMinor: '2682' });
  });
  it('flag ON with an ACCEPTED agreement: the agreement\'s snapshot, paid to MAIN, the line names the agreement', async () => {
    const { svc, wallet, earnings } = harness({ flagOn: true, agreement: { id: 'agr1', instructorShareBps: 8500, tenantShareBps: 1300, platformShareBps: 200 } });
    await svc.enroll('t1', learner, 'c1', 'idem-11');
    expect(legsOf(wallet).find((l) => l.account.userId === 'instr')).toMatchObject({ account: { accountCode: 'main' }, amountMinor: 42500n });
    expect((earnings.insertLine.mock.calls as any[])[0][1]).toMatchObject({ agreementId: 'agr1', ruleId: null, instructorShareBps: 8500, state: 'paid_to_wallet' });
  });
  it('flag ON and no rule anywhere: the purchase is refused, nothing posted (a price is never split by a guess)', async () => {
    const { svc, wallet } = harness({ flagOn: true, rule: null });
    await expect(svc.enroll('t1', learner, 'c1', 'idem-12')).rejects.toMatchObject({ code: 'ROYALTY_INVALID' });
    expect(wallet.post).not.toHaveBeenCalled();
  });
  it('a course with no instructor row: the whole price is the platform\'s and NO line is written (nobody to attribute it to)', async () => {
    const { svc, wallet, earnings } = harness({ instructor: null, flagOn: true });
    await svc.enroll('t1', learner, 'c1', 'idem-13');
    expect(legsOf(wallet)).toHaveLength(2);
    expect(earnings.insertLine).not.toHaveBeenCalled();
  });
  it('getById 404s a non-owner (no IDOR)', async () => {
    const { svc } = harness();
    await expect(svc.getById('t1', learner, 'someone-elses')).rejects.toBeInstanceOf(EnrollmentNotFoundError);
  });
});
