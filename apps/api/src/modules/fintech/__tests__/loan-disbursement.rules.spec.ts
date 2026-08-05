// PC-55 A9 · disbursement eligibility. Once borrowed money lands, the loan is real and the farmer owes it —
// so these tests guard the moment before that becomes true, above all the anti-predatory cooling-off window.
import { coolingOffOpen, eligibility, planRun, canConfirmRun, totalsAgree } from '../domain/loan-disbursement.rules';
import { LoanDisbursementExecuteHandler } from '../jobs/loan-disbursement-execute.handler';

const NOW = Date.parse('2026-08-06T12:00:00.000Z');
const app = (over: Partial<Parameters<typeof eligibility>[0]> = {}) => ({
  id: 'a1', borrowerUserId: 'u1', status: 'approved', amountApprovedMinor: '5000000',
  coolingOffUntil: null as string | null, bankAccountId: 'bank1', alreadyDisbursed: false, ...over,
});

describe('coolingOffOpen (PRD §59.4 — the window a farmer can still walk away in)', () => {
  it('is open until the instant passes, and never rounds in the lender\'s favour', () => {
    expect(coolingOffOpen('2026-08-06T12:00:01.000Z', NOW)).toBe(true);   // one second left = still open
    expect(coolingOffOpen('2026-08-06T12:00:00.001Z', NOW)).toBe(true);   // ONE MILLISECOND left = STILL OPEN
                                                                          // (the window is never shortened, even
                                                                          //  by a millisecond, in the lender's favour)
    expect(coolingOffOpen('2026-08-06T12:00:00.000Z', NOW)).toBe(false);  // exactly elapsed = eligible
    expect(coolingOffOpen('2026-08-05T12:00:00.000Z', NOW)).toBe(false);
    expect(coolingOffOpen(null, NOW)).toBe(false);                        // no window recorded
    expect(coolingOffOpen('not-a-date', NOW)).toBe(false);                // garbage never blocks forever
  });
});

describe('eligibility', () => {
  it('lets a clean approved loan through', () => {
    expect(eligibility(app(), NOW)).toEqual({ ok: true, amountMinor: '5000000' });
  });
  it('HOLDS BACK a loan inside its cooling-off window and reports the instant it becomes eligible', () => {
    const e = eligibility(app({ coolingOffUntil: '2026-08-07T10:00:00.000Z' }), NOW);
    expect(e).toEqual({ ok: false, reason: 'cooling_off', coolingOffUntil: '2026-08-07T10:00:00.000Z' });
  });
  it('refuses anything not approved, unapproved amounts, and missing bank accounts', () => {
    expect(eligibility(app({ status: 'under_review' }), NOW)).toEqual({ ok: false, reason: 'not_approved' });
    expect(eligibility(app({ status: 'rejected' }), NOW)).toEqual({ ok: false, reason: 'not_approved' });
    expect(eligibility(app({ amountApprovedMinor: null }), NOW)).toEqual({ ok: false, reason: 'no_approved_amount' });
    expect(eligibility(app({ amountApprovedMinor: '0' }), NOW)).toEqual({ ok: false, reason: 'no_approved_amount' });
    expect(eligibility(app({ amountApprovedMinor: '500.00' }), NOW)).toEqual({ ok: false, reason: 'no_approved_amount' });
    expect(eligibility(app({ bankAccountId: null }), NOW)).toEqual({ ok: false, reason: 'no_bank_account' });
  });
  it('never disburses the same application twice', () => {
    expect(eligibility(app({ alreadyDisbursed: true }), NOW)).toEqual({ ok: false, reason: 'already_disbursed' });
  });
  it('checks cooling-off BEFORE the bank account, so a protected borrower is told the real reason', () => {
    const e = eligibility(app({ coolingOffUntil: '2026-08-07T10:00:00.000Z', bankAccountId: null }), NOW);
    expect(e).toMatchObject({ reason: 'cooling_off' });
  });
});

describe('planRun (nothing is silently dropped)', () => {
  it('partitions every candidate and sums only the queued ones', () => {
    const split = planRun([
      app({ id: 'ok1' }),
      app({ id: 'ok2', amountApprovedMinor: '2500000' }),
      app({ id: 'wait', coolingOffUntil: '2026-08-07T10:00:00.000Z' }),
      app({ id: 'nobank', bankAccountId: null }),
    ], NOW);
    expect(split.queued.map((q) => q.applicationId)).toEqual(['ok1', 'ok2']);
    expect(split.totalMinor).toBe('7500000');
    expect(split.skipped).toHaveLength(2);
    expect(split.queued.length + split.skipped.length).toBe(4);   // every candidate accounted for
    expect(totalsAgree(split)).toBe(true);
  });
  it('stays exact at portfolio scale (2,000 loans of ₹50,000)', () => {
    const many = Array.from({ length: 2000 }, (_, i) => app({ id: `a${i}` }));
    expect(planRun(many, NOW).totalMinor).toBe((5000000n * 2000n).toString());
  });
});

describe('the human and rail guards', () => {
  it('maker cannot be checker', () => {
    expect(canConfirmRun('officer-a', 'officer-b')).toBe(true);
    expect(canConfirmRun('officer-a', 'officer-a')).toBe(false);
  });
  it('the execute rail is ready ONLY with a real provider AND both credentials (fails closed)', () => {
    const ready = LoanDisbursementExecuteHandler.payoutRailReady;
    expect(ready({})).toBe(false);
    expect(ready({ PAYOUT_PROVIDER: 'noop' })).toBe(false);
    expect(ready({ PAYOUT_PROVIDER: 'razorpayx' })).toBe(false);                             // no credentials
    expect(ready({ PAYOUT_PROVIDER: 'razorpayx', RAZORPAYX_KEY_ID: 'k' })).toBe(false);      // half-configured
    expect(ready({ PAYOUT_PROVIDER: 'razorpayx', RAZORPAYX_KEY_ID: 'k', RAZORPAYX_KEY_SECRET: 's' })).toBe(true);
  });
  it('execute REFUSES without the rail — a borrower must never owe money they did not receive', async () => {
    const h = new LoanDisbursementExecuteHandler();
    const r = await h.execute('run1', {});
    expect(r.executed).toBe(false);
    expect(r.itemsProcessed).toBe(0);
    expect(r.reason.toLowerCase()).toContain('not configured');
  });
});
