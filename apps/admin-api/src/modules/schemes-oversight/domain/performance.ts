// apps/admin-api/src/modules/schemes-oversight/domain/performance.ts · W078's numbers, and the rules about what they
// are allowed to claim. Pure, no I/O.
//
// W078 opens with "The number that matters: benefit money actually reaching farmers because Krishalaya existed." That
// sentence is the reason every function here returns null rather than 0 on an empty denominator. A founder reads this
// screen to decide where to send people and money; a rate computed from four applications, or an approval rate whose
// denominator is silently zero, is worse than a blank — a blank prompts a question and a wrong number prompts a
// decision.

/** A rate with its own denominator attached, so a caller cannot render the percentage without the sample size.
 *  Returning a bare number is what lets "78%" appear on a screen when it means "7 of 9". */
export interface Rate {
  /** Percentage 0..100, rounded to one decimal. NULL when the denominator is 0 — never 0, which would read as
   *  "nothing was approved" rather than "nothing was decided". */
  pct: number | null;
  numerator: number;
  denominator: number;
  /** True when the denominator is too small for the percentage to mean anything. The console renders the raw counts
   *  instead of the rate — the number is still true, it just stops being a rate. */
  lowSample: boolean;
}

/** Below this, a percentage is arithmetic rather than information. 30 is not a statistical threshold and is not
 *  claimed as one; it is the point at which one more application stops moving the headline by whole percentage
 *  points, which is the property that matters on a dashboard somebody checks weekly. */
export const LOW_SAMPLE_BELOW = 30;

export function rate(numerator: number, denominator: number): Rate {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return { pct: null, numerator: Math.max(0, numerator || 0), denominator: Math.max(0, denominator || 0), lowSample: true };
  }
  return {
    pct: Math.round((numerator / denominator) * 1000) / 10,
    numerator, denominator,
    lowSample: denominator < LOW_SAMPLE_BELOW,
  };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE REJECTION BREAKDOWN, AND ITS DENOMINATOR                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

/** The codes 0106 added. Ordered as W078 orders them — by remedy, most actionable first — not alphabetically and not
 *  by frequency: a chart that reorders itself as the data moves is a chart nobody learns to read. */
export const REJECTION_CODES = [
  'aadhaar_seeding_mismatch', 'land_record_name_variance', 'duplicate_application', 'window_missed',
  'documents_missing', 'ineligible_landholding', 'ineligible_category', 'ineligible_region',
  'portal_rejected', 'withdrawn_by_applicant', 'other',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];
export function isRejectionCode(v: string): v is RejectionCode {
  return (REJECTION_CODES as readonly string[]).includes(v);
}

/** Which rejections a farmer (or an ambassador on their behalf) can actually do something about.
 *
 *  The split is load-bearing, not cosmetic. W078 wires each fixable reason to a remedy — an ambassador task, a 7/12
 *  correction camp, a dedupe check, a calendar nudge — and an ineligibility is not a remedy, it is an answer. Sending
 *  an ambassador to a farm whose landholding genuinely exceeds the cap wastes the visit AND tells the farmer their
 *  refusal was a mistake, which it was not.
 */
export const FIXABLE_CODES: readonly RejectionCode[] = [
  'aadhaar_seeding_mismatch', 'land_record_name_variance', 'duplicate_application', 'window_missed', 'documents_missing',
];
export function isFixable(code: string): boolean {
  return (FIXABLE_CODES as readonly string[]).includes(code);
}

export interface RejectionSlice { code: RejectionCode; n: number; pctOfCoded: number | null; fixable: boolean }

export interface RejectionBreakdown {
  slices: RejectionSlice[];
  /** Rejections carrying a code — the denominator of every percentage above. */
  coded: number;
  /** Rejections with NO code. Reported on its own, never folded into `other`. */
  uncoded: number;
  /** coded + uncoded. The number a reader will assume the percentages are of, which is why it is returned. */
  totalRejections: number;
  /** What share of rejections the breakdown can speak for at all. A 12% coverage with a confident-looking pie chart
   *  is the single most misleading thing this screen could render. */
  coverage: Rate;
}

/** Build the breakdown, counting ONLY coded rows and saying so.
 *
 *  THE TWO THINGS THIS REFUSES TO DO, both of which a simpler implementation does by accident:
 *    • It does not put uncoded rows into `other`. `other` means "an officer looked and none of the codes fitted",
 *      which is a real signal that the code list needs work. "We never asked" is a different fact and mixing them
 *      destroys the only signal that would ever prompt somebody to fix the list.
 *    • It does not take percentages of the TOTAL. With 88% uncoded, every slice would round to a number near zero and
 *      the chart would say Aadhaar seeding is a 5% problem when among coded rejections it is 42%.
 */
export function rejectionBreakdown(rows: Array<{ code: string | null; n: number }>): RejectionBreakdown {
  let coded = 0; let uncoded = 0;
  const byCode = new Map<RejectionCode, number>();
  for (const r of rows) {
    const n = Number.isFinite(r.n) && r.n > 0 ? Math.floor(r.n) : 0;
    if (n === 0) continue;
    if (r.code === null || r.code === undefined || !isRejectionCode(r.code)) {
      // An UNRECOGNISED code lands here too, not in `other`. A code this build does not know about means the CHECK
      // constraint moved ahead of this list, and quietly bucketing it would hide that.
      uncoded += n;
      continue;
    }
    coded += n;
    byCode.set(r.code, (byCode.get(r.code) ?? 0) + n);
  }
  const slices: RejectionSlice[] = REJECTION_CODES
    .filter((c) => (byCode.get(c) ?? 0) > 0)
    .map((c) => {
      const n = byCode.get(c) ?? 0;
      return { code: c, n, pctOfCoded: coded > 0 ? Math.round((n / coded) * 1000) / 10 : null, fixable: isFixable(c) };
    });
  const totalRejections = coded + uncoded;
  return { slices, coded, uncoded, totalRejections, coverage: rate(coded, totalRejections) };
}

/** How much of the rejection population is fixable — the number that sizes an outreach programme. Null when nothing is
 *  coded, because "0% fixable" would call off work that may be entirely fixable and simply unrecorded. */
export function fixableShare(b: RejectionBreakdown): Rate {
  const fixable = b.slices.filter((s) => s.fixable).reduce((n, s) => n + s.n, 0);
  return rate(fixable, b.coded);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* MEDIAN TIME TO DISBURSAL                                                                                     */
/* ------------------------------------------------------------------------------------------------------------ */

export type Duration =
  | { kind: 'days'; days: number; sampleSize: number }
  /** No application has reached `disbursed` in the window. Not "0 days". */
  | { kind: 'none_disbursed' }
  /** Disbursals exist but none can be timed — a `disbursed` event with no `submitted_at` to measure from. */
  | { kind: 'untimeable'; disbursals: number };

/** W078 prints "Median time to disbursal — 24 days ▼ 6 days QoQ".
 *
 *  MEDIAN AND NOT MEAN, deliberately: one application stuck in a portal for eleven months drags a mean past every real
 *  farmer's experience, and this number is meant to describe the experience rather than the tail. The tail matters too
 *  and belongs in its own metric, not smuggled into this one.
 *
 *  Takes seconds because that is what `percentile_cont` over an interval returns, and converts once, here, so no
 *  caller invents its own rounding.
 */
export function medianDuration(p50Seconds: number | null | undefined, sampleSize: number, disbursals = sampleSize): Duration {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) {
    return disbursals > 0 ? { kind: 'untimeable', disbursals } : { kind: 'none_disbursed' };
  }
  if (p50Seconds === null || p50Seconds === undefined || !Number.isFinite(p50Seconds)) {
    return { kind: 'untimeable', disbursals };
  }
  // Rounded to whole days: a median of 24.3 days is not more accurate than 24, and a decimal invites a comparison
  // between quarters that the sample cannot support.
  return { kind: 'days', days: Math.round(p50Seconds / 86400), sampleSize };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE HEADLINE                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

/** "Benefits facilitated YTD — ₹38.2 Cr", as a minor-unit STRING (Law 2: never a float, never summed in JS).
 *
 *  AND THE CLAIM IN THE WORD "FACILITATED" IS CHECKED. This is the sum of DBT credits OBSERVED against applications
 *  filed through the platform — money the government moved to a farmer's own bank account. It is not our revenue, not
 *  GMV, and it never touched our ledger. `attributionBasis` travels with the number so a deck built from this screen
 *  says what it is measuring; a bare "₹38.2 Cr facilitated" on a fundraising slide is a claim somebody will be asked
 *  to defend.
 */
export interface BenefitTotal {
  amountMinor: string;
  transfers: number;
  attributionBasis: 'dbt_credits_observed_against_platform_applications';
  /** Credits with no resolvable application — observed, real money, but NOT attributable to a filing we assisted.
   *  Counted separately rather than dropped or claimed. */
  unattributedTransfers: number;
  unattributedAmountMinor: string;
}

export function benefitTotal(
  attributed: { amountMinor: string; transfers: number },
  unattributed: { amountMinor: string; transfers: number },
): BenefitTotal {
  const digits = (v: string) => (/^\d{1,30}$/.test((v ?? '').trim()) ? v.trim() : '0');
  return {
    amountMinor: digits(attributed.amountMinor),
    transfers: Math.max(0, attributed.transfers || 0),
    attributionBasis: 'dbt_credits_observed_against_platform_applications',
    unattributedTransfers: Math.max(0, unattributed.transfers || 0),
    unattributedAmountMinor: digits(unattributed.amountMinor),
  };
}
