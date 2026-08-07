// apps/admin-api/src/modules/payout-ops/__tests__/admin6b-money-door.spec.ts (PC-56 ADMIN-6b)
//
// Every test here pins a REFUSAL. That is the shape of this plane: the module's job is to not let money leave, and the
// interesting assertions are all about what it declines to do.
import {
  approvalState, assertApprovable, assertReturnable, batchMoney, batchPhase, BATCH_STATUSES,
  EXECUTABLE_STATUSES, RETURN_REASON_MIN, returnNeedsSecondPerson,
} from '../domain/batch-approval';
import {
  preflight, preflightOne, preflightForStorage, preflightDrift, PREFLIGHT_FAILURES, type PreflightSubject,
} from '../domain/preflight-view';
import {
  cycleTile, componentTile, awaitingPayoutTile, runOutcome, statusFromCounts, statementBalance,
  statementEquation, pdfState, formatMinor, parseMinor, parseCycleDate, RUN_STALE_AFTER_MS, type SettlementRunRow,
} from '../domain/settlement-cycle';
import { SecondPersonRequiredError } from '../../../core/approval/two-person-rule';
import { InvalidPayoutOpsError, InvalidPayoutQueryError } from '../domain/payout-ops.errors';

const subj = (o: Partial<PreflightSubject> = {}): PreflightSubject => ({
  payoutId: 'p1', userId: 'u1', amountMinor: 4738500n, bankVerified: true, bankLast4: '4417',
  kycStatus: 'verified', walletFrozen: false, status: 'queued', ...o,
});

/* ================================================================================================ */
/* THE GATE                                                                                          */
/* ================================================================================================ */

describe('EXECUTABLE_STATUSES — the states money may leave from', () => {
  it('is exactly approved and executing', () => {
    // THIS CONSTANT MUST AGREE WITH THE SQL IN apps/api's claimQueued AND WITH 0114's TRIGGER. Three places, one rule —
    // the same danger ADMIN-6 documented for the hash preimage, where a verifier disagreeing with a writer pages P0 over
    // a healthy ledger. Here a disagreement either strands an approved run or opens the door.
    expect([...EXECUTABLE_STATUSES]).toEqual(['approved', 'executing']);
  });
  it('excludes open, so a batch nobody signed cannot execute', () => {
    expect(EXECUTABLE_STATUSES).not.toContain('open');
    expect(EXECUTABLE_STATUSES).not.toContain('returned');
    expect(EXECUTABLE_STATUSES).not.toContain('failed');
  });
  it('the ratified status set matches 0114 ck_payout_batch_status', () => {
    expect([...BATCH_STATUSES]).toEqual(['open', 'approved', 'returned', 'executing', 'executed', 'failed']);
  });
});

/* ================================================================================================ */
/* THE PREFLIGHT                                                                                     */
/* ================================================================================================ */

describe('preflightOne', () => {
  it('passes a verified, penny-verified, unfrozen, queued payout', () => {
    expect(preflightOne(subj())).toEqual({ payoutId: 'p1', ok: true, failures: [], bankLast4: '4417' });
  });

  it('refuses an expired KYC — the gap between requesting and approving', () => {
    // `requestPayout` checks KYC once, at request. A batch assembled Monday and approved Thursday is the ordinary case,
    // and this is the check nothing performed.
    expect(preflightOne(subj({ kycStatus: 'not_verified' })).failures).toEqual(['kyc_not_verified']);
  });

  it('distinguishes "no active role" from "KYC failed"', () => {
    // Two different next actions for an operator: one is a person whose verification lapsed, the other is a person with
    // no role in this tenant at all. Collapsing them would send somebody to re-verify an account that does not exist.
    expect(preflightOne(subj({ kycStatus: null })).failures).toEqual(['kyc_unknown']);
  });

  it('refuses a bank account that was never penny-verified', () => {
    // W067 prints "all bank-verified accounts". `penny_verified_at` was never read on the payout path — loan
    // disbursement and coop payouts both require it and payouts did not.
    expect(preflightOne(subj({ bankVerified: false })).failures).toEqual(['bank_unverified']);
  });

  it('refuses a payout whose payee wallet is FROZEN — the freeze that never reached the money door', () => {
    // A payout's success legs debit PLATFORM payouts and credit PLATFORM gateway; the farmer's own account was debited
    // at request time. So wallet-service's frozen-account guard never saw this money, and freezing an account for
    // suspected fraud did not stop a payout already requested. This is the first code that connects the two.
    expect(preflightOne(subj({ walletFrozen: true })).failures).toEqual(['wallet_frozen']);
  });

  it('reports EVERY failure, not the first', () => {
    // A checker fixing a batch needs the whole list; one at a time turns a review into a loop.
    const l = preflightOne(subj({ kycStatus: 'not_verified', bankVerified: false, walletFrozen: true }));
    expect(l.failures.sort()).toEqual(['bank_unverified', 'kyc_not_verified', 'wallet_frozen']);
  });

  it('reports no_payee ALONE and does not also guess at KYC or a freeze', () => {
    // Running a user-shaped check against nobody would produce 'kyc_unknown' and a bank verdict — two answers where
    // there is no question.
    //
    // THE SUBJECT HERE IS THE SHAPE AN ORPHANED PAYOUT ACTUALLY HAS, and getting that wrong cost a survivor. My first
    // version passed `{ userId: null }` and left every other field passing — so deleting the early `return` changed
    // nothing, because the checks it skipped all happened to pass anyway. A payout with no payee has no roles either
    // (so KYC is unknowable) and its bank account is not verifiable, which is what makes the early return load-bearing.
    // Same lesson as ADMIN-6's M16: a case where both implementations agree tests neither.
    expect(preflightOne(subj({ userId: null, kycStatus: null, bankVerified: false })).failures)
      .toEqual(['no_payee']);
  });

  it('refuses a payout that has already moved on', () => {
    expect(preflightOne(subj({ status: 'success' })).failures).toContain('not_payable');
  });

  it('refuses a zero amount even though the DB CHECK forbids it', () => {
    // A preflight that trusts a constraint it did not write stops being true the day the constraint is relaxed.
    expect(preflightOne(subj({ amountMinor: 0n })).failures).toContain('zero_or_negative');
  });

  it('treats an UNKNOWN kyc_status as failing, because the allow-list is one value', () => {
    // A new `kyc_status` added by a future migration must default to blocked, not to payable. This is the assertion that
    // makes the allow-list load-bearing rather than stylistic.
    expect(preflightOne(subj({ kycStatus: 'provisionally_ok' })).failures).toEqual(['kyc_not_verified']);
  });

  it('every failure code in the union is reachable', () => {
    // Guards against a code being added to the type and never produced, which is how a console gains a label nothing
    // ever renders.
    const produced = new Set<string>();
    for (const s of [
      subj({ userId: null }), subj({ kycStatus: 'not_verified' }), subj({ kycStatus: null }),
      subj({ bankVerified: false }), subj({ walletFrozen: true }), subj({ status: 'failed' }),
      subj({ amountMinor: -1n }),
    ]) for (const f of preflightOne(s).failures) produced.add(f);
    expect([...produced].sort()).toEqual([...PREFLIGHT_FAILURES].sort());
  });
});

describe('preflight (a batch)', () => {
  it('AN EMPTY BATCH DOES NOT PASS', () => {
    // `[].every(ok)` is true, which would let a checker approve a run that disburses nothing and marks itself executed.
    // W067 has a state for exactly this.
    const r = preflight([]);
    expect(r.pass).toBe(false);
    expect(r.checked).toBe(0);
  });

  it('keeps the payable total apart from the requested total', () => {
    const r = preflight([subj({ payoutId: 'a' }), subj({ payoutId: 'b', walletFrozen: true, amountMinor: 100n })]);
    // The figure on the header is not the figure that will leave, and that difference is the finding.
    expect(r.pass).toBe(false);
    expect(r.payableMinor).toBe(4738500n);
    expect(r.totalMinor).toBe(4738600n);
    expect(r.blocked).toBe(1);
  });

  it('sums in bigint past 2^53', () => {
    // 2^53 minor units is about ₹90,071,992,547 — reachable by a platform aiming at ₹1.5 lakh crore GMV. THE EXPECTED
    // VALUES ARE NOT A CANCELLING PAIR: ADMIN-5e's mutation lesson was that 0 survives any lossy conversion, so a test
    // over extreme inputs whose answer is 0 proves nothing. These two differ in their last digit, which a float cannot
    // represent.
    const r = preflight([
      subj({ payoutId: 'a', amountMinor: 9007199254740993n }),
      subj({ payoutId: 'b', amountMinor: 9007199254740993n }),
    ]);
    expect(r.payableMinor).toBe(18014398509481986n);
    expect(r.payableMinor.toString()).toBe('18014398509481986');
    expect(r.payableMinor).not.toBe(BigInt(Number(r.payableMinor.toString())));
  });

  it('counts failures by code so the panel can name them', () => {
    const r = preflight([
      subj({ payoutId: 'a', kycStatus: 'not_verified' }),
      subj({ payoutId: 'b', kycStatus: 'not_verified' }),
      subj({ payoutId: 'c', bankVerified: false }),
    ]);
    expect(r.byFailure).toEqual({ kyc_not_verified: 2, bank_unverified: 1 });
  });
});

describe('preflightForStorage', () => {
  it('stores money as STRINGS and keeps only the blocked ids', () => {
    const r = preflight([subj({ payoutId: 'a' }), subj({ payoutId: 'b', walletFrozen: true })]);
    const s = preflightForStorage(r);
    expect(typeof s.payableMinor).toBe('string');
    // Storing all 214 lines would put a copy of the batch inside the batch row; the ones that PASSED are recoverable
    // from the payouts, and the ones that were blocked are the finding.
    expect(s.blockedPayoutIds).toEqual(['b']);
  });
});

describe('preflightDrift', () => {
  const fresh = preflight([subj()]);
  it('reports no_record for a missing or unreadable stored preflight', () => {
    expect(preflightDrift(null, fresh)).toEqual({ drifted: true, reason: 'no_record' });
    // A shape we cannot read is treated as no record. Guessing would be a claim about what a human approved.
    expect(preflightDrift({ payableMinor: 4738500 as unknown as string }, fresh).reason).toBe('no_record');
  });
  it('detects a changed payable total', () => {
    expect(preflightDrift({ payableMinor: '1', blocked: 0 }, fresh))
      .toEqual({ drifted: true, reason: 'payable_changed' });
  });
  it('agrees when nothing moved', () => {
    expect(preflightDrift({ payableMinor: '4738500', blocked: 0 }, fresh)).toEqual({ drifted: false });
  });
});

/* ================================================================================================ */
/* APPROVAL                                                                                          */
/* ================================================================================================ */

const pf = (pass: boolean, checked = 3, blocked = 0) => ({ pass, checked, blocked });

describe('approvalState — what the console DRAWS', () => {
  it('is approvable for a second operator over a passing preflight', () => {
    expect(approvalState({ status: 'open', count: 3, openedByAdminId: 'a1', viewerAdminId: 'a2', preflight: pf(true) }))
      .toEqual({ kind: 'approvable' });
  });

  it('withholds the control from the MAKER', () => {
    expect(approvalState({ status: 'open', count: 3, openedByAdminId: 'a1', viewerAdminId: 'a1', preflight: pf(true) }))
      .toEqual({ kind: 'needs_other_operator' });
  });

  it('reports an already-decided batch as decided, even if its preflight has since gone bad', () => {
    // Re-litigating a signed decision on a read screen is noise; "this was already approved" is the fact needed.
    expect(approvalState({ status: 'approved', count: 3, openedByAdminId: 'a1', viewerAdminId: 'a2', preflight: pf(false, 3, 1) }))
      .toEqual({ kind: 'already', status: 'approved' });
  });

  it('reports EMPTY before it reports a preflight verdict', () => {
    // `preflight([])` correctly refuses to pass, and "0 blocked, does not pass" is a confusing way to say "there is
    // nothing here".
    expect(approvalState({ status: 'open', count: 0, openedByAdminId: 'a1', viewerAdminId: 'a2', preflight: pf(false, 0, 0) }))
      .toEqual({ kind: 'empty' });
  });

  it('reports EMPTY from the batch COUNT even when the preflight found payouts', () => {
    // `payout_batches.count` is maintained by the batch service; the preflight counts the payouts that actually point at
    // the batch. THOSE CAN DISAGREE, and a batch whose own count says 0 while three payouts name it is a bookkeeping
    // fault that should stop an approval, not be resolved silently in favour of whichever number is larger.
    //
    // This is the second mutation in this wave that survived for the same reason (see the `pass`-with-blocked case
    // above): every input I had written was internally consistent, so two independent checks looked like one. The rule
    // that comes out of it is sharper than "test the guard" — WHEN TWO FIELDS COULD DISAGREE, THE TEST MUST MAKE THEM
    // DISAGREE, or a check on one of them is unverified no matter how many cases pass.
    expect(approvalState({ status: 'open', count: 0, openedByAdminId: 'a1', viewerAdminId: 'a2', preflight: pf(true, 3, 0) }))
      .toEqual({ kind: 'empty' });
  });

  it('refuses a preflight that claims to PASS while carrying blocked payouts', () => {
    // `preflight()` can never produce this — `pass` is derived as `length > 0 && blocked === 0` — and that is exactly why
    // the check exists twice. `approvalState` is also handed hand-built objects (the recorded jsonb on the batch row, a
    // future caller, a replayed audit value), and a function on the money door must not depend on an invariant it did
    // not compute. A mutation removing the `blocked > 0` branch survived until this test, because every case I had
    // written was internally consistent and the `!pass` branch caught them all.
    expect(approvalState({
      status: 'open', count: 3, openedByAdminId: 'a1', viewerAdminId: 'a2',
      preflight: { pass: true, checked: 3, blocked: 3 },
    })).toEqual({ kind: 'blocked', blocked: 3 });
  });

  it('reports no_preflight distinctly from blocked', () => {
    // One is a known problem, the other is not knowing — and a checker must not be shown a green button in the second
    // case.
    expect(approvalState({ status: 'open', count: 3, openedByAdminId: 'a1', viewerAdminId: 'a2', preflight: null }))
      .toEqual({ kind: 'no_preflight' });
  });

  it('refuses a status it does not recognise rather than treating it as approvable', () => {
    expect(approvalState({ status: 'quantum', count: 3, openedByAdminId: 'a1', viewerAdminId: 'a2', preflight: pf(true) }).kind)
      .toBe('already');
  });
});

describe('assertApprovable — what the server ALLOWS', () => {
  const ok = { status: 'open', count: 3, openedByAdminId: 'a1', approverAdminId: 'a2', preflight: pf(true) };

  it('permits a clean second-person approval', () => {
    expect(() => assertApprovable(ok)).not.toThrow();
  });

  it('THROWS SecondPersonRequiredError for self-approval — the tenth maker-checker site', () => {
    expect(() => assertApprovable({ ...ok, approverAdminId: 'a1' })).toThrow(SecondPersonRequiredError);
  });

  it('refuses on a failing preflight BEFORE it refuses on the two-person rule', () => {
    // Order matters for the operator: learn about the substantive problem before being told to find a colleague.
    try {
      assertApprovable({ ...ok, approverAdminId: 'a1', preflight: pf(false, 214, 3) });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidPayoutOpsError);
      expect(e).not.toBeInstanceOf(SecondPersonRequiredError);
      // ASSERTING THE MESSAGE, NOT ONLY THE TYPE. ADMIN-6's M23 survived because deleting a branch still threw the same
      // class — the branch's whole purpose was the sentence it produced.
      expect((e as InvalidPayoutOpsError).getResponse()).toMatchObject({
        message: expect.stringContaining('3 of 214'),
      });
    }
  });

  it('refuses an empty batch', () => {
    expect(() => assertApprovable({ ...ok, count: 0 })).toThrow(/no payouts/);
  });

  it('refuses a preflight that claims to PASS while carrying blocked payouts', () => {
    // The write-side twin of the display-side case above, and for the same reason: this function is the last thing
    // between a request and money leaving, so it must not trust a `pass` flag it did not compute.
    expect(() => assertApprovable({ ...ok, preflight: { pass: true, checked: 3, blocked: 3 } }))
      .toThrow(/3 of 3/);
  });

  it('refuses when there is no preflight at all', () => {
    expect(() => assertApprovable({ ...ok, preflight: null })).toThrow(/no preflight/i);
  });

  it('refuses a batch that is not open', () => {
    expect(() => assertApprovable({ ...ok, status: 'returned' })).toThrow(/returned/);
  });

  it('permits approval when the MAKER IS UNRECORDED, and that is deliberate', () => {
    // The shared helper's documented rule: refusing an unknown initiator means nobody can ever approve a backfilled row,
    // for ever. Two nulls must not compare equal — a mutation test on the scheme-version plane caught exactly that.
    expect(() => assertApprovable({ ...ok, openedByAdminId: null })).not.toThrow();
  });
});

describe('assertReturnable', () => {
  it('needs a reason of at least the documented floor', () => {
    expect(RETURN_REASON_MIN).toBe(20);
    expect(() => assertReturnable({ status: 'open', reason: 'no', returnerAdminId: 'a1' })).toThrow(/20 characters/);
  });
  it('counts TRIMMED length, so whitespace does not buy a reason', () => {
    expect(() => assertReturnable({ status: 'open', reason: `${' '.repeat(40)}bad`, returnerAdminId: 'a1' }))
      .toThrow(/20 characters/);
  });
  it('accepts a real reason', () => {
    expect(() => assertReturnable({
      status: 'open', reason: 'Three payees have lapsed KYC; rebuild after re-verification.', returnerAdminId: 'a1',
    })).not.toThrow();
  });
  it('is NOT subject to the two-person rule, and the asymmetry is intentional', () => {
    // Refusing your own batch is noticing your own mistake. Requiring a colleague to help stop a payment run at 02:00
    // would make the safe action the expensive one.
    expect(returnNeedsSecondPerson()).toBe(false);
    expect(() => assertReturnable({
      status: 'open', reason: 'My own error: the wage lane was included by mistake.', returnerAdminId: 'a1',
    })).not.toThrow();
  });
});

describe('batchPhase / batchMoney', () => {
  it('derives awaiting_checker from open rather than storing it', () => {
    // A derived phase means there is no second column to disagree with `status` — the failure this whole plane keeps
    // finding.
    expect(batchPhase('open')).toBe('awaiting_checker');
    expect(batchPhase('nonsense')).toBe('unknown');
  });
  it('does not call a pre-execution zero total a shortfall', () => {
    expect(batchMoney('open', 482120n, 0n).shortfall).toBe(false);
    expect(batchMoney('executing', 482120n, 100n).shortfall).toBe(false);
  });
  it('reports a shortfall once the run has finished', () => {
    const m = batchMoney('executed', 482120n, 400000n);
    expect(m.shortfall).toBe(true);
    expect(m.shortfallMinor).toBe(82120n);
  });
  it('does not report a shortfall when more settled than requested', () => {
    // Should be impossible, and reporting a negative shortfall would be a confusing way to surface a real anomaly.
    expect(batchMoney('executed', 100n, 200n).shortfall).toBe(false);
  });
});

/* ================================================================================================ */
/* THE SETTLEMENT CYCLE                                                                              */
/* ================================================================================================ */

const run = (o: Partial<SettlementRunRow> = {}): SettlementRunRow => ({
  id: 'r1', periodStart: '2026-07-13', periodEnd: '2026-07-13', status: 'completed',
  sellersScanned: 1102, generatedCount: 1102, failedCount: 0,
  grossMinor: 428640000n, commissionMinor: 6429600n, taxMinor: 4286400n, netMinor: 417924000n,
  finishedAt: '2026-07-13T18:20:00Z', triggeredByAdminId: null, failureDetail: null,
  createdAt: '2026-07-13T18:00:00Z', ...o,
});

describe('the tiles — unknown is never zero', () => {
  it('reports no_run_today rather than ₹0 when there is no run', () => {
    expect(cycleTile(null)).toEqual({ known: false, reason: 'no_run_today' });
    expect(componentTile(null, 'commission')).toEqual({ known: false, reason: 'no_run_today' });
  });
  it('reports a real zero as KNOWN', () => {
    // The distinction the type exists for: a cycle that ran and settled nothing is a quiet day, not a broken scheduler.
    expect(cycleTile(run({ grossMinor: 0n }))).toEqual({ known: true, minor: 0n, note: 'completed' });
  });
  it('reports awaiting-payout as not_recorded when nothing is known', () => {
    expect(awaitingPayoutTile(null)).toEqual({ known: false, reason: 'not_recorded' });
  });
});

describe('runOutcome', () => {
  const now = Date.parse('2026-07-13T19:00:00Z');
  it('reads a running run as running while it is fresh', () => {
    expect(runOutcome(run({ status: 'running', finishedAt: null }), now).kind).toBe('running');
  });
  it('reads a long-silent running run as ABANDONED, from the absence of an ending', () => {
    // A crashed process cannot write its own epitaph. This is the only trace it leaves.
    const late = Date.parse('2026-07-13T18:00:00Z') + RUN_STALE_AFTER_MS + 1;
    expect(runOutcome(run({ status: 'running', finishedAt: null }), late).kind).toBe('abandoned');
  });
  it('does NOT read an unparseable start as fresh', () => {
    // `Number.isNaN` and not a comparison: NaN comparisons are false in both directions, which would make every stuck
    // run look healthy.
    expect(runOutcome(run({ status: 'running', finishedAt: null, createdAt: 'not a date' }), now).kind).toBe('unknown');
  });
  it('separates partial from failed', () => {
    expect(runOutcome(run({ status: 'partial', failedCount: 3 }), now)).toMatchObject({ kind: 'partial', failed: 3 });
    expect(runOutcome(run({ status: 'failed' }), now).kind).toBe('failed');
  });
});

describe('statusFromCounts — derived, never chosen by the caller', () => {
  it('is completed when nothing failed, including when nothing was generated', () => {
    // W062: "zero statements means no delivered orders today" — a real and ordinary outcome.
    expect(statusFromCounts({ scanned: 0, generated: 0, failed: 0 })).toBe('completed');
    expect(statusFromCounts({ scanned: 40, generated: 40, failed: 0 })).toBe('completed');
  });
  it('is failed when everything failed, because nothing stands', () => {
    expect(statusFromCounts({ scanned: 40, generated: 0, failed: 40 })).toBe('failed');
  });
  it('is partial when some stand and some do not', () => {
    expect(statusFromCounts({ scanned: 40, generated: 37, failed: 3 })).toBe('partial');
  });
  it('cannot be told it is clean while carrying failures', () => {
    // The point of deriving it: the previous version of this logic was a log line, and a log line can say anything.
    expect(statusFromCounts({ scanned: 1, generated: 1, failed: 1 })).not.toBe('completed');
  });
});

describe('statementBalance / statementEquation — W442 recomputed', () => {
  it('confirms a statement that adds up', () => {
    expect(statementBalance({ grossMinor: 4860000n, commissionMinor: 72900n, taxMinor: 48600n, netMinor: 4738500n }))
      .toEqual({ balanced: true, netMinor: 4738500n });
  });
  it('names the drift on a statement that does not', () => {
    const b = statementBalance({ grossMinor: 4860000n, commissionMinor: 72900n, taxMinor: 48600n, netMinor: 4738501n });
    expect(b).toMatchObject({ balanced: false, driftMinor: 1n });
  });
  it('prints the arithmetic a reader can check by eye', () => {
    expect(statementEquation({ grossMinor: 4860000n, commissionMinor: 72900n, taxMinor: 48600n, netMinor: 4738500n }))
      .toBe('4860000 − 72900 − 48600 = 4738500');
  });
  it('omits a zero commission and a zero tax rather than printing − 0', () => {
    expect(statementEquation({ grossMinor: 100n, commissionMinor: 0n, taxMinor: 0n, netMinor: 100n }))
      .toBe('100 = 100');
  });
  it('detects drift on a value beyond float precision', () => {
    // A one-unit drift on a 17-digit figure is exactly the drift a float would erase.
    const b = statementBalance({
      grossMinor: 9007199254740993n, commissionMinor: 0n, taxMinor: 0n, netMinor: 9007199254740992n,
    });
    expect(b.balanced).toBe(false);
    expect((b as { driftMinor: bigint }).driftMinor).toBe(-1n);
  });
});

describe('pdfState — W442, and never_hashed is the honest default', () => {
  const s = { pdfMediaId: 'm1', pdfSha256: 'a'.repeat(64), pdfHashedAt: '2026-07-13T18:30:00Z' };
  it('reports not_generated when there is no file', () => {
    expect(pdfState({ pdfMediaId: null, pdfSha256: null, pdfHashedAt: null })).toEqual({ kind: 'not_generated' });
  });
  it('reports never_hashed for a file with no digest — the state almost every statement is in', () => {
    expect(pdfState({ pdfMediaId: 'm1', pdfSha256: null, pdfHashedAt: null }))
      .toEqual({ kind: 'never_hashed', mediaId: 'm1' });
  });
  it('reports ANCHORED, not VERIFIED, when nothing has re-read the file', () => {
    // The ADMIN-6 rule: a claim carries the date somebody last checked it and never implies a check that did not happen.
    expect(pdfState(s).kind).toBe('anchored');
  });
  it('reports a mismatch only when a file was actually re-read and differed', () => {
    expect(pdfState(s, 'b'.repeat(64)).kind).toBe('mismatch');
    expect(pdfState(s, 'a'.repeat(64)).kind).toBe('anchored');
  });
  it('does not claim an anchor when the digest is present but the timestamp is not', () => {
    // 0114's CHECK forbids the pair, so this is reachable only through a path that bypassed it — and the safe reading of
    // a half-written tamper claim is that there is none.
    expect(pdfState({ pdfMediaId: 'm1', pdfSha256: 'a'.repeat(64), pdfHashedAt: null }).kind).toBe('never_hashed');
  });
});

/* ================================================================================================ */
/* MONEY IN AND OUT                                                                                  */
/* ================================================================================================ */

describe('parseMinor', () => {
  it('accepts a pg string and a bigint', () => {
    expect(parseMinor('4738500')).toBe(4738500n);
    expect(parseMinor(-500n)).toBe(-500n);
  });
  it('REFUSES a JS number with a message about precision, not a generic one', () => {
    // ADMIN-6's M23: deleting this branch still threw, because a number is also not a string. Asserting only the type
    // proved nothing about a branch whose entire purpose is its message.
    expect(() => parseMinor(4738500, 'net')).toThrow(InvalidPayoutQueryError);
    expect(() => parseMinor(4738500, 'net')).toThrow(/JavaScript number/);
    expect(() => parseMinor(4738500, 'net')).toThrow(/2\^53/);
  });
  it('refuses a decimal, an empty string and a 20-digit number', () => {
    expect(() => parseMinor('47385.00')).toThrow(/whole number/);
    expect(() => parseMinor('')).toThrow(/whole number/);
    expect(() => parseMinor('1'.repeat(20))).toThrow(/whole number/);
  });
  it('preserves a value past 2^53 exactly', () => {
    expect(parseMinor('9007199254740993')).toBe(9007199254740993n);
  });
});

describe('formatMinor', () => {
  it('groups en-IN and keeps two decimals', () => {
    expect(formatMinor(482120000n)).toBe('₹48,21,200.00');
    expect(formatMinor(5n)).toBe('₹0.05');
  });
  it('uses a real minus sign for a negative', () => {
    expect(formatMinor(-100n)).toBe('−₹1.00');
  });
});

describe('parseCycleDate', () => {
  it('accepts a business day and rejects a timestamp', () => {
    expect(parseCycleDate('2026-07-13', 'cycle')).toBe('2026-07-13');
    expect(() => parseCycleDate('2026-07-13T18:00:00Z', 'cycle')).toThrow(/business day/);
  });
  it('rejects a date the regex would accept but the calendar would not', () => {
    // The round-trip through Date is what catches this; the pattern alone is happy with it.
    expect(() => parseCycleDate('2026-02-31', 'cycle')).toThrow(/not a real date/);
  });
  it('returns null for an absent value rather than inventing today', () => {
    // Defaulting to today would silently answer a different question from the one asked.
    expect(parseCycleDate(undefined, 'cycle')).toBeNull();
  });
});
