// modules/logistics/domain/fleet-fitness.ts · MAY THIS VEHICLE CARRY THIS LOAD (PC-56 TENANT-5b).
// Pure rules — no I/O, no clock of its own (every function that needs "today" is given it).
//
// W229's lead, printed under its own title:
//
//   "Fleet register — type from the lookup (bike, tempo, truck, reefer_7mt, tractor_trolley), capacity, RC on
//    file. **An expired RC parks the vehicle automatically; safety is not a preference.**"
//
// **NOTHING ON THIS PLATFORM HAS EVER LOOKED AT AN RC.** `vehicles.rc_doc_id` has existed since 0007 as a FK
// to `kyc_documents`, and `grep -rn "rc_doc\|rcDoc" apps` returns the DTO that accepts it, the entity field
// that holds it, the repository columns that store it and the serializer that echoes it back — and not one
// join, not one status check, not one expiry comparison. `kyc_documents` carries `status` and `valid_until`
// and even an index built for this exact question (`idx_kyc_expiring ... WHERE status = 'verified'`), which
// the identity module's reminder job uses to NOTIFY a person. No vehicle was ever parked by anything.
//
// And W226/W227's assignment: `ShipmentService.assign` accepts `vehicleId` as a bare uuid and validates
// NOTHING — not that the vehicle exists, not that it belongs to this tenant, not that it is active, and not
// that a `requires_cold_chain` shipment is going onto a refrigerated one. `shipments.requires_cold_chain`
// (0007) and `vehicles.is_refrigerated` (0007) have both existed all along and have never been compared, so a
// ghee run could be loaded onto an open tempo and the only thing that would notice is `cold_chain_logs`,
// after the temperature was already wrong.
import { ShipmentStatus } from './shipment.state';

/* --------------------------------------------------------------------------------------------------------- */
/* THE THREE SWITCHES (0152) — declared here, in the file that owns the vocabulary, so the gate, the job and   */
/* the register cannot drift onto three spellings of the same flag key.                                       */
/* --------------------------------------------------------------------------------------------------------- */
export const FLEET_FITNESS_FLAG = 'logistics_fleet_fitness';
export const RC_PARKING_FLAG = 'logistics_rc_parking';
export const REQUIRE_RC_FLAG = 'logistics_require_rc';

/* --------------------------------------------------------------------------------------------------------- */
/* THE RC                                                                                                    */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * The document states that matter for a vehicle's registration certificate, in the vocabulary
 * `kyc_documents.status` actually uses (`kyc_status`: pending | verified | rejected | expired).
 *
 * `absent` is NOT a document state — it is the state of a vehicle with no `rc_doc_id` at all, which is what
 * every vehicle registered before this wave has, because no form ever asked for one.
 */
export type RcVerdict =
  /** Verified and inside its validity window (or verified with no expiry recorded — some RCs are lifetime). */
  | { kind: 'valid'; validUntil: string | null }
  /** Verified, still valid, and inside the warning window: the FPO can renew before the vehicle stops. */
  | { kind: 'expiring'; validUntil: string; daysLeft: number }
  /** Verified and past its validity date. This is the state W229 says parks the vehicle. */
  | { kind: 'expired'; validUntil: string; daysOver: number }
  /** Submitted and not yet reviewed. NOT the same as expired: the paperwork is in, the desk has not read it. */
  | { kind: 'unverified' }
  /** Reviewed and refused. A rejected RC is not a slow RC. */
  | { kind: 'rejected' }
  /** No document on file. Every pre-wave vehicle. Reported, never silently treated as valid. */
  | { kind: 'absent' };

/** How long before expiry the register starts warning. Two months: long enough that an RTO appointment and a
 *  renewal fit inside it, short enough that the warning still means something when it appears. */
export const RC_EXPIRY_WARN_DAYS = 60;

const DAY_MS = 86_400_000;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
/** Whole days between two YYYY-MM-DD dates (b − a). Date-only arithmetic: an RC expires on a DATE, and a
 *  timezone-dependent "expired at 18:30 IST" would park a vehicle mid-run in one region and not another. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

export interface RcDoc { status: string | null; validUntil: string | null }

/**
 * What this vehicle's RC actually says, as of `now`.
 *
 * A verified document with NO `valid_until` reads as `valid`, deliberately: a null expiry means "no expiry was
 * recorded", and inventing one (or treating the absence as expiry) would park a vehicle over a blank field.
 * The register still shows the blank, so an operator can fix the record rather than argue with the console.
 */
export function rcVerdict(doc: RcDoc | null | undefined, now: Date): RcVerdict {
  if (!doc || (doc.status == null && doc.validUntil == null)) return { kind: 'absent' };
  if (doc.status === 'rejected') return { kind: 'rejected' };
  if (doc.status !== 'verified') return { kind: 'unverified' };
  if (!doc.validUntil) return { kind: 'valid', validUntil: null };
  const today = dayOf(now);
  const left = daysBetween(today, doc.validUntil);
  // An RC valid UNTIL today is still valid today — the last day of a licence is a day you may drive on.
  if (left < 0) return { kind: 'expired', validUntil: doc.validUntil, daysOver: -left };
  if (left <= RC_EXPIRY_WARN_DAYS) return { kind: 'expiring', validUntil: doc.validUntil, daysLeft: left };
  return { kind: 'valid', validUntil: doc.validUntil };
}

/**
 * Does this RC state PARK the vehicle (W229: "an expired RC parks the vehicle automatically")?
 *
 * `expired` and `rejected` only. **`absent` deliberately does NOT park**, and that is the most consequential
 * decision in this file: `rc_doc_id` is nullable, no form has ever asked for it, and no vehicle on the
 * platform has one — so parking on absence would deactivate every fleet on the platform in one tick and call
 * it safety. What absence gets instead is a named row on the register ("no RC on file") that an FPO can act
 * on, and a tenant that wants the strict rule turns it on per tenant (`logistics_require_rc`).
 *
 * A pending document does not park either: the paperwork is in and the desk has not read it, and punishing a
 * tenant for our own review queue is not a safety rule.
 */
export function rcParks(v: RcVerdict): boolean {
  return v.kind === 'expired' || v.kind === 'rejected';
}

/** W229's RC column has a fifth reading that is not a document state: the document belongs to a platform 3PL
 *  and this tenant may not see it. The canon's word for it is "3PL-held". */
export type RcCell = RcVerdict | { kind: '3pl_held' };

/** Only `absent` — the state the strict per-tenant flag escalates from a warning into a refusal. */
export function rcAbsent(v: RcVerdict): boolean { return v.kind === 'absent'; }

/* --------------------------------------------------------------------------------------------------------- */
/* THE PLATE                                                                                                 */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W229 prints every plate part-masked — `GJ-03-TR-88••` — and that is not decoration: a registration number
 * identifies a vehicle, its owner and, on a village run, a household, and the fleet register is readable by
 * every holder of `logistics.manage` including a 3PL desk looking at partnered vehicles.
 *
 * The last two characters are replaced. Short plates (under 6) are masked more aggressively rather than less,
 * because a 4-character plate is MORE identifying, not less. Applied in the read model, never in a template.
 */
export function maskRegNo(regNo: string): string {
  const s = (regNo ?? '').trim();
  if (!s) return '';
  const keep = s.length <= 5 ? Math.max(1, s.length - 2) : s.length - 2;
  return `${s.slice(0, keep)}••`;
}

/* --------------------------------------------------------------------------------------------------------- */
/* MAY THIS VEHICLE TAKE THIS SHIPMENT                                                                       */
/* --------------------------------------------------------------------------------------------------------- */

export interface FitnessInput {
  /** null when the id names no vehicle this tenant may see (missing, another tenant's, soft-deleted). */
  vehicle: { id: string; isActive: boolean; isRefrigerated: boolean; capacityKg: number | null } | null;
  rc: RcVerdict;
  requiresColdChain: boolean;
  /** Per-tenant escalation of `absent` from a warning to a refusal (flag `logistics_require_rc`). */
  requireRcOnFile: boolean;
  /**
   * The vehicle is a platform 3PL's own (Law 11: `vehicles.tenant_id IS NULL`), so its RC lives in the
   * partner's realm and RLS correctly hides it from this tenant. W229 prints exactly this as **"3PL-held"**
   * against the Shadowfax reefer.
   *
   * The RC branches are SKIPPED rather than passed a fabricated verdict: an FPO cannot renew a Shadowfax RC, so
   * refusing their dispatch over a document they cannot see would punish them for somebody else's paperwork —
   * and treating the invisible document as `valid` inside the domain would be this file telling itself a lie.
   * The carrier warrants its own fleet contractually; the register says who holds the document.
   */
  rcHeldByPartner?: boolean;
}

export type FitnessVerdict =
  | { kind: 'fit' }
  /** The id names nothing this tenant may assign. Refuse — never "assign it anyway and find out". */
  | { kind: 'vehicle_unknown' }
  /** Deactivated: either an operator parked it or the RC-parking job did. */
  | { kind: 'vehicle_parked' }
  /** The RC is expired or rejected. Carries the state so the console can print WHICH. */
  | { kind: 'rc_invalid'; rc: 'expired' | 'rejected'; validUntil: string | null }
  /** No RC on file and this tenant has chosen to require one. */
  | { kind: 'rc_absent' }
  /** A cold-chain consignment onto a vehicle that is not refrigerated. */
  | { kind: 'not_refrigerated' };

/**
 * The single question the assignment asks. Ordered deliberately: existence, then parking, then paperwork,
 * then physics — an operator fixing one problem at a time should be told the FIRST one that stops them, and
 * "this vehicle is not refrigerated" is useless advice about a vehicle that does not exist.
 */
export function vehicleFitness(i: FitnessInput): FitnessVerdict {
  if (!i.vehicle) return { kind: 'vehicle_unknown' };
  // Parking still applies to a partnered vehicle: whoever deactivated it, it is not to be dispatched.
  if (!i.vehicle.isActive) return { kind: 'vehicle_parked' };
  if (!i.rcHeldByPartner) {
    if (i.rc.kind === 'expired') return { kind: 'rc_invalid', rc: 'expired', validUntil: i.rc.validUntil };
    if (i.rc.kind === 'rejected') return { kind: 'rc_invalid', rc: 'rejected', validUntil: null };
    if (i.requireRcOnFile && rcAbsent(i.rc)) return { kind: 'rc_absent' };
  }
  // The physics. Both columns have existed since 0007 and have never been compared.
  if (i.requiresColdChain && !i.vehicle.isRefrigerated) return { kind: 'not_refrigerated' };
  return { kind: 'fit' };
}

export function isFit(v: FitnessVerdict): boolean { return v.kind === 'fit'; }

/* --------------------------------------------------------------------------------------------------------- */
/* WHAT IS THIS VEHICLE DOING TODAY (W229's last column)                                                     */
/* --------------------------------------------------------------------------------------------------------- */

/** The shipment statuses that mean this vehicle is CARRYING something right now. `pending` is not one of
 *  them: a shipment waiting on money has a vehicle written against it and no wheels turning. */
export const ON_THE_ROAD: readonly ShipmentStatus[] = ['picked_up', 'in_transit', 'at_hub', 'out_for_delivery'];

export interface TodayInput {
  /** Shipments created today (or still open) that name this vehicle, already counted by the repository. */
  onRoad: number; deliveredToday: number; assignedToday: number;
  /** The next recurring run this vehicle is committed to, if any (delivery_routes.run_weekday). */
  nextRun: { routeName: string; weekday: number } | null;
  /** The most recent cold-chain reading for the consignment this vehicle is carrying, if any. */
  reefer: { tempC: number; isBreach: boolean } | null;
}

export type TodayVerdict =
  | { kind: 'carrying'; onRoad: number; reefer: { tempC: number; isBreach: boolean } | null }
  | { kind: 'done_today'; deliveredToday: number }
  | { kind: 'loads_next'; routeName: string; weekday: number }
  | { kind: 'idle' };

/**
 * What the register may say about a vehicle's day.
 *
 * W229 prints four things in this column: "2 runs done · free 15:30", "at depot", "Village Run — loads Sat
 * 05:00" and "ghee run · 4.2°C". Three of those are facts this platform holds. **"free 15:30" is not**: there
 * is no shift model, no working-hours record and no drop-duration estimate anywhere, so the time a vehicle
 * becomes free is not derivable and this function does not return one. Neither is the "05:00" in "loads Sat
 * 05:00" — a route carries a WEEKDAY and no time of day (`delivery_routes.run_weekday`), so the console says
 * the day and not an hour it would be inventing.
 */
export function todayVerdict(i: TodayInput): TodayVerdict {
  if (i.onRoad > 0) return { kind: 'carrying', onRoad: i.onRoad, reefer: i.reefer };
  if (i.deliveredToday > 0) return { kind: 'done_today', deliveredToday: i.deliveredToday };
  if (i.nextRun) return { kind: 'loads_next', routeName: i.nextRun.routeName, weekday: i.nextRun.weekday };
  return { kind: 'idle' };
}

/** W229's footer: "4 highlighted of 5 vehicles (yours 3 + partnered 2)". `tenant_id IS NULL` is a platform 3PL
 *  vehicle browsed here read-only (Law 11); a tenant-owned row is the FPO's own. The two are counted
 *  separately because they are two different kinds of promise — one the FPO can park, one it cannot. */
export function fleetSplit(rows: readonly { scope: 'tenant' | 'platform' }[]): { own: number; partnered: number; total: number } {
  let own = 0, partnered = 0;
  for (const r of rows) (r.scope === 'platform' ? partnered++ : own++);
  return { own, partnered, total: own + partnered };
}
