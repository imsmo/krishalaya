// apps/web-tenant/src/features/logistics/fleet.ts · W229 (Vehicles) as PURE rules (PC-56 TENANT-5b).
// No React, no I/O — unit- and mutation-tested, and the API re-enforces every judgement server-side.
//
// W229's lead is a safety claim: "An expired RC parks the vehicle automatically; safety is not a preference."
// Most of this file is about telling that claim's truth — including when the mechanism behind it is switched off,
// which is the state a fresh tenant is actually in.

import type { FleetMechanisms, FleetVehicleRow, RcCell, VehicleToday } from '@krishalaya/sdk-js';

/* ------------------------------------------------------------------------------------------------------- */
/* THE RC COLUMN                                                                                           */
/* ------------------------------------------------------------------------------------------------------- */

/** The i18n key for what a vehicle's RC says. Seven readings, seven sentences: an operator who is told "RC
 *  problem" has to open the record to find out whether to book an RTO appointment or chase our review desk. */
export function rcKey(rc: RcCell): string {
  switch (rc.kind) {
    case 'valid':      return 'fleet.rc.valid';
    case 'expiring':   return 'fleet.rc.expiring';
    case 'expired':    return 'fleet.rc.expired';
    case 'unverified': return 'fleet.rc.unverified';
    case 'rejected':   return 'fleet.rc.rejected';
    case '3pl_held':   return 'fleet.rc.heldByPartner';
    default:           return 'fleet.rc.absent';
  }
}

/** How the cell READS. `expiring` is a warning and not a failure — a vehicle with eight weeks left is legal
 *  today, and colouring it red teaches an operator to ignore red. */
export function rcTone(rc: RcCell): 'ok' | 'warn' | 'bad' | 'muted' {
  switch (rc.kind) {
    case 'valid':    return 'ok';
    case 'expiring': return 'warn';
    case 'expired':
    case 'rejected': return 'bad';
    case '3pl_held': return 'muted';
    default:         return 'warn';   // unverified / absent — not a failure, but not a tick either
  }
}

/** W229 prints "verified · valid 2028": the YEAR, not a full date, because the column is a status and not a
 *  document viewer. Null when there is no date to print (a lifetime RC, an unverified one, a partner's). */
export function rcYear(rc: RcCell): string | null {
  return 'validUntil' in rc && rc.validUntil ? rc.validUntil.slice(0, 4) : null;
}

/* ------------------------------------------------------------------------------------------------------- */
/* WHAT THE VEHICLE IS DOING                                                                               */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W229's last column. Four readings, and NOT the fifth the canon draws: "free 15:30".
 *
 * There is no shift model, no working-hours record and no drop-duration estimate anywhere on this platform, so
 * the time a vehicle becomes free is not derivable — and it is the one number on this screen a dispatcher would
 * promise a farmer. The API does not return it and this function cannot render it.
 */
export function todayKey(t: VehicleToday): string {
  switch (t.kind) {
    case 'carrying':   return t.reefer ? 'fleet.today.carryingReefer' : 'fleet.today.carrying';
    case 'done_today': return 'fleet.today.doneToday';
    case 'loads_next': return 'fleet.today.loadsNext';
    default:           return 'fleet.today.idle';
  }
}

/** A cold-chain breach on a vehicle CARRYING a consignment is the one thing on this screen that is an emergency:
 *  it is the difference between "4.2°C" and "the ghee is spoiling now". */
export function reeferBreach(t: VehicleToday): boolean {
  return t.kind === 'carrying' && !!t.reefer && t.reefer.isBreach;
}

/* ------------------------------------------------------------------------------------------------------- */
/* THE TYPE — A VOCABULARY THAT HAD NO VALUES                                                              */
/* ------------------------------------------------------------------------------------------------------- */

/**
 * W229: "type from the lookup (bike, tempo, truck, reefer_7mt, tractor_trolley)".
 *
 * The `vehicle_type` lookup TYPE has been declared in `db/seeds/core/0005_lookup_vocabularies.sql` since the
 * beginning with **not one VALUE inserted**, so `vehicles.vehicle_type_id` could never be set to anything, every
 * vehicle carried a NULL type, and the register form had no options to offer. TENANT-5b seeds the five the canon
 * names; a vehicle recorded before that shows `unset` — which is the truth, and is fixable in one edit.
 */
export function typeKey(typeCode: string | null): string {
  return typeCode ? `fleet.type.${typeCode}` : 'fleet.type.unset';
}

/** A `reefer_7mt` that is not flagged refrigerated (or the reverse) is a record that contradicts itself, and the
 *  cold-chain gate reads the FLAG — so the register says so rather than letting the two disagree quietly. */
export function typeContradictsReefer(v: { typeCode: string | null; isRefrigerated: boolean }): boolean {
  if (!v.typeCode) return false;
  const typeSaysReefer = v.typeCode.startsWith('reefer');
  return typeSaysReefer !== v.isRefrigerated;
}

/* ------------------------------------------------------------------------------------------------------- */
/* WHY A VEHICLE MAY NOT BE DISPATCHED                                                                     */
/* ------------------------------------------------------------------------------------------------------- */

/** The API's refusal reasons, translated BY NAME — the same verdicts `assign` throws, so the register and the
 *  dispatch desk cannot tell an operator two different stories about one vehicle. */
export const UNFIT_KEYS: Record<string, string> = {
  vehicle_unknown: 'fleet.unfit.unknown',
  vehicle_parked: 'fleet.unfit.parked',
  rc_invalid: 'fleet.unfit.rcInvalid',
  rc_absent: 'fleet.unfit.rcAbsent',
  not_refrigerated: 'fleet.unfit.notRefrigerated',
};

export function unfitKey(unfit: string | null): string | null {
  return unfit ? (UNFIT_KEYS[unfit] ?? 'fleet.unfit.generic') : null;
}

/**
 * **The sentence this screen must not leave out.** With `logistics_rc_parking` off — the shipped default — an
 * expired RC sits on the register and NOTHING parks the vehicle. W229 states the opposite as settled policy, so
 * the screen says which is true today rather than letting the canon's sentence stand as a description of the
 * software.
 *
 * Returns a key only when there is something to say: a tenant whose fleet is clean does not need a lecture about
 * a switch.
 */
export function mechanismNoticeKey(m: FleetMechanisms, rows: readonly Pick<FleetVehicleRow, 'rc' | 'isActive'>[]): string | null {
  const invalid = rows.some((r) => (r.rc.kind === 'expired' || r.rc.kind === 'rejected') && r.isActive);
  if (invalid && !m.rcParking) return 'fleet.notice.rcNotParking';
  if (invalid && !m.fitnessGate) return 'fleet.notice.gateOff';
  const absent = rows.some((r) => r.rc.kind === 'absent');
  if (absent) return 'fleet.notice.rcMissing';
  return null;
}

/** W229's footer: "4 highlighted of 5 vehicles (yours 3 + partnered 2)". Which vehicles are "highlighted" is a
 *  mockup's word for the ones drawn in the table, so the console counts what it shows and says PAGE — a total
 *  across a keyset-paged register would be a number the reader cannot check. */
export function splitKey(split: { own: number; partnered: number }): string {
  return split.partnered > 0 ? 'fleet.split.mixed' : 'fleet.split.ownOnly';
}

/* ------------------------------------------------------------------------------------------------------- */
/* NAVIGATION AND THE MUTATE CHAIN (W2421 · W2422 · W2423)                                                 */
/* ------------------------------------------------------------------------------------------------------- */

export function registerHref(activeOnly: boolean, cursor?: string | null): string {
  const qs = new URLSearchParams();
  if (activeOnly) qs.set('active', '1');
  if (cursor) qs.set('cursor', cursor);
  const s = qs.toString();
  return s ? `/logistics/vehicles?${s}` : '/logistics/vehicles';
}

export const VEHICLE_ACTIONS = ['park', 'unpark', 'register'] as const;
export type VehicleAction = (typeof VEHICLE_ACTIONS)[number];

export function isVehicleAction(v: string | undefined): v is VehicleAction {
  return !!v && (VEHICLE_ACTIONS as readonly string[]).includes(v);
}

/** W2421's confirm step: "Review the object and reason below; confirming writes an audit-trail entry with actor,
 *  time and reason." Every state-changing action gets one (Completeness Law B4) — including un-parking, which is
 *  the one that puts a vehicle back on a road. */
export function confirmHref(action: VehicleAction, id?: string): string {
  const qs = new URLSearchParams({ act: action });
  if (id) qs.set('id', id);
  return `/logistics/vehicles?${qs.toString()}`;
}

export function actionTitleKey(action: VehicleAction): string {
  return `fleet.act.${action}.title`;
}

/** Un-parking a vehicle whose RC is expired puts an unroadworthy lorry back on a village road, so the confirm
 *  step says so explicitly instead of asking "are you sure?". */
export function unparkWarningKey(rc: RcCell): string | null {
  return rc.kind === 'expired' || rc.kind === 'rejected' ? 'fleet.act.unpark.rcWarning' : null;
}

/* ------------------------------------------------------------------------------------------------------- */
/* REFUSALS                                                                                               */
/* ------------------------------------------------------------------------------------------------------- */

export const FLEET_REFUSALS: Record<string, string> = {
  VEHICLE_REG_EXISTS: 'regExists',
  VEHICLE_INVALID: 'invalid',
  FLEET_ALREADY_IN_STATE: 'alreadyInState',
  PARTNER_NOT_FOUND: 'partnerUnknown',
  SHIPMENT_FORBIDDEN: 'forbidden',
  reg_required: 'regRequired',
  partner_required: 'partnerRequired',
};

export function fleetErrorKey(code: string): string {
  return `fleet.err.${FLEET_REFUSALS[code] ?? 'generic'}`;
}

export const FLEET_OK = ['registered', 'parked', 'unparked'] as const;
export function fleetOkKey(code: string): string | null {
  return (FLEET_OK as readonly string[]).includes(code) ? `fleet.ok.${code}` : null;
}
