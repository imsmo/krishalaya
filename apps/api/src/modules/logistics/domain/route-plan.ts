// modules/logistics/domain/route-plan.ts · A RECURRING RUN, AND WHAT MAY BE CLAIMED BEFORE IT IS APPROVED
// (PC-56 TENANT-5b). Pure rules — no I/O, no clock of its own.
//
// W231's lead: "Recurring runs (delivery_routes): weekday, villages, vehicle, and an ambassador as the
// consolidation point. One planned truck beats five ad-hoc tempos." Its table carries a row the platform
// could not represent:
//
//     Mendarda midweek (proposed) | Thu | Mendarda, Bilkha +4 | Kavita Ben D. (senior amb) | unassigned | — est. 12
//     [Approve route]
//
// and under it: "Route economics show before approval: the Mendarda proposal pencils at ₹28/parcel vs ₹96
// ad-hoc — but only above 9 parcels/run. Demand data says 12. **Approve when the math holds, not when it
// feels right.**" The restricted state adds why the button is privileged: "Route approval needs logistics
// lead (it commits a vehicle + ambassador weekly)."
//
// **THERE WAS NO PROPOSAL STATE AND NO APPROVAL.** `delivery_routes` (0007) carries `is_active boolean NOT
// NULL DEFAULT true`, `DeliveryRoute.create` sets it TRUE, and the only lifecycle method is `setActive`. So
// every route was live the instant it was typed: the Village-Run consolidation job (which selects
// `is_active = true AND run_weekday = today`) would have started notifying a consolidation point about a run
// nobody had approved, and "approve when the math holds" had no button, no state and no record of who
// committed a named ambassador's Thursday.
//
// This wave gives the route ONE state machine (0152's `status`) rather than a second boolean beside the first
// — two mechanisms over one fact is on this programme's own defect list, and `is_active` becomes a GENERATED
// column derived from `status` so no existing reader breaks and no code can write a contradiction.

/* --------------------------------------------------------------------------------------------------------- */
/* THE STATE MACHINE                                                                                         */
/* --------------------------------------------------------------------------------------------------------- */

export const ROUTE_STATUSES = ['proposed', 'active', 'inactive'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

export function isRouteStatus(v: string | undefined | null): v is RouteStatus {
  return !!v && (ROUTE_STATUSES as readonly string[]).includes(v);
}

/**
 * Legal transitions. A proposal may be approved or dropped; an active run may be suspended; a suspended run
 * may be restarted. **`inactive → proposed` is deliberately absent**: a run that has already committed a
 * vehicle and an ambassador and then stopped is not an untested idea again, and re-proposing it would erase
 * the record that it once ran.
 */
export const ROUTE_TRANSITIONS: Record<RouteStatus, readonly RouteStatus[]> = {
  proposed: ['active', 'inactive'],
  active: ['inactive'],
  inactive: ['active'],
};

export function canTransitionRoute(from: RouteStatus, to: RouteStatus): boolean {
  return (ROUTE_TRANSITIONS[from] ?? []).includes(to);
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT APPROVAL COMMITS                                                                                     */
/* --------------------------------------------------------------------------------------------------------- */

export type ApprovalVerdict =
  | { kind: 'ready' }
  /** W231's proposal row shows `unassigned` in the vehicle column. Approving that would commit a weekly run
   *  with nothing to carry it, and the consolidation job would notify a village that a truck was coming. */
  | { kind: 'needs_vehicle' }
  /** The consolidation point is a NAMED PERSON whose Thursday this commits. A route without one has nowhere
   *  to drop and nobody accountable for the parcels when it does. */
  | { kind: 'needs_consolidation' }
  /** A run with no villages is not a run. */
  | { kind: 'needs_villages' }
  /** Already approved — reported rather than thrown, so a double-click reads as "already done". */
  | { kind: 'already_active' }
  /** A dropped proposal is not approvable; it must be re-created, which keeps the record of the drop. */
  | { kind: 'not_proposed'; status: RouteStatus };

/**
 * Is this route approvable, and if not, WHICH commitment is missing?
 *
 * Ordered by what an operator would fix first, and every branch names one thing — a screen that says
 * "incomplete" makes somebody open five fields to find out which.
 */
export function approvalVerdict(r: {
  status: RouteStatus; vehicleId: string | null; consolidationUserId: string | null; villageRegionIds: readonly string[];
}): ApprovalVerdict {
  if (r.status === 'active') return { kind: 'already_active' };
  if (r.status !== 'proposed') return { kind: 'not_proposed', status: r.status };
  if (r.villageRegionIds.length === 0) return { kind: 'needs_villages' };
  if (!r.vehicleId) return { kind: 'needs_vehicle' };
  if (!r.consolidationUserId) return { kind: 'needs_consolidation' };
  return { kind: 'ready' };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE DAY                                                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

/** 0=Sunday … 6=Saturday, matching `delivery_routes.run_weekday`'s own CHECK and `Date.getUTCDay()`. The
 *  NAMES are i18n keys, never English strings — "Sat" is a word in three launch languages. */
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function weekdayKey(d: number | null): string | null {
  return d === null || !Number.isInteger(d) || d < 0 || d > 6 ? null : `route.day.${WEEKDAY_KEYS[d]}`;
}

/** A route with no weekday runs on demand rather than on a day, and the screen says so instead of printing a
 *  dash that reads like missing data. */
export function runsOnDemand(runWeekday: number | null): boolean { return runWeekday === null; }

/* --------------------------------------------------------------------------------------------------------- */
/* PARCELS PER RUN — MEASURED, NEVER STORED                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W231's "Parcels/run avg" column: 34, 18, and "— est. 12" for the proposal.
 *
 * **`shipments.route_id` HAS EXISTED SINCE 0007 AND IS WRITTEN BY NOTHING.** `grep -rn "route_id\|routeId"
 * apps/api/src` returns the route's own event payload and this comment's subject — no INSERT, no UPDATE, no
 * SELECT. Nothing anywhere chooses a route for a shipment, so the column cannot be the source of this number
 * and writing it now would mean inventing the choice.
 *
 * The measure is therefore computed from facts that DO exist: a delivered shipment's drop address carries a
 * `region_id` (0003 `addresses.region_id → admin_regions`), and a route carries the region ids it serves. A
 * shipment that went to one of those villages ON the route's weekday is a parcel that run carried — or would
 * have carried, for a proposal, which is exactly what "est." means on that row.
 *
 * Two verdicts, never one number pretending to be both:
 *   • `measured` — the route is active, so past runs are its own history;
 *   • `estimated` — the route is a proposal, so the number is what ad-hoc traffic through those villages
 *     already looks like. W231 prints "est." for precisely this row and the console must keep the word.
 */
export type ParcelsVerdict =
  | { kind: 'measured'; perRun: number; runs: number }
  | { kind: 'estimated'; perRun: number; runs: number }
  /** No delivered shipment has ever gone to these villages on this day. Not zero-with-confidence: unknown. */
  | { kind: 'no_history' };

export function parcelsVerdict(i: { status: RouteStatus; parcels: number; runs: number }): ParcelsVerdict {
  if (i.runs <= 0 || i.parcels <= 0) return { kind: 'no_history' };
  // Integer division would report 1.6 parcels a run as 1 and make a viable route look dead; rounded to one
  // decimal because this number is read against a per-parcel cost, not counted out into a truck.
  const perRun = Math.round((i.parcels / i.runs) * 10) / 10;
  return i.status === 'active' ? { kind: 'measured', perRun, runs: i.runs } : { kind: 'estimated', perRun, runs: i.runs };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE ECONOMICS — ONE SIDE IS REAL AND THE OTHER IS NOT RECORDED                                            */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W231: "the Mendarda proposal pencils at ₹28/parcel vs ₹96 ad-hoc — but only above 9 parcels/run."
 *
 * **The ad-hoc side is real.** `shipments.charge_minor` is what those parcels actually cost, one at a time,
 * to those villages: sum it, divide by the parcels, and the number is a fact with a receipt.
 *
 * **The route side is not recorded anywhere.** A planned run's cost is a quote for a truck for a morning —
 * there is no per-route cost column, no vehicle day-rate, no fuel model and no driver rate for an own-fleet
 * run (`rider_payout_terms` prices a DROP for a rider, not a truck for a route). So this function returns the
 * ad-hoc baseline and says the route side is missing. It does not divide an invented lorry hire by an
 * estimated parcel count and print ₹28 next to a real ₹96, because a made-up number beside a measured one
 * reads as two measurements — and this screen's whole instruction is "approve when the math holds".
 *
 * The break-even parcel count ("only above 9") is the same missing input seen from the other side: it is
 * route cost ÷ ad-hoc unit cost, and with no route cost there is no threshold either. Naming that is the
 * honest version of the sentence; printing 9 would be hardcoding a business number (Law 6) that happens to
 * be in a mockup.
 */
export interface EconomicsInput { adHocTotalMinor: bigint; adHocParcels: number; currencyCode: string }
export type EconomicsVerdict =
  | { kind: 'ad_hoc_only'; adHocPerParcelMinor: string; parcels: number; currencyCode: string; routeCost: 'not_recorded' }
  | { kind: 'no_baseline'; routeCost: 'not_recorded' };

export function economicsVerdict(i: EconomicsInput): EconomicsVerdict {
  if (i.adHocParcels <= 0 || i.adHocTotalMinor <= 0n) return { kind: 'no_baseline', routeCost: 'not_recorded' };
  // Integer minor units throughout (Law 2). BigInt division truncates, which UNDER-states the ad-hoc cost by
  // at most one paisa — the direction that cannot flatter a route proposal.
  const per = i.adHocTotalMinor / BigInt(i.adHocParcels);
  return { kind: 'ad_hoc_only', adHocPerParcelMinor: per.toString(), parcels: i.adHocParcels, currencyCode: i.currencyCode, routeCost: 'not_recorded' };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE SUGGEST TOOL W231's EMPTY STATE OFFERS                                                                */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W231's second empty state: "Start with the corridor your parcels already travel — **the suggest tool maps
 * 30 days of ad-hoc shipments into route candidates.** [Suggest routes]"
 *
 * That tool does not exist, and this wave does not pretend otherwise. What DOES exist, and is honest, is the
 * ingredient: delivered shipments grouped by their drop village and weekday over a window. The console offers
 * that as a corridor LIST an operator can read and turn into a proposal themselves — a candidate is a
 * suggestion made by a person from real traffic, not a route this platform decided.
 *
 * Naming the difference matters because a "Suggest routes" button that silently created proposals would be
 * committing a vehicle and an ambassador on the strength of a grouping query.
 */
export const SUGGEST_WINDOW_DAYS = 30;
export type SuggestVerdict = { kind: 'corridors_only'; windowDays: number };
export function suggestVerdict(): SuggestVerdict { return { kind: 'corridors_only', windowDays: SUGGEST_WINDOW_DAYS }; }

/** How many village names the board prints before it says "+N" (W231: "Vanthali, Bhesan, Keshod +11"). */
export const VILLAGES_SHOWN = 3;

export function villageOverflow(total: number): number { return Math.max(0, total - VILLAGES_SHOWN); }
