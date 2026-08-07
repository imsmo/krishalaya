// apps/admin-api/src/modules/cells-ops/domain/map-integrity.ts · PURE (PC-56 ADMIN-8).
//
// Three guards the canon states and the code did not have, plus W036's growth rate — which turns out to be computable
// from history that already exists, and is the reason W036 is in this wave while W037's projection is in ADMIN-8b.
import { InvalidCellsInputError } from './cells-ops.errors';

/* ------------------------------------------------------------------------------------------------ */
/* 1 · `weight = 0` MEANS DRAIN, AND NOTHING READ IT                                                 */
/* ------------------------------------------------------------------------------------------------ */

/** W031's subtitle: "tenant→shard via consistent hash weighted by `weight`. **weight 0 = drain (no new placements)**."
 *  W030 shows shard-2 as "draining · weight 0". W036's chart legend has "draining (weight 0)".
 *
 *  `assertWeight` in `routing.ts` bounds the value. `TenantCellAssignmentService.place` checks
 *  `acceptsPlacement(shard.status)` — status only. **There is no read of `weight` on the placement path.** So an operator
 *  who zeroes a hot shard's weight to drain it keeps receiving tenants onto it, and the console shows weight 0 beside a
 *  rising `placed_count`. FIFTH occurrence of a column recording an intention no code honours, after ADMIN-5's erasure,
 *  5c's breach, 5f's removal and 0114's payout approval.
 *
 *  A SHARD NEEDS BOTH: an `active` status AND a non-zero weight. They are not redundant — status is the operator's
 *  declaration about the shard's lifecycle and weight is its share of new traffic, and W030 shows a shard carrying BOTH
 *  (`draining`, weight 0) precisely because a careful drain sets both. A shard at weight 0 while still `active` is the
 *  interesting case: somebody has stopped the bleeding without committing to the lifecycle change, and it must not
 *  receive tenants.
 */
export function shardAcceptsPlacement(status: string, weight: number): boolean {
  if (status !== 'active') return false;
  // A non-finite weight is NOT treated as a large one. `Number.isFinite` first, because `NaN > 0` is false and would fall
  // through to a refusal anyway — but relying on that would make the correct behaviour an accident of IEEE-754, which is
  // the equivalence ADMIN-5f caught itself relying on in `priorityOf`.
  if (!Number.isFinite(weight)) return false;
  return weight > 0;
}

export type PlacementRefusal =
  | { ok: true }
  | { ok: false; reason: 'shard_not_active'; status: string }
  | { ok: false; reason: 'shard_draining_by_weight' }
  | { ok: false; reason: 'cell_not_active'; status: string }
  | { ok: false; reason: 'cell_at_capacity'; placed: number; capacity: number }
  | { ok: false; reason: 'shard_not_in_cell' };

/** The whole placement decision, in one place, returning WHICH refusal rather than a boolean.
 *
 *  `shard_draining_by_weight` is its own reason and not folded into `shard_not_active`, because they send an operator to
 *  different places: one means "this shard is being retired", the other means "somebody took it out of the rotation
 *  without changing its status" — and on a routing map the second is usually a colleague mid-incident.
 */
export function placementDecision(i: {
  cellStatus: string;
  cellPlacedCount: number;
  cellCapacity: number | null;
  shardStatus: string;
  shardWeight: number;
  shardCellId: string;
  targetCellId: string;
}): PlacementRefusal {
  // Checked FIRST: a shard that belongs to another cell is a caller error rather than a capacity condition, and reporting
  // it as "at capacity" would send somebody to raise a cap that was never the problem.
  if (i.shardCellId !== i.targetCellId) return { ok: false, reason: 'shard_not_in_cell' };
  if (i.cellStatus !== 'active') return { ok: false, reason: 'cell_not_active', status: i.cellStatus };
  if (i.shardStatus !== 'active') return { ok: false, reason: 'shard_not_active', status: i.shardStatus };
  if (!shardAcceptsPlacement(i.shardStatus, i.shardWeight)) return { ok: false, reason: 'shard_draining_by_weight' };
  if (i.cellCapacity !== null && i.cellPlacedCount >= i.cellCapacity) {
    return { ok: false, reason: 'cell_at_capacity', placed: i.cellPlacedCount, capacity: i.cellCapacity };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------------------------------ */
/* 2 · THE DEFAULT CELL MAY NOT BE DRAINED                                                           */
/* ------------------------------------------------------------------------------------------------ */

/** W030's drain dialog says it twice: "default flag must move to another IN cell first" and "blocked while
 *  is_default=true".
 *
 *  `setCellStatus` checked retire-when-empty and nothing else. So `in-west-1` — the default landing cell for IN — could be
 *  moved to `draining` by one operator with one reason string, and because `acceptsPlacement` is fail-closed on anything
 *  but `active`, **every new tenant registration in India would then fail at placement.** Existing tenants keep working,
 *  which is exactly what makes it hard to notice: the platform does not go down, it stops taking customers.
 *
 *  Returns the SENTENCE rather than throwing, so the same function serves the console's disabled-state copy and the
 *  service's refusal.
 */
export function defaultCellBlocksStatusChange(isDefault: boolean, to: string): string | null {
  if (!isDefault) return null;
  if (to === 'active') return null;
  return `this is the default landing cell for its country, so moving it to '${to}' would stop every new tenant `
    + 'registration there while existing tenants kept running — a platform that has not gone down but has stopped taking '
    + 'customers. Move the default flag to another cell in the same country first.';
}

export function assertStatusChangeAllowed(isDefault: boolean, to: string): void {
  const msg = defaultCellBlocksStatusChange(isDefault, to);
  if (msg) throw new InvalidCellsInputError(msg);
}

/* ------------------------------------------------------------------------------------------------ */
/* 3 · THE DENORMALISED COUNT NOBODY VERIFIED                                                        */
/* ------------------------------------------------------------------------------------------------ */

export type CountVerdict =
  | { kind: 'match'; count: number }
  /** The guard reads a number HIGHER than reality: a cell with room refuses placements. Costs onboarding. */
  | { kind: 'over'; stored: number; derived: number; drift: number }
  /** The guard reads a number LOWER than reality: a cell past its cap keeps accepting. Costs the infra commitment the
   *  cap represents, and is the direction that ends in a shard nobody planned for. */
  | { kind: 'under'; stored: number; derived: number; drift: number };

/** `cells.placed_count` and `shards.placed_count` are maintained atomically with each placement — 0043 says so and it is
 *  true. **Nothing has ever compared them against `tenant_placements`.** The capacity guard reads the denormalised
 *  number, so drift means either refusing placements on a cell with room or admitting them past the cap.
 *
 *  Same shape as ADMIN-6's `cached_balance_minor`, where the per-account drift check had existed twice since 0006 and
 *  never run — and the same reason it matters: the denormalised figure is what the guard trusts and the derived one is
 *  the truth.
 *
 *  THE TWO DIRECTIONS ARE REPORTED SEPARATELY because they cost different things and are noticed differently. `over` is
 *  visible (somebody complains that onboarding is refused); `under` is invisible until a shard falls over.
 */
export function countVerdict(stored: number, derived: number): CountVerdict {
  const drift = stored - derived;
  if (drift === 0) return { kind: 'match', count: stored };
  return drift > 0
    ? { kind: 'over', stored, derived, drift }
    : { kind: 'under', stored, derived, drift };
}

/** Whether a drift set warrants an alert. Any non-zero drift on a CAPPED node does, because the cap is what the guard
 *  compares against; on an uncapped cell the count is informational and a drift is a bookkeeping error rather than a
 *  routing risk. Stated as a function so the console and a future worker sweep cannot disagree about it. */
export function driftIsUrgent(v: CountVerdict, capacity: number | null): boolean {
  if (v.kind === 'match') return false;
  return capacity !== null;
}

/* ------------------------------------------------------------------------------------------------ */
/* 4 · W036's HEADROOM AND GROWTH RATE                                                               */
/* ------------------------------------------------------------------------------------------------ */

export type Headroom =
  | { known: true; percent: number; placed: number; capacity: number }
  /** An uncapped cell has no headroom to report — and 0 would read as "full", which is the opposite of unbounded. W029's
   *  own table shows `0 / —` for the retired dry-run cell. */
  | { known: false; reason: 'uncapped' | 'no_capacity_recorded' };

export function headroomOf(placed: number, capacity: number | null): Headroom {
  if (capacity === null) return { known: false, reason: 'uncapped' };
  if (!Number.isFinite(capacity) || capacity <= 0) return { known: false, reason: 'no_capacity_recorded' };
  const used = capacity > 0 ? placed / capacity : 1;
  // Floor, not round: 59.6% used reports 40% headroom rather than 41%, so the figure an operator plans against never
  // overstates the room available. The same direction ADMIN-5f chose rounding value-at-stake half up — err toward the
  // reading that triggers action.
  return { known: true, percent: Math.max(0, Math.floor((1 - used) * 100)), placed, capacity };
}

export type GrowthRate =
  | { known: true; perWeek: number; windowWeeks: number; sample: number }
  /** No placement history in the window. NOT a rate of 0: "nobody joined" and "we have no history" are the same number
   *  and different findings, and W036's "+38/week · full in ≈ 21 weeks" is meaningless without knowing which. */
  | { known: false; reason: 'no_history' };

/** **THE RATE IS NOT A FORECAST — IT IS A COUNT.** W037's banner declares a forecasting service backend-pending
 *  (DELTA-013), and W036's "+38/week" is arithmetic over `cell_map_changes` rows with `action='placed'`, a table that has
 *  held every placement since 0043. So the rate is computable today and the PROJECTION is not, which is exactly where the
 *  line between this wave and ADMIN-8b falls.
 *
 *  NET of removals, because a cell whose tenants arrive and leave in equal numbers is not filling up. A gross arrival
 *  count would forecast a cell full in 21 weeks that will still be half empty — which is how a platform buys infrastructure
 *  it does not need.
 */
export function growthRate(
  events: readonly { action: string }[],
  windowWeeks: number,
): GrowthRate {
  if (events.length === 0 || windowWeeks <= 0) return { known: false, reason: 'no_history' };
  let net = 0;
  for (const e of events) {
    if (e.action === 'placed') net += 1;
    else if (e.action === 'removed') net -= 1;
    // `moved` is deliberately NOT counted. A move is one tenant leaving one cell and arriving at another; counted here it
    // would inflate the receiving cell's rate and understate nothing, because the caller filters events per cell and a
    // move appears once. Counting it would make an internal rebalance look like growth.
  }
  return { known: true, perWeek: Math.round((net / windowWeeks) * 10) / 10, sample: events.length, windowWeeks };
}

export type TimeToFull =
  | { known: true; weeks: number }
  | { known: false; reason: 'uncapped' | 'no_rate' | 'not_filling' | 'already_full' };

/** W036's "full in ≈ 21 weeks at current rate".
 *
 *  `not_filling` is its own answer for a flat or shrinking cell — reporting `Infinity` weeks, or a very large number,
 *  would put a figure on a screen that means "never" and invite somebody to plan against it.
 */
export function weeksToFull(placed: number, capacity: number | null, rate: GrowthRate): TimeToFull {
  if (capacity === null) return { known: false, reason: 'uncapped' };
  if (placed >= capacity) return { known: false, reason: 'already_full' };
  if (!rate.known) return { known: false, reason: 'no_rate' };
  if (rate.perWeek <= 0) return { known: false, reason: 'not_filling' };
  return { known: true, weeks: Math.max(1, Math.floor((capacity - placed) / rate.perWeek)) };
}

/** The threshold W037 names as its own trigger — "the planner suggests triggers at 70% cell utilization" — so the
 *  capacity screen can flag a cell before the planner exists. Exported rather than inlined so ADMIN-8b's planner cannot
 *  drift from the figure this screen already shows an operator. */
export const PLAN_TRIGGER_PERCENT_USED = 70;

export function needsScalePlan(h: Headroom): boolean {
  if (!h.known) return false;
  return 100 - h.percent >= PLAN_TRIGGER_PERCENT_USED;
}

/* ------------------------------------------------------------------------------------------------ */
/* 5 · THE ONE SECRET THAT MUST NOT LEAK                                                             */
/* ------------------------------------------------------------------------------------------------ */

/** W031: "Raw DSNs never appear here. `dsn_secret_ref` points into Secrets Manager; even platform owners see only the
 *  reference."
 *
 *  0043 stores a reference and the module already treats it as one — this is a GUARD rather than a fix, and it exists
 *  because the failure would be silent and total. A `vault://` ref is safe to render; anything containing a scheme with
 *  credentials in it is a connection string that reached this column by mistake, and printing it on a console page would
 *  put a production database password in a screenshot.
 */
export function isSafeSecretRef(ref: string | null): boolean {
  if (ref === null) return true;
  const v = ref.trim();
  if (v === '') return true;
  // A vault-style reference and nothing else. Checked as an ALLOW-LIST, because the deny-list version ("does it look like
  // a DSN") is exactly the check that fails on the format nobody anticipated.
  return /^vault:\/\/[A-Za-z0-9._\-/]+$/.test(v);
}

/** What the console may print. An unsafe value renders as a refusal rather than as itself — and the refusal is loud,
 *  because a raw DSN in this column is a secret-management incident and not a display bug. */
export function secretRefDisplay(ref: string | null): { safe: boolean; text: string | null } {
  if (ref === null || ref.trim() === '') return { safe: true, text: null };
  return isSafeSecretRef(ref)
    ? { safe: true, text: ref.trim() }
    : { safe: false, text: null };
}
