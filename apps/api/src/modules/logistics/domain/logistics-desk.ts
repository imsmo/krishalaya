// modules/logistics/domain/logistics-desk.ts · W225's overview and W244's insights as PURE verdicts
// (PC-56 TENANT-5d). No I/O, no clock of its own — every input is passed in, so the same rules are testable,
// mutation-tested, and identical for the API, the console and any future export.
//
// This file exists because a desk that mixes measured numbers with plausible ones is worse than no desk. W225 and
// W244 between them print fourteen figures, and only some of them have a source on this platform. So every figure
// here is a VERDICT: a number with its basis, or a refusal with the inputs it is missing by name. The console prints
// the verdict, never a bare number, and the two cannot drift apart because there is one rule for both.
import type { ShipmentStatus } from './shipment.state';

/* --------------------------------------------------------------------------------------------------------- */
/* WINDOWS                                                                                                   */
/* --------------------------------------------------------------------------------------------------------- */

/** W244's range control reads "90 days"; W225's tiles are 30d (delivery), 90d (transit loss) and 7d (cold chain).
 *  Offered as a closed set so a caller cannot ask for a window the indexes and the partition pruning cannot serve. */
export const INSIGHT_WINDOWS = [30, 90, 180] as const;
export type InsightWindow = (typeof INSIGHT_WINDOWS)[number];
export const DEFAULT_INSIGHT_WINDOW: InsightWindow = 90;

export function isInsightWindow(v: unknown): v is InsightWindow {
  return typeof v === 'number' && (INSIGHT_WINDOWS as readonly number[]).includes(v);
}

/** Insights need history before they mean anything — W244 says so itself: "Insights need 30+ days of shipment
 *  events — keep moving, the picture builds." Three states, and the middle one is not an error. */
export const MIN_HISTORY_DAYS = 30;
export type HistoryVerdict =
  | { kind: 'no_data' }
  | { kind: 'not_enough_history'; days: number; needDays: number }
  | { kind: 'ready'; days: number };

export function historyVerdict(daysOfHistory: number | null): HistoryVerdict {
  if (daysOfHistory === null) return { kind: 'no_data' };
  if (daysOfHistory < MIN_HISTORY_DAYS) return { kind: 'not_enough_history', days: daysOfHistory, needDays: MIN_HISTORY_DAYS };
  return { kind: 'ready', days: daysOfHistory };
}

/* --------------------------------------------------------------------------------------------------------- */
/* DELIVERY PERFORMANCE — WHAT IS MEASURED, AND WHAT IS NOT PROMISED                                         */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W225: *"On-time delivery (30d) 95.1%"*.
 *
 * **Nothing on this platform promises a delivery time.** `shipments` carries `scheduled_pickup_at` and no
 * expected/promised delivery column; `delivery_zones` carries no SLA; no charge definition encodes one. "On time"
 * measured against no promise is a ratio with no denominator, and the number a tenant would quote to a buyer.
 *
 * So the tile is refused BY NAME and the two things that ARE measured take its place: the first-attempt rate (5a's
 * `delivery_attempts`, which counted nothing before that wave) and the median pickup→delivery transit.
 */
export type OnTimeVerdict = { kind: 'not_promised'; missing: readonly string[] };
export function onTimeVerdict(): OnTimeVerdict {
  return { kind: 'not_promised', missing: ['shipment_promised_delivery_at', 'zone_delivery_sla'] };
}

export interface DeliveryStats {
  /** Delivered shipments in the window. */
  delivered: number;
  /** Of those, the ones that took one attempt. `delivery_attempts` counts FAILURES, so first-attempt is `<= 0`
   *  failures recorded — a shipment delivered after one failed attempt is not a first-attempt delivery. */
  firstAttempt: number;
  /** Median hours from `picked_up_at` to `delivered_at`, over the rows where both are set. Null when none are. */
  medianTransitHours: number | null;
  /** How many delivered rows had no `picked_up_at` at all, so the transit median is partial and says so. */
  missingPickupStamp: number;
}

export type RateVerdict =
  | { kind: 'measured'; bps: number; of: number }
  /** No delivered shipment in the window: a rate over zero deliveries is not 0%, it is unknown. */
  | { kind: 'no_deliveries' };

/** First-attempt delivery as integer basis points — no float ever divides a count on this platform's screens, and
 *  a percentage rendered from bps cannot disagree with the count it came from. */
export function firstAttemptVerdict(s: Pick<DeliveryStats, 'delivered' | 'firstAttempt'>): RateVerdict {
  if (s.delivered <= 0) return { kind: 'no_deliveries' };
  return { kind: 'measured', bps: Math.round((s.firstAttempt * 10_000) / s.delivered), of: s.delivered };
}

export type TransitVerdict =
  | { kind: 'measured'; medianHours: number; of: number; missingPickupStamp: number }
  | { kind: 'not_measurable'; missingPickupStamp: number };

/** The median transit, and honest about its own coverage: a shipment delivered with no pickup stamp cannot be timed,
 *  and a median over three of ninety rows is a number an operator should distrust. */
export function transitVerdict(s: DeliveryStats): TransitVerdict {
  if (s.medianTransitHours === null) return { kind: 'not_measurable', missingPickupStamp: s.missingPickupStamp };
  return { kind: 'measured', medianHours: s.medianTransitHours, of: s.delivered - s.missingPickupStamp, missingPickupStamp: s.missingPickupStamp };
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE FAILURE REASONS — THE CHART THIS WAVE GAVE A SOURCE                                                   */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W244: *"Failed-delivery reasons (90d, 118 events)"* over five bars, with a policy decision resting on them.
 *
 * **The reason was written to no column of this database before 0154.** The API accepted it, `markFailed(reason)`
 * put it in an outbox payload, and the only writer of a status hop into `shipment_events` passed `note = NULL`. So
 * this chart had no source at all — not free text to bucket, nothing.
 *
 * `unclassified` is therefore a first-class slice, not a rounding error: it is every attempt recorded before this
 * wave (and any recorded while the coded reason was not supplied). Distributing it across the five bars would let a
 * call-ahead pilot be justified by arithmetic nobody performed.
 */
export interface FailureRow { reasonCode: string | null; events: number }

export interface FailureSlice { code: string; events: number; shareBps: number }
export type FailureBreakdown = {
  total: number;
  slices: FailureSlice[];
  /** Attempts with no coded reason. Reported beside the slices and NEVER folded into them. */
  unclassified: number;
  /** True when the coded rows are a minority — the chart is then a sample of the tenant's own history, and saying so
   *  is the difference between a decision and a guess. */
  mostlyUnclassified: boolean;
};

export const UNCLASSIFIED = 'unclassified';

export function failureBreakdown(rows: readonly FailureRow[]): FailureBreakdown {
  let total = 0;
  let unclassified = 0;
  const byCode = new Map<string, number>();
  for (const r of rows) {
    const n = Math.max(0, Math.trunc(r.events));
    total += n;
    if (r.reasonCode === null || r.reasonCode === '') { unclassified += n; continue; }
    byCode.set(r.reasonCode, (byCode.get(r.reasonCode) ?? 0) + n);
  }
  const coded = total - unclassified;
  const slices = [...byCode.entries()]
    // Share is of the CODED events, because a slice's share of a total that includes unclassified rows would shrink
    // every bar by however much history predates the column — a chart that changes shape for a reason that is not
    // about deliveries at all.
    .map(([code, events]) => ({ code, events, shareBps: coded > 0 ? Math.round((events * 10_000) / coded) : 0 }))
    .sort((a, b) => b.events - a.events || a.code.localeCompare(b.code));
  return { total, slices, unclassified, mostlyUnclassified: total > 0 && unclassified * 2 > total };
}

/** The one actionable sentence W244 hangs on this chart ("the 30-min call-ahead pilot") is only worth printing when
 *  the reason it targets is actually the biggest CODED slice — and never off unclassified history. */
export function callAheadCandidate(b: FailureBreakdown): boolean {
  const top = b.slices[0];
  return !!top && top.code === 'gate_closed' && !b.mostlyUnclassified && top.events > 0;
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE LANES — MEASURED IN WHAT WE ACTUALLY HAVE                                                             */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W244: *"Busiest lane · Vanthali ↔ Rajkot · 31% of qtl-km · candidate for fixed daily run"*.
 *
 * The lane itself is real — `addresses.region_id` at both ends of a shipment names it. **Its share of qtl-km is
 * not**: there is no distance (`shipments.distance_km` is dead since 0007, see its COMMENT) and no consignment
 * weight anywhere. So the share is computed over SHIPMENTS and labelled as such. A share of the wrong denominator
 * printed with the right unit is how a tenant commits a truck to a daily run on a number nobody measured.
 */
export interface LaneRow { fromRegionId: string; toRegionId: string; fromName: string | null; toName: string | null; shipments: number }
export interface LaneShare extends LaneRow { shareBps: number }

export function laneShares(rows: readonly LaneRow[]): { lanes: LaneShare[]; totalShipments: number; basis: 'shipments' } {
  const total = rows.reduce((a, r) => a + Math.max(0, Math.trunc(r.shipments)), 0);
  return {
    lanes: rows.map((r) => ({ ...r, shareBps: total > 0 ? Math.round((r.shipments * 10_000) / total) : 0 }))
      .sort((a, b) => b.shipments - a.shipments || a.fromRegionId.localeCompare(b.fromRegionId)),
    totalShipments: total,
    basis: 'shipments',
  };
}

/**
 * W244's "candidate for fixed daily run" badge.
 *
 * A candidate is a lane carrying a real share of the tenant's movements with enough absolute volume to fill a
 * vehicle regularly — both, because 60% of five shipments is not a daily run, and twelve shipments spread over
 * nothing in particular is not either. The thresholds are stated here rather than in a template so the console and
 * any future report cannot disagree about what the badge means, and so a founder can move one number.
 */
export const LANE_CANDIDATE_MIN_SHARE_BPS = 2_000;   // 20% of the window's shipments
export const LANE_CANDIDATE_MIN_SHIPMENTS = 12;
export function isLaneCandidate(l: Pick<LaneShare, 'shareBps' | 'shipments'>): boolean {
  return l.shareBps >= LANE_CANDIDATE_MIN_SHARE_BPS && l.shipments >= LANE_CANDIDATE_MIN_SHIPMENTS;
}

/**
 * W244's first tile: *"Cost per qtl-km ₹2.14 ▼ 9% — Village Run consolidation working"*.
 *
 * THREE inputs, none of them present:
 *   • `shipments.distance_km` — dead since 0007, nothing writes or reads it; no routing engine, no distance matrix,
 *     no odometer reading exists on this platform;
 *   • a consignment WEIGHT — `shipments` has no weight column at all (`vehicles.capacity_kg` is a truck's property);
 *   • `shipments.charge_minor` — nothing writes it either (5c's finding, recorded in that column's own COMMENT).
 *
 * Refused with all three named. This is the number a tenant sets next quarter's freight rates by, and a plausible
 * one would be worse than none.
 */
export type CostPerUnitVerdict = { kind: 'not_computable'; missing: readonly string[] };
export function costPerQtlKmVerdict(): CostPerUnitVerdict {
  return { kind: 'not_computable', missing: ['shipment_distance_km', 'consignment_weight', 'shipment_charge_minor'] };
}

/**
 * W225: *"Transit loss (90d) ₹84,200"* and *"Transit is 45% of our wastage"*.
 *
 * Nothing measures loss on this platform: no damage record, no shortfall record, and no weighbridge (5a established
 * that no weighbridge exists anywhere in `apps/` or `db/`). The nearest signal is a buyer DISPUTE reasoned `damaged`
 * with a resolution amount — a claims figure, not a measurement, and one that lives in the disputes plane, which
 * this module may not read from (module blueprint: only a public service or events). And a percentage of "our
 * wastage" has no baseline at all: nothing on this platform measures total wastage, so 45% is a share of an unknown.
 */
export type TransitLossVerdict = { kind: 'not_recorded'; missing: readonly string[]; nearest: 'buyer_disputes_damaged' };
export function transitLossVerdict(): TransitLossVerdict {
  return {
    kind: 'not_recorded',
    missing: ['shipment_loss_record', 'weighbridge_slips', 'wastage_baseline'],
    nearest: 'buyer_disputes_damaged',
  };
}

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT NEEDS YOU TODAY                                                                                      */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W225's "Needs you today" list. Three rows in the canon, and each is a different KIND of thing:
 *   • a pickup that is booked with a vehicle and NO DRIVER — the row an operator must act on, and the one 5a's
 *     shipments list already distinguishes;
 *   • a reefer in transit with a live temperature — real (cold-chain readings exist) minus the ETA, which 5a refused
 *     for the whole platform: no routing engine, and an ETA is the number a farmer plans an afternoon around;
 *   • the next Village Run, whose DAY is real (0152's route state machine) and whose consolidation count is not
 *     tracked by anything (5b: `logistics.village_run_due` has no subscriber, the job is instantiated nowhere).
 *
 * Ordered by how soon somebody must move, not by kind: a pickup in ninety minutes outranks a run on Saturday.
 */
export type AttentionItem =
  | { kind: 'pickup_no_driver'; shipmentId: string; orderId: string; at: string; hasVehicle: boolean }
  | { kind: 'pickup_due'; shipmentId: string; orderId: string; at: string }
  | { kind: 'cold_chain_live'; shipmentId: string; orderId: string; lastTempC: string | null; lastAt: string | null; breaches: number }
  | { kind: 'village_run'; routeId: string; routeName: string; dayKey: string | null; daysAway: number | null; consolidation: 'not_tracked' };

export function attentionKey(i: AttentionItem): string { return `logistics.attention.${i.kind}`; }

/** The three rows the canon prints, in the order a person should work them. A cold-chain row with a BREACH sorts
 *  first regardless of clocks — a warming reefer is the only thing on this screen that spoils while you read it. */
export function orderAttention(items: readonly AttentionItem[]): AttentionItem[] {
  const rank = (i: AttentionItem) => {
    if (i.kind === 'cold_chain_live') return i.breaches > 0 ? 0 : 2;
    if (i.kind === 'pickup_no_driver') return 1;
    if (i.kind === 'pickup_due') return 3;
    return 4;
  };
  return [...items].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    const at = 'at' in a ? a.at : '';
    const bt = 'at' in b ? b.at : '';
    return at.localeCompare(bt);
  });
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE PHILOSOPHY BLOCK — THREE CLAIMS, CHECKED AGAINST THE SOFTWARE                                         */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W225 prints three ticks:
 *   ✓ "OTP at pickup AND delivery — possession changes hands with proof, both directions"
 *   ✓ "Weighbridge slips both ends — the 2-qtl dispute taught us; now it's physics"
 *   ✓ "Village Run consolidation: one truck, one Saturday, thirty villages"
 *
 * A tick is a claim about the software, so each one is resolved against what is actually switched on for THIS
 * tenant. The pickup half of the OTP promise exists only because 5a built it and is behind a flag; the weighbridge
 * does not exist at all; the Village Run has routes and no consolidation tracking. Printing three ticks over that
 * is how a safety claim becomes decoration — and this block is the one an FPO would quote in a dispute.
 */
export type MechanismState = 'on' | 'off' | 'partial' | 'absent';
export interface MechanismVerdict { key: 'otp_both_ends' | 'weighbridge' | 'village_run'; state: MechanismState; detail?: string }

export function mechanisms(i: { pickupOtpEnabled: boolean; routesActive: number }): MechanismVerdict[] {
  return [
    // Delivery OTP has always existed; the PICKUP half is 5a's, behind `logistics_pickup_otp`. With it off, the
    // platform proves ONE end of a handover, which is not what this tick says.
    { key: 'otp_both_ends', state: i.pickupOtpEnabled ? 'on' : 'partial', detail: i.pickupOtpEnabled ? undefined : 'delivery_only' },
    // No weighbridge exists anywhere on this platform: no slip, no reading, no table. 5a refused to draw it and this
    // wave refuses to tick it.
    { key: 'weighbridge', state: 'absent' },
    // The route plane is real (0152). What is missing is the consolidation record the canon counts parcels with.
    { key: 'village_run', state: i.routesActive > 0 ? 'partial' : 'absent', detail: 'consolidation_not_tracked' },
  ];
}

export function mechanismKey(m: MechanismVerdict): string { return `logistics.mech.${m.key}.${m.state}`; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE LEAD LINE                                                                                             */
/* --------------------------------------------------------------------------------------------------------- */

/** W225's lead counts three things and then makes a claim: "24 active shipments · 2 pickups scheduled today ·
 *  Saturday Village Run loads in 5 days. Transit is 45% of our wastage". The first three are counted from rows; the
 *  fourth has no baseline anywhere on this platform and is refused (see `transitLossVerdict`). */
// Every status where produce is committed and moving. `pending` is excluded on purpose — 5a established that a
// pending shipment is one whose money has not cleared, so counting it as "active" would tell an FPO that a truck is
// out for an order nobody has paid for. `at_hub` IS included: the goods are ours, in transit, and mid-lane.
export const ACTIVE_STATUSES: readonly ShipmentStatus[] = ['assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'at_hub', 'out_for_delivery'];

export function activeCount(byStatus: Readonly<Record<string, number>>): number {
  return ACTIVE_STATUSES.reduce((a, s) => a + (byStatus[s] ?? 0), 0);
}

/** Days from today to the next run of an active weekly route — computed on DATE boundaries, so "loads in 5 days"
 *  cannot flip because the read happened at 23:59. `null` when the route has no weekday (an on-demand run). */
export function daysUntilWeekday(todayDow: number, runWeekday: number | null): number | null {
  if (runWeekday === null) return null;
  if (!Number.isInteger(runWeekday) || runWeekday < 0 || runWeekday > 6) return null;
  const d = (runWeekday - todayDow + 7) % 7;
  return d;
}
