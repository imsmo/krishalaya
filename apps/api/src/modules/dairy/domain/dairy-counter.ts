// modules/dairy/domain/dairy-counter.ts · W167 (Dairy — collections) as PURE rules (PC-56 TENANT-6a).
// No I/O and no clock of its own: the day, the shift and every aggregate are passed in, so the same rules serve the
// API, the console and any future export, and a mutation test can reach all of them.
//
// W167's lead: *"312 pourers · 2 shifts/day · Lactoscan-metered fat/SNF at the counter · every drop rated by the
// active rate card. Cycle 01–15 Jul closes Wed 15, pays Fri 17 Jul."* Four claims in one sentence, and they are not
// equally true on this platform — which is what most of this file is about.
import { PaymentCycle } from './dairy.events';

/* --------------------------------------------------------------------------------------------------------- */
/* THE SHIFT                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/** 0007's own vocabulary, and the only two values `milk_collections.shift` accepts. */
export const SHIFTS = ['morning', 'evening'] as const;
export type Shift = (typeof SHIFTS)[number];

export function isShift(v: unknown): v is Shift {
  return typeof v === 'string' && (SHIFTS as readonly string[]).includes(v);
}

/**
 * W167 prints *"evening starts 17:00"* and its empty state says *"Morning shift opens 06:00"*.
 *
 * **There is no shift clock on this platform.** No column, no setting, no per-centre schedule: `milk_collections`
 * carries a `shift` label and a `collected_on` DATE, and nothing anywhere records when a shift opens or closes. Those
 * two times are the ones an operator would plan a queue around and a farmer would walk to the centre for, so the desk
 * states the shift it is showing and refuses to print an hour. A per-centre shift window is a real thing to build
 * (it belongs with the centre, which is TENANT-6d's screen) and a plausible one would send people to a closed door.
 */
export type ShiftClockVerdict = { kind: 'not_recorded'; missing: readonly string[] };
export function shiftClockVerdict(): ShiftClockVerdict {
  return { kind: 'not_recorded', missing: ['mcc_shift_open_at', 'mcc_shift_close_at'] };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE CYCLE — DERIVED, BECAUSE NOTHING DEFINES ONE                                                          */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W167: *"Cycle 01–15 Jul closes Wed 15, pays Fri 17 Jul."* W169 is a whole screen about those cycles.
 *
 * **No cycle exists as a record on this platform.** `dairy_memberships.payment_cycle` stores each member's
 * preference (daily | weekly | fortnightly | monthly) and **nothing reads it** — `grep` finds only the repository
 * round-tripping the column. `milk_bills.period_start/period_end` are whatever a caller passed in, and
 * `MilkBillCycleCloseJob` — the only thing that would generate bills on a clock — **is instantiated nowhere** (its
 * own header says "instantiated by apps/worker"; apps/worker does not). So bills have never been generated on a
 * schedule, and no calendar says which fortnight is running.
 *
 * The window is therefore DERIVED here, from the member's own stored preference and the calendar, as a pure rule:
 *   • fortnightly → 01–15 and 16–end-of-month (the canon's own "01–15 Jul");
 *   • monthly     → the calendar month;
 *   • weekly      → Monday–Sunday containing the day (W171: "pays every Friday" — that is a PAYDAY, not a window);
 *   • daily       → the day itself.
 * Deriving it is honest — the inputs are real and the rule is stated — but it is NOT the same as a cycle the
 * platform has committed to, so the desk labels the window `derived` and TENANT-6c owns making it a record with a
 * close and a payday.
 */
export interface CycleWindow { from: string; to: string; cycle: PaymentCycle; basis: 'derived_from_membership_preference' }

const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Parse YYYY-MM-DD as a UTC date. Dates on this desk are calendar days (`collected_on` is a DATE), so they are
 *  handled as UTC throughout and never as local instants — that is how an "01–15" window slips to "31–14". */
function utcDay(day: string): Date {
  const [y, m, d] = day.split('-').map((n) => Number(n));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

export function cycleWindow(day: string, cycle: PaymentCycle): CycleWindow {
  const base = utcDay(day);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const dom = base.getUTCDate();
  const eom = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  switch (cycle) {
    case 'daily':
      return { from: day, to: day, cycle, basis: 'derived_from_membership_preference' };
    case 'weekly': {
      // ISO week: Monday starts it. `getUTCDay()` is 0=Sunday, so Sunday must go BACK six days, not forward one.
      const dow = base.getUTCDay();
      const back = (dow + 6) % 7;
      const from = new Date(base.getTime() - back * DAY_MS);
      return { from: iso(from), to: iso(new Date(from.getTime() + 6 * DAY_MS)), cycle, basis: 'derived_from_membership_preference' };
    }
    case 'fortnightly':
      return dom <= 15
        ? { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m, 15))), cycle, basis: 'derived_from_membership_preference' }
        : { from: iso(new Date(Date.UTC(y, m, 16))), to: iso(new Date(Date.UTC(y, m, eom))), cycle, basis: 'derived_from_membership_preference' };
    default:
      return { from: iso(new Date(Date.UTC(y, m, 1))), to: iso(new Date(Date.UTC(y, m, eom))), cycle, basis: 'derived_from_membership_preference' };
  }
}

/**
 * W167 also promises a CLOSE ("closes Wed 15") and a PAYDAY ("pays Fri 17 Jul", W169: "with ambassador weekly run —
 * one bank trip").
 *
 * The close is the window's own last day, which is derivable. **The payday is not**: nothing on this platform records
 * when a dairy cycle pays, and W169's payday is tied to a logistics run ("one bank trip") that no dairy row
 * references. Refused, with what it would need named — a promised payday nobody keeps is the single worst thing this
 * desk could print, because 312 families plan a week around it.
 */
export type PaydayVerdict = { kind: 'not_recorded'; closesOn: string; missing: readonly string[] };
export function paydayVerdict(w: CycleWindow): PaydayVerdict {
  return { kind: 'not_recorded', closesOn: w.to, missing: ['dairy_cycle_calendar', 'cycle_payday_rule'] };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE DAY'S BOARD                                                                                           */
/* --------------------------------------------------------------------------------------------------------- */

/** One centre's numbers for one shift, as the database can produce them. Quantities are SCALED INTEGERS — weight in
 *  milli-kg, fat/SNF in centi-percent — because that is how they are stored and how they are priced (float-free). */
export interface CentreShiftRow {
  mccId: string; code: string; name: string;
  analyzerModel: string | null; analyzerSerial: string | null;
  pours: number; pourers: number;
  weightMilliKg: bigint;
  /** Weighted by litres, not a mean of means: a 900-litre centre and a 90-litre centre do not carry equal votes in
   *  their own averages, and averaging the two averages is the classic way to report a quality figure nobody has. */
  fatCentiPctWeighted: bigint | null;
  snfCentiPctWeighted: bigint | null;
  amountMinor: bigint;
  flags: number;
  membershipsEnrolled: number;
}

/** Litres, to one decimal, from milli-kg. Milk is weighed and sold by litre-equivalents on this desk; the conversion
 *  is 1:1 by convention here (the platform stores kg and W167 prints L), and that convention is stated rather than
 *  hidden in a template. */
export function litresText(weightMilliKg: bigint): string {
  const tenths = (weightMilliKg + 50n) / 100n;         // milli-kg → tenths of a litre, round-half-up
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** Fat/SNF percent to one decimal from centi-percent — integer arithmetic, and null when there was nothing to
 *  average (which is not 0.0%: a centre with no pours has no quality). */
export function pctText(centiPct: bigint | null): string | null {
  if (centiPct === null) return null;
  const tenths = (centiPct + 5n) / 10n;
  return `${tenths / 10n}.${tenths % 10n}`;
}

export interface BoardTotals {
  pours: number; pourers: number; weightMilliKg: bigint; amountMinor: bigint; flags: number;
  membershipsEnrolled: number;
  fatCentiPctWeighted: bigint | null;
  snfCentiPctWeighted: bigint | null;
}

/**
 * The day's totals, summed from the centre rows — and the check W167 prints at the foot of its table
 * (*"3 MCCs · 2,148 L morning total ✓"*).
 *
 * `pourers` is summed across centres because a membership belongs to exactly ONE centre (`dairy_memberships.mcc_id`),
 * so no person can be double-counted; that assumption is stated here because if memberships ever became multi-centre
 * this sum would silently start over-counting people.
 */
export function boardTotals(rows: readonly CentreShiftRow[]): BoardTotals {
  let pours = 0, pourers = 0, flags = 0, enrolled = 0;
  let weight = 0n, amount = 0n, fatNum = 0n, snfNum = 0n, fatDen = 0n, snfDen = 0n;
  for (const r of rows) {
    pours += r.pours; pourers += r.pourers; flags += r.flags; enrolled += r.membershipsEnrolled;
    weight += r.weightMilliKg; amount += r.amountMinor;
    if (r.fatCentiPctWeighted !== null) { fatNum += r.fatCentiPctWeighted * r.weightMilliKg; fatDen += r.weightMilliKg; }
    if (r.snfCentiPctWeighted !== null) { snfNum += r.snfCentiPctWeighted * r.weightMilliKg; snfDen += r.weightMilliKg; }
  }
  return {
    pours, pourers, weightMilliKg: weight, amountMinor: amount, flags, membershipsEnrolled: enrolled,
    fatCentiPctWeighted: fatDen > 0n ? (fatNum + fatDen / 2n) / fatDen : null,
    snfCentiPctWeighted: snfDen > 0n ? (snfNum + snfDen / 2n) / snfDen : null,
  };
}

/** W167's *"287 of 312 pourers"*. Reported as a pair with a share in basis points, never as a bare percentage: an
 *  operator chasing the 25 who have not come needs the count, and the share is what tells them whether today is
 *  unusual. */
export type CoverageVerdict =
  | { kind: 'measured'; poured: number; enrolled: number; shareBps: number }
  | { kind: 'no_memberships' };

export function coverage(t: Pick<BoardTotals, 'pourers' | 'membershipsEnrolled'>): CoverageVerdict {
  if (t.membershipsEnrolled <= 0) return { kind: 'no_memberships' };
  return {
    kind: 'measured', poured: t.pourers, enrolled: t.membershipsEnrolled,
    shareBps: Math.round((t.pourers * 10_000) / t.membershipsEnrolled),
  };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE THINGS THE BOARD MAY NOT CLAIM                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W167's MCC table has a **BMC temp** column (3.8°C · 4.1°C · 6.9°C ↑) and its own "see BMC" link.
 *
 * `bmc_units` (0007) has capacity, a target temperature and an `iot_device_ref` — and **no application code
 * anywhere**: `grep -rln "bmc_units\|bmcUnit" apps/ packages/` returns nothing. `cold_chain_logs` DOES accept
 * `subject_type = 'bmc_unit'` (it is in `COLD_CHAIN_SUBJECTS`), so the stream the canon names is reachable in
 * principle — and nothing has ever written a reading for one. So the column is reported as `not_recorded` per centre
 * rather than left blank (a blank cell reads as "cold enough to not mention") and TENANT-6d owns the monitor.
 */
export type BmcTempVerdict =
  | { kind: 'reading'; tempC: string; recordedAt: string; targetC: string | null; overTarget: boolean }
  | { kind: 'no_unit' }
  | { kind: 'no_readings'; unitId: string; targetC: string | null };

export function bmcTempVerdict(i: { unitId: string | null; targetC: string | null; tempC: string | null; recordedAt: string | null }): BmcTempVerdict {
  if (!i.unitId) return { kind: 'no_unit' };
  if (i.tempC === null || i.recordedAt === null) return { kind: 'no_readings', unitId: i.unitId, targetC: i.targetC };
  // Compared as scaled integers via the string's own decimal — one place, so a tolerance band cannot drift between
  // this desk and the monitor that TENANT-6d will build.
  const over = i.targetC !== null && Number(i.tempC) > Number(i.targetC);
  return { kind: 'reading', tempC: i.tempC, recordedAt: i.recordedAt, targetC: i.targetC, overTarget: over };
}

/**
 * W167's **Analyzer** column ("Lactoscan SP ✓") and its lead's claim that fat/SNF are *"Lactoscan-metered at the
 * counter"*.
 *
 * Half true, and the halves matter. The CENTRE's analyzer is real: `mcc_centres.analyzer_model` and
 * `analyzer_serial` are recorded and this desk prints them. What is NOT recorded is that any particular pour came
 * from that device: `milk_collections.device_payload` — the column built for exactly that evidence — **is dead**
 * (no writer, no reader, anywhere), and the API accepts fat/SNF as plain decimal strings from whoever is calling. So
 * a tick on this column means "this centre has an analyzer on file", never "this reading came out of it", and the
 * desk says which. It matters because W168 rests a member's money and an adulteration flag on the reading.
 */
export type AnalyzerVerdict =
  | { kind: 'on_file'; model: string; serial: string | null; perPourEvidence: false }
  | { kind: 'none_on_file' };

export function analyzerVerdict(i: { model: string | null; serial: string | null }): AnalyzerVerdict {
  if (!i.model) return { kind: 'none_on_file' };
  return { kind: 'on_file', model: i.model, serial: i.serial, perPourEvidence: false };
}

/**
 * W167's **"Value accrued (cycle to date) ₹24,88,200 · 312 milk_bills building"**.
 *
 * The money is real — `milk_collections.amount_minor` is priced by the active rate card at the counter, in bigint
 * (`MilkRateCard.priceMinor`, float-free) — and it is an ACCRUAL, not a payable: it is what the pours are worth
 * before deductions, and W169's bills subtract feed credit, loan EMI and insurance from it. Reported as such.
 *
 * **And the bonus the canon promises is NOT in it.** `milk_rate_cards.bonus_rules` (0007, jsonb) is read by nothing:
 * the pricing engine's own header says the slabs are "DEFERRED", so W168's "Bonus slab: fat ≥ 6.5 → +₹0.50/L" and
 * its "premium band pourers 184 / 312" describe money no pour has ever been paid. This desk therefore reports the
 * accrual as EXCLUDING any bonus, per active card, rather than letting a farmer's total imply a premium they did not
 * receive. TENANT-6b owns the rate card and the fix.
 */
export interface AccrualVerdict {
  kind: 'accrued';
  amountMinor: string;
  currencyCode: string;
  window: CycleWindow;
  /** True when at least one rate card that priced this window carries bonus rules that the engine ignored. */
  bonusRulesIgnored: boolean;
  /** How many memberships have pours in the window — W167's "312 milk_bills building" is a COUNT OF MEMBERS with
   *  collections, not of rows that exist: no bill exists until something generates one, and nothing does on a clock. */
  membersWithPours: number;
  billsExisting: number;
}

export function accrualVerdict(i: {
  amountMinor: bigint; currencyCode: string; window: CycleWindow;
  cardsWithBonusRules: number; membersWithPours: number; billsExisting: number;
}): AccrualVerdict {
  return {
    kind: 'accrued',
    amountMinor: i.amountMinor.toString(),
    currencyCode: i.currencyCode,
    window: i.window,
    bonusRulesIgnored: i.cardsWithBonusRules > 0,
    membersWithPours: i.membersWithPours,
    billsExisting: i.billsExisting,
  };
}

/**
 * W167's *"Adulteration flags today · 1 · water_flag · sample retained · handled with dignity"*.
 *
 * The COUNT is real: `milk_collections.water_flag` and `adulteration_flags` are recorded per pour. What does not
 * exist is anything after it — no retained-sample record, no re-test, no decision, no notification — so "sample
 * retained" is a promise about a physical act this platform does not witness. The count is reported with its own
 * kinds and the desk sends the operator to the quality desk rather than implying the flag has been handled.
 * TENANT-6b owns that workflow.
 */
/**
 * `total` counts FLAGGED POURS, not flag markers — a pour marked both watered and urea-adulterated is ONE pour to
 * chase, one retained sample, one member to talk to.
 *
 * [PC-56 TENANT-6a LIVE FINDING] The first version summed the markers (`water + other`), which made the tile print 2
 * for a single doubly-flagged pour while the table's own flag column — `count(*) FILTER (WHERE water_flag OR …)` in
 * SQL — printed 1 for the same pour. Two mechanisms over one fact, disagreeing, on a screen where the number decides
 * how many samples an operator goes and re-tests. The live integration probe caught it; `total` is now the same
 * quantity the per-centre column counts, and the suite asserts the two agree.
 *
 * `water` and `other` are OVERLAPPING subsets of `total` (a pour can be in both), deliberately: they answer "how many
 * pours look watered" and "how many carry a named adulterant", which is what the quality desk sorts by. They are not
 * a partition and must never be added together.
 */
export interface FlagSummary { total: number; water: number; other: number; kinds: string[]; workflow: 'not_built' }

export function flagSummary(rows: readonly { waterFlag: boolean; adulterationFlags: readonly string[] }[]): FlagSummary {
  let total = 0, water = 0, other = 0;
  const kinds = new Set<string>();
  for (const r of rows) {
    const named = r.adulterationFlags.filter((f) => !!f);
    if (!r.waterFlag && named.length === 0) continue;     // an unflagged row the query should not have returned
    total += 1;
    if (r.waterFlag) { water += 1; kinds.add('water_flag'); }
    if (named.length > 0) { other += 1; for (const f of named) kinds.add(f); }
  }
  return { total, water, other, kinds: [...kinds].sort(), workflow: 'not_built' };
}

/** W167's second promise about a pour: *"Each pour is UNIQUE (member, date, shift) — a second scan the same shift
 *  updates nothing and pays nothing twice."* That one IS enforced, by
 *  `UNIQUE(membership_id, collected_on, shift)` on the table plus the service's typed refusal — so the desk states it
 *  as a fact rather than an aspiration, and the integration probe proves it against the live constraint. */
export const POUR_UNIQUENESS = 'unique_membership_day_shift' as const;
