// modules/dairy/domain/mcc-console.ts · PC-56 TENANT-6d-2 · W171's judgements about a collection centre.
//
// W171: *"3 collection centres · 312 memberships (member_code = card/QR at the counter) · payment cycles per member
// preference: daily | weekly | fortnightly | monthly."* — a board of centres, each with an operator, a member count, a
// capacity, an analyzer and a status; a footer that reconciles the counts; and a panel of preferences.
//
// FOUR RULES THIS FILE HOLDS, and each of them is about refusing to round a fact into a nicer one:
//
//   • **A SHIFT WINDOW IS RECORDED OR IT IS NOT.** TENANT-6a refused to print W167's *"evening starts 17:00"* because
//     no column existed. 0163 adds the columns, so the refusal must now be a FUNCTION of the centre rather than a
//     constant — a screen that keeps saying "not recorded" after the thing was built is the same defect as one that
//     claims something untrue, and this programme has now met it twice (TENANT-6c-6's `paydayVerdict`).
//   • **CUSTODY IS A RECORD, NOT A COLUMN.** *"Operator assignment is recorded (custody of member milk)."* A column
//     answers "who is the operator now" and destroys the previous answer. So the console reads the open custody row
//     AND the centre's column, and when they disagree it says so instead of choosing.
//   • **THE FOOTER'S TICK IS A CHECK, NOT DECORATION.** *"3 centres · 312 memberships total ✓"* — the tick means the
//     per-centre counts add up to the tenant's total. When they do not, some memberships are routed to a centre this
//     board is not showing, and that is the fact a secretary needs rather than a green mark.
//   • **A PREFERENCE IS HONOURED OR IT IS PENDING.** W171 says of the twelve daily-paid households *"their choice,
//     honoured"*. That is TRUE on this platform — TENANT-6c-1 ensures one cycle per DISTINCT preference and
//     `membershipsToBillForCycle` filters on `m.payment_cycle` — but it is true only once the cadence has actually
//     opened a cycle for that preference. So the panel reports, per preference, the cycle that exists; a preference
//     with no cycle row is `pending`, and printing "honoured" over it would be a promise about a job that has not run.
import { Band, TelemetryVerdict, ReadingVerdict, bandOf, readingVerdict, telemetryVerdict } from './bmc';

/* --------------------------------------------------------------------------------------------------------- */
/* THE HOURS                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

export const MILK_SHIFTS = ['morning', 'evening'] as const;
export type MilkShift = (typeof MILK_SHIFTS)[number];

/** A local wall-clock window at a centre, in whole minutes (0163 refuses seconds it could not print). */
export interface ShiftWindow { opens: string; closes: string }

export interface ShiftWindows { morning: ShiftWindow | null; evening: ShiftWindow | null }

/**
 * `"06:00:00"` → `"06:00"`. The column is `time` and 0163 constrains its seconds to zero, so this drops a suffix that
 * is provably `":00"` rather than truncating a value.
 *
 * A string in, a string out: `Date` is not involved anywhere near a wall clock, because a `time` given a date acquires
 * a timezone and this platform resolves the cooperative's zone from its country (0157) — turning 06:00 into an instant
 * here would make the hour move when the tenant's country did.
 */
export function hhmm(t: string | null): string | null {
  if (t === null) return null;
  const m = /^(\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(t.trim());
  if (!m) throw new Error(`mcc: not a wall-clock time this platform can print: ${JSON.stringify(t)}`);
  if (m[3] !== undefined && Number(m[3]) !== 0) {
    throw new Error(`mcc: shift boundary ${t} carries seconds, which 0163's CHECK forbids and a screen cannot print`);
  }
  return `${m[1]}:${m[2]}`;
}

export interface ShiftColumns {
  morningOpensAt: string | null; morningClosesAt: string | null;
  eveningOpensAt: string | null; eveningClosesAt: string | null;
}

/**
 * The two windows a centre has recorded. A half-window is impossible in the database (`ck_mcc_shift_*`) and is
 * therefore treated here as UNRECORDED rather than repaired: a row that reached this code with one end missing came
 * from something that bypassed the constraint, and inventing the other end is how a screen sends a farmer to a
 * closed door.
 */
export function shiftWindows(c: ShiftColumns): ShiftWindows {
  const w = (o: string | null, cl: string | null): ShiftWindow | null => {
    const opens = hhmm(o); const closes = hhmm(cl);
    return opens !== null && closes !== null ? { opens, closes } : null;
  };
  return { morning: w(c.morningOpensAt, c.morningClosesAt), evening: w(c.eveningOpensAt, c.eveningClosesAt) };
}

/** How many minutes past midnight, for ordering and for "is the centre open now" — never for display. */
export function minutesOfDay(hm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hm);
  if (!m) throw new Error(`mcc: not an HH:MM wall clock: ${JSON.stringify(hm)}`);
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) throw new Error(`mcc: wall clock out of range: ${JSON.stringify(hm)}`);
  return h * 60 + mi;
}

export const SHIFT_OPEN_STATES = ['open', 'before', 'after', 'not_recorded'] as const;
export type ShiftOpenState = (typeof SHIFT_OPEN_STATES)[number];

/**
 * Is this shift open at a given local wall clock?
 *
 * Inclusive of the opening minute and EXCLUSIVE of the closing one, which is the same boundary rule 0157 chose for a
 * cycle's `closes_at`: a centre that closes at 09:00 is shut at 09:00, and "09:00 counts as open" is the minute an
 * operator argues about with a farmer who arrived on time.
 */
export function shiftOpenState(w: ShiftWindow | null, nowHm: string): ShiftOpenState {
  if (w === null) return 'not_recorded';
  const n = minutesOfDay(nowHm);
  if (n < minutesOfDay(w.opens)) return 'before';
  if (n >= minutesOfDay(w.closes)) return 'after';
  return 'open';
}

/* --------------------------------------------------------------------------------------------------------- */
/* CUSTODY                                                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

export const CUSTODY_STATES = ['held', 'nobody', 'unrecorded', 'disagrees'] as const;
export type CustodyState = (typeof CUSTODY_STATES)[number];

export interface CustodyVerdict {
  state: CustodyState;
  /** Whose custody the console should print. Null for `nobody`, and for `disagrees` — where naming one would pick. */
  operatorUserId: string | null;
  /** When this custody began. Null whenever there is no custody ROW to have begun. */
  since: Date | null;
  /** The centre's own column, so a `disagrees` screen can show both halves of the contradiction. */
  columnUserId: string | null;
}

/**
 * Who is holding this centre's milk.
 *
 * `unrecorded` is the state of every centre that existed before 0163 whose operator is not a member of the tenant —
 * the backfill deliberately skipped those rows rather than writing custody it could not stand behind (0163.3), and the
 * console reports the gap instead of presenting a stranger as the custodian.
 *
 * `disagrees` should be unreachable: the service writes the column and the custody row in ONE transaction. It is here
 * because "unreachable" is a claim about today's code, and a console that silently preferred one of two contradicting
 * answers about who is responsible for 108 families' milk would hide exactly the bug worth finding.
 */
export function custodyVerdict(
  centre: { operatorUserId: string | null },
  open: { operatorUserId: string; assignedAt: Date } | null,
): CustodyVerdict {
  const col = centre.operatorUserId;
  if (open === null) {
    return col === null
      ? { state: 'nobody', operatorUserId: null, since: null, columnUserId: null }
      : { state: 'unrecorded', operatorUserId: col, since: null, columnUserId: col };
  }
  if (col !== open.operatorUserId) {
    return { state: 'disagrees', operatorUserId: null, since: open.assignedAt, columnUserId: col };
  }
  return { state: 'held', operatorUserId: open.operatorUserId, since: open.assignedAt, columnUserId: col };
}

/** Whole days a custody has run, inclusive of neither end — the "since 14 Mar (162 days)" a handover review reads. */
export function custodyDays(since: Date | null, now: Date): number | null {
  if (since === null) return null;
  return Math.max(Math.floor((now.getTime() - since.getTime()) / 86_400_000), 0);
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE TANK, AS A CENTRE SEES IT                                                                             */
/* --------------------------------------------------------------------------------------------------------- */

export const TANK_CONDITIONS = ['no_unit', 'never', 'stale', 'in_range', 'above_band', 'below_min'] as const;
export type TankCondition = (typeof TANK_CONDITIONS)[number];

export interface CentreTank {
  condition: TankCondition;
  /** The tank's own band, so a warm centre can be shown what it was judged against. Null when there is no unit. */
  band: Band | null;
  tempDeci: number | null;
  telemetry: TelemetryVerdict | null;
  unitId: string | null;
}

/**
 * W171's *"active · BMC warm"* — the one thing on this board that is not about the centre at all.
 *
 * The ARITHMETIC is TENANT-6d-1's (`bandOf`, `readingVerdict`, `telemetryVerdict`), imported rather than repeated. Two
 * queries read the coolers now (the monitor's and this board's) and that is fine; two implementations of the band rule
 * would not be — a centre listed as fine beside a monitor showing a breach is how a cooperative stops believing both.
 *
 * A STALE sensor is never reported as a temperature, for the reason it is never reported as one on the monitor:
 * *"sensors buffer locally; a gap is a connectivity issue, not a temperature unknown"*.
 */
export function centreTank(
  unit: { id: string; minDeci: number; targetDeci: number; toleranceDeci: number; lastTempDeci: number | null; lastAt: Date | null } | null,
  now: Date,
  silenceMinutes: number,
): CentreTank {
  if (unit === null) return { condition: 'no_unit', band: null, tempDeci: null, telemetry: null, unitId: null };
  const band = bandOf(unit);
  const telemetry = telemetryVerdict(unit.lastAt, now, silenceMinutes);
  if (telemetry.state === 'never' || unit.lastTempDeci === null) {
    return { condition: 'never', band, tempDeci: null, telemetry, unitId: unit.id };
  }
  if (telemetry.state === 'stale') {
    return { condition: 'stale', band, tempDeci: unit.lastTempDeci, telemetry, unitId: unit.id };
  }
  const v: ReadingVerdict = readingVerdict(unit.lastTempDeci, band);
  return { condition: v, band, tempDeci: unit.lastTempDeci, telemetry, unitId: unit.id };
}

/** Does this centre need somebody to walk to the tank right now? Only a LIVE breach counts (6d-1's badge rule). */
export function tankNeedsAttention(t: CentreTank): boolean {
  return t.condition === 'above_band' || t.condition === 'below_min';
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE FOOTER'S TICK                                                                                         */
/* --------------------------------------------------------------------------------------------------------- */

export interface Reconciliation {
  centres: number;
  /** Sum of the per-centre counts this board is SHOWING. */
  shown: number;
  /** Active memberships in the tenant, counted independently. */
  total: number;
  reconciles: boolean;
  /** Memberships the board does not account for — routed to a centre that is inactive, deleted, or filtered out. */
  unaccounted: number;
}

/**
 * W171's *"3 centres · 312 memberships total ✓"*.
 *
 * The tick is EARNED. `shown` is summed from the rows on the board and `total` is counted straight from
 * `dairy_memberships`, so a membership whose centre was deactivated — which is a real thing, because deactivating a
 * centre does not move its members anywhere — shows up as `unaccounted` instead of quietly shrinking the total.
 *
 * `unaccounted` is clamped at zero: a board showing MORE members than the tenant has would mean a double count, which
 * is not a negative shortfall and must not be printed as one. The two figures are still reported, so the contradiction
 * is visible rather than absorbed.
 */
export function reconcile(perCentre: readonly number[], total: number): Reconciliation {
  const shown = perCentre.reduce((a, b) => a + b, 0);
  return { centres: perCentre.length, shown, total, reconciles: shown === total, unaccounted: Math.max(total - shown, 0) };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE PREFERENCE MIX                                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

export const PREFERENCE_STATES = ['honoured', 'pending'] as const;
export type PreferenceState = (typeof PREFERENCE_STATES)[number];

export interface PreferenceRow {
  paymentCycle: string;
  members: number;
  /** Share of all active memberships, in basis points — an integer, so a screen prints one decimal without a float. */
  shareBp: number | null;
  state: PreferenceState;
  /** The cycle that actually exists for this preference, if the cadence has opened one. */
  window: { from: string; to: string; payday: string; status: string } | null;
}

/**
 * W171's preference panel, told from the cycles that exist.
 *
 * The canon writes a caption under each row — *"default — pays every Friday"*, *"aligned to this 01–15 cycle"*,
 * *"mostly larger pourers"*, *"cash-flow-tight households — their choice, honoured"*. Three of those four are
 * ANSWERABLE from `dairy_bill_cycles` and are answered: the window and the payday this cooperative's own cycle carries,
 * rather than the Friday one FPO in Gujarat happens to pay on.
 *
 * *"Mostly larger pourers"* is NOT answered. It is a claim about who chooses monthly, and the honest ways to make it
 * are a per-preference average of litres poured — a grouped scan of a partitioned collections table on every page
 * load — or nothing. The panel prints the counts and the real cycle and leaves the characterisation out; a screen that
 * tells a secretary what kind of household chooses monthly, from no measurement, is a stereotype with a database
 * behind it.
 */
export function preferenceMix(
  counts: readonly { paymentCycle: string; members: number }[],
  cycles: readonly { paymentCycle: string; periodStart: string; periodEnd: string; payday: string; status: string }[],
): PreferenceRow[] {
  const total = counts.reduce((a, c) => a + c.members, 0);
  const byCycle = new Map(cycles.map((c) => [c.paymentCycle, c]));
  return counts.map((c) => {
    const cy = byCycle.get(c.paymentCycle) ?? null;
    return {
      paymentCycle: c.paymentCycle,
      members: c.members,
      shareBp: total <= 0 ? null : Math.round((c.members * 10_000) / total),
      state: cy ? 'honoured' : 'pending',
      window: cy ? { from: cy.periodStart, to: cy.periodEnd, payday: cy.payday, status: cy.status } : null,
    };
  });
}

/**
 * Is every preference a member has chosen actually served by a cycle?
 *
 * This is the whole claim behind *"their choice, honoured"*, as one boolean plus the preferences that are missing —
 * because the answer a secretary needs when it is false is WHICH twelve households are waiting.
 */
export function preferencesHonoured(rows: readonly PreferenceRow[]): { all: boolean; pending: string[] } {
  const pending = rows.filter((r) => r.members > 0 && r.state === 'pending').map((r) => r.paymentCycle);
  return { all: pending.length === 0, pending };
}
