// modules/logistics/domain/shipment-event-explorer.ts · THE TRAIL, AND WHO MAY SEE HOW PRECISELY
// (PC-56 TENANT-5a). Pure rules — no I/O, no clock of its own.
//
// **`shipment_events` HAS TWO WRITERS AND NO READER IN ITS OWN MODULE.** `ShipmentRepository.recordEvent`
// and `.insertLocationEvent` append to it on every hop and every GPS ping; `grep -rln "shipment_events"
// apps/api/src` returns those two writers, one test, and `modules/orders/read-models/order-tracking` — a
// BUYER-facing feed for ONE order, in a different module. So the table the whole logistics desk is built on
// could not be read by the logistics desk.
//
// W236 is the console for it ("the ops debugging surface") and W235 is the single-shipment view. Neither had
// anything behind it: no cross-shipment query, no filters, no date window, no export, no tracking read.
import { ShipmentStatus } from './shipment.state';

/* --------------------------------------------------------------------------------------------------------- */
/* THE WINDOW                                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

/** W236: "Date-bounded queries only; today is preloaded." A partitioned, append-only table that every hop
 *  and every 90-second GPS ping writes to is not something to offer an unbounded query over — the default
 *  IS the bound, and there is no "all time" option to click. */
export const DEFAULT_WINDOW_DAYS = 1;
/** W236: "events keep 90 days hot, archive beyond." Asking for more than the hot horizon returns the hot
 *  part and SAYS the window was clamped, rather than silently returning less than was asked for. */
export const HOT_WINDOW_DAYS = 90;

export interface DateWindow { from: string; to: string; clamped: boolean }

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Resolve the window a query actually runs over. Both ends inclusive, both YYYY-MM-DD.
 *
 * A missing or malformed input falls back to TODAY — never to "everything". The clamp is reported rather
 * than applied silently: an operator who asked for six months and got ninety days must be told, or they will
 * read an empty stretch as "nothing happened" instead of "you did not ask for that".
 */
export function resolveWindow(raw: { from?: string; to?: string }, now: Date): DateWindow {
  const today = dayOf(now);
  const to = raw.to && DAY.test(raw.to) && raw.to <= today ? raw.to : today;
  const wanted = raw.from && DAY.test(raw.from) ? raw.from : addDays(to, -(DEFAULT_WINDOW_DAYS - 1));
  const earliest = addDays(today, -(HOT_WINDOW_DAYS - 1));
  const from = wanted < earliest ? earliest : wanted;
  // An inverted range is a typo, not a query. Collapse it to the single day the operator named LAST.
  if (from > to) return { from: to, to, clamped: wanted < earliest };
  return { from, to, clamped: wanted < earliest };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE FILTERS W236 DRAWS                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

/** The four chips on the canon screen, plus the implicit "everything in the window". Each is a QUESTION an
 *  operator actually asks at 09:00, which is why they are a fixed vocabulary and not a free query builder. */
export const EVENT_FILTERS = ['all', 'failed', 'at_hub', 'door_open', 'gps_gap'] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];

export function isEventFilter(v: string | undefined): v is EventFilter {
  return !!v && (EVENT_FILTERS as readonly string[]).includes(v);
}

/** W236's chip reads "door-open ≥60s". The threshold is a constant here rather than a magic number in a
 *  query, and the cold-chain tolerance it is measured against (90s) lives with the cold-chain rules — a
 *  door-open event is FLAGGED at 60 and BREACHES at 90, and the two numbers mean different things. */
export const DOOR_OPEN_FLAG_SECONDS = 60;

/**
 * A GPS gap: consecutive points far enough apart in time that the trail cannot be drawn as a line.
 *
 * W235 is explicit about what this must NOT do: *"a signal gap draws a dotted segment, never a teleport."*
 * Breadcrumbs arrive every 90 seconds, so a gap is a multiple of that rather than an arbitrary minute —
 * three missed pings is a gap, one late ping is traffic.
 */
export const BREADCRUMB_INTERVAL_SECONDS = 90;
export const GPS_GAP_SECONDS = BREADCRUMB_INTERVAL_SECONDS * 3;

export interface TrailPoint { at: string; lat: number | null; lng: number | null; status: ShipmentStatus | string; note: string | null }

/** True when the segment ENDING at `curr` should be drawn dotted. The first located point of a trail is
 *  never a gap — there is nothing before it to be disconnected from. */
export function isGpsGap(prev: TrailPoint | undefined, curr: TrailPoint): boolean {
  if (!prev) return false;
  if (prev.lat === null || prev.lng === null || curr.lat === null || curr.lng === null) return true;
  const a = Date.parse(prev.at), b = Date.parse(curr.at);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return Math.abs(b - a) / 1000 > GPS_GAP_SECONDS;
}

/* --------------------------------------------------------------------------------------------------------- */
/* HOW PRECISELY MAY YOU SEE IT                                                                              */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W236: *"GPS coordinates round to ~100m for non-lead roles."* W235: *"Driver location outside active runs:
 * invisible — tracking a shipment, never a person."*
 *
 * Rounding happens HERE, in the domain, and not in a template — a coordinate that reaches a serializer at
 * full precision has already left the building as far as an API response is concerned, and "the UI rounds
 * it" is not a privacy control. Three decimal places is ~110m at this latitude, which is the canon's ~100m.
 */
export const LEAD_PRECISION_DP = 6;
export const MEMBER_PRECISION_DP = 3;

export function roundCoord(v: number | null, dp: number): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Precision for a viewer. A logistics LEAD sees the real coordinate because they are the person who has to
 *  go and find a stopped vehicle; everybody else sees the neighbourhood. */
export function precisionFor(isLead: boolean): number {
  return isLead ? LEAD_PRECISION_DP : MEMBER_PRECISION_DP;
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT THE TRACKING VIEW MAY CLAIM                                                                          */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * **THERE IS NO ETA ON THIS PLATFORM, AND THE VIEW MUST NOT DRAW ONE.**
 *
 * W235 prints "ETA 17:30" and "traffic-adjusted ETA holds". Nothing computes an ETA: there is no routing
 * engine, no traffic source, and `OrderTracking`'s own type carries the note *"No ETA field exists (the app
 * shows ETA as '—' rather than fabricating one)"* — a decision an earlier wave already took on the buyer's
 * side. The tenant console inherits it rather than quietly deciding otherwise, because an ETA a farmer
 * plans their afternoon around is exactly the wrong place to guess.
 *
 * `last_seen` is the honest substitute and is a fact: this is where it was, and this is when.
 */
export type EtaVerdict = { kind: 'no_eta_source' };
export function etaVerdict(): EtaVerdict { return { kind: 'no_eta_source' }; }

/** The furthest point the trail can honestly place the shipment: the last event that carried coordinates.
 *  Null when nothing on this shipment has ever been located, which the screen states rather than centring a
 *  map on a default that would read as a position. */
export function lastKnownPoint(trail: readonly TrailPoint[]): TrailPoint | null {
  for (let i = trail.length - 1; i >= 0; i--) {
    const p = trail[i];
    if (p.lat !== null && p.lng !== null) return p;
  }
  return null;
}

/**
 * Progress along the journey, as a STATUS ORDINAL rather than a distance.
 *
 * W235 draws "72% of route · 38 km remaining". Neither number is derivable: the platform stores no route
 * geometry and no distance-travelled, only breadcrumbs and hops. So the view shows how far through the
 * MILESTONES the shipment is — which is true, checkable, and does not pretend to know kilometres.
 */
export const JOURNEY_MILESTONES: readonly ShipmentStatus[] = ['pending', 'assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'at_hub', 'out_for_delivery', 'delivered'];

export function milestoneProgress(status: ShipmentStatus): { step: number; of: number } | null {
  const i = JOURNEY_MILESTONES.indexOf(status);
  // failed / returned / cancelled are not points on the line — a bar for them would imply progress toward
  // an arrival that is not coming.
  return i < 0 ? null : { step: i + 1, of: JOURNEY_MILESTONES.length };
}
