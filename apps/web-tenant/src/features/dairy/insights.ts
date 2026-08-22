// apps/web-tenant/src/features/dairy/insights.ts · W172 (Dairy insights), as sentences — PC-56 TENANT-6e-1.
//
// Pure, and every function here exists to stop the page overstating a derived number. W172 prints eleven things; the
// platform can produce nine, and the two it cannot are the two a cooperative would quote to a member deciding where to
// pour tomorrow morning. So the vocabulary is built around saying which is which.
import type {
  DairyChange, DairyHistoryVerdict, DairyInsights, DairyInsightWindow, DairyPourerCohorts, DairyPremiumTrend,
  DairyRatePerLitre, DairyShiftSeries,
} from '@krishalaya/sdk-js';

export const INSIGHTS_HREF = '/dairy/insights';

/** The windows the API accepts, mirrored for the range control. A closed set on both sides: the page cannot offer a
 *  range the partition pruning cannot serve. */
export const INSIGHT_WINDOWS: readonly DairyInsightWindow[] = [30, 90, 180];

export function insightsHref(window: DairyInsightWindow): string {
  return window === 90 ? INSIGHTS_HREF : `${INSIGHTS_HREF}?window=${window}`;
}
export function windowLabelKey(window: DairyInsightWindow): string { return `dairy.insights.window.${window}`; }

/* ------------------------------------------------------------------------------------------------------------- */
/* THE PAGE'S OWN STATE                                                                                          */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * W172 draws six states and the API answers five of them by NAME — because a screen whose flagged-off state is a 404
 * cannot tell an operator anything (0168.5's argument, and the reason the module flag and this screen's flag are read
 * in different places). `restricted` and `error` remain transport facts, mapped the way every wave since 5c maps them.
 *
 * The sixth, `loading`, is the framework's: this page is a server component, so it is the streamed shell.
 */
export type InsightsViewState = 'ok' | 'notEnabled' | 'unavailable' | 'noData' | 'notEnoughHistory' | 'restricted' | 'error';

export function insightsTransportState(code: string | null | undefined, status?: number): InsightsViewState | null {
  if (!code && status === undefined) return null;
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  // 404 here means the DAIRY MODULE is switched off for this cooperative — the screen's own flag answers in the body.
  if (code === 'NOT_FOUND' || status === 404) return 'notEnabled';
  return 'error';
}

export function insightsState(v: DairyInsights): InsightsViewState {
  switch (v.kind) {
    case 'not_enabled': return 'notEnabled';
    case 'unavailable': return 'unavailable';
    case 'no_data': return 'noData';
    case 'not_enough_history': return 'notEnoughHistory';
    default: return 'ok';
  }
}
export function insightsStateKey(s: InsightsViewState): string { return `dairy.insights.state.${s}`; }

/** *"needs ≥ 2 full cycles"* — the gate's own sentence, which has to name the CYCLE or it means nothing: two
 *  fortnights and two months are very different waits. */
export function historyKey(h: DairyHistoryVerdict): string {
  if (h.kind === 'no_data') return 'dairy.insights.history.noData';
  return h.kind === 'not_enough_history' ? 'dairy.insights.history.notEnough' : 'dairy.insights.history.ready';
}

/* ------------------------------------------------------------------------------------------------------------- */
/* CHANGE                                                                                                        */
/* ------------------------------------------------------------------------------------------------------------- */

/** *"▲9%"* / *"▼"* / neither. `none` for the three verdicts that are not a movement, so the page renders a sentence
 *  instead of an arrow pointing at nothing. */
export function changeDirection(c: DairyChange): 'up' | 'down' | 'flat' | 'none' {
  if (c.kind !== 'changed') return 'none';
  if (c.deltaBps > 0) return 'up';
  return c.deltaBps < 0 ? 'down' : 'flat';
}

/** Why there is no arrow, in the cooperative's own terms. `both_zero` is deliberately its own sentence: "no milk in
 *  either period" is a fact a secretary needs, and "no comparison available" would bury it. */
export function changeAbsentKey(c: DairyChange): string | null {
  switch (c.kind) {
    case 'from_zero': return 'dairy.insights.change.fromZero';
    case 'to_zero': return 'dairy.insights.change.toZero';
    case 'both_zero': return 'dairy.insights.change.bothZero';
    case 'no_previous': return 'dairy.insights.change.noPrevious';
    default: return null;
  }
}

/** Basis points to a percent string with one decimal: 912 -> "9.1", 905 -> "9.1", 900 -> "9.0". Via TENTHS of a percent
 *  so the rounding happens once, at the digit being shown — going through `abs % 100` instead loses the tens place on
 *  anything under 10 bps of remainder and prints "9.00".
 *
 *  The sign is dropped because the arrow carries it: a tile showing both "▼" and "-9.1%" reads as a double negative. */
export function bpsToPercentText(deltaBps: number): string {
  const tenths = Math.round(Math.abs(Math.trunc(deltaBps)) / 10);
  return `${Math.trunc(tenths / 10)}.${tenths % 10}`;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* LITRES AND RATES                                                                                              */
/* ------------------------------------------------------------------------------------------------------------- */

/** Milli-litres to litres with one decimal, by string arithmetic on a bigint — the discipline every dairy surface on
 *  this platform has used since 6a, because `Number(milli)/1000` on a district union's 90-day total is a rounding this
 *  programme has already had to fix once. */
export function litresText(milli: string): string {
  const m = BigInt(milli || '0');
  const neg = m < 0n;
  const tenths = ((neg ? -m : m) + 50n) / 100n;
  return `${neg ? '-' : ''}${tenths / 10n}.${tenths % 10n}`;
}

/**
 * Centi-minor-per-litre to a MINOR-UNIT string the money formatter can take: 516000 at two minor digits is "5160",
 * i.e. ₹51.60. The two extra places the API carries are for COMPARING windows, not for showing — a rate quoted to a
 * member in ten-thousandths of a rupee is a rate nobody can check against their slip.
 *
 * Rounded half-up on the magnitude so a decline and a rise of the same size round alike.
 */
export function ratePerLitreMinor(centiMinorPerLitre: string): string {
  const c = BigInt(centiMinorPerLitre || '0');
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const minor = (abs + 50n) / 100n;
  return `${neg ? '-' : ''}${minor}`;
}

/** *"before deductions"* — printed beside the ₹/L figure, always. The counter rate is what a pour earned; what a member
 *  receives is the bill's net, after feed credit, loan EMI, insurance and share. A page that prints the first under the
 *  words "member ₹/L" and stays quiet about the second is one slip away from being caught out. */
export function rateBasisKey(r: DairyRatePerLitre): string | null {
  return r.kind === 'measured' ? 'dairy.insights.rate.grossAtCounter' : null;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* THE COHORTS                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------- */

/** *"+18 this quarter · 4 win-backs"*, or the reason there is no such line. `inconsistent` is shown as a defect and not
 *  as a number, because the alternative is a page printing "-3 continuing pourers" at a cooperative's secretary. */
export function cohortsKey(p: DairyPourerCohorts): string | null {
  if (p.kind === 'no_pourers') return 'dairy.insights.pourers.none';
  return p.kind === 'inconsistent' ? 'dairy.insights.pourers.inconsistent' : null;
}

/** *"new to us this year"* rather than *"new"*. The lookback is a real bound (one year, so a flush-season-only buffalo
 *  owner is not counted new every season) and the page says so instead of implying the platform checked all time. */
export const COHORT_BASIS_KEY = 'dairy.insights.pourers.lookback';

/* ------------------------------------------------------------------------------------------------------------- */
/* THE CHART                                                                                                     */
/* ------------------------------------------------------------------------------------------------------------- */

/** The tallest bucket, for scaling bars in CSS without a chart library. Returns 0n for an all-empty series, and the
 *  caller must not divide by it — an empty chart is a message ("no milk in this window"), not a flat axis. */
export function peakMilli(s: DairyShiftSeries): bigint {
  return s.buckets.reduce((max, b) => {
    const t = BigInt(b.totalMilli || '0');
    return t > max ? t : max;
  }, 0n);
}

/** A bar's height as an integer percentage of the peak. Integer arithmetic on bigints throughout: a 0.4% rounding on a
 *  bar is invisible, but the same helper is the one somebody reaches for next time it is not. */
export function barPct(milli: string, peak: bigint): number {
  if (peak <= 0n) return 0;
  const v = BigInt(milli || '0');
  return Number((v * 100n) / peak);
}

/** The shift's own key — the SAME one 6a's counter board and 6d-6's diversion screen use. A second `morning` in the
 *  catalogue is a second place for it to be translated differently, which the parity gate's duplicate check catches. */
export function shiftKey(shift: string): string { return `dairy.shift.${shift}`; }

/** Marks the oldest bucket when the window does not divide by seven, so a short first bar reads as "the window starts
 *  here" rather than as a bad week. */
export function isPartialBucket(s: DairyShiftSeries, index: number): boolean {
  return index === 0 && s.firstBucketDays > 0 && s.firstBucketDays < s.bucketDays;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* WHAT MOVED THE RATE                                                                                           */
/* ------------------------------------------------------------------------------------------------------------- */

/** *"184 pourers in the fat ≥ 6.5 slab, was 141"* — and the sentence changes completely with the slab flag. `earned`
 *  means money moved; `would_qualify` means nobody was paid and the count is a forecast. 6b-2 drew that line and the
 *  insights page must not blur it back. */
export function premiumKey(p: DairyPremiumTrend): string {
  if (p.current.kind === 'no_slabs') return 'dairy.insights.premium.noSlabs';
  if (p.current.kind === 'no_pours') return 'dairy.insights.premium.noPours';
  return p.current.basis === 'earned' ? 'dairy.insights.premium.earned' : 'dairy.insights.premium.wouldQualify';
}

/**
 * Why there is no *"was 141"*, in the right words for each reason.
 *
 * `basis_unknown` is its own sentence and the most important one: premiums are being paid now, nothing was paid in the
 * previous window, and this platform holds no flag history — so whether the slabs were off back then or on with nobody
 * clearing the band is not recorded. Printing "was 0" there would invent a collapse in milk quality out of a setting
 * nobody wrote down.
 */
export function premiumIncomparableKey(p: DairyPremiumTrend): string | null {
  if (p.comparable || p.current.kind !== 'measured') return null;
  if (p.previous.kind === 'basis_unknown') return 'dairy.insights.premium.basisUnknown';
  return p.previous.kind === 'measured' ? 'dairy.insights.premium.basisChanged' : 'dairy.insights.premium.noPrevious';
}

/** The slab as words, from the CARD's own threshold — never a literal 6.5 anywhere in this app. */
export function slabText(slab: { metric: string; minCentiPct: number; bonusMinorPerLitre: number }): string {
  return `${Math.trunc(slab.minCentiPct / 100)}.${String(slab.minCentiPct % 100).padStart(2, '0')}`;
}
export function slabMetricKey(metric: string): string { return `dairy.insights.premium.metric.${metric}`; }

/* ------------------------------------------------------------------------------------------------------------- */
/* THE TWO REFUSALS                                                                                              */
/* ------------------------------------------------------------------------------------------------------------- */

/** *"On-time payout streak · 24 cycles"* — the tile that is a sentence rather than a number, because nothing on this
 *  platform records when a milk payment actually arrived. The substitutes go beside it. */
export const PAYOUT_STREAK_KEY = 'dairy.insights.payout.notRecorded';
export const PAYOUT_STREAK_SUBSTITUTE_KEY = 'dairy.insights.payout.instead';

/**
 * *"zero spoilage"* — refused, **in 6d-2's own key**, not a second copy of it.
 *
 * W170's *"0 L milk lost to temperature"* and W172's *"zero spoilage"* are the same claim about the same absence, and
 * `dairy.bmc.quarter.litresLostUnknown` already says it in three languages. A second key would be a second place for a
 * translator to say it differently about one fact — Law 7's reasoning, and what the parity gate's duplicate check is
 * for.
 */
export const SPOILAGE_KEY = 'dairy.bmc.quarter.litresLostUnknown';

/** *"Rate card v4"* — there is no version column on `milk_rate_cards`, so the panel names the card and the date it
 *  took effect. An ordinal counted from `effective_from` would look identical and mean the platform's count of cards
 *  rather than the number on the cooperative's notice board. */
export const RATE_CARD_NO_VERSION_KEY = 'dairy.insights.rateCard.noVersion';
