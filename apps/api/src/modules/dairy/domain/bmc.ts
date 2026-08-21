// modules/dairy/domain/bmc.ts · PC-56 TENANT-6d-1 · W170's arithmetic, and the judgements a monitor is allowed to make.
//
// W170: *"Bulk milk coolers · target 4.0°C (tolerance band to 4.5°C) · IoT temperature stream (cold_chain_logs). Warm
// milk is money evaporating — alerts fire to the operator's phone before the dairy loses a rupee."*
//
// EVERYTHING IS DECI-DEGREES (tenths of a °C), as integers. A cooler's band is 4.0 to 4.5 and its playbook turns on
// 7.5 and 8.0; those are one decimal place, which is exactly the size of number that a float rounds into the wrong
// decision. Same discipline as `core/database/pg-numeric.ts`, at scale 1 — and the same reason: a comparison that
// decides whether 87 families walk to another village must be exact.
//
// WHAT THIS FILE WILL NOT DO:
//   • infer the compressor from the temperature. A tank whose milk is cold may still have a machine about to die, and
//     a tank warming up may have a perfectly healthy compressor and a power cut (which is exactly W170's own scenario).
//     The compressor is somebody's statement (0162), read here, never derived.
//   • call a telemetry gap a temperature. *"Sensors buffer locally; a gap is a connectivity issue, not a temperature
//     unknown"* — so a stale reading is reported as STALE with its age, and never as the tank's current state.
//   • claim litres. W170's *"0 L milk lost to temperature"* is a number nothing on this platform can produce: no
//     mechanism ties a breach to a quantity of milk written off. Named, not printed.

/** The band a cooler is in range for, in deci-degrees. Both ends come from the unit's own row. */
export interface Band { minDeci: number; targetDeci: number; maxDeci: number }

/**
 * `min_temp_c … target_temp_c + tolerance_c`, from the unit.
 *
 * The MAX is derived rather than stored so the two can never disagree: W170 says *"target 4.0°C (tolerance band to
 * 4.5°C)"*, which is one decision (the target) plus how much drift the cooperative tolerates.
 */
export function bandOf(u: { minDeci: number; targetDeci: number; toleranceDeci: number }): Band {
  return { minDeci: u.minDeci, targetDeci: u.targetDeci, maxDeci: u.targetDeci + u.toleranceDeci };
}

export const READING_VERDICTS = ['in_range', 'above_band', 'below_min'] as const;
export type ReadingVerdict = (typeof READING_VERDICTS)[number];

/**
 * Where a reading sits against the band.
 *
 * `below_min` is a real state and not a courtesy: milk that freezes is damaged, so a cooler running too cold is a
 * fault to fix rather than a cooler doing well. The logistics writer's `is_breach` covers both ends for the same
 * reason, and this must agree with it — one arithmetic, two readers.
 */
export function readingVerdict(tempDeci: number, band: Band): ReadingVerdict {
  if (tempDeci > band.maxDeci) return 'above_band';
  if (tempDeci < band.minDeci) return 'below_min';
  return 'in_range';
}

/** Is this reading a breach, by exactly the rule the reading path writes into `cold_chain_logs.is_breach`? */
export function isBreach(tempDeci: number, band: Band): boolean {
  return readingVerdict(tempDeci, band) !== 'in_range';
}

/**
 * *"2,000 L capacity · 41% full"* — integer percent, truncated.
 *
 * Truncated rather than rounded because the number is used to decide whether the next shift fits: a tank the screen
 * calls 99% full when it is 99.6% is the honest direction to be wrong in. Null capacity or level means the platform
 * does not know how full the tank is, which is different from empty.
 */
export function fillPct(volumeLitres: bigint | null, capacityLitres: bigint | null): number | null {
  if (volumeLitres === null || capacityLitres === null || capacityLitres <= 0n) return null;
  return Number((volumeLitres * 100n) / capacityLitres);
}

export const TELEMETRY_STATES = ['live', 'stale', 'never'] as const;
export type TelemetryState = (typeof TELEMETRY_STATES)[number];

export interface TelemetryVerdict {
  state: TelemetryState;
  /** Whole minutes since the last reading — the number W170's gap card is about. */
  ageMinutes: number | null;
  /** The tenant's own silence threshold (a setting), so the screen says why this counts as a gap. */
  silenceMinutes: number;
}

/**
 * Live, stale, or never — with the AGE, because *"no reading for 40 minutes"* and *"no reading ever"* send an operator
 * to two different places (the sensor's connection, and the sensor's registration).
 */
export function telemetryVerdict(lastAt: Date | null, now: Date, silenceMinutes: number): TelemetryVerdict {
  if (lastAt === null) return { state: 'never', ageMinutes: null, silenceMinutes };
  const ageMinutes = Math.floor((now.getTime() - lastAt.getTime()) / 60_000);
  // A reading from the FUTURE (a sensor with a wrong clock) is reported as live rather than as a negative age: the
  // clock is the fault, and pretending the tank has not reported for -3 minutes tells nobody anything.
  return { state: ageMinutes >= silenceMinutes ? 'stale' : 'live', ageMinutes: Math.max(ageMinutes, 0), silenceMinutes };
}

export const PLAYBOOK_STEPS = ['operator_confirm', 'divert_next_shift', 'test_before_pooling'] as const;
export type PlaybookStep = (typeof PLAYBOOK_STEPS)[number];

export interface PlaybookThresholds { divertDeci: number; condemnDeci: number }

/** Which playbook steps this COOPERATIVE can actually perform — one flag today, and room for the next. */
export interface PlaybookCapabilities { divert: boolean }

export interface PlaybookItem {
  step: PlaybookStep;
  /** True when the tank's temperature has reached this step's threshold. */
  due: boolean;
  /** The threshold this step turns on, so the screen prints the tenant's number and not the canon's. */
  atDeci: number | null;
  /**
   * What this platform can actually DO about it.
   *
   * TENANT-6d-1 typed this as the literal `false`, honestly: all three steps were human acts with no surface. **Step 2
   * is built now** (TENANT-6d-6: a diversion is a recorded act with two signatures), so the field is a boolean and each
   * step answers for itself — per COOPERATIVE, because the act is behind a flag and a screen must not offer a button
   * whose route answers not-found.
   */
  built: boolean;
}

/**
 * W170's *"Playbook (auto-suggested)"*, as steps rather than prose.
 *
 * The thresholds are the TENANT's (0162 settings), and the order is checked rather than assumed: a cooperative that
 * set its divert threshold above its test-before-pooling threshold would otherwise get a playbook that tells them to
 * move the milk after they were supposed to have tested it. Nothing here performs anything — the diversion is an act
 * on memberships (TENANT-6d-2) and the union pickup is a phone call — so every item says so.
 */
export function playbook(tempDeci: number | null, t: PlaybookThresholds, can: PlaybookCapabilities = { divert: false }): PlaybookItem[] {
  if (t.condemnDeci < t.divertDeci) {
    throw new Error(`bmc playbook thresholds are inverted (divert ${t.divertDeci}, test-before-pooling ${t.condemnDeci}) — a cooperative would be told to move milk after testing it`);
  }
  const at = (x: number) => tempDeci !== null && tempDeci >= x;
  return [
    // Step 1 is somebody standing at the tank saying the generator has fuel. Nothing on this platform witnesses that,
    // and TENANT-6d-1's ruling holds: the compressor's state is already a human's word, recorded where it belongs.
    { step: 'operator_confirm', due: tempDeci !== null, atDeci: null, built: false },
    // Step 2 — *"divert evening shift to Bhesan"* — IS BUILT (TENANT-6d-6), for a cooperative that has the act
    // switched on. The pours then land at the centre that took them instead of the one the members belong to.
    { step: 'divert_next_shift', due: at(t.divertDeci), atDeci: t.divertDeci, built: can.divert },
    // Step 3 — *"dairy-union pickup advanced; batch tested before pooling"* — has no entity on this platform: no
    // union, no pickup, no batch test. Still false, still said out loud on the screen.
    { step: 'test_before_pooling', due: at(t.condemnDeci), atDeci: t.condemnDeci, built: false },
  ];
}

/**
 * *"99.2% time in range across 3 BMCs"* — measured from the readings there are, with the count beside it.
 *
 * Returned as basis points (integer) so a share can be printed to one decimal without a float, and with `readings`
 * exposed because *"100% in range"* from four readings in a quarter is not the claim the canon is making. A share of
 * nothing is null, never 100.
 */
export function timeInRangeBp(inRange: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((inRange * 10_000) / total);
}

/**
 * The quarter tile's second half: *"0 L milk lost to temperature — alerts beat spoilage every time"*.
 *
 * NOT MEASURABLE ON THIS PLATFORM, and the honest answer is a refusal with its reason. Nothing ties a breach to a
 * quantity written off: milk is priced at the counter (`milk_collections.amount_minor`) and a warm tank does not
 * reduce anybody's litres anywhere in the schema. Printing "0 L" would be a promise made out of the absence of a
 * mechanism to notice otherwise.
 */
export interface LitresLostVerdict { kind: 'not_measurable'; needs: readonly string[] }
export function litresLostVerdict(): LitresLostVerdict {
  return { kind: 'not_measurable', needs: ['a write-off act on a tank', 'a link from a breach to the pours it spoiled'] };
}

/** Deci-degrees as the one-decimal string a screen prints: `69` → `"6.9"`. String arithmetic, no float. */
export function cOfDeci(deci: number): string {
  const neg = deci < 0;
  const abs = Math.abs(deci);
  return `${neg ? '-' : ''}${Math.floor(abs / 10)}.${abs % 10}`;
}

/** The inverse for a caller's decimal input: `"6.9"` → `69`. Rejects anything that is not a one-decimal number. */
export function deciOfC(s: string): number {
  const m = /^([+-]?)(\d{1,3})(?:\.(\d))?$/.exec(s.trim());
  if (!m) throw new Error(`bmc: not a temperature this platform can store to one decimal: ${JSON.stringify(s)}`);
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 10 + Number(m[3] ?? 0));
}
