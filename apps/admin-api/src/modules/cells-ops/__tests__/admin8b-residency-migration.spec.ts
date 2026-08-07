// apps/admin-api/src/modules/cells-ops/__tests__/admin8b-residency-migration.spec.ts (PC-56 ADMIN-8b)
//
// The attestation asserts a NEGATIVE, so most of these tests are about the conditions under which it must DECLINE to
// assert one. The pipeline's tests are about refusals for the same reason ADMIN-8's were: the job of a migration state
// machine is to not move a farmer's data until every gate has said yes.
import {
  attest, attestationClaim, canProvisionForCountry, crossBorderPosture, draftViolation, isEvidenceOfBoundary,
  ATTEMPT_KINDS, REFUSAL_REASONS, type ViolationRow,
} from '../domain/residency-evidence';
import {
  assertStartable, assertTransition, canTransition, cleanupVerdict, dataHasMoved, freezeVerdict, inWindow,
  isWaivable, preflight, safetyHoldUntil, sourceStillHeld, verifyCopy, verifyPermitsCutover,
  DEFAULT_FREEZE_BUDGET_SECONDS, JOB_STATUSES, PIPELINE_EXECUTOR_EXISTS, SAFETY_HOLD_DAYS, UNWAIVABLE,
} from '../domain/migration-pipeline';

const v = (o: Partial<ViolationRow> = {}): ViolationRow => ({
  id: 'v1', attemptKind: 'move', subjectType: 'tenant', subjectId: 't1',
  fromCountry: 'IN', toCountry: 'BD', refusedBy: 'residency_lock', outcome: 'blocked',
  actorAdminId: 'op1', detail: {}, createdAt: '2026-08-01T00:00:00Z', ...o,
});

const FROM = '2026-07-01T00:00:00Z';
const TO = '2026-08-07T00:00:00Z';
const SINCE = '2026-06-01T00:00:00Z';

/* ================================================================================================ */
/* THE ATTESTATION — WHICH ASSERTS A NEGATIVE                                                        */
/* ================================================================================================ */

describe('attest', () => {
  it('reports CLEAN when every cross-border attempt was blocked', () => {
    const a = attest([v(), v({ id: 'v2' })], FROM, TO, SINCE);
    expect(a).toMatchObject({ kind: 'clean', attempts: 2, blockedByBoundary: 2, otherRefusals: 0 });
  });

  it('**REFUSES TO ATTEST OVER A WINDOW THE LOG CANNOT SPEAK FOR**', () => {
    // The whole point. Before this wave every window was in this state and W033 said "no violations logged" — a sentence
    // a reader takes as assurance. An attestation from an empty log is an attestation from nothing.
    expect(attest([], FROM, TO, null)).toMatchObject({ kind: 'no_evidence', since: null });
    // A window starting BEFORE the log did is a window with a hole in it.
    expect(attest([], FROM, TO, '2026-07-15T00:00:00Z')).toMatchObject({ kind: 'no_evidence' });
  });

  it('declines rather than asserting when a timestamp cannot be read', () => {
    // On a document that asserts a negative, the safe direction is always to decline.
    expect(attest([], FROM, TO, 'not a date').kind).toBe('no_evidence');
    expect(attest([], 'not a date', TO, SINCE).kind).toBe('no_evidence');
  });

  it('attests CLEAN over an empty window the log DID cover', () => {
    // The distinction that makes the whole table worth having: nothing attempted, and we can prove we were watching.
    expect(attest([], FROM, TO, SINCE)).toMatchObject({ kind: 'clean', attempts: 0, blockedByBoundary: 0 });
  });

  it('separates a transfer that OCCURRED from one that was blocked', () => {
    // A lawful cross-border transfer under a processing agreement is a real thing DELTA-011 will model — and conflating
    // "none occurred" with "these occurred under a basis" is the one error this document cannot survive.
    const a = attest([v(), v({ id: 'v2', outcome: 'allowed', detail: { legalBasis: 'SCC-2026-01' } })], FROM, TO, SINCE);
    expect(a).toMatchObject({ kind: 'transfers_occurred', allowed: 1, withoutBasis: 0 });
  });

  it('counts an allowed transfer with NO legal basis separately', () => {
    // `ck_rv_allowed_needs_basis` forbids the row at the database, so a non-zero count here means one bypassed the
    // constraint — the worst row this table can hold, and it must not be averaged away.
    const a = attest([v({ outcome: 'allowed', detail: {} })], FROM, TO, SINCE);
    expect(a).toMatchObject({ kind: 'transfers_occurred', withoutBasis: 1 });
  });

  it('reports refusals that were NOT the boundary separately', () => {
    // "The residency lock held" and "the target cell did not exist" are different assurances, and an attestation counting
    // the second as protection would be claiming credit for a typo.
    const a = attest([v(), v({ id: 'v2', refusedBy: 'cell_missing' })], FROM, TO, SINCE);
    expect(a).toMatchObject({ kind: 'clean', attempts: 2, blockedByBoundary: 1, otherRefusals: 1 });
  });

  it('lists the countries involved, deduplicated and sorted', () => {
    const a = attest([v(), v({ id: 'v2', fromCountry: 'IN', toCountry: 'AE' })], FROM, TO, SINCE);
    expect((a as { countries: string[] }).countries).toEqual(['AE', 'BD', 'IN']);
  });

  it('maps each verdict to the claim it permits', () => {
    expect(attestationClaim(attest([], FROM, TO, SINCE))).toBe('no_cross_border_transfers');
    expect(attestationClaim(attest([], FROM, TO, null))).toBe('cannot_attest');
    expect(attestationClaim(attest([v({ outcome: 'allowed', detail: { legalBasis: 'x' } })], FROM, TO, SINCE)))
      .toBe('transfers_under_basis');
  });
});

describe('isEvidenceOfBoundary', () => {
  it('counts only the two refusals that ARE the boundary', () => {
    expect(isEvidenceOfBoundary('residency_lock')).toBe(true);
    expect(isEvidenceOfBoundary('country_mismatch')).toBe(true);
    expect(isEvidenceOfBoundary('cell_missing')).toBe(false);
    expect(isEvidenceOfBoundary('profile_not_ratified')).toBe(false);
  });
  it('the vocabularies are closed', () => {
    expect([...ATTEMPT_KINDS]).toEqual(['move', 'place', 'read', 'export']);
    expect([...REFUSAL_REASONS]).toEqual(['residency_lock', 'country_mismatch', 'cell_missing', 'profile_not_ratified']);
  });
});

describe('draftViolation', () => {
  const base = {
    attemptKind: 'move' as const, subjectType: 'tenant', subjectId: 't1',
    fromCountry: 'IN', toCountry: 'BD', fromCellId: 'c1', toCellId: 'c2',
    refusedBy: 'residency_lock' as const, outcome: 'blocked' as const,
    actorAdminId: 'op1', detail: {},
  };
  it('accepts a well-formed refusal', () => {
    expect(() => draftViolation(base)).not.toThrow();
  });
  it('refuses a blocked record missing a country', () => {
    // A cross-border record with one side missing is a record an attestation cannot use.
    expect(() => draftViolation({ ...base, toCountry: null })).toThrow(/both countries/);
  });
  it('**REFUSES A PERMITTED TRANSFER WITH NO LEGAL BASIS**', () => {
    expect(() => draftViolation({ ...base, outcome: 'allowed' }))
      .toThrow(/legal basis/);
    expect(() => draftViolation({ ...base, outcome: 'allowed', detail: { legalBasis: 'SCC-2026-01' } }))
      .not.toThrow();
  });
});

/* ================================================================================================ */
/* THE COUNTRY PROFILE                                                                               */
/* ================================================================================================ */

describe('canProvisionForCountry', () => {
  it('permits a ratified, named profile', () => {
    expect(canProvisionForCountry({ regulationStatus: 'ratified', regulationProfile: 'DPDP Act 2023' }))
      .toEqual({ ok: true });
  });
  it('**A DRAFT PROFILE IS NOT A PROFILE**', () => {
    // W033 shows BD as "DPA 2023 (draft profile)" with no cells, and that is the correct state: provisioning under a
    // draft would mean the residency lock enforcing a rule nobody has ratified.
    const r = canProvisionForCountry({ regulationStatus: 'draft', regulationProfile: 'DPA 2023' });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/not ratified/);
  });
  it('refuses a country with no profile at all', () => {
    const r = canProvisionForCountry({ regulationStatus: 'none', regulationProfile: null });
    expect(r.ok).toBe(false);
    expect((r as { reason: string }).reason).toMatch(/legal artefact/);
  });
  it('refuses a status of ratified with no profile named', () => {
    // `ck_countries_regulation_named` refuses the row; this refuses the decision built on it.
    expect(canProvisionForCountry({ regulationStatus: 'ratified', regulationProfile: null }).ok).toBe(false);
  });
});

describe('crossBorderPosture', () => {
  it('is blocked only when EVERY cell is locked', () => {
    // A country's boundary is as strong as its weakest cell, and `partial` says so rather than rounding up to "blocked".
    expect(crossBorderPosture({ allLocked: true, cells: 3 })).toBe('blocked');
    expect(crossBorderPosture({ allLocked: false, cells: 3 })).toBe('partial');
  });
  it('reports NO CELLS rather than blocked for a country with none', () => {
    // W033 renders "blocked" for BD, NP, LK and AE — countries with no cells at all — and "the boundary holds" is a
    // different statement from "there is nothing here to protect". Only the second is true today.
    expect(crossBorderPosture({ allLocked: true, cells: 0 })).toBe('no_cells');
  });
});

/* ================================================================================================ */
/* THE MIGRATION PIPELINE                                                                            */
/* ================================================================================================ */

describe('the state machine', () => {
  it('follows copy → verify → cutover → done', () => {
    expect(canTransition('queued', 'copying')).toBe(true);
    expect(canTransition('copying', 'verifying')).toBe(true);
    expect(canTransition('verifying', 'cutover')).toBe(true);
    expect(canTransition('cutover', 'done')).toBe(true);
  });
  it('permits a rollback from copying, verifying AND cutover', () => {
    // W034: "automatic if verify fails — source stays authoritative until cutover commits." The safety net covers both
    // sides of the commit point, and modelling only the first would leave a failed cutover with nowhere legal to go.
    for (const from of ['copying', 'verifying', 'cutover']) expect(canTransition(from, 'rolled_back')).toBe(true);
  });
  it('refuses to skip the verify', () => {
    expect(canTransition('copying', 'cutover')).toBe(false);
    expect(() => assertTransition('copying', 'cutover')).toThrow(/copy → verify → cutover/);
  });
  it('has three terminal states and no way back out', () => {
    for (const t of ['done', 'rolled_back', 'failed']) {
      for (const to of JOB_STATUSES) expect(canTransition(t, to)).toBe(false);
    }
  });
  it('DATA HAS MOVED only at done', () => {
    // The source is authoritative through copy and verify, and the placement flips inside the cutover — so any other
    // state, including a rolled-back cutover, leaves the tenant where they were. A console that got this wrong would tell
    // somebody their data is in the wrong country.
    expect(dataHasMoved('done')).toBe(true);
    for (const s of ['queued', 'copying', 'verifying', 'cutover', 'rolled_back', 'failed']) {
      expect(dataHasMoved(s)).toBe(false);
    }
  });
  it('the source is still held after done until cleanup runs', () => {
    expect(sourceStillHeld('done', null)).toBe(true);
    expect(sourceStillHeld('done', '2026-08-01T00:00:00Z')).toBe(false);
    expect(sourceStillHeld('cutover', null)).toBe(false);
  });
});

/* ================================================================================================ */
/* THE PREFLIGHT                                                                                     */
/* ================================================================================================ */

describe('preflight', () => {
  const clean = { openPayouts: 0, liveAuctions: 0, outboxPending: 0, estimatedBytes: 100, windowBudgetBytes: 1000 };

  it('passes a clean set', () => {
    expect(preflight(clean).pass).toBe(true);
  });

  it('**AN UNREADABLE CHECK IS UNKNOWN, NOT A PASS**', () => {
    // These come from cross-plane reads that can fail, and a preflight that passed on three checks while the fourth did
    // not run is not a pass — the person about to freeze a farmer's tenant for four minutes is entitled to know which is
    // which.
    const r = preflight({ ...clean, openPayouts: null });
    expect(r.pass).toBe(false);
    expect(r.unknown).toEqual(['no_open_payouts']);
    expect(r.blocking).toEqual([]);
  });

  it('treats a non-finite count as unknown rather than as zero', () => {
    expect(preflight({ ...clean, liveAuctions: NaN }).unknown).toContain('no_live_auctions');
  });

  it('blocks on open payouts and says WHY, in the canon\'s own words', () => {
    const r = preflight({ ...clean, openPayouts: 1 });
    expect(r.blocking).toContain('no_open_payouts');
    const c = r.checks.find((x) => x.check === 'no_open_payouts');
    expect(c && 'detail' in c ? c.detail : '').toMatch(/never race money/);
  });

  it('reports the window-budget failure as WAIVABLE and the payout one as not', () => {
    expect(isWaivable('no_open_payouts')).toBe(false);
    expect(isWaivable('within_window_budget')).toBe(true);
    expect([...UNWAIVABLE]).toEqual(['no_open_payouts']);
  });

  it('treats an unknown budget as unknown rather than as fitting', () => {
    expect(preflight({ ...clean, windowBudgetBytes: null }).unknown).toContain('within_window_budget');
  });
});

describe('assertStartable', () => {
  const pass = preflight({ openPayouts: 0, liveAuctions: 0, outboxPending: 0, estimatedBytes: 1, windowBudgetBytes: 2 });

  it('starts a queued, approved job with a passing preflight', () => {
    expect(() => assertStartable({ status: 'queued', preflight: pass, waived: [], approvedByAdminId: 'op2' }))
      .not.toThrow();
  });

  it('**REFUSES A JOB WITH NO CHECKER APPROVAL**', () => {
    expect(() => assertStartable({ status: 'queued', preflight: pass, waived: [], approvedByAdminId: null }))
      .toThrow(/checker approval/);
  });

  it('**REFUSES TO WAIVE A CHECK THAT DID NOT RUN**', () => {
    // Waiving an unrun check is asserting a result nobody has — the sharpest distinction in this module.
    const unknown = preflight({ openPayouts: null, liveAuctions: 0, outboxPending: 0, estimatedBytes: 1, windowBudgetBytes: 2 });
    expect(() => assertStartable({
      status: 'queued', preflight: unknown,
      waived: [{ check: 'no_open_payouts', reason: 'a perfectly long reason that is over twenty characters' }],
      approvedByAdminId: 'op2',
    })).toThrow(/cannot be waived/);
  });

  it('**REFUSES TO WAIVE OPEN PAYOUTS EVEN WITH A REASON**', () => {
    // Moves never race money. A live auction can be judged; a payout executing against a shard being replicated cannot.
    const blocked = preflight({ openPayouts: 2, liveAuctions: 0, outboxPending: 0, estimatedBytes: 1, windowBudgetBytes: 2 });
    expect(() => assertStartable({
      status: 'queued', preflight: blocked,
      waived: [{ check: 'no_open_payouts', reason: 'the finance lead said it is fine, honestly' }],
      approvedByAdminId: 'op2',
    })).toThrow(/never race money/);
  });

  it('accepts a waived WAIVABLE check with a real reason', () => {
    const over = preflight({ openPayouts: 0, liveAuctions: 0, outboxPending: 0, estimatedBytes: 10, windowBudgetBytes: 1 });
    expect(() => assertStartable({
      status: 'queued', preflight: over,
      waived: [{ check: 'within_window_budget', reason: 'the window was extended to three hours by agreement' }],
      approvedByAdminId: 'op2',
    })).not.toThrow();
  });

  it('refuses a waiver whose reason is too short', () => {
    // Per check, so "I waived the preflight" is never something anybody can do — the granularity IS the control.
    const over = preflight({ openPayouts: 0, liveAuctions: 0, outboxPending: 0, estimatedBytes: 10, windowBudgetBytes: 1 });
    expect(() => assertStartable({
      status: 'queued', preflight: over,
      waived: [{ check: 'within_window_budget', reason: 'fine' }],
      approvedByAdminId: 'op2',
    })).toThrow(/has not been waived/);
  });
});

/* ================================================================================================ */
/* THE WINDOW, THE FREEZE, THE HOLD                                                                  */
/* ================================================================================================ */

describe('inWindow', () => {
  const now = Date.parse('2026-08-07T02:30:00Z');
  it('is open inside the agreed window', () => {
    expect(inWindow(now, '2026-08-07T02:00:00Z', '2026-08-07T03:00:00Z')).toBe(true);
  });
  it('is CLOSED with no window, or an unreadable one', () => {
    // A migration starting outside its agreed window is a write freeze nobody warned the tenant about.
    expect(inWindow(now, null, null)).toBe(false);
    expect(inWindow(now, 'nope', '2026-08-07T03:00:00Z')).toBe(false);
  });
  it('is exclusive at the end', () => {
    expect(inWindow(Date.parse('2026-08-07T03:00:00Z'), '2026-08-07T02:00:00Z', '2026-08-07T03:00:00Z')).toBe(false);
  });
});

describe('freezeVerdict', () => {
  const now = Date.parse('2026-08-07T02:05:00Z');
  it('measures rather than promises', () => {
    // "We promised four minutes" and "it took four minutes" are different claims and only the second is evidence.
    expect(DEFAULT_FREEZE_BUDGET_SECONDS).toBe(240);
    expect(freezeVerdict('2026-08-07T02:00:00Z', '2026-08-07T02:03:00Z', 240, now))
      .toEqual({ kind: 'finished', elapsedSeconds: 180, budgetSeconds: 240, overBudget: false });
  });
  it('reports an over-budget freeze as such after the fact', () => {
    expect(freezeVerdict('2026-08-07T02:00:00Z', '2026-08-07T02:06:00Z', 240, now))
      .toMatchObject({ kind: 'finished', overBudget: true });
  });
  it('reports a RUNNING freeze already over budget', () => {
    // The state somebody needs to see immediately: the tenant is offline and the promise has been broken.
    expect(freezeVerdict('2026-08-07T01:55:00Z', null, 240, now)).toMatchObject({ kind: 'running', overBudget: true });
  });
  it('reports an unreadable timestamp rather than computing from it', () => {
    expect(freezeVerdict('nope', null, 240, now)).toEqual({ kind: 'unreadable' });
    expect(freezeVerdict(null, null, 240, now)).toEqual({ kind: 'not_started' });
  });
});

describe('the safety hold', () => {
  it('is seven days from the cutover', () => {
    expect(SAFETY_HOLD_DAYS).toBe(7);
    const at = Date.parse('2026-08-01T00:00:00Z');
    expect(safetyHoldUntil(at)).toBe('2026-08-08T00:00:00.000Z');
  });
  it('holds, becomes due, then records the cleanup', () => {
    const now = Date.parse('2026-08-05T00:00:00Z');
    expect(cleanupVerdict('done', '2026-08-08T00:00:00Z', null, now)).toMatchObject({ kind: 'holding', daysRemaining: 3 });
    expect(cleanupVerdict('done', '2026-08-01T00:00:00Z', null, now)).toEqual({ kind: 'due' });
    expect(cleanupVerdict('done', '2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z', now))
      .toEqual({ kind: 'done', at: '2026-08-02T00:00:00Z' });
  });
  it('**KEEPS THE SOURCE when the hold date cannot be read**', () => {
    // The safe direction on "may we delete the original copy of a farmer's data" is always to wait.
    expect(cleanupVerdict('done', 'nope', null, Date.now())).toMatchObject({ kind: 'holding' });
  });
  it('does not apply before the migration is done', () => {
    expect(cleanupVerdict('cutover', '2026-08-01T00:00:00Z', null, Date.now())).toEqual({ kind: 'not_applicable' });
  });
});

/* ================================================================================================ */
/* THE VERIFY                                                                                        */
/* ================================================================================================ */

describe('verifyCopy', () => {
  it('matches on rows AND the ledger sum', () => {
    expect(verifyCopy({ sourceRows: 100, targetRows: 100, sourceLedgerMinor: '4738500', targetLedgerMinor: '4738500' }))
      .toEqual({ kind: 'match', rows: 100 });
  });

  it('reports a row mismatch with both counts', () => {
    expect(verifyCopy({ sourceRows: 100, targetRows: 99, sourceLedgerMinor: '1', targetLedgerMinor: '1' }))
      .toEqual({ kind: 'row_mismatch', sourceRows: 100, targetRows: 99 });
  });

  it('**ROW COUNTS ALONE ARE NOT A PASS**', () => {
    // A copy that moved every row and corrupted the money would pass a row check. ADMIN-6 spent a wave on the fact that a
    // ledger's own arithmetic is the thing worth checking.
    expect(verifyCopy({ sourceRows: 100, targetRows: 100, sourceLedgerMinor: '4738500', targetLedgerMinor: '4738400' }))
      .toMatchObject({ kind: 'ledger_mismatch' });
  });

  it('reports INCOMPLETE when the ledger could not be read, never a match', () => {
    // A verify saying "the money is fine" about a sum it never read is the worst output this function could produce.
    expect(verifyCopy({ sourceRows: 100, targetRows: 100, sourceLedgerMinor: null, targetLedgerMinor: '1' }))
      .toMatchObject({ kind: 'incomplete' });
  });

  it('compares money as bigint, so a one-paisa difference past 2^53 is caught', () => {
    // 2^53 minor units is about ₹90,071,992,547 and a tenant's ledger can exceed it; through a float these two are equal.
    expect(verifyCopy({
      sourceRows: 1, targetRows: 1,
      sourceLedgerMinor: '9007199254740993', targetLedgerMinor: '9007199254740992',
    })).toMatchObject({ kind: 'ledger_mismatch' });
  });

  it('reports an unparseable ledger sum as incomplete rather than throwing', () => {
    expect(verifyCopy({ sourceRows: 1, targetRows: 1, sourceLedgerMinor: 'abc', targetLedgerMinor: '1' }))
      .toMatchObject({ kind: 'incomplete' });
  });

  it('only an exact MATCH permits a cutover', () => {
    expect(verifyPermitsCutover({ kind: 'match', rows: 1 })).toBe(true);
    expect(verifyPermitsCutover({ kind: 'incomplete', reason: 'x' })).toBe(false);
    expect(verifyPermitsCutover({ kind: 'row_mismatch', sourceRows: 1, targetRows: 2 })).toBe(false);
  });
});

/* ================================================================================================ */
/* WHAT NOBODY RUNS                                                                                  */
/* ================================================================================================ */

describe('the executor', () => {
  it('**IS DECLARED ABSENT, and every surface can say so**', () => {
    // Five status columns on this platform have already recorded acts nobody performs. A seven-state pipeline would be
    // the sixth and largest, so the absence is a constant rather than something each page remembers.
    expect(PIPELINE_EXECUTOR_EXISTS).toBe(false);
  });
});
