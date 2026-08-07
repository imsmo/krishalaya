// apps/admin-api/src/modules/ai-models-ops/domain/slice-measurement.ts · PURE (PC-56 ADMIN-7).
//
// ---------------------------------------------------------------------------
// THE ACCURACY PROXY, STATED HONESTLY, BECAUSE IT IS THE WEAKEST LINK IN THE WHOLE GATE
// ---------------------------------------------------------------------------
// A fairness audit needs per-group ACCURACY. Accuracy needs labels — ground truth about what the right answer was. **This
// platform has no labelled eval set per slice.** W081 says so in its own empty state: "Shadow models accumulate labelled
// comparisons before any metric shows", and there is no table of labelled comparisons anywhere in the schema.
//
// What the platform DOES have is `ai_inferences.was_overridden`: every case where a human looked at a decision and
// changed it. So the proxy is the HUMAN-CORRECTION RATE per group, and the difference in that rate between the
// best-served and worst-served group is what `maxGapPp` measures.
//
// THIS IS A PROXY AND THE CONSOLE SAYS SO IN WORDS. Its two known biases, both stated on screen rather than buried here:
//   • IT UNDER-COUNTS. A wrong decision nobody reviewed is invisible to it. If a district's cases are reviewed less
//     often — a smaller tenant, fewer reviewers, a language the desk does not read — that district looks BETTER, not
//     worse. The measure is least reliable exactly where under-service is most likely, which is the opposite of what a
//     fairness measure should do.
//   • IT CONFLATES MODEL ERROR WITH REVIEWER BEHAVIOUR. Two reviewers with different thresholds produce different
//     override rates on identical model output.
// A proxy with named biases is worth having; a proxy presented as accuracy is not. `PROXY_BASIS` below is exported so
// every screen that prints a gap can print what the gap is made of, and ADMIN-7-Q3 is the labelled eval store that would
// let this be replaced rather than caveated.
//
// The alternative was to build nothing until labels exist. That was rejected: the gate has to refuse an unaudited model
// TODAY, and "we cannot measure fairness perfectly" is not a reason to keep promoting models with no measurement at all.

export const PROXY_BASIS = 'human_override_rate_per_group' as const;

export const PROXY_CAVEATS = Object.freeze([
  // Ordered worst-first: the first one is the reason this measure could be systematically wrong in the direction that
  // matters, and a reader who stops after one sentence should get that one.
  'under_review_looks_like_accuracy',
  'reviewer_threshold_variance',
  'no_labelled_ground_truth',
]);

/** One group within a slice — a district, a language, a phone tier. */
export interface GroupTally {
  group: string;
  decisions: number;
  overridden: number;
}

export interface SliceMeasurement {
  maxGapPp: number;
  worst: string | null;
  best: string | null;
  groups: number;
  smallestGroup: number;
}

/** Groups smaller than this are EXCLUDED from the gap comparison but still reported in `smallestGroup`.
 *
 *  A group of 3 decisions with 1 override is a 33% rate and means nothing; including it would make the widest gap in
 *  every slice belong to the smallest group, every time. The exclusion is not a way of hiding them — `smallestGroup`
 *  carries the true minimum, which is what makes `scoreAudit` return `inconclusive`, so a slice full of tiny groups
 *  reports "we cannot tell" rather than a confident number computed off the survivors.
 */
export const MIN_GROUP_FOR_COMPARISON = 30;

/** Measure one slice from its group tallies.
 *
 *  Rates are computed in percentage POINTS to two decimals. The subtraction happens ONCE at the end, on the two extreme
 *  rates, rather than accumulating — and the rounding is applied after the subtraction so a 4.996pp gap does not become
 *  a 5.00pp failure through two independent roundings.
 */
export function measureSlice(tallies: readonly GroupTally[]): SliceMeasurement {
  if (tallies.length === 0) {
    return { maxGapPp: 0, worst: null, best: null, groups: 0, smallestGroup: 0 };
  }
  const smallestGroup = tallies.reduce((m, t) => (t.decisions < m ? t.decisions : m), Number.POSITIVE_INFINITY);

  const comparable = tallies.filter((t) => t.decisions >= MIN_GROUP_FOR_COMPARISON);
  if (comparable.length < 2) {
    // One comparable group has nothing to be compared WITH. A gap of 0 here would read as perfect parity across a slice
    // that was never actually compared, so `smallestGroup` is what carries the truth to `scoreAudit`.
    return {
      maxGapPp: 0,
      worst: null,
      best: null,
      groups: tallies.length,
      smallestGroup: Number.isFinite(smallestGroup) ? smallestGroup : 0,
    };
  }

  let worstRate = -1; let worst: string | null = null;
  let bestRate = Number.POSITIVE_INFINITY; let best: string | null = null;
  for (const t of comparable) {
    // A HIGHER override rate means the model served that group WORSE — humans had to correct it more often. Naming the
    // variables for the farmer's experience rather than for the number's size is deliberate: `worst` on this screen must
    // mean "worst served", and an operator reading "worst: Kutch" needs that to be the district being let down.
    const rate = (t.overridden / t.decisions) * 100;
    if (rate > worstRate) { worstRate = rate; worst = t.group; }
    if (rate < bestRate) { bestRate = rate; best = t.group; }
  }

  return {
    maxGapPp: Math.round((worstRate - bestRate) * 100) / 100,
    worst,
    best,
    groups: tallies.length,
    smallestGroup: Number.isFinite(smallestGroup) ? smallestGroup : 0,
  };
}

/** The slice set W085 names: "district · phone tier · crop", "language · gender · age band", "district · tenant size ·
 *  role".
 *
 *  WHAT THE PLATFORM CAN ACTUALLY SLICE BY TODAY is narrower than that list, and the difference is not glossed. Every
 *  slice here is derivable from `ai_inferences` joined to tables that exist:
 *    `tenant`   — `ai_inferences.tenant_id`. Available always, and the closest available stand-in for geography, since a
 *                 tenant is an FPO or a union with a district-shaped footprint. Not the same as district, and labelled as
 *                 tenant rather than dressed up as one.
 *    `subject`  — `subject_type`. Whether the model serves listings worse than disputes.
 *    `confidence_band` — self-reported confidence, decile-bucketed. The one slice that needs no join, and the one that
 *                 catches a model that is confidently wrong.
 *  GENDER, AGE BAND, PHONE TIER AND DISTRICT ARE NOT HERE, and each is absent for its own reason: district needs the
 *  region join through the subject (a listing's region, a dispute's parties — a different path per subject type, which is
 *  ADMIN-7-Q4); gender and age band are protected attributes whose processing needs the DPO sign-off the audit table now
 *  has a column for, and inventing that consent inside a build wave would be precisely backwards.
 *  So the audit ships with three real slices and says which of the canon's it cannot yet measure — rather than three
 *  labelled with the canon's names and computed from something else.
 */
export const AVAILABLE_SLICES = Object.freeze(['tenant', 'subject', 'confidence_band'] as const);
export type AvailableSlice = (typeof AVAILABLE_SLICES)[number];

export const CANON_SLICES_NOT_YET_MEASURABLE = Object.freeze([
  { slice: 'district', reason: 'needs a region join that differs per subject_type (ADMIN-7-Q4)' },
  { slice: 'phone_tier', reason: 'device tier is not recorded against an inference' },
  { slice: 'gender', reason: 'a protected attribute; processing it for audit needs DPO sign-off first' },
  { slice: 'age_band', reason: 'a protected attribute; processing it for audit needs DPO sign-off first' },
  { slice: 'crop', reason: 'the product is in the subject, not the inference; same join problem as district' },
]);

/** Assemble the audit's `slices` payload from per-slice tallies. */
export function buildSlices(
  tallies: Readonly<Partial<Record<AvailableSlice, readonly GroupTally[]>>>,
): Record<string, SliceMeasurement> {
  const out: Record<string, SliceMeasurement> = {};
  for (const name of AVAILABLE_SLICES) {
    const t = tallies[name];
    // A slice with no rows is OMITTED rather than recorded as a zero-gap measurement. `ck_afa_slices_present` refuses an
    // empty object outright, and `scoreAudit` returns `inconclusive` for one — both of which are the truthful outcome for
    // an audit that found no data, and neither of which is reachable if absence is silently written as parity.
    if (!t || t.length === 0) continue;
    out[name] = measureSlice(t);
  }
  return out;
}

/** Total decisions the audit looked at, across every group of every slice's widest tally.
 *
 *  Taken as the MAXIMUM over slices rather than the sum: the same inference appears in every slice, so summing would
 *  report an audit over 400 decisions as one over 1,200 and make a thin audit look substantial. The maximum is the
 *  honest denominator because each slice partitions the same population.
 */
export function sampleSize(tallies: Readonly<Partial<Record<AvailableSlice, readonly GroupTally[]>>>): number {
  let max = 0;
  for (const name of AVAILABLE_SLICES) {
    const t = tallies[name];
    if (!t) continue;
    const n = t.reduce((a, x) => a + x.decisions, 0);
    if (n > max) max = n;
  }
  return max;
}
