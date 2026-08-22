// modules/dairy/domain/dairy-insights.ts · W172 (Dairy insights) — PC-56 TENANT-6e-1.
//
// PURE. No I/O, no clock, no Nest. Every rule W172 needs to turn pours into a sentence lives here so the API, the page
// and the (declared, not yet built) export cannot disagree about what "daily volume" or "a new pourer" means.
//
// THE SHAPE, AS EVERY DERIVED SCREEN IN THIS PROGRAMME HAS IT: a figure arrives as a VERDICT — measured, with its
// basis, or refused, with the facts it is missing named. W172 prints eleven things. This platform can honestly produce
// nine of them. A page that presented all eleven identically would teach a cooperative to trust the two that are
// decoration, and the two are the most quotable numbers on the screen.
//
// THE INTEGER DISCIPLINE. Litres arrive as milli-kg bigint (`weight_kg numeric(8,3)` through `pg-numeric`), money as
// minor units bigint, percentages as centi-percent, and every ratio is carried as an integer in a declared scale.
// There is no float anywhere in this file, including in the "averages": a rate per litre that drifts in the third
// decimal is a rate a member can dispute, and a dispute this platform would lose.
import { litresLostVerdict, LitresLostVerdict } from './bmc';
import { PaymentCycle } from './dairy.events';
import { BonusSlab } from './milk-rate-card.entity';
import { PremiumBandVerdict, premiumBand } from './dairy-quality-desk';

/* ============================================================================================================= */
/* THE WINDOW                                                                                                    */
/* ============================================================================================================= */

/** W172's own window is 90 days (*"Volume by shift (90d, weekly buckets)"*, *"vs previous 90d"*). The other two are
 *  offered for the same reason TENANT-5d offered them: a cooperative six weeks old cannot use 90, and a district union
 *  reviewing a season wants 180. The set is closed so no caller can ask for an unbounded range. */
export const INSIGHT_WINDOWS = [30, 90, 180] as const;
export type InsightWindow = (typeof INSIGHT_WINDOWS)[number];
export const DEFAULT_INSIGHT_WINDOW: InsightWindow = 90;

/**
 * HOW FAR BACK "NEW" IS ALLOWED TO LOOK.
 *
 * *"pourers active 312, +18 this quarter · 4 win-backs"*. "New" naturally means "never poured before" and "never" has
 * no floor: it is a scan of every partition this tenant has ever had, growing slower every month the cooperative
 * succeeds — the precise shape Law 8 exists to forbid. So the cohorts are judged against ONE YEAR and the number is
 * returned on the wire beside the counts, which lets the screen say "new to us this year" (true) instead of "new ever"
 * (never checked). A year is chosen because milk is seasonal: a buffalo owner who pours only in flush would be counted
 * "new" every single season by any shorter lookback.
 */
export const POURER_LOOKBACK_DAYS = 365;

/** Weekly buckets, W172's own word. */
export const BUCKET_DAYS = 7;

/** How many complete cycles a tenant needs before any of this is drawn — W172's *"not enough history: needs ≥ 2 full
 *  cycles"*. Two rather than one because every figure on the screen is a COMPARISON, and one cycle has nothing to be
 *  compared with. */
export const MIN_CYCLES = 2;

/** The nominal length of each cycle, for the history gate only. `fortnightly` is 15 rather than 14 because 0155's
 *  `cycleWindow` splits a month at the 15th (the canon's own window), so a fortnight here averages half a month. */
export const CYCLE_DAYS: Readonly<Record<PaymentCycle, number>> = Object.freeze({
  daily: 1, weekly: 7, fortnightly: 15, monthly: 30,
});

const DAY_MS = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** Calendar days are UTC throughout, exactly as `dairy-counter`'s `cycleWindow` handles them: `collected_on` is a
 *  DATE, and treating it as a local instant is how an "01–15" window silently slips to "31–14". */
export function utcDay(day: string): Date {
  const [y, m, d] = day.split('-').map((n) => Number(n));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    throw new RangeError(`dairy-insights: not a calendar day: ${day}`);
  }
  return new Date(Date.UTC(y, m - 1, d));
}

export const addDays = (day: string, n: number): string => iso(new Date(utcDay(day).getTime() + n * DAY_MS));

/** Inclusive day count. `from === to` is one day, not zero: a cooperative that poured on one day poured for a day. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / DAY_MS) + 1;
}

export interface DayRange { from: string; to: string; days: number }

export interface InsightRanges {
  /** The window ending TODAY inclusive. */
  current: DayRange;
  /** The same number of days immediately before it — what *"vs previous 90d"* compares against. */
  previous: DayRange;
  /** The floor for the pourer cohorts (168.1). */
  lookbackFrom: string;
  window: InsightWindow;
}

/**
 * The two windows and the cohort floor, from one day and one width.
 *
 * `current` ENDS TODAY AND INCLUDES IT. Today is a partial day at every hour except the last, so the most recent bar
 * on the chart and the current average are both diluted by however much of today has not happened yet. The alternative
 * — ending yesterday — makes a manager who has just watched the morning shift come in look at a page that does not
 * contain it, which is worse on a screen whose whole purpose is "is this working today". The partial day is declared
 * on the wire (`endsOnPartialDay`) so the page can say so rather than the number quietly lying by a few per cent.
 */
export function insightRanges(today: string, window: InsightWindow): InsightRanges {
  const curFrom = addDays(today, -(window - 1));
  const prevTo = addDays(curFrom, -1);
  const prevFrom = addDays(prevTo, -(window - 1));
  return {
    current: { from: curFrom, to: today, days: window },
    previous: { from: prevFrom, to: prevTo, days: window },
    lookbackFrom: addDays(curFrom, -POURER_LOOKBACK_DAYS),
    window,
  };
}

/* ============================================================================================================= */
/* THE HISTORY GATE                                                                                              */
/* ============================================================================================================= */

/**
 * W172's *"not enough history — needs ≥ 2 full cycles"*.
 *
 * Measured in CYCLES, not days, because that is what the canon says and because it is the right unit: two fortnights
 * is a comparison a secretary can act on, and 30 days is two cycles for one cooperative and one for another. The cycle
 * is the one 0155 derives from the members' own `payment_cycle` preference — deliberately the SAME derivation, because
 * two dairy screens disagreeing about which fortnight is running would be worse than either being wrong alone.
 *
 * `no_data` is distinct from `not_enough_history` and neither is a zero: a cooperative that has never recorded a pour
 * is in a different situation from one that started last week, and "0 L/day" is the answer to neither.
 *
 * `atLeast` IS THE HONEST WORD FOR A BOUNDED SEARCH. The earliest pour is looked for only inside the declared lookback
 * (168.1) — `min(collected_on)` over all time is a scan of every partition a cooperative has ever filled, and it gets
 * slower every year they stay. That bound cannot change the GATE's answer (the gate needs at most 60 days and the
 * lookback is 365), but it does mean the reported length of history is a floor rather than a measurement whenever the
 * oldest pour found sits on the lookback floor. So it is flagged, and the page says "over a year" instead of quoting
 * 365 days to a cooperative in its ninth season.
 */
export type HistoryVerdict =
  | { kind: 'no_data' }
  | { kind: 'not_enough_history'; days: number; needDays: number; cycle: PaymentCycle; cycleDays: number; haveCycles: number; atLeast: boolean }
  | { kind: 'ready'; days: number; cycle: PaymentCycle; cycleDays: number; haveCycles: number; atLeast: boolean };

export function historyVerdict(i: {
  firstPourOn: string | null; today: string; cycle: PaymentCycle;
  /** The floor the search was bounded to. When `firstPourOn` equals it, history may be older than reported. */
  searchedFrom?: string | null;
}): HistoryVerdict {
  if (i.firstPourOn === null) return { kind: 'no_data' };
  const cycleDays = CYCLE_DAYS[i.cycle];
  const days = daysBetween(i.firstPourOn, i.today);
  const needDays = MIN_CYCLES * cycleDays;
  // Floor, not round: one and a half cycles of history is one full cycle, and rounding it up to two would open the
  // page on exactly the tenant the gate exists to protect.
  const haveCycles = Math.floor(days / cycleDays);
  const atLeast = i.searchedFrom != null && i.firstPourOn === i.searchedFrom;
  if (days < needDays) return { kind: 'not_enough_history', days, needDays, cycle: i.cycle, cycleDays, haveCycles, atLeast };
  return { kind: 'ready', days, cycle: i.cycle, cycleDays, haveCycles, atLeast };
}

/* ============================================================================================================= */
/* CHANGE, WITHOUT A FLOAT AND WITHOUT A DIVISION BY ZERO                                                        */
/* ============================================================================================================= */

/**
 * *"▲9% vs previous 90d"*.
 *
 * Carried in BASIS POINTS as a signed integer, so 9% is 900 and the page divides once for display. A percentage
 * computed in floating point and then rounded is how two screens over the same two numbers come to disagree by a
 * tenth.
 *
 * `from_zero` is its own verdict. A cooperative that collected nothing in the previous window and 4,180 L/day in this
 * one has not improved by any percentage — the ratio is undefined, and every implementation that prints "+∞%" or
 * "+100%" is choosing a number to avoid saying so. The page prints "no comparable period" and the actual figures.
 */
export type ChangeVerdict =
  | { kind: 'changed'; deltaBps: number; delta: string; from: string; to: string }
  | { kind: 'from_zero'; to: string }
  | { kind: 'to_zero'; from: string }
  /** Both windows are empty. Distinct from `no_previous`, which means the previous window was never read: "no milk in
   *  either period" is a fact a cooperative needs to see, and "no comparison available" would hide it. */
  | { kind: 'both_zero' }
  | { kind: 'no_previous' };

export function changeVerdict(previous: bigint | null, current: bigint): ChangeVerdict {
  if (previous === null) return { kind: 'no_previous' };
  if (previous === 0n) return current === 0n ? { kind: 'both_zero' } : { kind: 'from_zero', to: String(current) };
  if (current === 0n) return { kind: 'to_zero', from: String(previous) };
  const delta = current - previous;
  // Round half-away-from-zero on the magnitude so -0.5% and +0.5% are treated alike; a truncating division would
  // report every small decline as smaller than it is.
  const mag = delta < 0n ? -delta : delta;
  const bps = (mag * 10_000n + previous / 2n) / previous;
  return { kind: 'changed', deltaBps: Number(delta < 0n ? -bps : bps), delta: String(delta), from: String(previous), to: String(current) };
}

/* ============================================================================================================= */
/* KPI 1 — DAILY VOLUME                                                                                          */
/* ============================================================================================================= */

/**
 * *"Daily volume avg 4,180 L ▲9% vs previous 90d"*.
 *
 * **Averaged over every calendar day in the window, not over the days that had pours.** A cooperative that collected
 * on 50 of 90 days collects, on average, less per day than one that collected on all 90 — and dividing by 50 would
 * hide exactly that, flattering the tenant whose centres were shut. The basis is on the wire so the page can say it.
 *
 * Litres come from `weight_kg`, which is a WEIGHT. This desk's own convention since 0155 is that milk is bought and
 * quoted in litre-equivalents and milli-kg is read as milli-litres (`litresOf`); that convention is inherited here
 * rather than a density factor being invented, because inventing one would silently reprice every figure on the page.
 */
export interface VolumeInsight {
  /** Milli-litres per calendar day, floor-divided: an average is not evidence of a fractional litre. */
  perDayMilli: string;
  totalMilli: string;
  days: number;
  basis: 'per_calendar_day';
  daysWithPours: number;
  change: ChangeVerdict;
}

export function volumeInsight(i: {
  currentMilli: bigint; currentDays: number; currentDaysWithPours: number;
  previousMilli: bigint | null; previousDays: number;
}): VolumeInsight {
  const perDay = i.currentDays > 0 ? i.currentMilli / BigInt(i.currentDays) : 0n;
  const prevPerDay = i.previousMilli === null || i.previousDays <= 0 ? null : i.previousMilli / BigInt(i.previousDays);
  return {
    perDayMilli: String(perDay),
    totalMilli: String(i.currentMilli),
    days: i.currentDays,
    basis: 'per_calendar_day',
    daysWithPours: i.currentDaysWithPours,
    // The comparison is between the two AVERAGES, not the two totals. They coincide only while both windows are the
    // same length, and they will not be the day someone adds a "since inception" range.
    change: changeVerdict(prevPerDay, perDay),
  };
}

/* ============================================================================================================= */
/* KPI 2 — WHAT A MEMBER EARNED PER LITRE                                                                         */
/* ============================================================================================================= */

/**
 * *"Member ₹/L ₹51.60 ▲₹2.10"*.
 *
 * **THIS IS THE COUNTER RATE, BEFORE DEDUCTIONS, AND THE WIRE SAYS SO.** `milk_collections.amount_minor` is what the
 * pour earned when it was weighed; what a member actually receives is `milk_bills.net_minor`, after feed credit, loan
 * EMI, insurance and share deductions (0009, 0160). Those are different numbers and the second is always smaller.
 * W172's own explanation panel is entirely about premiums and rate cards — i.e. about the counter rate — so that is
 * what is computed, and `basis: 'gross_at_counter'` is returned so the page can label it. Printing the gross under the
 * words "member ₹/L" without that label is the kind of quiet flattery this programme exists to remove: a member
 * comparing it with their own slip would find the platform out.
 *
 * CENTI-MINOR PER LITRE is the unit, throughout, as a bigint: ₹51.60/L is 5,160 minor units per litre, carried as
 * 516,000. Two extra decimal places of a paisa are kept because the figure is a RATIO of two large sums and rounding
 * it to whole paise before comparing two windows makes a real ₹0.004 movement appear as ₹0.00 or ₹0.01 depending on
 * nothing. The projection to text happens once, on the way out.
 */
export const RATE_SCALE = 100_000n; // minor-per-litre × 100, given milli-litres: amount × 1000 × 100

export type RatePerLitreInsight =
  | { kind: 'no_pours' }
  | {
      kind: 'measured';
      basis: 'gross_at_counter';
      centiMinorPerLitre: string;
      amountMinor: string;
      milli: string;
      change: ChangeVerdict;
    };

/** amountMinor per litre, ×100, rounded half-up. Returns null when there is no milk to divide by — a rate per litre
 *  over zero litres is not zero, it is nothing. */
export function centiMinorPerLitre(amountMinor: bigint, milli: bigint): bigint | null {
  if (milli <= 0n) return null;
  return (amountMinor * RATE_SCALE + milli / 2n) / milli;
}

export function ratePerLitreInsight(i: {
  currentAmountMinor: bigint; currentMilli: bigint;
  previousAmountMinor: bigint | null; previousMilli: bigint | null;
}): RatePerLitreInsight {
  const cur = centiMinorPerLitre(i.currentAmountMinor, i.currentMilli);
  if (cur === null) return { kind: 'no_pours' };
  const prev = i.previousAmountMinor === null || i.previousMilli === null
    ? null
    : centiMinorPerLitre(i.previousAmountMinor, i.previousMilli);
  return {
    kind: 'measured',
    basis: 'gross_at_counter',
    centiMinorPerLitre: String(cur),
    amountMinor: String(i.currentAmountMinor),
    milli: String(i.currentMilli),
    change: changeVerdict(prev, cur),
  };
}

/** Centi-minor-per-litre to a text rate in major units, at the CURRENCY's own precision plus the two extra places the
 *  ratio carries. INR (2 minor digits): 516000 -> "51.6000". Sign is preserved for a delta. */
export function ratePerLitreText(centi: bigint, minorUnits: number): string {
  const neg = centi < 0n;
  const abs = neg ? -centi : centi;
  const digits = minorUnits + 2;
  const div = 10n ** BigInt(digits);
  const whole = abs / div;
  const frac = String(abs % div).padStart(digits, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/* ============================================================================================================= */
/* KPI 3 — THE POURERS                                                                                            */
/* ============================================================================================================= */

/**
 * *"Pourers active 312, +18 this quarter · 4 win-backs"*.
 *
 * Three cohorts that must PARTITION the active set, and one guard that refuses the tile if they do not:
 *
 *   • `newcomer`  — poured in this window, and not once in the year before it. "New to us this year" (168.1).
 *   • `winBack`   — poured in this window, nothing in the window immediately before it, but something earlier in the
 *                   year. The canon's *"4 win-backs"*: a family that stopped and came back, which is a different and
 *                   much better story than a family that never left.
 *   • `continuing` — everyone else who poured: active minus the two above.
 *
 * THE GUARD MATTERS MORE THAN THE COUNTS. `continuing` is a subtraction, so a repository that double-counts a member
 * in both cohorts produces a negative number — and a screen printing "-3 continuing pourers" has already lost the
 * reader. `inconsistent` says the query is wrong instead of drawing it, and it is the assertion that would have caught
 * every version of this SQL I got wrong before the right one.
 */
export type PourerCohorts =
  | { kind: 'no_pourers'; lookbackDays: number }
  | { kind: 'inconsistent'; active: number; newcomers: number; winBacks: number; lookbackDays: number }
  | {
      kind: 'measured';
      active: number; newcomers: number; winBacks: number; continuing: number;
      lookbackDays: number; basis: 'first_pour_within_lookback';
      change: ChangeVerdict;
    };

export function pourerCohorts(i: {
  active: number; newcomers: number; winBacks: number; previousActive: number | null;
}): PourerCohorts {
  const lookbackDays = POURER_LOOKBACK_DAYS;
  if (i.active <= 0) return { kind: 'no_pourers', lookbackDays };
  if (i.newcomers < 0 || i.winBacks < 0 || i.newcomers + i.winBacks > i.active) {
    return { kind: 'inconsistent', active: i.active, newcomers: i.newcomers, winBacks: i.winBacks, lookbackDays };
  }
  return {
    kind: 'measured',
    active: i.active, newcomers: i.newcomers, winBacks: i.winBacks,
    continuing: i.active - i.newcomers - i.winBacks,
    lookbackDays, basis: 'first_pour_within_lookback',
    change: changeVerdict(i.previousActive === null ? null : BigInt(i.previousActive), BigInt(i.active)),
  };
}

/* ============================================================================================================= */
/* KPI 4 — THE ONE THAT IS REFUSED                                                                                */
/* ============================================================================================================= */

/**
 * *"On-time payout streak · 24 cycles"* — REFUSED, and it is the most persuasive number on the screen.
 *
 * A streak is `count of consecutive cycles where the money arrived on or before the promised day`. This platform has
 * the promise and not the arrival:
 *
 *   • `dairy_bill_cycles.payday` (0157) — the date promised. Exists.
 *   • `dairy_bill_cycles.status` — `open | closed` only (0157's own CHECK). No cycle has a paid state.
 *   • `milk_bills.status` — admits `paid`, and no column anywhere records WHEN.
 *   • `payouts` (0006) — `payout_status` has `success`, and there is no `settled_at` or `paid_at` on the table at all.
 *     The shared `updated_at` is overwritten by any later touch, so it cannot even be read opportunistically.
 *
 * So the tile names the three missing facts and the page prints, in its place, the two things that ARE true: how many
 * cycles closed in the window, and how many of those had every bill approved. Weaker sentence; supportable one. A
 * `paid_at` added here and written by nothing would read NULL forever and the streak would print `0` — a screen
 * telling a cooperative it has never once paid on time.
 */
export interface PayoutStreakVerdict {
  kind: 'not_recorded';
  missing: readonly string[];
  /** The substitutes, which are facts. */
  cyclesClosed: number;
  cyclesAllBillsApproved: number;
}

export const PAYOUT_STREAK_MISSING = Object.freeze([
  'dairy_bill_cycles.paid_at',
  'milk_bills.paid_at',
  'payouts.settled_at',
] as const);

export function payoutStreakVerdict(i: { cyclesClosed: number; cyclesAllBillsApproved: number }): PayoutStreakVerdict {
  return {
    kind: 'not_recorded',
    missing: PAYOUT_STREAK_MISSING,
    cyclesClosed: i.cyclesClosed,
    cyclesAllBillsApproved: i.cyclesAllBillsApproved,
  };
}

/* ============================================================================================================= */
/* THE CHART — VOLUME BY SHIFT, WEEKLY BUCKETS                                                                    */
/* ============================================================================================================= */

/**
 * *"Volume by shift (90d, weekly buckets)"*, stacked.
 *
 * BUCKETS ARE COUNTED BACK FROM TODAY, NOT FORWARD FROM THE START. 90 days is twelve weeks and six days; something
 * has to be partial. Stepping forward leaves the partial bucket at the RIGHT edge — a final bar six sevenths as tall
 * as the truth, in the position the eye reads as "now", which would show a collapse in collection that never happened.
 * Stepping back puts it at the left edge, where a short first bar reads as "the window starts here", and the number of
 * days in it is returned so the page can label it.
 *
 * EVERY BUCKET IS PRESENT, INCLUDING THE EMPTY ONES. A week with no pours is a zero bar, not a missing one: a gap in
 * an array becomes a compressed axis, and a compressed axis turns a shutdown into a smooth line.
 */
export interface ShiftBucket {
  from: string; to: string; days: number;
  /** Milli-litres per shift, every shift key present. */
  byShift: Record<string, string>;
  totalMilli: string;
}

export interface ShiftSeries {
  buckets: ShiftBucket[];
  shifts: readonly string[];
  bucketDays: number;
  /** Days in the oldest bucket when the window does not divide by seven. */
  firstBucketDays: number;
}

/** The shifts the chart stacks. Milk is collected morning and evening (`milk_shift`); the order is the order of the
 *  day, so a stacked bar reads bottom-to-top the way the day ran. */
export const SHIFTS = ['morning', 'evening'] as const;

export function shiftSeries(
  range: DayRange,
  rows: ReadonlyArray<{ collectedOn: string; shift: string; milli: bigint }>,
  shifts: readonly string[] = SHIFTS,
): ShiftSeries {
  const bucketCount = Math.ceil(range.days / BUCKET_DAYS);
  const buckets: ShiftBucket[] = [];
  for (let b = bucketCount - 1; b >= 0; b -= 1) {
    // b counted from the NEWEST (0) backwards, then emitted oldest-first.
    const to = addDays(range.to, -b * BUCKET_DAYS);
    const rawFrom = addDays(to, -(BUCKET_DAYS - 1));
    const from = utcDay(rawFrom).getTime() < utcDay(range.from).getTime() ? range.from : rawFrom;
    const byShift: Record<string, string> = {};
    for (const s of shifts) byShift[s] = '0';
    buckets.push({ from, to, days: daysBetween(from, to), byShift, totalMilli: '0' });
  }

  const totals = buckets.map(() => new Map<string, bigint>());
  for (const r of rows) {
    const t = utcDay(r.collectedOn).getTime();
    const idx = buckets.findIndex((b) => t >= utcDay(b.from).getTime() && t <= utcDay(b.to).getTime());
    // A pour outside the window is dropped rather than folded into an edge bucket: the repository asked for this
    // range, and quietly absorbing an out-of-range row would hide a broken predicate behind a plausible chart.
    if (idx < 0) continue;
    const m = totals[idx];
    m.set(r.shift, (m.get(r.shift) ?? 0n) + r.milli);
  }

  buckets.forEach((b, i) => {
    let total = 0n;
    for (const [shift, milli] of totals[i]) {
      // A shift the caller did not declare (a tenant's third collection, a future enum value) still contributes to the
      // total and appears as its own key, rather than being silently dropped from a chart that claims to show volume.
      b.byShift[shift] = String((BigInt(b.byShift[shift] ?? '0')) + milli);
      total += milli;
    }
    b.totalMilli = String(total);
  });

  const allShifts = Array.from(new Set([...shifts, ...buckets.flatMap((b) => Object.keys(b.byShift))]));
  for (const b of buckets) for (const s of allShifts) if (b.byShift[s] === undefined) b.byShift[s] = '0';

  return {
    buckets,
    shifts: allShifts,
    bucketDays: BUCKET_DAYS,
    firstBucketDays: buckets.length > 0 ? buckets[0].days : 0,
  };
}

/* ============================================================================================================= */
/* THE EXPLANATION PANEL — *"What moved member ₹/L"*                                                              */
/* ============================================================================================================= */

/**
 * *"Quality premiums — 184 pourers in the fat ≥ 6.5 slab, was 141"*.
 *
 * The threshold is READ FROM THE CARD, never written here. `6.5` is what one seed happens to hold; a cooperative that
 * rewards fat at 6.2 would otherwise read its own screen quoting somebody else's slab (Law 6). It comes through
 * TENANT-6b-2's `premiumBand` unchanged, which carries the distinction that matters more than the count: with
 * `dairy_bonus_slabs` OFF nobody was paid a premium, and the honest word is "would qualify", not "earned".
 *
 * **THE PREVIOUS WINDOW IS NOT LABELLED WITH TODAY'S FLAG.** This is the defect the mutation pass found in the first
 * version of this function, and it is worth stating plainly because it looked completely correct: `slabsApplied` is
 * read ONCE, now, and applying it to BOTH windows means a cooperative that switched the slabs on forty days ago is
 * shown a previous 90 days labelled *"members actually paid a premium"* when nobody was paid a paisa. The basis-equality
 * guard could never fire, because both labels came from the same variable.
 *
 * **This platform holds no feature-flag history**, so what the previous window's basis WAS cannot be looked up. What can
 * be observed is money: a window with `earnedCount > 0` had the slabs applied — members were paid, which is not a
 * setting but a fact. So:
 *
 *   • previous window paid a premium  -> `earned`, certainly.
 *   • nobody poured                    -> `no_pours`, as before.
 *   • paid nothing and the flag is OFF now -> `would_qualify`: nothing was paid in either window, and both counts are
 *     forecasts of the same kind.
 *   • paid nothing and the flag is ON now -> **`basis_unknown`.** Either the slabs were off back then, or they were on
 *     and nobody cleared the band. Those are different sentences and the difference is not recorded anywhere, so the
 *     page says it does not know instead of picking the flattering one.
 *
 * *"was 141"* is then compared only when both windows measured the same thing. A "141 would-qualify" against a "184
 * earned" is not a trend — it is a flag being switched on, and an arrow over it would credit the cooperative's milk for
 * an act of configuration.
 */
export type PremiumPrevious = PremiumBandVerdict | { kind: 'basis_unknown'; slabs: readonly BonusSlab[] };

export interface PremiumTrend {
  current: PremiumBandVerdict;
  previous: PremiumPrevious;
  /** Present only when both windows are `measured` on the SAME basis. */
  change: ChangeVerdict | null;
  comparable: boolean;
}

export interface PremiumWindowCounts { pourers: number; earnedCount: number; wouldQualifyCount: number }

export function premiumTrend(i: {
  slabs: readonly BonusSlab[];
  /** The flag as it stands NOW. It is the authority for the CURRENT window and for nothing else. */
  slabsApplied: boolean;
  current: PremiumWindowCounts;
  previous: PremiumWindowCounts | null;
}): PremiumTrend {
  const current = premiumBand({ slabs: i.slabs, slabsApplied: i.slabsApplied, ...i.current });
  const previous: PremiumPrevious = (() => {
    if (i.slabs.length === 0) return { kind: 'no_slabs' } as PremiumBandVerdict;
    if (i.previous === null || i.previous.pourers <= 0) return { kind: 'no_pours', slabs: i.slabs } as PremiumBandVerdict;
    // Money moved in that window, so the slabs were applied in it. A fact, not a setting.
    if (i.previous.earnedCount > 0) return premiumBand({ slabs: i.slabs, slabsApplied: true, ...i.previous });
    // Nothing was paid then and nothing is being paid now: both counts are forecasts of the same kind.
    if (!i.slabsApplied) return premiumBand({ slabs: i.slabs, slabsApplied: false, ...i.previous });
    // Nothing was paid then and premiums ARE being paid now. Slabs off back then, or on with nobody clearing the band?
    // Nothing on this platform records which, so neither is claimed.
    return { kind: 'basis_unknown', slabs: i.slabs };
  })();

  const comparable = current.kind === 'measured' && previous.kind === 'measured' && current.basis === previous.basis;
  return {
    current,
    previous,
    comparable,
    change: comparable && current.kind === 'measured' && previous.kind === 'measured'
      ? changeVerdict(BigInt(previous.qualifying), BigInt(current.qualifying))
      : null,
  };
}

/**
 * *"zero spoilage"* — REFUSED, and not re-decided here.
 *
 * TENANT-6d-2 met the identical claim in W170 (*"0 L milk lost to temperature"*) and settled it: **no relation on this
 * platform reduces anybody's litres anywhere in the schema.** 0162 added the condemnation THRESHOLD and no
 * condemnation FACT. So this page calls 6d-2's own verdict rather than reaching the same conclusion in a second place
 * — two dairy screens disagreeing about whether spoilage is measurable would be worse than either being wrong alone.
 * "Zero spoilage" printed out of an absent table is a promise made out of a silence.
 */
export function spoilageVerdict(): LitresLostVerdict {
  return litresLostVerdict();
}
