// apps/admin-api/src/modules/ai-models-ops/domain/rollout.ts · W088 + W087's threshold half, PURE (PC-56 ADMIN-7).
//
// W088's ladder: shadow (14d) → canary 10% → fairness gate → production, with "each gate has hard criteria" and
// "regression auto-rolls back to v2.0".
//
// WHAT EXISTED: `ai_models.status` as a bare varchar with a four-value comment and a state machine allowing every
// transition between them. No traffic share (so "canary 10%" on four screens was a number in a mockup — nothing stored a
// split and nothing read one), no shadow-duration requirement, no gate criteria, no rollback record, no checker.
//
// WHAT IS HONESTLY BUILDABLE, AND WHERE THE LINE IS. The gates that read the INFERENCE LOG are real: override rate and
// sample size are both in `ai_inferences`, which is populated. The gates that read MODEL QUALITY are not: MAPE, accuracy
// and p95 latency appear on W088 and none of them is recorded anywhere — there is no labelled eval set (see
// `slice-measurement.ts`) and no latency histogram per model. So this module computes the gates it can and REPORTS THE
// OTHERS AS UNMEASURED rather than defaulting them to pass. A rollout wizard that showed four green ticks over two real
// measurements would be the exact defect this programme keeps finding.
import { AiGovernanceRefusedError } from './ai-models.errors';

/** W088: "Shadow (14d)". A model must log against production traffic for two weeks before it may carry any.
 *
 *  Fourteen days and not seven, because the point is to see a WEEKLY cycle twice — mandi days, weekend listing patterns,
 *  a festival — and one week cannot distinguish a model that is stable from one that happened to have a quiet week.
 */
export const MIN_SHADOW_DAYS = 14;

/** The canary ladder. W088 steps 10% → 50% → production, and these are the only shares the console offers.
 *
 *  A fixed ladder rather than a free number, deliberately: an operator typing 37% is making an unreviewable decision, and
 *  the value of a canary is comparing like with like across models and weeks. */
export const CANARY_STEPS = Object.freeze([10, 50] as const);

/** The override-rate ceiling for a canary to advance. W088's gate is "Override rate — pass ≤7.5%", which is the
 *  production model's own current rate: a candidate must be no worse than the thing it replaces. Expressed as a fraction
 *  because that is how `ai_inferences` aggregates. */
export const CANARY_MAX_OVERRIDE_RATE = 0.075;

/** W088's auto-rollback trigger: "if canary MAPE exceeds 8% or override rate exceeds 10% over any 6h window, traffic
 *  snaps back". MAPE is unmeasurable here, so the override half is what arms. */
export const ROLLBACK_OVERRIDE_RATE = 0.10;
export const ROLLBACK_WINDOW_HOURS = 6;

/** The smallest number of canary decisions before an override rate means anything. Same reasoning as the fairness
 *  slices' group floor: a canary with 12 decisions and 2 overrides is at 16.7% and is noise, and letting that arm the
 *  rollback would make a new canary snap back on its first afternoon. */
export const MIN_CANARY_SAMPLE = 200;

export type GateStatus =
  | { kind: 'pass'; value: number }
  | { kind: 'fail'; value: number; limit: number }
  /** Too little data to say. Not a pass — the whole point. */
  | { kind: 'insufficient'; have: number; need: number }
  /** The platform does not record this metric at all. Reported by NAME so the screen can show W088's row and say plainly
   *  that nothing measures it, instead of omitting the row (which hides that the canon asked for it) or showing a tick
   *  (which is a lie). */
  | { kind: 'unmeasured'; metric: string; why: string };

export interface CanaryEvidence {
  decisions: number;
  overridden: number;
  /** Days since the model was registered — the shadow-duration proxy. `ai_models` records no `shadow_started_at`, so
   *  `created_at` is what there is, and it is honest for the ordinary case (a model registered as shadow) and generous
   *  for a model registered straight into canary. Named as ADMIN-7-Q5. */
  ageDays: number;
}

export interface RolloutGates {
  shadowDuration: GateStatus;
  overrideRate: GateStatus;
  /** Every metric W088 shows that this platform cannot compute. */
  unmeasured: Array<{ metric: string; why: string }>;
  /** True only when every MEASURABLE gate passes. A screen must not read this as "ready" on its own — `unmeasured` is
   *  the other half of the sentence, and `promotionAdvice` below joins them. */
  measurablePass: boolean;
}

export const UNMEASURED_METRICS = Object.freeze([
  { metric: 'mape', why: 'no labelled eval set exists, so prediction error cannot be computed (ADMIN-7-Q3)' },
  { metric: 'accuracy', why: 'no labelled ground truth per decision (ADMIN-7-Q3)' },
  { metric: 'p95_latency', why: 'inference latency is not recorded on ai_inferences' },
  { metric: 'fairness_district_gap', why: 'district needs a region join that differs per subject_type (ADMIN-7-Q4)' },
]);

export function evaluateGates(e: CanaryEvidence): RolloutGates {
  const shadowDuration: GateStatus = !Number.isFinite(e.ageDays)
    // An unknowable age is `insufficient`, never a pass. `Number.isFinite` first for the reason it is always first here:
    // NaN loses every comparison silently, so a bare `>=` would read an unreadable registration date as a mature model.
    ? { kind: 'insufficient', have: 0, need: MIN_SHADOW_DAYS }
    : e.ageDays >= MIN_SHADOW_DAYS
      ? { kind: 'pass', value: e.ageDays }
      : { kind: 'insufficient', have: e.ageDays, need: MIN_SHADOW_DAYS };

  let overrideRate: GateStatus;
  if (e.decisions < MIN_CANARY_SAMPLE) {
    overrideRate = { kind: 'insufficient', have: e.decisions, need: MIN_CANARY_SAMPLE };
  } else {
    const rate = e.overridden / e.decisions;
    overrideRate = rate <= CANARY_MAX_OVERRIDE_RATE
      ? { kind: 'pass', value: rate }
      : { kind: 'fail', value: rate, limit: CANARY_MAX_OVERRIDE_RATE };
  }

  return {
    shadowDuration,
    overrideRate,
    unmeasured: [...UNMEASURED_METRICS],
    measurablePass: shadowDuration.kind === 'pass' && overrideRate.kind === 'pass',
  };
}

/** What the console should tell an operator about promoting.
 *
 *  THE UNMEASURED GATES DO NOT BLOCK, and that is a judgement worth defending. Blocking on a metric the platform cannot
 *  compute would make production unreachable for ever, which in practice means somebody eventually removes the check —
 *  and a control that gets removed is worse than one that was never claimed. What blocks is the FAIRNESS gate, which is
 *  measurable and is the one the canon calls hard. The unmeasured metrics are named on screen at the moment of decision,
 *  so the operator approves knowing exactly what nobody checked.
 */
export type PromotionAdvice =
  | { advice: 'blocked'; reason: string }
  | { advice: 'proceed_with_caveats'; unmeasured: string[] }
  | { advice: 'proceed' };

export function promotionAdvice(g: RolloutGates): PromotionAdvice {
  if (g.overrideRate.kind === 'fail') {
    return {
      advice: 'blocked',
      reason: `humans are correcting this candidate ${(g.overrideRate.value * 100).toFixed(1)}% of the time, above the `
        + `${(g.overrideRate.limit * 100).toFixed(1)}% ceiling — it is performing worse than the model it would replace`,
    };
  }
  if (g.overrideRate.kind === 'insufficient') {
    return {
      advice: 'blocked',
      reason: `only ${g.overrideRate.have} canary decisions so far, against ${g.overrideRate.need} needed before an `
        + 'override rate means anything. Promoting now would be promoting on noise.',
    };
  }
  if (g.shadowDuration.kind !== 'pass') {
    const have = g.shadowDuration.kind === 'insufficient' ? g.shadowDuration.have : 0;
    return {
      advice: 'blocked',
      reason: `this model has ${have} days of logged traffic against ${MIN_SHADOW_DAYS} required — two weekly cycles, so `
        + 'a quiet week cannot be mistaken for a stable model',
    };
  }
  if (g.unmeasured.length > 0) {
    return { advice: 'proceed_with_caveats', unmeasured: g.unmeasured.map((u) => u.metric) };
  }
  return { advice: 'proceed' };
}

/** Does this canary's recent behaviour arm the auto-rollback?
 *
 *  RETURNS THE DECISION, AND NOTHING HERE PERFORMS IT. W088 says rollbacks are "automatic" and "never silent", and
 *  automatic means a scheduled job — which does not exist. So the console reports that the rollback is ARMED BY POLICY
 *  AND NOT BY ANY RUNNING CODE, which is the honest state, and the executor is ADMIN-7-Q6. Claiming an automatic
 *  rollback that no process performs would be a status recording an act nobody does, for the fifth time on this platform.
 */
export type RollbackSignal =
  | { fires: false; reason: 'insufficient_sample'; have: number; need: number }
  | { fires: false; reason: 'within_limits'; rate: number }
  | { fires: true; rate: number; limit: number };

export function rollbackSignal(e: { decisions: number; overridden: number }): RollbackSignal {
  if (e.decisions < MIN_CANARY_SAMPLE) {
    return { fires: false, reason: 'insufficient_sample', have: e.decisions, need: MIN_CANARY_SAMPLE };
  }
  const rate = e.overridden / e.decisions;
  return rate > ROLLBACK_OVERRIDE_RATE
    ? { fires: true, rate, limit: ROLLBACK_OVERRIDE_RATE }
    : { fires: false, reason: 'within_limits', rate };
}

/** The next rung. Returns null at the top of the ladder — production is not a canary step, and offering "100%" as one
 *  would let an operator reach production without the fairness gate the production transition carries. */
export function nextCanaryStep(current: number | null): number | null {
  if (current === null) return CANARY_STEPS[0];
  const i = CANARY_STEPS.indexOf(current as 10 | 50);
  if (i < 0) {
    // A share nobody set through this ladder. Advancing from it would be guessing what the operator meant, so the
    // console offers the bottom rung and the audit trail shows the correction.
    return CANARY_STEPS[0];
  }
  return i + 1 < CANARY_STEPS.length ? CANARY_STEPS[i + 1] : null;
}

export function assertCanaryStep(pct: number): void {
  if (!(CANARY_STEPS as readonly number[]).includes(pct)) {
    throw new AiGovernanceRefusedError(
      `canary traffic is set in fixed steps (${CANARY_STEPS.join('%, ')}%), not as an arbitrary share — a rung nobody `
      + 'else has used cannot be compared with anything.');
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* W087's THRESHOLD HALF                                                                             */
/* ------------------------------------------------------------------------------------------------ */

/** W087: "Raising photo_grading to 0.82 adds ≈412 cases/day to the review queue — confirm reviewer capacity (current
 *  headroom: 380/day) or stage the change."
 *
 *  THIS IS THE PART OF W087 THAT IS REAL. The prompt store is DELTA-020 and does not exist (the canon's own banner says
 *  so), but the threshold does live on `ai_models` and the review-load consequence IS computable from the confidence
 *  distribution in `ai_inferences` — which is the whole substance of that screen: a threshold edit changes WHO GETS
 *  HUMAN REVIEW, and an operator who cannot see that number is choosing blind.
 *
 *  Takes a confidence histogram (bucket floor → count over the window) and returns how many decisions move across.
 *  Returns null rather than 0 when the histogram is empty: "this change adds no cases" and "we have no data to say" are
 *  opposite statements, and a threshold raised on the strength of the first when the second is true is exactly how a
 *  review desk gets swamped.
 */
export function reviewLoadDelta(
  histogram: readonly { floor: number; count: number }[],
  from: number | null,
  to: number,
): { perWindow: number; direction: 'more' | 'fewer' | 'none' } | null {
  if (histogram.length === 0) return null;
  if (from === null) return null;   // no current threshold means no delta to compute, only an absolute count
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  // Buckets whose floor sits in [lo, hi) are the decisions that change side. A bucket straddling the boundary is counted
  // whole, which OVERSTATES the delta — chosen deliberately, because the failure mode of understating it is a review
  // desk that silently falls behind on farmers' listings.
  const moved = histogram.filter((b) => b.floor >= lo && b.floor < hi).reduce((a, b) => a + b.count, 0);
  if (moved === 0) return { perWindow: 0, direction: 'none' };
  return { perWindow: moved, direction: to > from ? 'more' : 'fewer' };
}

/** Is there room for the extra cases? `headroom` is what the desk can absorb per day.
 *
 *  UNKNOWN HEADROOM IS NOT INFINITE HEADROOM. There is no reviewer-capacity record on this platform, so headroom is
 *  supplied by the operator or it is unknown — and unknown returns `unknown`, which the console renders as a caution
 *  rather than as a clearance. W087 shows a headroom figure; where it comes from is ADMIN-7-Q7.
 */
export function capacityVerdict(delta: number, headroom: number | null): 'fits' | 'exceeds' | 'unknown' {
  if (headroom === null || !Number.isFinite(headroom)) return 'unknown';
  return delta <= headroom ? 'fits' : 'exceeds';
}
