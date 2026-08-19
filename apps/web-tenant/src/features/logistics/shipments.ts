// apps/web-tenant/src/features/logistics/shipments.ts · W226/W227/W235/W236 as PURE rules (PC-56 TENANT-5a).
// No React, no I/O — unit- and mutation-tested, and the API re-enforces every gate server-side.
//
// The four screens this file serves are the logistics desk: the shipment list, one shipment's detail, its
// live trail, and the cross-shipment event explorer. What it mostly encodes is what the console may NOT say.

export const TABS = ['active', 'pending', 'delivered', 'failed'] as const;
export type Tab = (typeof TABS)[number];

export function isTab(v: string | undefined): v is Tab {
  return !!v && (TABS as readonly string[]).includes(v);
}

/** The tab a query string selects, defaulting to W226's own first tab rather than to whatever arrives. */
export function tabOf(raw: string | undefined): Tab {
  return isTab(raw) ? raw : 'active';
}

/** The server statuses behind each tab. Mirrors `statusesForTab` in the api domain — the SCREEN must not
 *  invent its own bucket, and a test asserts the two lists agree so a divergence fails rather than showing a
 *  tenant a count that disagrees with the rows under it. */
export function statusesForTab(tab: Tab): string[] {
  switch (tab) {
    case 'pending':   return ['pending'];
    case 'delivered': return ['delivered'];
    case 'failed':    return ['failed', 'returned'];
    default:          return ['assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'at_hub', 'out_for_delivery'];
  }
}

export function listHref(tab: Tab, cursor?: string | null): string {
  const qs = new URLSearchParams();
  if (tab !== 'active') qs.set('tab', tab);
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `/logistics?${s}` : '/logistics';
}

/* ------------------------------------------------------------------------------------------------------- */
/* W226's "NEXT MILESTONE" COLUMN                                                                          */
/* ------------------------------------------------------------------------------------------------------- */

export type Milestone = 'assign_driver' | 'schedule_pickup' | 'pickup' | 'transit' | 'deliver' | null;

/** The i18n key for the one thing this shipment is waiting for. `null` renders a dash: a finished shipment
 *  has no next step, and inventing one ("archived", "complete") would be a status recording an act nobody
 *  performed — the defect class this programme has found more than any other. */
export function milestoneKey(m: Milestone): string | null {
  return m ? `ship.milestone.${m}` : null;
}

/** W226 draws "(driver unassigned)" against a shipment with a tempo and no human. That is a REAL distinction
 *  — a vehicle is booked and nobody is driving it — and it is the row an operator must act on today. */
export function driverGapKey(s: { vehicleId?: string | null; riderUserId?: string | null; partnerId?: string | null }): string | null {
  if (s.riderUserId) return null;
  if (s.vehicleId) return 'ship.gap.driverUnassigned';
  // No vehicle and no rider: a 3PL carries its own driver, so only an OWN-fleet shipment is short of one.
  return s.partnerId ? null : 'ship.gap.unassigned';
}

/* ------------------------------------------------------------------------------------------------------- */
/* WHY A SHIPMENT IS NOT MOVING                                                                            */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W226 prints "payment clears first" against its pending cumin row and states the rule beneath the table:
 * "wheels never turn before money clears". Until PC-56 TENANT-5a nothing enforced it — `ShipmentService`
 * never read the order on create, assign, schedule-pickup or pickup.
 *
 * Now the API refuses by name, and this maps that refusal onto the sentence the screen shows. The reason
 * matters: "not yet" sends an operator to chase a buyer, "no longer" sends them to cancel the transport.
 */
export const TRANSPORT_REFUSALS: Record<string, string> = {
  awaiting_payment: 'ship.blocked.awaitingPayment',
  order_closed: 'ship.blocked.orderClosed',
  unknown_order: 'ship.blocked.unknownOrder',
};

export function blockedKey(reason: string | null | undefined): string | null {
  return reason ? (TRANSPORT_REFUSALS[reason] ?? 'ship.blocked.generic') : null;
}

/** Whether the dispatcher's actions should be OFFERED at all. A button that refuses on click is worse than
 *  an absent one with a reason — the same rule W120's pay button follows. */
export function canDispatch(s: { status: string }, orderReady: boolean): boolean {
  return orderReady && ['pending', 'assigned', 'pickup_scheduled'].includes(s.status);
}

/* ------------------------------------------------------------------------------------------------------- */
/* POSSESSION — W225's TICK, HONESTLY                                                                      */
/* ------------------------------------------------------------------------------------------------------- */

export type PossessionProof = 'both_ends' | 'delivery_only' | 'pickup_only' | 'neither';

/**
 * W225's philosophy line is a TICK: "✓ OTP at pickup AND delivery — possession changes hands with proof,
 * both directions." It may only render as a tick when the shipment actually holds both codes.
 *
 * `pickup_otp_hash` existed unwritten from 0007 to 0151, so every shipment created before this wave proves
 * the delivery end only — and the console says so rather than back-filling a claim about a handover nobody
 * witnessed. `neither` is a pre-wave shipment that never reached dispatch.
 */
export function possessionKey(p: PossessionProof): string {
  return `ship.possession.${p === 'both_ends' ? 'bothEnds' : p === 'delivery_only' ? 'deliveryOnly' : p === 'pickup_only' ? 'pickupOnly' : 'neither'}`;
}

/** Only a shipment proving BOTH ends may render the canon's tick. Everything else is a notice. */
export function possessionIsProven(p: PossessionProof): boolean {
  return p === 'both_ends';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE JOURNEY PLAN (W227) — AND THE HALF OF IT THAT DOES NOT EXIST                                        */
/* ------------------------------------------------------------------------------------------------------- */

export type StepVerdict = 'done' | 'next' | 'later' | 'not_built';

/**
 * W227's journey plan is three numbered steps, and each one names a weighbridge slip:
 *   1 Pickup · OTP · 24 bags counted · **weighbridge slip #1**
 *   2 Transit · GPS breadcrumbs every 90s
 *   3 Delivery · OTP · **weighbridge slip #2** · POD photo
 *
 * **THERE IS NO WEIGHBRIDGE ANYWHERE ON THIS PLATFORM.** `grep -rln weighbridge apps/ db/` finds a web-ops
 * i18n string and a backlog note — no table, no column, no service. W225 stakes a tick on it ("Weighbridge
 * slips both ends — the 2-qtl dispute taught us; now it's physics") and W227 stakes its whole
 * dispute-prevention story on slip #1 vs slip #2.
 *
 * So the weighbridge steps render as `not_built` — named, visible, and NOT ticked. Drawing them as part of a
 * completed step would tell an FPO that 998 kg was weighed at both ends when nothing weighed anything, which
 * is exactly the evidence they would reach for in the dispute the canon describes.
 */
export function weighbridgeVerdict(): StepVerdict { return 'not_built'; }

/** Where the shipment is along W227's three steps. Pure ordering, no clock. */
export function stepVerdict(step: 1 | 2 | 3, status: string): StepVerdict {
  const done: Record<number, string[]> = {
    1: ['picked_up', 'in_transit', 'at_hub', 'out_for_delivery', 'delivered'],
    2: ['at_hub', 'out_for_delivery', 'delivered'],
    3: ['delivered'],
  };
  const next: Record<number, string[]> = {
    1: ['pending', 'assigned', 'pickup_scheduled'],
    2: ['picked_up', 'in_transit'],
    3: ['out_for_delivery'],
  };
  if (done[step].includes(status)) return 'done';
  if (next[step].includes(status)) return 'next';
  return 'later';
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE TRAIL (W235) AND THE EXPLORER (W236)                                                                */
/* ------------------------------------------------------------------------------------------------------- */

export const EVENT_FILTERS = ['all', 'failed', 'at_hub', 'door_open', 'gps_gap'] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];

export function isEventFilter(v: string | undefined): v is EventFilter {
  return !!v && (EVENT_FILTERS as readonly string[]).includes(v);
}

export function eventsHref(f: EventFilter, from?: string, to?: string, cursor?: string | null): string {
  const qs = new URLSearchParams();
  if (f !== 'all') qs.set('filter', f);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `/logistics/events?${s}` : '/logistics/events';
}

/**
 * **THE ETA THE SCREEN MUST NOT DRAW.** W235 prints "ETA 17:30", "traffic-adjusted ETA holds" and
 * "38 km remaining". Nothing on this platform computes an ETA — no routing engine, no traffic feed, no route
 * geometry — and the buyer-facing `OrderTracking` type already carries an earlier wave's ruling in its own
 * comment: "No ETA field exists (the app shows ETA as '—' rather than fabricating one)."
 *
 * The tenant console inherits that ruling rather than quietly deciding otherwise. An ETA is the single number
 * on this screen a farmer would plan their afternoon around, which is the worst possible place to guess.
 */
export function etaKey(): string { return 'ship.eta.none'; }

/** What the view CAN say instead, and it is a fact: this is where it was, and this is when. */
export function lastSeenKey(hasPoint: boolean): string {
  return hasPoint ? 'ship.lastSeen.at' : 'ship.lastSeen.never';
}

/** W235: "a signal gap draws a dotted segment, never a teleport". The renderer asks this per point. */
export function segmentStyle(gapBefore: boolean): 'solid' | 'dotted' {
  return gapBefore ? 'dotted' : 'solid';
}

/** Milestone progress as a percentage for the bar — of the JOURNEY's steps, never of a distance. Null when
 *  the shipment is off the line (failed/returned/cancelled): a bar there would imply an arrival that is not
 *  coming. */
export function progressPct(p: { step: number; of: number } | null): number | null {
  if (!p || p.of <= 0) return null;
  return Math.round((Math.min(p.step, p.of) / p.of) * 100);
}

/** W236's window banner. The server reports a clamp when the request reached past the 90-day hot horizon;
 *  the screen must SAY it, or an empty stretch reads as "nothing happened" instead of "you did not ask". */
export function windowKey(w: { clamped: boolean }): string {
  return w.clamped ? 'ship.events.windowClamped' : 'ship.events.window';
}

/** GPS precision, said out loud. A non-lead sees ~100m coordinates and must know that is what they are
 *  looking at, or they will read a rounded point as an exact one and go to the wrong gate. */
export function precisionKey(dp: number): string {
  return dp >= 6 ? 'ship.gps.exact' : 'ship.gps.rounded';
}

/* ------------------------------------------------------------------------------------------------------- */
/* REFUSALS                                                                                                */
/* ------------------------------------------------------------------------------------------------------- */

/** Every refusal these surfaces can return from the API, translated BY NAME. */
export const REFUSALS: Record<string, string> = {
  SHIPMENT_NOT_FOUND: 'notFound',
  SHIPMENT_ORDER_NOT_READY: 'orderNotReady',
  SHIPMENT_ILLEGAL_TRANSITION: 'conflict',
  SHIPMENT_INVALID_PICKUP_OTP: 'pickupOtp',
  SHIPMENT_INVALID_OTP: 'deliveryOtp',
  SHIPMENT_FORBIDDEN: 'forbidden',
};

export function refusalKey(code: string): string {
  return `ship.err.${REFUSALS[code] ?? 'generic'}`;
}
