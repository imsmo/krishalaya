// apps/admin-api/src/modules/ai-models-ops/__tests__/admin7-fairness-gate.spec.ts (PC-56 ADMIN-7)
//
// The gate's job is to REFUSE, so almost every assertion here is about what it declines to permit. The one that matters
// most is the default: a model nobody has audited cannot reach production, which was the state of every model on this
// platform before this wave.
import {
  assertPromotable, breachesPolicy, canApprove, gateRefusal, legacyAuditShape, productionGate, scoreAudit,
  transitionNeedsFairnessGate, AUDIT_MAX_AGE_DAYS, MAX_SLICE_GAP_PP, MIN_SLICE_GROUP, VERDICTS,
  type AuditRow, type GateResult, type SliceMeasurement,
} from '../domain/fairness-gate';
import {
  buildSlices, measureSlice, sampleSize, AVAILABLE_SLICES, CANON_SLICES_NOT_YET_MEASURABLE,
  MIN_GROUP_FOR_COMPARISON, PROXY_BASIS, PROXY_CAVEATS, type GroupTally,
} from '../domain/slice-measurement';
import {
  assertClaimable, assertDecidable, buildDecision, census, claimState, holdsListings, triageOrder,
  CASE_KINDS, CLAIM_STALE_AFTER_MS, DECISION_NOTE_MIN, OVERRIDES_INFERENCE, type CaseRow,
} from '../domain/review-case';
import {
  assertCanaryStep, evaluateGates, nextCanaryStep, promotionAdvice, reviewLoadDelta, rollbackSignal,
  capacityVerdict, CANARY_STEPS, CANARY_MAX_OVERRIDE_RATE, MIN_CANARY_SAMPLE, MIN_SHADOW_DAYS,
  ROLLBACK_OVERRIDE_RATE, UNMEASURED_METRICS,
} from '../domain/rollout';
import { SecondPersonRequiredError } from '../../../core/approval/two-person-rule';
import { AiGovernanceRefusedError } from '../domain/ai-models.errors';

const slice = (o: Partial<SliceMeasurement> = {}): SliceMeasurement => ({
  maxGapPp: 1.2, worst: 'kutch', best: 'anand', groups: 4, smallestGroup: 500, ...o,
});

const audit = (o: Partial<AuditRow> = {}): AuditRow => ({
  id: 'a1', modelId: 'm1', windowStart: '2026-07-01T00:00:00Z', windowEnd: '2026-07-31T00:00:00Z',
  sampleSize: 4000, slices: { tenant: slice() }, maxGapPp: 1.2, verdict: 'pass', verdictNote: null,
  auditedByAdminId: 'op1', slicesApprovedByAdminId: 'dpo1', slicesApprovedAt: '2026-07-31T09:00:00Z',
  createdAt: '2026-07-31T08:00:00Z', ...o,
});

const NOW = Date.parse('2026-08-07T00:00:00Z');

/* ================================================================================================ */
/* THE POLICY                                                                                        */
/* ================================================================================================ */

describe('the policy figure', () => {
  it('is 5 percentage points', () => {
    expect(MAX_SLICE_GAP_PP).toBe(5);
  });
  it('FAILS AT EXACTLY 5.00pp, and the tie goes to the farmer', () => {
    // W085 writes the policy as "<5pp" in one place and ">5pp" in another, which read literally disagree about exactly
    // 5.00. On a gate protecting farmers from a model that treats them differently by district, the looser reading would
    // make the cheaper path the accidental default at the boundary — which is what Rule Zero forbids, and the same call
    // ADMIN-5f made rounding value-at-stake half UP.
    expect(breachesPolicy(4.99)).toBe(false);
    expect(breachesPolicy(5)).toBe(true);
    expect(breachesPolicy(5.01)).toBe(true);
  });
  it('treats an unmeasurable gap as a breach, never as a clearance', () => {
    expect(breachesPolicy(NaN)).toBe(true);
    expect(breachesPolicy(Infinity)).toBe(true);
  });
});

/* ================================================================================================ */
/* SCORING                                                                                           */
/* ================================================================================================ */

describe('scoreAudit — the verdict is DERIVED, never supplied', () => {
  it('passes a clean, well-populated set of slices', () => {
    const s = scoreAudit({ tenant: slice({ maxGapPp: 1.2 }), subject: slice({ maxGapPp: 0.4 }) });
    expect(s.verdict).toBe('pass');
    expect(s.maxGapPp).toBe(1.2);
    expect(s.worstSlice).toBe('tenant');
  });

  it('AN AUDIT OVER NO SLICES IS NOT A PASS — this is the shape the unwired job produced', () => {
    // `runFairnessAudit` in apps/api writes { window, total, overridden, lowConfidence, overrideRate } and NOT ONE SLICE,
    // into a column named `fairness_audit`. A console would have rendered that as "audited". It is the reason this module
    // refuses to read that column as an audit at all.
    const s = scoreAudit({});
    expect(s.verdict).toBe('inconclusive');
    expect(s.note).toMatch(/no slices/);
  });

  it('FAILS on a breach and names the slice', () => {
    const s = scoreAudit({ tenant: slice({ maxGapPp: 6.4, worst: 'kutch' }) });
    expect(s.verdict).toBe('fail');
    expect(s.note).toMatch(/tenant/);
    expect(s.note).toMatch(/6\.4pp/);
  });

  it('reports a THIN slice as inconclusive rather than as a pass', () => {
    // A slice whose smallest group is 11 farmers produces a gap figure from four mistakes. Calling that a pass is how a
    // fairness programme becomes a formality.
    const s = scoreAudit({ tenant: slice({ maxGapPp: 0.5, smallestGroup: MIN_SLICE_GROUP - 1 }) });
    expect(s.verdict).toBe('inconclusive');
    expect(s.thinSlices).toEqual(['tenant']);
  });

  it('a slice that BOTH breaches and is thin is a FAIL, not inconclusive', () => {
    // ARGUED, and the direction matters: a large measured gap on a small group is still the best evidence available, and
    // downgrading it to "we cannot tell" would let the thinnest slices become the ones the gate ignores — which are
    // exactly the populations most likely to be underserved.
    const s = scoreAudit({ tenant: slice({ maxGapPp: 12, smallestGroup: 5 }) });
    expect(s.verdict).toBe('fail');
  });

  it('does not read a non-finite gap as zero', () => {
    // NaN loses every comparison silently, so a bare `>` would make an unmeasurable slice look like a perfect one.
    const s = scoreAudit({ tenant: slice({ maxGapPp: NaN }) });
    expect(s.verdict).toBe('inconclusive');
    expect(s.thinSlices).toContain('tenant');
  });

  it('does not read a non-finite GROUP SIZE as a large group', () => {
    // TWO INDEPENDENT GUARDS SIT ON ONE LINE — `!Number.isFinite(smallestGroup) || smallestGroup < MIN_SLICE_GROUP` —
    // and a mutation removing the first survived until this test, because my only NaN case was on the GAP and took the
    // other path out of the loop entirely. `NaN < 100` is false, so an unmeasurable group size would have scored as a
    // comfortably large one and the audit would have passed.
    //
    // REACHABLE, WHICH IS WHY THE GUARD MATTERS: `measureSlice` cannot emit NaN here (it coerces to 0), but `scoreAudit`
    // also reads STORED audits out of the `slices` jsonb, where a hand-written or migrated row can carry anything at all.
    //
    // The generalisation of ADMIN-6b's lesson: it is not only two FIELDS that must be made to disagree — two guards in
    // one condition need a case each, or one of them is unverified no matter how many inputs pass through the line.
    const s = scoreAudit({ tenant: slice({ maxGapPp: 0.5, smallestGroup: NaN }) });
    expect(s.verdict).toBe('inconclusive');
    expect(s.thinSlices).toEqual(['tenant']);
  });

  it('every verdict in the union is reachable', () => {
    const produced = new Set<string>([
      scoreAudit({ tenant: slice() }).verdict,
      scoreAudit({ tenant: slice({ maxGapPp: 9 }) }).verdict,
      scoreAudit({}).verdict,
    ]);
    expect([...produced].sort()).toEqual([...VERDICTS].sort());
  });
});

/* ================================================================================================ */
/* THE GATE                                                                                          */
/* ================================================================================================ */

describe('productionGate', () => {
  it('IS CLOSED WHEN NO AUDIT EXISTS — the state of every model on this platform', () => {
    expect(productionGate(null, NOW)).toEqual({ open: false, reason: 'never_audited' });
  });

  it('opens on a fresh, passing, DPO-approved audit', () => {
    const g = productionGate(audit(), NOW);
    expect(g.open).toBe(true);
  });

  it('is closed by a failing audit', () => {
    expect(productionGate(audit({ verdict: 'fail', verdictNote: 'a twenty character reason at least' }), NOW))
      .toMatchObject({ open: false, reason: 'audit_failed' });
  });

  it('is closed by an inconclusive audit — not knowing is not clearance', () => {
    expect(productionGate(audit({ verdict: 'inconclusive', verdictNote: 'thin groups everywhere here' }), NOW))
      .toMatchObject({ open: false, reason: 'audit_inconclusive' });
  });

  it('REFUSES A STORED PASS THAT CONTRADICTS ITS OWN GAP', () => {
    // The two can only disagree if the verdict was written by something that did not apply this policy — which describes
    // every producer that existed before this module. A gate that trusted the flag would inherit their rules.
    const g = productionGate(audit({ verdict: 'pass', maxGapPp: 9.9 }), NOW);
    expect(g).toMatchObject({ open: false, reason: 'audit_failed' });
    expect((g as Extract<GateResult, { open: false; reason: 'audit_failed' }>).note)
      .toMatch(/not produced by the current policy/);
  });

  it('is closed when the DPO has not signed off the slice definitions', () => {
    // Measuring accuracy by gender means processing gender. An audit that chose its own protected attributes is a privacy
    // decision made by whoever wrote the query.
    expect(productionGate(audit({ slicesApprovedByAdminId: null, slicesApprovedAt: null }), NOW))
      .toMatchObject({ open: false, reason: 'slices_unapproved' });
  });

  it('is closed by a stale audit, because an audit measures a POPULATION', () => {
    const old = new Date(NOW - (AUDIT_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    expect(productionGate(audit({ createdAt: old }), NOW)).toMatchObject({ open: false, reason: 'audit_stale' });
  });

  it('treats an UNREADABLE audit date as stale, not as fresh', () => {
    // NaN comparisons are false in both directions, so a bare `>` would read an unparseable timestamp as an audit
    // performed a moment ago — the most dangerous possible reading.
    const g = productionGate(audit({ createdAt: 'not a date' }), NOW);
    expect(g).toMatchObject({ open: false, reason: 'audit_stale' });
    expect((g as Extract<GateResult, { open: false; reason: 'audit_stale' }>).ageDays).toBe(-1);
  });

  it('treats an unrecognised verdict as inconclusive rather than as a pass', () => {
    expect(productionGate(audit({ verdict: 'probably_fine' }), NOW))
      .toMatchObject({ open: false, reason: 'audit_inconclusive' });
  });

  it('every closed reason produces a refusal an operator can act on', () => {
    const reasons: Array<Extract<GateResult, { open: false }>> = [
      { open: false, reason: 'never_audited' },
      { open: false, reason: 'audit_failed', auditId: 'a', maxGapPp: 9, note: null },
      { open: false, reason: 'audit_inconclusive', auditId: 'a', note: null },
      { open: false, reason: 'audit_stale', auditId: 'a', ageDays: 200, maxAgeDays: 90 },
      { open: false, reason: 'audit_stale', auditId: 'a', ageDays: -1, maxAgeDays: 90 },
      { open: false, reason: 'slices_unapproved', auditId: 'a' },
    ];
    for (const r of reasons) {
      const s = gateRefusal(r);
      // ASSERTING THE SENTENCE HAS SUBSTANCE, not just that one exists. ADMIN-6's M23 survived because a branch's whole
      // purpose was its message and the test only asserted the error type.
      expect(s.length).toBeGreaterThan(60);
      expect(s).not.toMatch(/undefined/);
    }
  });
});

describe('transitionNeedsFairnessGate — where the gate applies', () => {
  it('gates production and NOTHING else', () => {
    expect(transitionNeedsFairnessGate('production')).toBe(true);
    // Canary is deliberately ungated: requiring an audit before a canary would mean auditing a model on no production
    // traffic, and the canary exists to GENERATE the data the audit needs. W088's ladder puts the gate at step three.
    expect(transitionNeedsFairnessGate('canary')).toBe(false);
    expect(transitionNeedsFairnessGate('shadow')).toBe(false);
    // And retiring is never gated: taking a model OUT of service must never be harder than leaving it in.
    expect(transitionNeedsFairnessGate('retired')).toBe(false);
  });
});

/* ================================================================================================ */
/* THE PROMOTION                                                                                     */
/* ================================================================================================ */

describe('assertPromotable — the eleventh maker-checker site', () => {
  const open: GateResult = { open: true, auditId: 'a1', maxGapPp: 1.2, auditedAt: '2026-07-31T08:00:00Z' };
  const ok = { currentStatus: 'canary', proposedStatus: 'production', proposedByAdminId: 'op1', approverAdminId: 'op2', gate: open };

  it('permits a clean second-person promotion through an open gate', () => {
    expect(() => assertPromotable(ok)).not.toThrow();
  });

  it('refuses self-approval', () => {
    expect(() => assertPromotable({ ...ok, approverAdminId: 'op1' })).toThrow(SecondPersonRequiredError);
  });

  it('refuses when nothing was proposed', () => {
    expect(() => assertPromotable({ ...ok, proposedStatus: null })).toThrow(/nothing has been proposed/);
  });

  it('REFUSES A PRODUCTION PROMOTION THROUGH A CLOSED GATE, BEFORE the two-person rule', () => {
    // Order matters for the operator: learn the model is unfair before being told to find a colleague. Being sent to
    // fetch somebody and only then discovering the promotion was never permissible is the sequence that gets a control
    // resented.
    try {
      assertPromotable({ ...ok, approverAdminId: 'op1', gate: { open: false, reason: 'never_audited' } });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(AiGovernanceRefusedError);
      expect(e).not.toBeInstanceOf(SecondPersonRequiredError);
      expect((e as AiGovernanceRefusedError).getResponse()).toMatchObject({
        message: expect.stringContaining('never had a fairness audit'),
      });
    }
  });

  it('refuses a production promotion when the gate was NOT EVALUATED', () => {
    // An unevaluated gate is not an open one. This is the branch that stops a caller reaching production by simply not
    // computing the check.
    expect(() => assertPromotable({ ...ok, gate: null })).toThrow(/not evaluated/);
  });

  it('does NOT require a gate for a canary promotion', () => {
    expect(() => assertPromotable({ ...ok, proposedStatus: 'canary', gate: null })).not.toThrow();
  });

  it('permits promotion when the MAKER IS UNRECORDED, deliberately', () => {
    // The shared helper's documented rule: refusing an unknown initiator means nobody can ever approve a backfilled row.
    // Two nulls must not compare equal — a mutation test on the scheme-version plane caught exactly that.
    expect(() => assertPromotable({ ...ok, proposedByAdminId: null })).not.toThrow();
  });
});

describe('canApprove — what the console DRAWS', () => {
  const open: GateResult = { open: true, auditId: 'a1', maxGapPp: 1, auditedAt: 'x' };
  it('is false with no proposal', () => {
    expect(canApprove({ proposedStatus: null, proposedByAdminId: 'a', viewerAdminId: 'b', gate: open })).toBe(false);
  });
  it('is false for the maker', () => {
    expect(canApprove({ proposedStatus: 'production', proposedByAdminId: 'a', viewerAdminId: 'a', gate: open })).toBe(false);
  });
  it('is false for production through a closed gate', () => {
    expect(canApprove({
      proposedStatus: 'production', proposedByAdminId: 'a', viewerAdminId: 'b',
      gate: { open: false, reason: 'never_audited' },
    })).toBe(false);
  });
  it('is TRUE for a canary with no gate at all', () => {
    expect(canApprove({ proposedStatus: 'canary', proposedByAdminId: 'a', viewerAdminId: 'b', gate: null })).toBe(true);
  });
});

/* ================================================================================================ */
/* THE MEASUREMENT                                                                                   */
/* ================================================================================================ */

const tally = (group: string, decisions: number, overridden: number): GroupTally => ({ group, decisions, overridden });

describe('measureSlice', () => {
  it('measures the gap between the best- and worst-served groups, in points', () => {
    // 10% vs 2% → 8pp. HIGHER override rate means the model served that group WORSE.
    const m = measureSlice([tally('kutch', 1000, 100), tally('anand', 1000, 20)]);
    expect(m.maxGapPp).toBe(8);
    expect(m.worst).toBe('kutch');
    expect(m.best).toBe('anand');
  });

  it('names WORST as the worst-SERVED group, not the largest number', () => {
    // An operator reading "worst: Kutch" needs that to be the district being let down. Naming this for the farmer's
    // experience rather than for the number's size is the whole reason the variables are named as they are.
    const m = measureSlice([tally('kutch', 500, 200), tally('anand', 500, 5)]);
    expect(m.worst).toBe('kutch');
  });

  it('EXCLUDES groups too small to compare, but reports the true smallest', () => {
    // A group of 3 with 1 override is 33% and is noise; including it would make the widest gap in every slice belong to
    // the smallest group, every time. `smallestGroup` still carries the truth, which is what makes `scoreAudit` return
    // `inconclusive` rather than a confident number computed off the survivors.
    const m = measureSlice([tally('a', 1000, 20), tally('b', 1000, 30), tally('tiny', 3, 1)]);
    expect(m.maxGapPp).toBe(1);
    expect(m.smallestGroup).toBe(3);
    expect(m.groups).toBe(3);
  });

  it('reports a zero gap with NO best/worst when only one group is comparable', () => {
    // One comparable group has nothing to be compared WITH. A gap of 0 alone would read as perfect parity across a slice
    // that was never compared — so `smallestGroup` is what carries the truth onward.
    const m = measureSlice([tally('a', 1000, 20), tally('tiny', 2, 0)]);
    expect(m.maxGapPp).toBe(0);
    expect(m.worst).toBeNull();
    expect(m.best).toBeNull();
    expect(m.smallestGroup).toBe(2);
  });

  it('handles an empty slice without pretending to have measured it', () => {
    expect(measureSlice([])).toEqual({ maxGapPp: 0, worst: null, best: null, groups: 0, smallestGroup: 0 });
  });

  it('rounds ONCE, after the subtraction', () => {
    // 33/1000 vs 8/1000 → 3.3% − 0.8% = 2.5pp. A pleasant case, and it proves nothing about WHERE the rounding happens:
    // both orders give 2.5. See the next test.
    const m = measureSlice([tally('a', 1000, 33), tally('b', 1000, 8)]);
    expect(m.maxGapPp).toBe(2.5);
  });

  it('rounds once in a case where rounding TWICE gives a different answer', () => {
    // 2/30 = 6.6667% and 1/30 = 3.3333%. Subtract first, then round: 3.33pp. Round each rate first, then subtract:
    // 6.67 − 3.33 = 3.34pp. A mutation that reordered them survived every case above, because every case above used
    // denominators whose rates round cleanly.
    //
    // WHY 0.01pp MATTERS HERE AND NOWHERE ELSE ON THIS SCREEN: this figure is compared against a policy limit with `>=`,
    // so a hundredth of a point is the difference between a model reaching production and being refused. Rounding twice
    // biases the gap UPWARD, which fails models that pass — the safe direction for a farmer and the wrong answer for the
    // platform, and either way not the number the policy is written about.
    //
    // 30 is exactly MIN_GROUP_FOR_COMPARISON, so both groups are compared rather than one being excluded.
    const m = measureSlice([tally('worse', 30, 2), tally('better', 30, 1)]);
    expect(m.maxGapPp).toBe(3.33);
    expect(m.maxGapPp).not.toBe(3.34);
  });

  it('the comparison floor is documented and load-bearing', () => {
    expect(MIN_GROUP_FOR_COMPARISON).toBe(30);
    const m = measureSlice([tally('a', 100, 1), tally('b', MIN_GROUP_FOR_COMPARISON - 1, 20)]);
    // The 29-decision group is excluded from the comparison, so no gap is reported despite a huge apparent difference.
    expect(m.maxGapPp).toBe(0);
  });
});

describe('buildSlices / sampleSize', () => {
  it('OMITS an empty slice rather than recording it as parity', () => {
    // `ck_afa_slices_present` refuses an empty object outright and `scoreAudit` returns inconclusive for one — both of
    // which are the truthful outcome, and neither reachable if absence is silently written as a zero gap.
    const s = buildSlices({ tenant: [tally('a', 100, 5), tally('b', 100, 6)], subject: [] });
    expect(Object.keys(s)).toEqual(['tenant']);
  });

  it('takes the MAXIMUM across slices as the sample size, never the sum', () => {
    // The same inference appears in every slice, so summing would report an audit over 400 decisions as one over 1,200 and
    // make a thin audit look substantial.
    const n = sampleSize({
      tenant: [tally('a', 200, 1), tally('b', 200, 1)],
      subject: [tally('listing', 400, 2)],
    });
    expect(n).toBe(400);
  });

  it('names the canon slices it cannot yet measure, each with a reason', () => {
    // Three real slices with the canon's absences named, rather than three labelled with the canon's names and computed
    // from something else.
    expect([...AVAILABLE_SLICES]).toEqual(['tenant', 'subject', 'confidence_band']);
    const names = CANON_SLICES_NOT_YET_MEASURABLE.map((s) => s.slice);
    expect(names).toContain('district');
    expect(names).toContain('gender');
    for (const s of CANON_SLICES_NOT_YET_MEASURABLE) expect(s.reason.length).toBeGreaterThan(20);
  });

  it('states the proxy basis and its biases, worst first', () => {
    expect(PROXY_BASIS).toBe('human_override_rate_per_group');
    // The first caveat is the one that could make the measure systematically wrong in the direction that matters, and a
    // reader who stops after one sentence must get that one.
    expect(PROXY_CAVEATS[0]).toBe('under_review_looks_like_accuracy');
  });
});

describe('legacyAuditShape — what the old column actually holds', () => {
  it('identifies the unwired job\'s output as a USAGE ROLLUP, not an audit', () => {
    const s = legacyAuditShape({ window: '30d', total: 4000, overridden: 200, lowConfidence: 30, overrideRate: 0.05 });
    expect(s).toMatchObject({ kind: 'usage_rollup', overrideRate: 0.05, total: 4000 });
  });
  it('recognises a hand-written audit that does have slices', () => {
    expect(legacyAuditShape({ slices: { district: {} }, verdict: 'pass' }))
      .toEqual({ kind: 'has_slices', sliceNames: ['district'] });
  });
  it('reads null, undefined and an empty object as absent', () => {
    for (const v of [null, undefined, {}]) expect(legacyAuditShape(v)).toEqual({ kind: 'absent' });
  });
  it('reads an unfamiliar shape as unrecognised rather than mislabelling it', () => {
    expect(legacyAuditShape({ somethingNew: 1 })).toEqual({ kind: 'unrecognised' });
  });
});

/* ================================================================================================ */
/* THE REVIEW QUEUE                                                                                  */
/* ================================================================================================ */

const kase = (o: Partial<CaseRow> = {}): CaseRow => ({
  id: 'c1', tenantId: 't1', inferenceId: '42', queueKind: 'fraud_flag', priority: 10, status: 'pending',
  reviewerUserId: null, reviewerAdminId: null, claimedAt: null, decisionNote: null, resolvedAt: null,
  createdAt: '2026-08-06T22:00:00Z', ...o,
});

describe('triageOrder', () => {
  it('sorts by priority, then OLDEST FIRST', () => {
    // The opposite of nearly every other list in this console, and the same choice ADMIN-5f made on moderation reports:
    // here age is harm, because a fraud_flag case holds a farmer's listing off the market while it waits.
    const out = triageOrder([
      kase({ id: 'new', priority: 10, createdAt: '2026-08-07T09:00:00Z' }),
      kase({ id: 'old', priority: 10, createdAt: '2026-08-07T08:00:00Z' }),
      kase({ id: 'low', priority: 100, createdAt: '2026-08-01T00:00:00Z' }),
    ]);
    expect(out.map((c) => c.id)).toEqual(['old', 'new', 'low']);
  });
  it('sorts an unreadable date LAST, not first', () => {
    // First would put a corrupt row at the top of the queue on every read, and the desk would work around the screen
    // instead of the row being noticed.
    const out = triageOrder([kase({ id: 'bad', createdAt: 'nope' }), kase({ id: 'good' })]);
    expect(out.map((c) => c.id)).toEqual(['good', 'bad']);
  });
});

describe('claimState', () => {
  it('is claimable when pending', () => {
    expect(claimState(kase(), 'op1', NOW)).toEqual({ kind: 'claimable' });
  });
  it('is held_by_you for your own fresh claim', () => {
    expect(claimState(kase({ status: 'in_review', reviewerAdminId: 'op1', claimedAt: new Date(NOW - 60_000).toISOString() }), 'op1', NOW))
      .toEqual({ kind: 'held_by_you' });
  });
  it('is held_by_other for somebody else\'s fresh claim', () => {
    expect(claimState(kase({ status: 'in_review', reviewerAdminId: 'op2', claimedAt: new Date(NOW - 60_000).toISOString() }), 'op1', NOW).kind)
      .toBe('held_by_other');
  });
  it('is a STALE CLAIM once the hold has aged out', () => {
    // W083 is right that cases are single-owner, and it needs an escape or a reviewer who claims a fraud case and closes
    // their laptop holds a farmer's listing off the market indefinitely.
    const old = new Date(NOW - CLAIM_STALE_AFTER_MS - 1).toISOString();
    expect(claimState(kase({ status: 'in_review', reviewerAdminId: 'op2', claimedAt: old }), 'op1', NOW).kind)
      .toBe('stale_claim');
  });
  it('treats a MISSING claim time as stale, which unblocks the pre-existing backlog', () => {
    // Every case that reached `in_review` before 0115 has no `claimed_at` at all. Reading those as permanently held would
    // make the whole existing in_review backlog untouchable for ever.
    expect(claimState(kase({ status: 'in_review', reviewerAdminId: 'op2', claimedAt: null }), 'op1', NOW).kind)
      .toBe('stale_claim');
  });
  it('reports a decided case as decided', () => {
    expect(claimState(kase({ status: 'accepted' }), 'op1', NOW)).toEqual({ kind: 'already_decided', status: 'accepted' });
  });
});

describe('assertClaimable / assertDecidable', () => {
  it('refuses to re-open a decided case', () => {
    expect(() => assertClaimable(kase({ status: 'rejected' }), 'op1', NOW)).toThrow(/already rejected/);
  });
  it('refuses to take a case somebody else holds', () => {
    const fresh = new Date(NOW - 60_000).toISOString();
    expect(() => assertClaimable(kase({ status: 'in_review', reviewerAdminId: 'op2', claimedAt: fresh }), 'op1', NOW))
      .toThrow(/single-owner/);
  });
  it('REFUSES A DECISION ON AN UNCLAIMED CASE', () => {
    // `pending` → `accepted` in one step would mean nobody was ever recorded as holding the case, which is the
    // single-owner rule defeated by skipping a step rather than by breaking one.
    expect(() => assertDecidable({ status: 'pending', note: 'x'.repeat(30), decision: 'accept' }))
      .toThrow(/take the case first/i);
  });
  it('requires a real reasoning note', () => {
    expect(DECISION_NOTE_MIN).toBe(20);
    expect(() => assertDecidable({ status: 'in_review', note: 'no', decision: 'reject' })).toThrow(/20 characters/);
    // Trimmed, so whitespace does not buy a reason.
    expect(() => assertDecidable({ status: 'in_review', note: `${' '.repeat(40)}bad`, decision: 'reject' }))
      .toThrow(/20 characters/);
  });
});

describe('buildDecision', () => {
  it('REJECT marks the inference overridden and ACCEPT does not', () => {
    // Getting this backwards would invert every figure on the fairness board and make a well-behaved model look like a
    // failing one, which is why it is data rather than a conditional in a service.
    expect(OVERRIDES_INFERENCE).toEqual({ accept: false, reject: true });
    expect(buildDecision('reject', 'the model was wrong about this')).toMatchObject({ status: 'rejected', marksOverridden: true });
    expect(buildDecision('accept', 'the model was right about this')).toMatchObject({ status: 'accepted', marksOverridden: false });
  });
  it('trims the note', () => {
    expect(buildDecision('accept', '  a properly long reasoning note  ').note).toBe('a properly long reasoning note');
  });
});

describe('census / holdsListings', () => {
  it('reports the oldest pending age, and NULL for an empty queue', () => {
    // Zero would read as "a case arrived this second", the opposite of "there is nothing waiting" — and on a screen whose
    // job is to say whether humans are keeping up, those must not render alike.
    expect(census([], NOW).oldestPendingMinutes).toBeNull();
    const c = census([kase({ createdAt: new Date(NOW - 22 * 60_000).toISOString() })], NOW);
    expect(c.oldestPendingMinutes).toBe(22);
    expect(c.pending).toBe(1);
  });
  it('ignores an unreadable created_at when finding the oldest', () => {
    const c = census([kase({ createdAt: 'nope' })], NOW);
    expect(c.pending).toBe(1);
    expect(c.oldestPendingMinutes).toBeNull();
  });
  it('counts only OPEN cases by kind', () => {
    const c = census([kase(), kase({ id: 'd', status: 'accepted', queueKind: 'price_anomaly' })], NOW);
    expect(c.byKind).toEqual({ fraud_flag: 1 });
  });
  it('counts the kinds that hold a listing off the market', () => {
    expect(holdsListings({ fraud_flag: 3, low_confidence_grade: 2, price_anomaly: 9 })).toBe(5);
  });
  it('drift is in the vocabulary because the drift job inserts it', () => {
    // `drift-watch.job.ts` writes `queue_kind = 'drift'` and is itself dead code (ADMIN-7-Q2) — a union omitting it would
    // break that job the day somebody wires it, which is the more likely order of events.
    expect([...CASE_KINDS]).toContain('drift');
  });
});

/* ================================================================================================ */
/* THE ROLLOUT                                                                                       */
/* ================================================================================================ */

describe('evaluateGates', () => {
  it('passes a mature, well-behaved canary', () => {
    const g = evaluateGates({ decisions: 1000, overridden: 30, ageDays: 20 });
    expect(g.shadowDuration.kind).toBe('pass');
    expect(g.overrideRate.kind).toBe('pass');
    expect(g.measurablePass).toBe(true);
  });
  it('fails a canary humans correct too often', () => {
    const g = evaluateGates({ decisions: 1000, overridden: 100, ageDays: 20 });
    expect(g.overrideRate).toMatchObject({ kind: 'fail', limit: CANARY_MAX_OVERRIDE_RATE });
    expect(g.measurablePass).toBe(false);
  });
  it('reports too little data as INSUFFICIENT, never as a pass', () => {
    const g = evaluateGates({ decisions: MIN_CANARY_SAMPLE - 1, overridden: 0, ageDays: 20 });
    expect(g.overrideRate.kind).toBe('insufficient');
    expect(g.measurablePass).toBe(false);
  });
  it('does not read an unknowable age as a mature model', () => {
    const g = evaluateGates({ decisions: 1000, overridden: 10, ageDays: NaN });
    expect(g.shadowDuration.kind).toBe('insufficient');
  });
  it('ALWAYS carries the metrics nothing measures', () => {
    // W088 lists MAPE, accuracy, p95 latency and a district gap; this platform records none. Shown rather than omitted,
    // because omitting them would hide that the canon asked — and never as ticks.
    const g = evaluateGates({ decisions: 1000, overridden: 10, ageDays: 20 });
    expect(g.unmeasured.map((u) => u.metric)).toEqual(UNMEASURED_METRICS.map((u) => u.metric));
    for (const u of g.unmeasured) expect(u.why.length).toBeGreaterThan(15);
  });
  it('the shadow floor is two weekly cycles', () => {
    expect(MIN_SHADOW_DAYS).toBe(14);
  });
});

describe('promotionAdvice', () => {
  it('blocks on a failing override rate, with the numbers in the sentence', () => {
    const a = promotionAdvice(evaluateGates({ decisions: 1000, overridden: 200, ageDays: 30 }));
    expect(a.advice).toBe('blocked');
    expect((a as { reason: string }).reason).toMatch(/20\.0%/);
  });
  it('blocks on too little data — promoting on noise', () => {
    const a = promotionAdvice(evaluateGates({ decisions: 10, overridden: 0, ageDays: 30 }));
    expect(a).toMatchObject({ advice: 'blocked' });
    expect((a as { reason: string }).reason).toMatch(/noise/);
  });
  it('blocks on an immature model', () => {
    const a = promotionAdvice(evaluateGates({ decisions: 1000, overridden: 10, ageDays: 3 }));
    expect((a as { reason: string }).reason).toMatch(/weekly cycles/);
  });
  it('proceeds WITH CAVEATS when the measurable gates pass', () => {
    // The unmeasured gates do NOT block: blocking on a metric the platform cannot compute would make production
    // unreachable for ever, which in practice means somebody eventually removes the check. What blocks is the fairness
    // gate, which is measurable and which the canon calls hard.
    const a = promotionAdvice(evaluateGates({ decisions: 1000, overridden: 10, ageDays: 30 }));
    expect(a.advice).toBe('proceed_with_caveats');
    expect((a as { unmeasured: string[] }).unmeasured).toContain('mape');
  });
});

describe('rollbackSignal', () => {
  it('fires above the ceiling', () => {
    expect(rollbackSignal({ decisions: 1000, overridden: 150 }))
      .toMatchObject({ fires: true, limit: ROLLBACK_OVERRIDE_RATE });
  });
  it('does NOT fire on a thin sample', () => {
    // A canary with 12 decisions and 2 overrides is at 16.7% and is noise; letting that arm the rollback would make a new
    // canary snap back on its first afternoon.
    expect(rollbackSignal({ decisions: 12, overridden: 2 }))
      .toMatchObject({ fires: false, reason: 'insufficient_sample' });
  });
  it('does not fire exactly AT the ceiling', () => {
    // `>` and not `>=` here, deliberately opposite to the fairness gap: a rollback is an automatic action against a model
    // that may be fine, so the tie goes to not acting. The fairness gate protects a farmer from a model; this protects a
    // model from a twitchy threshold.
    expect(rollbackSignal({ decisions: 1000, overridden: 100 }).fires).toBe(false);
  });
});

describe('the canary ladder', () => {
  it('is a fixed ladder', () => {
    expect([...CANARY_STEPS]).toEqual([10, 50]);
    expect(nextCanaryStep(null)).toBe(10);
    expect(nextCanaryStep(10)).toBe(50);
    // NULL at the top: production is not a canary step, and offering 100% would let an operator reach production without
    // the fairness gate the production transition carries.
    expect(nextCanaryStep(50)).toBeNull();
  });
  it('offers the bottom rung from a share nobody set through the ladder', () => {
    expect(nextCanaryStep(37)).toBe(10);
  });
  it('refuses an arbitrary share', () => {
    expect(() => assertCanaryStep(37)).toThrow(/fixed steps/);
    expect(() => assertCanaryStep(10)).not.toThrow();
  });
});

describe('reviewLoadDelta / capacityVerdict — W087\'s real half', () => {
  const hist = [{ floor: 0.7, count: 100 }, { floor: 0.8, count: 412 }, { floor: 0.9, count: 900 }];

  it('counts the decisions that change side when a threshold rises', () => {
    expect(reviewLoadDelta(hist, 0.8, 0.9)).toEqual({ perWindow: 412, direction: 'more' });
  });
  it('reports the direction when a threshold falls', () => {
    expect(reviewLoadDelta(hist, 0.9, 0.8)).toEqual({ perWindow: 412, direction: 'fewer' });
  });
  it('returns NULL for an empty histogram, not zero', () => {
    // "This change adds no cases" and "we have no data to say" are opposite statements, and a threshold raised on the
    // first when the second is true is how a review desk silently falls behind on farmers' listings.
    expect(reviewLoadDelta([], 0.8, 0.9)).toBeNull();
  });
  it('returns NULL when there is no current threshold to compare against', () => {
    expect(reviewLoadDelta(hist, null, 0.9)).toBeNull();
  });
  it('UNKNOWN CAPACITY IS NOT INFINITE CAPACITY', () => {
    expect(capacityVerdict(412, null)).toBe('unknown');
    expect(capacityVerdict(412, NaN)).toBe('unknown');
    expect(capacityVerdict(412, 380)).toBe('exceeds');
    expect(capacityVerdict(412, 500)).toBe('fits');
  });
});
