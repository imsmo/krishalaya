// modules/dairy/__tests__/tenant6e1-insights.spec.ts · PC-56 TENANT-6e-1 · THE INSIGHTS.
//
// W172 prints eleven figures and asks the reader to trust all of them equally. This spec is mostly about the two that
// must NOT be trusted — *"On-time payout streak · 24 cycles"* and *"zero spoilage"* — and about the boundaries where a
// derived number quietly becomes a wrong one:
//
//   • an average divided by the wrong denominator (days with pours, not calendar days) flatters a cooperative whose
//     centres were shut;
//   • a percentage change computed against zero;
//   • a weekly bucket sequence whose partial week lands at the right-hand edge, where the eye reads "now";
//   • a rate per litre rounded to whole paise before two windows are compared;
//   • a premium count compared across a flag being switched on;
//   • a cohort partition that can go negative.
//
// Every harness value below is deliberately DISTINCT. A previous wave in this programme lost a mutation round because
// a fixture's two numbers coincided, so a read of the wrong one looked correct.
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA, VERSION_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BUCKET_DAYS, CYCLE_DAYS, DEFAULT_INSIGHT_WINDOW, INSIGHT_WINDOWS, MIN_CYCLES, PAYOUT_STREAK_MISSING,
  POURER_LOOKBACK_DAYS, RATE_SCALE, SHIFTS,
  addDays, centiMinorPerLitre, changeVerdict, daysBetween, historyVerdict, insightRanges, payoutStreakVerdict,
  pourerCohorts, premiumTrend, ratePerLitreInsight, ratePerLitreText, shiftSeries, spoilageVerdict, utcDay,
  volumeInsight,
} from '../domain/dairy-insights';
import { DairyInsightsReadModel, INSIGHTS_FLAG } from '../read-models/dairy-insights.read-model';
import { DairyInsightsController } from '../controllers/v1/dairy-insights.controller';
import { QueryDairyInsightsSchema } from '../dto/query-dairy-insights.dto';
import { canDrillDownMember } from '../policies/dairy.policies';
import { BONUS_SLABS_FLAG } from '../domain/milk-quality.flags';
import { BonusSlab } from '../domain/milk-rate-card.entity';

const TODAY = '2026-08-21';
const mig = () => fs.readFileSync(
  path.join(__dirname, '../../../../../../db/migrations/0168_dairy_insights.sql'), 'utf8');

const FAT_SLAB: BonusSlab = { metric: 'fat', minCentiPct: 650, bonusMinorPerLitre: 50 };
/** A SECOND, LOWER slab so "the lowest fat threshold" is a real choice and not the only value present. */
const FAT_SLAB_LOW: BonusSlab = { metric: 'fat', minCentiPct: 620, bonusMinorPerLitre: 20 };

/* =============================================================================================================== */
/* THE WINDOW                                                                                                      */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · the two windows', () => {
  it('makes the current window END TODAY, inclusive, and the previous one exactly as long', () => {
    const r = insightRanges(TODAY, 90);
    expect(r.current).toEqual({ from: '2026-05-24', to: '2026-08-21', days: 90 });
    expect(r.previous).toEqual({ from: '2026-02-23', to: '2026-05-23', days: 90 });
    // No gap and no overlap: the day before the current window starts is the day the previous one ends.
    expect(addDays(r.previous.to, 1)).toBe(r.current.from);
    expect(daysBetween(r.current.from, r.current.to)).toBe(90);
    expect(daysBetween(r.previous.from, r.previous.to)).toBe(90);
  });

  it('puts the cohort floor a declared year before the window, not before today', () => {
    const r = insightRanges(TODAY, 90);
    // Measured from the WINDOW's start, so "no pour in the year before this window" means exactly that. Anchoring it
    // to today instead would let the previous window's own pours count as the lookback and no member would ever be new.
    expect(r.lookbackFrom).toBe(addDays(r.current.from, -POURER_LOOKBACK_DAYS));
    expect(daysBetween(r.lookbackFrom, r.current.from)).toBe(POURER_LOOKBACK_DAYS + 1);
    expect(POURER_LOOKBACK_DAYS).toBe(365);
  });

  it('offers a closed set of windows and no more — an arbitrary range defeats the partition pruning', () => {
    expect([...INSIGHT_WINDOWS]).toEqual([30, 90, 180]);
    expect(DEFAULT_INSIGHT_WINDOW).toBe(90); // W172's own word
    expect(QueryDairyInsightsSchema.parse({}).window).toBe(90);
    expect(QueryDairyInsightsSchema.parse({ window: '180' }).window).toBe(180);
    expect(() => QueryDairyInsightsSchema.parse({ window: 3650 })).toThrow();
    expect(() => QueryDairyInsightsSchema.parse({ window: 91 })).toThrow();
    expect(() => QueryDairyInsightsSchema.parse({ window: 90, extra: 1 })).toThrow(); // .strict()
  });

  it('handles calendar days as UTC, so a month boundary does not slip', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29'); // leap
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(daysBetween('2026-08-21', '2026-08-21')).toBe(1); // a day of pours is a day, not zero
    expect(() => utcDay('not-a-day')).toThrow(RangeError);
  });
});

/* =============================================================================================================== */
/* THE HISTORY GATE                                                                                                */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · not enough history', () => {
  it('measures the gate in CYCLES, so the same 30 days opens the page for one cooperative and not another', () => {
    // 30 days of history: two fortnights (30) is exactly enough, two months (60) is not.
    const thirty = { firstPourOn: '2026-07-23', today: TODAY };
    expect(historyVerdict({ ...thirty, cycle: 'fortnightly' }).kind).toBe('ready');
    expect(historyVerdict({ ...thirty, cycle: 'monthly' }).kind).toBe('not_enough_history');
    expect(historyVerdict({ ...thirty, cycle: 'weekly' }).kind).toBe('ready');
    expect(MIN_CYCLES).toBe(2);
    expect(CYCLE_DAYS).toEqual({ daily: 1, weekly: 7, fortnightly: 15, monthly: 30 });
  });

  it('FLOORS the cycle count — one and a half cycles is one, and rounding up would open the page it protects', () => {
    // 23 days, fortnightly: 1.53 cycles. Rounding gives 2 and lets the page draw; flooring gives 1 and holds it.
    const v = historyVerdict({ firstPourOn: '2026-07-30', today: TODAY, cycle: 'fortnightly' });
    expect(v.kind).toBe('not_enough_history');
    if (v.kind !== 'not_enough_history') throw new Error('unreachable');
    expect(v.days).toBe(23);
    expect(v.haveCycles).toBe(1);
    expect(v.needDays).toBe(30);
  });

  it('says NO DATA rather than zero — never having poured is not the same as having poured nothing', () => {
    expect(historyVerdict({ firstPourOn: null, today: TODAY, cycle: 'weekly' })).toEqual({ kind: 'no_data' });
  });

  it('flags a BOUNDED answer as "at least", because the search has a floor (Law 8)', () => {
    const floor = addDays(TODAY, -400);
    // The earliest pour found IS the floor, so the true history may be far longer. Reporting 401 days as a measurement
    // to a cooperative in its ninth season would understate it.
    const bounded = historyVerdict({ firstPourOn: floor, today: TODAY, cycle: 'monthly', searchedFrom: floor });
    expect(bounded.kind).toBe('ready');
    if (bounded.kind !== 'ready') throw new Error('unreachable');
    expect(bounded.atLeast).toBe(true);

    // A pour strictly after the floor is a real measurement.
    const measured = historyVerdict({ firstPourOn: addDays(floor, 1), today: TODAY, cycle: 'monthly', searchedFrom: floor });
    if (measured.kind !== 'ready') throw new Error('unreachable');
    expect(measured.atLeast).toBe(false);

    // No floor supplied at all is also a measurement, not a bound.
    const unbounded = historyVerdict({ firstPourOn: floor, today: TODAY, cycle: 'monthly' });
    if (unbounded.kind !== 'ready') throw new Error('unreachable');
    expect(unbounded.atLeast).toBe(false);
  });
});

/* =============================================================================================================== */
/* CHANGE                                                                                                          */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · the change against the period before', () => {
  it('reports basis points, rounded half-up, with the sign preserved', () => {
    // 4180 from 3835: +345/3835 = 8.997% -> 900 bps. The canon's own "▲9%".
    expect(changeVerdict(3835n, 4180n)).toEqual({ kind: 'changed', deltaBps: 900, delta: '345', from: '3835', to: '4180' });
    // Exactly 100 -> 110 is +10%.
    expect(changeVerdict(100n, 110n).kind).toBe('changed');
    expect((changeVerdict(100n, 110n) as { deltaBps: number }).deltaBps).toBe(1000);
  });

  it('rounds a DECLINE by magnitude, so a fall and a rise of the same size read alike', () => {
    // A truncating division would report every small decline as smaller than it is — flattering by arithmetic.
    const up = changeVerdict(2000n, 2001n) as { deltaBps: number };
    const down = changeVerdict(2000n, 1999n) as { deltaBps: number };
    expect(up.deltaBps).toBe(5);
    expect(down.deltaBps).toBe(-5);
  });

  it('refuses a percentage against zero instead of printing one', () => {
    expect(changeVerdict(0n, 4180n)).toEqual({ kind: 'from_zero', to: '4180' });
    expect(changeVerdict(4180n, 0n)).toEqual({ kind: 'to_zero', from: '4180' });
    // Both empty is its own sentence: "no milk in either period" is a fact a secretary needs.
    expect(changeVerdict(0n, 0n)).toEqual({ kind: 'both_zero' });
    expect(changeVerdict(null, 4180n)).toEqual({ kind: 'no_previous' });
  });

  it("does not overflow or lose precision on a district union's numbers", () => {
    // 2^53 + 1 — the first integer a float cannot represent. Basis points on it must still be exact.
    const big = 9_007_199_254_740_993n;
    const v = changeVerdict(big, big * 2n) as { deltaBps: number; delta: string };
    expect(v.deltaBps).toBe(10_000);
    expect(v.delta).toBe(String(big));
  });
});

/* =============================================================================================================== */
/* KPI 1 — DAILY VOLUME                                                                                            */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · daily volume', () => {
  it('divides by CALENDAR days, not by the days that had pours', () => {
    // 90 days, milk on only 45 of them, 376,200 litres in total.
    const v = volumeInsight({
      currentMilli: 376_200_000n, currentDays: 90, currentDaysWithPours: 45,
      previousMilli: null, previousDays: 90,
    });
    expect(v.perDayMilli).toBe('4180000');   // 4,180 L/day — W172's own figure
    expect(v.basis).toBe('per_calendar_day');
    // Dividing by 45 would print 8,360 L/day: double, and flattering exactly the cooperative whose centres were shut.
    expect(v.perDayMilli).not.toBe('8360000');
    expect(v.daysWithPours).toBe(45);
  });

  it('compares the two AVERAGES, not the two totals', () => {
    // Same totals, different window lengths. Comparing totals would report no change; comparing averages reports the
    // halving that actually happened. They coincide only while both windows are the same length.
    const v = volumeInsight({
      currentMilli: 180_000n, currentDays: 90, currentDaysWithPours: 90,
      previousMilli: 180_000n, previousDays: 45,
    });
    expect(v.change.kind).toBe('changed');
    expect((v.change as { deltaBps: number }).deltaBps).toBe(-5000); // -50%
  });

  it('does not divide by zero days', () => {
    const v = volumeInsight({ currentMilli: 5n, currentDays: 0, currentDaysWithPours: 0, previousMilli: 5n, previousDays: 0 });
    expect(v.perDayMilli).toBe('0');
    expect(v.change).toEqual({ kind: 'no_previous' });
  });
});

/* =============================================================================================================== */
/* KPI 2 — THE RATE PER LITRE                                                                                      */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · what a member earned per litre', () => {
  it('is the COUNTER rate and says so, because the bill nets it down', () => {
    // 1,000 L (1,000,000 milli) earning ₹51,600.00 -> ₹51.60/L.
    const v = ratePerLitreInsight({
      currentAmountMinor: 5_160_000n, currentMilli: 1_000_000n,
      previousAmountMinor: 4_950_000n, previousMilli: 1_000_000n,
    });
    if (v.kind !== 'measured') throw new Error('unreachable');
    expect(v.basis).toBe('gross_at_counter');
    expect(v.centiMinorPerLitre).toBe('516000');
    expect(ratePerLitreText(BigInt(v.centiMinorPerLitre), 2)).toBe('51.6000');
    // The canon's "▲₹2.10": 495000 -> 516000 is 21000 centi-minor = 210 minor = ₹2.10 per litre.
    expect((v.change as { delta: string }).delta).toBe('21000');
  });

  it('keeps two extra places so a real movement is not rounded to nothing before the comparison', () => {
    // Two windows whose rates differ by four thousandths of a rupee. Rounded to whole paise FIRST, both are 5160 and
    // the change reads as zero; carried at centi-minor, the movement survives.
    const a = centiMinorPerLitre(5_160_000n, 1_000_000n)!;
    const b = centiMinorPerLitre(5_160_040n, 1_000_000n)!;
    expect(a).toBe(516_000n);
    expect(b).toBe(516_004n);
    expect(changeVerdict(a, b).kind).toBe('changed');
    expect((a + 50n) / 100n).toBe((b + 50n) / 100n); // ...and they DO round to the same paise
  });

  it("rounds half-up and never truncates a member's rate downward", () => {
    // One minor unit spread over 3 litres: 0.3333 minor/L = 33.33 centi-minor -> 33, rounded DOWN because that is
    // where half-up lands. The member is not credited a hundredth of a paisa they did not earn.
    expect(centiMinorPerLitre(1n, 3_000n)).toBe(33n);
    // Over 6 litres: 16.67 -> 17, rounded UP. A truncating divide would say 16 and understate every rate on the page.
    expect(centiMinorPerLitre(1n, 6_000n)).toBe(17n);
    // Exactly .5 goes up, not to even.
    expect(centiMinorPerLitre(1n, 200_000n)).toBe(1n); // 100000/200000 = 0.5 -> 1
    expect(RATE_SCALE).toBe(100_000n);
  });

  it('refuses a rate over no milk — that is nothing, not zero', () => {
    expect(centiMinorPerLitre(5_000n, 0n)).toBeNull();
    expect(ratePerLitreInsight({ currentAmountMinor: 5_000n, currentMilli: 0n, previousAmountMinor: null, previousMilli: null }))
      .toEqual({ kind: 'no_pours' });
  });

  it("renders at the CURRENCY's own scale, so a zero-decimal currency is not divided by a hundred", () => {
    // 516000 centi-minor-per-litre is ₹51.6000 at two minor digits and ¥5160.00 at zero. Guessing two is the defect
    // TENANT-6d-7 refused on the notice path, and Rule Zero binds a read as tightly as a write.
    expect(ratePerLitreText(516_000n, 2)).toBe('51.6000');
    expect(ratePerLitreText(516_000n, 0)).toBe('5160.00');
    expect(ratePerLitreText(516_000n, 3)).toBe('5.16000');
    expect(ratePerLitreText(-21_000n, 2)).toBe('-2.1000');
  });
});

/* =============================================================================================================== */
/* KPI 3 — THE COHORTS                                                                                             */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · the pourers', () => {
  it('partitions the active set into new, came-back and continuing', () => {
    const v = pourerCohorts({ active: 312, newcomers: 18, winBacks: 4, previousActive: 294 });
    if (v.kind !== 'measured') throw new Error('unreachable');
    // W172's own three numbers, and the fourth it does not print but a reader needs.
    expect(v).toMatchObject({ active: 312, newcomers: 18, winBacks: 4, continuing: 290 });
    expect(v.newcomers + v.winBacks + v.continuing).toBe(v.active);
    expect(v.lookbackDays).toBe(POURER_LOOKBACK_DAYS);
    expect(v.basis).toBe('first_pour_within_lookback');
    expect(v.change.kind).toBe('changed');
  });

  it('REFUSES rather than printing a negative "continuing" count', () => {
    // The cohorts come from one SQL statement with two disjoint filters, so this should be impossible — which is
    // exactly why it is asserted. A page showing "-3 continuing pourers" has already lost its reader.
    expect(pourerCohorts({ active: 20, newcomers: 18, winBacks: 4, previousActive: 10 }).kind).toBe('inconsistent');
    expect(pourerCohorts({ active: 20, newcomers: -1, winBacks: 0, previousActive: 10 }).kind).toBe('inconsistent');
    // The boundary is inclusive: summing exactly to `active` is a valid partition with nobody continuing.
    const edge = pourerCohorts({ active: 22, newcomers: 18, winBacks: 4, previousActive: 10 });
    expect(edge.kind).toBe('measured');
    expect((edge as { continuing: number }).continuing).toBe(0);
  });

  it('says nobody poured rather than reporting a cohort of zero', () => {
    expect(pourerCohorts({ active: 0, newcomers: 0, winBacks: 0, previousActive: 41 }))
      .toEqual({ kind: 'no_pourers', lookbackDays: POURER_LOOKBACK_DAYS });
  });
});

/* =============================================================================================================== */
/* KPI 4 — THE REFUSAL                                                                                             */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · the on-time payout streak this platform cannot count', () => {
  it('names the three facts that do not exist, and offers the two that do', () => {
    const v = payoutStreakVerdict({ cyclesClosed: 6, cyclesAllBillsApproved: 5 });
    expect(v.kind).toBe('not_recorded');
    // The three, by name. A reader of this verdict can go and look each one up.
    expect([...v.missing]).toEqual(['dairy_bill_cycles.paid_at', 'milk_bills.paid_at', 'payouts.settled_at']);
    // DISTINCT substitutes: a harness whose two counts coincided could not see a read of the wrong one.
    expect(v.cyclesClosed).toBe(6);
    expect(v.cyclesAllBillsApproved).toBe(5);
  });

  it('has no `streak` field at all — there is nowhere for a plausible number to leak in', () => {
    const v = payoutStreakVerdict({ cyclesClosed: 24, cyclesAllBillsApproved: 24 });
    expect(Object.keys(v).sort()).toEqual(['cyclesAllBillsApproved', 'cyclesClosed', 'kind', 'missing']);
    expect(JSON.stringify(v)).not.toContain('streak');
  });

  it('is stated in the migration too, against the columns a future reader will find first', () => {
    const m = mig();
    expect(m).toContain('COMMENT ON COLUMN dairy_bill_cycles.payday');
    expect(m).toContain('COMMENT ON COLUMN milk_bills.status');
    for (const missing of PAYOUT_STREAK_MISSING) {
      // The migration names the same absences the API does, so the database's own documentation and the wire agree.
      expect(m).toContain(missing.split('.')[0]);
    }
    expect(m).toContain('settled_at');
  });
});

describe('PC-56 TENANT-6e-1 · zero spoilage', () => {
  it("reuses TENANT-6d-2's verdict rather than deciding the same thing twice", () => {
    const v = spoilageVerdict();
    expect(v.kind).toBe('not_measurable');
    expect(v.needs.length).toBeGreaterThan(0);
    // W170's "0 L milk lost" and W172's "zero spoilage" are one claim about one absence. Two verdicts over it is how
    // two dairy screens come to disagree about whether spoilage is measurable.
  });
});

/* =============================================================================================================== */
/* THE CHART                                                                                                       */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · volume by shift, in weekly buckets', () => {
  const range = insightRanges(TODAY, 90).current;

  it('counts buckets BACK from today, so the partial week is the oldest and not the newest', () => {
    const s = shiftSeries(range, []);
    expect(s.buckets.length).toBe(13);          // 90 days = 12 weeks and 6 days
    expect(s.bucketDays).toBe(BUCKET_DAYS);
    // The NEWEST bucket is complete — it is the one the eye reads as "now", and a six-sevenths-tall final bar would
    // show a collapse in collection that never happened.
    const newest = s.buckets[s.buckets.length - 1];
    expect(newest.to).toBe(TODAY);
    expect(newest.days).toBe(7);
    // The OLDEST is the short one, and its length is reported so the page can label it.
    expect(s.buckets[0].from).toBe(range.from);
    expect(s.buckets[0].days).toBe(6);
    expect(s.firstBucketDays).toBe(6);
  });

  it('divides evenly with no partial bucket when the window is a whole number of weeks', () => {
    const r = { from: '2026-08-01', to: '2026-08-28', days: 28 };
    const s = shiftSeries(r, []);
    expect(s.buckets.map((b) => b.days)).toEqual([7, 7, 7, 7]);
    expect(s.firstBucketDays).toBe(7);
  });

  it('emits buckets oldest-first and contiguous, with no gap and no overlap', () => {
    const s = shiftSeries(range, []);
    for (let i = 1; i < s.buckets.length; i += 1) {
      expect(addDays(s.buckets[i - 1].to, 1)).toBe(s.buckets[i].from);
    }
  });

  it('keeps EVERY bucket, including the empty ones — a gap in the array is a compressed axis', () => {
    // Milk in the newest week only. Twelve zero buckets must survive, or a shutdown draws as a smooth line.
    const s = shiftSeries(range, [{ collectedOn: TODAY, shift: 'morning', milli: 900_000n }]);
    expect(s.buckets.length).toBe(13);
    expect(s.buckets.slice(0, 12).every((b) => b.totalMilli === '0')).toBe(true);
    expect(s.buckets[12].totalMilli).toBe('900000');
    expect(s.buckets[12].byShift.morning).toBe('900000');
    expect(s.buckets[12].byShift.evening).toBe('0');   // present as zero, not absent
  });

  it('sums both shifts into the bucket total, and the two shift figures differ', () => {
    const s = shiftSeries(range, [
      { collectedOn: TODAY, shift: 'morning', milli: 700_000n },
      { collectedOn: TODAY, shift: 'evening', milli: 200_000n },
      { collectedOn: addDays(TODAY, -1), shift: 'morning', milli: 100_000n },
    ]);
    const b = s.buckets[12];
    expect(b.byShift.morning).toBe('800000');
    expect(b.byShift.evening).toBe('200000');
    expect(b.totalMilli).toBe('1000000');
    expect([...SHIFTS]).toEqual(['morning', 'evening']); // the order of the day
  });

  it('carries an UNDECLARED shift instead of dropping it from a chart that claims to show volume', () => {
    // A tenant's third collection, or a future value of the `milk_shift` enum.
    const s = shiftSeries(range, [{ collectedOn: TODAY, shift: 'night', milli: 55_000n }]);
    expect(s.shifts).toContain('night');
    expect(s.buckets[12].byShift.night).toBe('55000');
    expect(s.buckets[12].totalMilli).toBe('55000');
    // ...and every bucket carries the key, so the table has no ragged rows.
    expect(s.buckets[0].byShift.night).toBe('0');
  });

  it('drops a row OUTSIDE the window rather than folding it into an edge bucket', () => {
    // Absorbing it would hide a broken repository predicate behind a plausible chart.
    const s = shiftSeries(range, [
      { collectedOn: addDays(range.from, -1), shift: 'morning', milli: 999_000n },
      { collectedOn: addDays(range.to, 1), shift: 'morning', milli: 888_000n },
    ]);
    expect(s.buckets.every((b) => b.totalMilli === '0')).toBe(true);
  });

  it('places a pour on a bucket BOUNDARY in exactly one bucket', () => {
    const s = shiftSeries(range, []);
    const seam = s.buckets[5].to;
    const one = shiftSeries(range, [{ collectedOn: seam, shift: 'morning', milli: 1_000n }]);
    expect(one.buckets.filter((b) => b.totalMilli !== '0').length).toBe(1);
    expect(one.buckets[5].totalMilli).toBe('1000');
    const next = shiftSeries(range, [{ collectedOn: addDays(seam, 1), shift: 'morning', milli: 1_000n }]);
    expect(next.buckets[6].totalMilli).toBe('1000');
  });
});

/* =============================================================================================================== */
/* THE PREMIUM PANEL                                                                                               */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · what moved the rate', () => {
  const counts = (pourers: number, earned: number, would: number) =>
    ({ pourers, earnedCount: earned, wouldQualifyCount: would });

  it('reports EARNED with the slabs on and WOULD-QUALIFY with them off — never blurred', () => {
    const on = premiumTrend({
      slabs: [FAT_SLAB, FAT_SLAB_LOW], slabsApplied: true,
      current: counts(312, 184, 205), previous: counts(294, 141, 160),
    });
    if (on.current.kind !== 'measured') throw new Error('unreachable');
    expect(on.current.basis).toBe('earned');
    expect(on.current.qualifying).toBe(184);   // the money that moved, not the forecast
    expect(on.comparable).toBe(true);
    expect((on.change as { delta: string }).delta).toBe('43'); // 184 was 141 — W172's own pair

    const off = premiumTrend({
      slabs: [FAT_SLAB, FAT_SLAB_LOW], slabsApplied: false,
      current: counts(312, 184, 205), previous: counts(294, 141, 160),
    });
    if (off.current.kind !== 'measured') throw new Error('unreachable');
    expect(off.current.basis).toBe('would_qualify');
    expect(off.current.qualifying).toBe(205);  // a forecast, and the word "would" is on the screen
  });

  /**
   * **THE MUTATION PASS FOUND THIS ONE.** The first version of `premiumTrend` derived BOTH windows' basis from one
   * `slabsApplied`, read now — so a cooperative that switched the slabs on forty days ago saw its previous ninety days
   * labelled "members actually paid a premium" when nobody was paid a paisa, and the basis-equality guard could never
   * fire because both labels came from the same variable. Removing the guard changed nothing, which is how the mutant
   * survived. The previous window's basis now comes from MONEY.
   */
  it('reads the previous window\'s basis from money, not from today\'s flag', () => {
    // The slabs were ON in the previous window (141 members were PAID) and are OFF now. Today's flag would have
    // labelled that window "would qualify" — the reverse of the truth.
    const v = premiumTrend({
      slabs: [FAT_SLAB], slabsApplied: false,
      current: counts(312, 0, 205), previous: counts(294, 141, 160),
    });
    if (v.previous.kind !== 'measured') throw new Error('expected a measured previous window');
    expect(v.previous.basis).toBe('earned');
    expect(v.previous.qualifying).toBe(141);       // the money that moved, not the 160 that would have qualified
    if (v.current.kind !== 'measured') throw new Error('unreachable');
    expect(v.current.basis).toBe('would_qualify');
    // Two windows, two different things measured. NOT a trend — and this is the assertion the mutant had to survive.
    expect(v.comparable).toBe(false);
    expect(v.change).toBeNull();
  });

  it('compares the two windows when money moved in both', () => {
    const v = premiumTrend({
      slabs: [FAT_SLAB], slabsApplied: true,
      current: counts(312, 184, 205), previous: counts(294, 141, 160),
    });
    expect(v.comparable).toBe(true);
    expect((v.change as { delta: string }).delta).toBe('43');   // 184, was 141 — W172's own pair
  });

  it('compares two FORECASTS, because they are forecasts of the same kind', () => {
    // Nothing paid in either window and the flag is off now: both counts are "would qualify" and comparable.
    const v = premiumTrend({
      slabs: [FAT_SLAB], slabsApplied: false,
      current: counts(312, 0, 205), previous: counts(294, 0, 160),
    });
    if (v.current.kind !== 'measured' || v.previous.kind !== 'measured') throw new Error('unreachable');
    expect(v.current.basis).toBe('would_qualify');
    expect(v.previous.basis).toBe('would_qualify');
    expect(v.comparable).toBe(true);
    expect((v.change as { delta: string }).delta).toBe('45');
  });

  it('says the previous basis is UNKNOWN rather than inventing a collapse in quality', () => {
    // Premiums ARE being paid now; the previous window paid nothing. Either the slabs were off back then, or they were
    // on and nobody cleared the band. This platform holds no flag history, so neither is claimed — and printing
    // "was 0" would manufacture a collapse in milk quality out of a setting nobody wrote down.
    const v = premiumTrend({
      slabs: [FAT_SLAB], slabsApplied: true,
      current: counts(312, 184, 205), previous: counts(294, 0, 160),
    });
    expect(v.previous.kind).toBe('basis_unknown');
    expect(v.comparable).toBe(false);
    expect(v.change).toBeNull();
    // It is not a zero and it is not a no_pours: 294 members DID pour in that window.
    expect(v.previous.kind).not.toBe('no_pours');
  });

  it('says NO POURS, not UNKNOWN, when nobody poured in the previous window', () => {
    const v = premiumTrend({
      slabs: [FAT_SLAB], slabsApplied: true,
      current: counts(312, 184, 205), previous: counts(0, 0, 0),
    });
    expect(v.previous.kind).toBe('no_pours');
    expect(v.comparable).toBe(false);
  });

  it('refuses the comparison when there is no previous window at all', () => {
    const v = premiumTrend({ slabs: [FAT_SLAB], slabsApplied: true, current: counts(312, 184, 205), previous: null });
    expect(v.comparable).toBe(false);
    expect(v.change).toBeNull();
    expect(v.previous.kind).toBe('no_pours');
  });

  it('says NO SLABS rather than zero when the card promises no premium', () => {
    const v = premiumTrend({ slabs: [], slabsApplied: true, current: counts(312, 0, 0), previous: counts(294, 0, 0) });
    expect(v.current.kind).toBe('no_slabs');
    expect(v.comparable).toBe(false);
    // A cooperative whose card promises no premium is not one whose members all missed one.
  });

  it('says NO POURS rather than a zero share when nobody poured', () => {
    const v = premiumTrend({ slabs: [FAT_SLAB], slabsApplied: true, current: counts(0, 0, 0), previous: counts(294, 141, 160) });
    expect(v.current.kind).toBe('no_pours');
    expect(v.comparable).toBe(false);
  });
});

/* =============================================================================================================== */
/* THE READ MODEL                                                                                                  */
/* =============================================================================================================== */

type Totals = { milli: bigint; amountMinor: bigint; bonusMinor: bigint; daysWithPours: number; pourers: number; pours: number };

function harness(over: {
  flags?: Record<string, boolean>;
  firstPourOn?: string | null;
  money?: { currencyCode: string; minorUnits: number } | null;
  totals?: (from: string) => Totals;
  cohorts?: { active: number; newcomers: number; winBacks: number };
  cycles?: { closed: number; allBillsApproved: number };
  cards?: Array<{ id: string; defaultName: string; animalType: string; pricingModel: string; slabs: BonusSlab[]; effectiveFrom: string; effectiveTo: string | null }>;
  premium?: (from: string) => { pourers: number; earned: number; wouldQualify: number };
  cycleMix?: Array<{ paymentCycle: string; members: number }>;
} = {}) {
  const flags: Record<string, boolean> = { [INSIGHTS_FLAG]: true, [BONUS_SLABS_FLAG]: true, ...(over.flags ?? {}) };
  const calls: string[] = [];
  const zero: Totals = { milli: 0n, amountMinor: 0n, bonusMinor: 0n, daysWithPours: 0, pourers: 0, pours: 0 };

  const repo = {
    moneyShape: async () => (over.money === undefined ? { currencyCode: 'INR', minorUnits: 2 } : over.money),
    firstPourSince: async (_t: string, since: string) => {
      calls.push(`firstPourSince:${since}`);
      return over.firstPourOn === undefined ? '2025-01-01' : over.firstPourOn;
    },
    windowTotals: async (_t: string, from: string, to: string) => {
      calls.push(`windowTotals:${from}..${to}`);
      return over.totals ? over.totals(from) : zero;
    },
    dailyByShift: async (_t: string, from: string, to: string) => { calls.push(`dailyByShift:${from}..${to}`); return []; },
    cohortCounts: async (_t: string, f: string, _to: string, lb: string, pf: string) => {
      calls.push(`cohortCounts:${f}|${lb}|${pf}`);
      return over.cohorts ?? { active: 0, newcomers: 0, winBacks: 0 };
    },
    cycleFacts: async (_t: string, from: string, to: string) => {
      calls.push(`cycleFacts:${from}..${to}`);
      return over.cycles ?? { closed: 0, allBillsApproved: 0 };
    },
  };
  const quality = {
    today: async () => TODAY,
    membershipCycleMix: async () => over.cycleMix ?? [{ paymentCycle: 'fortnightly', members: 214 }],
    cardsInForce: async (_t: string, on: string) => { calls.push(`cardsInForce:${on}`); return (over.cards ?? []) as never[]; },
    premiumBandCounts: async (_t: string, from: string, _to: string, minFat: number | null) => {
      calls.push(`premiumBandCounts:${from}|${minFat}`);
      return over.premium ? over.premium(from) : { pourers: 0, earned: 0, wouldQualify: 0 };
    },
  };
  const flagsSvc = { isEnabled: async (k: string) => flags[k] ?? false };
  const metrics = { increment: () => {}, observe: () => {}, gauge: () => {}, timing: () => {} };
  const rm = new DairyInsightsReadModel(repo as never, quality as never, flagsSvc as never, metrics as never);
  return { rm, calls, flags };
}

const ACTOR = { userId: 'u1', canDrillDown: false };

describe('PC-56 TENANT-6e-1 · the read model', () => {
  it('says the insights are NOT SWITCHED ON, and reads nothing else', async () => {
    const h = harness({ flags: { [INSIGHTS_FLAG]: false } });
    const v = await h.rm.view('t1', ACTOR);
    expect(v).toEqual({ kind: 'not_enabled', flag: 'dairy_insights' });
    // Not a page of zeroes, and not a single query: a cooperative reading "0 L/day" learns that it collected no milk.
    expect(h.calls).toEqual([]);
  });

  it('FAILS CLOSED when the flag store cannot answer', async () => {
    const rm = new DairyInsightsReadModel(
      {} as never, {} as never,
      { isEnabled: async () => { throw new Error('flag store down'); } } as never,
      { increment: () => {}, observe: () => {}, gauge: () => {}, timing: () => {} } as never,
    );
    // The reader cannot tell "we chose to show you this" from "we could not check", so the page must not draw.
    await expect(rm.view('t1', ACTOR)).resolves.toEqual({ kind: 'not_enabled', flag: 'dairy_insights' });
  });

  it('says NO DATA before it asks any window question', async () => {
    const h = harness({ firstPourOn: null });
    const v = await h.rm.view('t1', ACTOR);
    expect(v.kind).toBe('no_data');
    expect(h.calls.filter((c) => c.startsWith('windowTotals'))).toEqual([]);
  });

  it('holds the page under two cycles, but still says how many members poured', async () => {
    const h = harness({
      firstPourOn: addDays(TODAY, -22),               // 23 days, fortnightly -> 1 cycle
      totals: () => ({ milli: 1n, amountMinor: 1n, bonusMinor: 0n, daysWithPours: 3, pourers: 62, pours: 9 }),
    });
    const v = await h.rm.view('t1', ACTOR);
    expect(v.kind).toBe('not_enough_history');
    if (v.kind !== 'not_enough_history') throw new Error('unreachable');
    expect(v.pourersSoFar).toBe(62);
    // Exactly ONE window was read — the current one. The comparison it cannot make is not attempted.
    expect(h.calls.filter((c) => c.startsWith('windowTotals')).length).toBe(1);
  });

  it('bounds the first-pour search at the declared lookback, never at all time', async () => {
    const h = harness();
    await h.rm.view('t1', ACTOR);
    const r = insightRanges(TODAY, 90);
    expect(h.calls).toContain(`firstPourSince:${r.lookbackFrom}`);
  });

  it("reads the two windows, the cohort floor and the previous window's start — each once", async () => {
    const h = harness();
    await h.rm.view('t1', ACTOR);
    const r = insightRanges(TODAY, 90);
    expect(h.calls).toContain(`windowTotals:${r.current.from}..${r.current.to}`);
    expect(h.calls).toContain(`windowTotals:${r.previous.from}..${r.previous.to}`);
    // The cohort query needs THREE distinct dates and they must not be confused: the window start, the year floor, and
    // the previous window's start (which is what "nothing for a whole window" means).
    expect(h.calls).toContain(`cohortCounts:${r.current.from}|${r.lookbackFrom}|${r.previous.from}`);
    expect(h.calls.filter((c) => c.startsWith('cardsInForce')).length).toBe(1);
    expect(h.calls.filter((c) => c.startsWith('premiumBandCounts')).length).toBe(2);
  });

  it("refuses the whole page rather than guessing a currency's scale", async () => {
    const h = harness({ money: null });
    const v = await h.rm.view('t1', ACTOR);
    expect(v.kind).toBe('unavailable');
    if (v.kind !== 'unavailable') throw new Error('unreachable');
    // The missing reference row is NAMED. Guessing two decimals is wrong by a factor of a hundred for a currency that
    // has none — 6d-7's ruling, and Rule Zero.
    expect(v.missing.join(' ')).toContain('minor_units');
  });

  it('takes the premium THRESHOLD from the cards in force, never from a literal', async () => {
    const h = harness({
      cards: [
        { id: 'c1', defaultName: 'Buffalo two-axis', animalType: 'buffalo', pricingModel: 'two_axis', slabs: [FAT_SLAB], effectiveFrom: '2026-07-01', effectiveTo: null },
        { id: 'c2', defaultName: 'Cow pooled', animalType: 'cow', pricingModel: 'fat_pooled', slabs: [FAT_SLAB_LOW], effectiveFrom: '2026-06-01', effectiveTo: null },
      ],
      premium: () => ({ pourers: 312, earned: 184, wouldQualify: 205 }),
    });
    await h.rm.view('t1', ACTOR);
    // The LOWEST fat slab across every card in force is the band a member must clear to be in the premium band at all.
    // 620, not 650: a cooperative rewarding fat at 6.2 must not read its own screen quoting somebody else's slab.
    expect(h.calls.filter((c) => c.startsWith('premiumBandCounts')).every((c) => c.endsWith('|620'))).toBe(true);
  });

  it('passes a NULL threshold when no card promises a premium, rather than inventing one', async () => {
    const h = harness({ cards: [{ id: 'c1', defaultName: 'flat', animalType: 'cow', pricingModel: 'fat_pooled', slabs: [], effectiveFrom: '2026-01-01', effectiveTo: null }] });
    await h.rm.view('t1', ACTOR);
    expect(h.calls.filter((c) => c.startsWith('premiumBandCounts')).every((c) => c.endsWith('|null'))).toBe(true);
  });

  it('carries the slab flag into the premium basis and reports the bonus actually paid', async () => {
    const paid = harness({
      cards: [{ id: 'c1', defaultName: 'x', animalType: 'cow', pricingModel: 'two_axis', slabs: [FAT_SLAB], effectiveFrom: '2026-01-01', effectiveTo: null }],
      premium: () => ({ pourers: 312, earned: 184, wouldQualify: 205 }),
      totals: () => ({ milli: 9_000n, amountMinor: 7_000n, bonusMinor: 640n, daysWithPours: 5, pourers: 312, pours: 40 }),
    });
    const on = await paid.rm.view('t1', ACTOR);
    if (on.kind !== 'ready') throw new Error('unreachable');
    expect(on.slabsApplied).toBe(true);
    expect(on.bonusMinor).toBe('640');
    expect(on.premium.current.kind === 'measured' && on.premium.current.basis).toBe('earned');

    const off = harness({
      flags: { [BONUS_SLABS_FLAG]: false },
      cards: [{ id: 'c1', defaultName: 'x', animalType: 'cow', pricingModel: 'two_axis', slabs: [FAT_SLAB], effectiveFrom: '2026-01-01', effectiveTo: null }],
      premium: () => ({ pourers: 312, earned: 184, wouldQualify: 205 }),
    });
    const v = await off.rm.view('t1', ACTOR);
    if (v.kind !== 'ready') throw new Error('unreachable');
    expect(v.slabsApplied).toBe(false);
    expect(v.premium.current.kind === 'measured' && v.premium.current.basis).toBe('would_qualify');
  });

  it('FAILS CLOSED on the bonus-slab flag, so a forecast is never labelled as money paid', async () => {
    // Same rule as the page's own flag, for a sharper reason: with the slab store unreachable, opening would print
    // "205 members were PAID a premium" over a window in which nobody was paid anything.
    const rm = new DairyInsightsReadModel(
      {
        moneyShape: async () => ({ currencyCode: 'INR', minorUnits: 2 }),
        firstPourSince: async () => '2025-01-01',
        windowTotals: async () => ({ milli: 9_000n, amountMinor: 7_000n, bonusMinor: 0n, daysWithPours: 5, pourers: 312, pours: 40 }),
        dailyByShift: async () => [],
        cohortCounts: async () => ({ active: 312, newcomers: 18, winBacks: 4 }),
        cycleFacts: async () => ({ closed: 2, allBillsApproved: 2 }),
      } as never,
      {
        today: async () => TODAY,
        membershipCycleMix: async () => [{ paymentCycle: 'fortnightly', members: 214 }],
        cardsInForce: async () => ([{ id: 'c1', defaultName: 'x', animalType: 'cow', pricingModel: 'two_axis', slabs: [FAT_SLAB], effectiveFrom: '2026-01-01', effectiveTo: null }] as never),
        premiumBandCounts: async () => ({ pourers: 312, earned: 184, wouldQualify: 205 }),
      } as never,
      // The PAGE's flag answers; only the slab flag throws.
      { isEnabled: async (k: string) => { if (k === BONUS_SLABS_FLAG) throw new Error('flag store down'); return true; } } as never,
      { increment: () => {}, observe: () => {}, gauge: () => {}, timing: () => {} } as never,
    );
    const v = await rm.view('t1', ACTOR);
    if (v.kind !== 'ready') throw new Error('unreachable');
    expect(v.slabsApplied).toBe(false);
    expect(v.premium.current.kind === 'measured' && v.premium.current.basis).toBe('would_qualify');
  });

  it('answers the drill-down from the ACTOR and nothing else', async () => {
    const h = harness();
    expect((await h.rm.view('t1', { userId: 'u1', canDrillDown: false }) as { memberDrillDown: boolean }).memberDrillDown).toBe(false);
    expect((await h.rm.view('t1', { userId: 'u1', canDrillDown: true }) as { memberDrillDown: boolean }).memberDrillDown).toBe(true);
  });

  it("derives the cycle from the members' own preference, dominant first — 0155's rule", async () => {
    // A monthly-dominant cooperative needs 60 days before the page opens; a weekly one needs 14. Same history, two
    // answers, and the derivation must be the one every other dairy screen uses.
    const hist = addDays(TODAY, -20);
    const monthly = harness({ firstPourOn: hist, cycleMix: [{ paymentCycle: 'monthly', members: 200 }, { paymentCycle: 'weekly', members: 3 }] });
    const weekly = harness({ firstPourOn: hist, cycleMix: [{ paymentCycle: 'weekly', members: 200 }] });
    expect((await monthly.rm.view('t1', ACTOR)).kind).toBe('not_enough_history');
    expect((await weekly.rm.view('t1', ACTOR)).kind).toBe('ready');
  });

  it('carries the whole ready page, and every refusal on it', async () => {
    const h = harness({
      totals: (from) => (from === '2026-05-24'
        ? { milli: 376_200_000n, amountMinor: 19_411_920_00n, bonusMinor: 640n, daysWithPours: 88, pourers: 312, pours: 5_000 }
        : { milli: 344_700_000n, amountMinor: 17_064_650_00n, bonusMinor: 0n, daysWithPours: 84, pourers: 294, pours: 4_600 }),
      cohorts: { active: 312, newcomers: 18, winBacks: 4 },
      cycles: { closed: 6, allBillsApproved: 5 },
    });
    const v = await h.rm.view('t1', ACTOR);
    if (v.kind !== 'ready') throw new Error('unreachable');
    expect(v.currencyCode).toBe('INR');
    expect(v.minorUnits).toBe(2);
    expect(v.endsOnPartialDay).toBe(true);
    expect(v.volume.perDayMilli).toBe('4180000');
    expect(v.pourers.kind).toBe('measured');
    expect(v.payoutStreak.kind).toBe('not_recorded');
    expect(v.payoutStreak.cyclesClosed).toBe(6);
    expect(v.spoilage.kind).toBe('not_measurable');
    expect(v.byShift.buckets.length).toBe(13);
    expect(v.history.kind).toBe('ready');
  });

  it('honours a narrower window end to end', async () => {
    const h = harness();
    const v = await h.rm.view('t1', ACTOR, { window: 30 });
    if (v.kind !== 'ready') throw new Error('unreachable');
    expect(v.ranges.window).toBe(30);
    expect(v.ranges.current.days).toBe(30);
    expect(v.byShift.buckets.length).toBe(5);   // 30 days = 4 weeks and 2 days
    expect(v.byShift.firstBucketDays).toBe(2);
  });
});

/* =============================================================================================================== */
/* THE ROUTE                                                                                                       */
/* =============================================================================================================== */

describe('PC-56 TENANT-6e-1 · the route', () => {
  it('is a GET on dairy/insights behind dairy.manage and the MODULE flag only', () => {
    const proto = DairyInsightsController.prototype as unknown as Record<string, unknown>;
    expect(Reflect.getMetadata(METHOD_METADATA, proto.view as object)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, DairyInsightsController)).toBe('dairy/insights');
    expect(Reflect.getMetadata(VERSION_METADATA, DairyInsightsController)).toBe('1');
    // The route itself carries no path segment: one GET at the collection, no parameterised sibling, so the route-order
    // trap this programme has documented six times cannot apply here.
    expect(Reflect.getMetadata(PATH_METADATA, proto.view as object)).toBe('/');

    // THE SCREEN'S OWN FLAG MUST NOT BE ON THE ROUTE. `FeatureFlagGuard` answers a disabled flag with 404, which is
    // indistinguishable from a mistyped URL — so W172's flagged-off state, which has words in it, would be unreachable.
    const flags = Reflect.getMetadata('feature_flag', DairyInsightsController) as string[];
    expect(flags).toEqual(['dairy']);
    expect(flags).not.toContain(INSIGHTS_FLAG);
    expect(Reflect.getMetadata('feature_flag', proto.view as object)).toBeUndefined();
  });

  it('resolves the drill-down through the policy, so god mode is not accidentally excluded', () => {
    const ctx = (perms: string[]) => ({ permissions: new Set(perms) }) as never;
    expect(canDrillDownMember(ctx(['member.view360']))).toBe(true);
    expect(canDrillDownMember(ctx(['*']))).toBe(true);
    expect(canDrillDownMember(ctx(['dairy.manage']))).toBe(false);
    // A read model testing `permissions.includes` itself would have missed `'*'` and been a second place authorisation
    // is decided.
  });

  it('has the flag in the migration, OFF, with the kill-switch shape Law 10 requires', () => {
    const m = mig();
    expect(m).toContain("'dairy_insights'");
    expect(m).toMatch(/'dairy_insights',[\s\S]*?false, 100, 'experiment'/);
    expect(m).toContain('ON CONFLICT (key) DO NOTHING');
    // W172's footnote is kept: no table, no view, no rollup.
    expect(m).not.toMatch(/CREATE TABLE/i);
    expect(m).not.toMatch(/CREATE MATERIALIZED VIEW/i);
    // ...and no redundant index either: 0155's and 0157's already lead with tenant_id.
    expect(m).not.toMatch(/CREATE INDEX/i);
    expect(m).toContain('idx_milkcoll_tenant_day_shift');
  });
});
