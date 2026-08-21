// modules/dairy/domain/bmc-call.ts · PC-56 TENANT-6d-5 · W170's *"Call MCC-AND-03 operator"*, as a decision.
//
// PURE. What this file decides is whether a call may be placed, who it reaches, and what the confirm screen shows —
// W2521's *"Review the object and reason below; confirming writes an audit-trail entry with actor, time and reason."*
//
// THREE RULINGS, AND ALL THREE ARE ABOUT WHAT A CALL IS *NOT*.
//
//   • **IT IS NOT A PHONE NUMBER.** The platform never reveals one and never stores one: `MaskedCallService` hands two
//     user ids to the telephony provider, which owns the directory and bridges the two parties. TENANT-6d-2 masked the
//     operator's number on the centres board because the board had to print something; this act needs it at no point,
//     which is the stronger version of the same care. The confirm screen names a PERSON.
//
//   • **IT IS NOT A BROADCAST.** A call goes to whoever HOLDS CUSTODY of that centre right now — 6d-2's
//     `mcc_operator_assignments`, one open row per centre — and when nobody holds it, the act is REFUSED rather than
//     redirected to a dairy lead. *"Call MCC-AND-03 operator"* names a role; if that role is vacant, the honest answer
//     is that this centre has no operator, which is a different problem and a worse one than a warm tank.
//
//   • **IT IS NOT AN ALERT.** The automatic path (a `device_silent` rule, the notification spine, quiet hours) is the
//     machine paging a human. This is a human dialling a human, recorded with a stated reason. They are kept apart on
//     purpose: the flag that switches this button off must never silence the machine.
import { TelemetryVerdict } from './bmc';

export const BMC_CALL_REFUSALS = [
  'NO_MANAGE', 'UNIT_NOT_FOUND', 'UNIT_RETIRED', 'NOBODY_HOLDS_CENTRE', 'CALLING_YOURSELF',
  'REASON_REQUIRED', 'REASON_TOO_LONG',
] as const;
export type BmcCallRefusal = (typeof BMC_CALL_REFUSALS)[number];

/** The longest reason this platform will carry into an audit row. A paragraph is not a reason; it is a note. */
export const MAX_CALL_REASON = 300;
export const MIN_CALL_REASON = 3;

export interface BmcCallInput {
  canManage: boolean;
  actorUserId: string;
  /** Null when this tenant has no such cooler. */
  unit: { id: string; mccId: string; mccCode: string; mccName: string; isActive: boolean } | null;
  /** The open custody row for that centre, or null when nobody holds it. */
  custody: { operatorUserId: string; operatorName: string | null; assignedAt: string } | null;
  reason: string;
}

export interface BmcCallVerdict {
  /** Whether the call may be placed. Every refusal below is a sentence a screen prints, not a code it swallows. */
  allowed: boolean;
  refusals: BmcCallRefusal[];
  /** Who would be reached. Null whenever the call cannot be placed — a confirm screen must not name a person the act
   *  will not actually call. */
  calleeUserId: string | null;
}

/**
 * May this call be placed, and to whom.
 *
 * ORDERED nobody-can → you-cannot → not-this → not-yet, the order this programme settled on in TENANT-6c-6: a screen
 * that leads with *"pick a reason"* when the caller has no permission at all has wasted somebody's time twice.
 *
 * EVERY refusal is returned, not the first, for the same reason the form chain lists every invalid field: an operator
 * fixing one thing at a time on a warming tank is an operator losing milk to a user interface.
 */
export function callVerdict(i: BmcCallInput): BmcCallVerdict {
  const refusals: BmcCallRefusal[] = [];
  if (!i.canManage) refusals.push('NO_MANAGE');
  if (i.unit === null) refusals.push('UNIT_NOT_FOUND');
  else if (!i.unit.isActive) refusals.push('UNIT_RETIRED');
  if (i.unit !== null && i.custody === null) refusals.push('NOBODY_HOLDS_CENTRE');
  // The dairy lead who holds this centre themselves pressing "call the operator" would ask the provider to bridge one
  // person to their own phone. Refused here rather than discovered as a telco error on the failure screen.
  if (i.custody !== null && i.custody.operatorUserId === i.actorUserId) refusals.push('CALLING_YOURSELF');

  const reason = (i.reason ?? '').trim();
  if (reason.length < MIN_CALL_REASON) refusals.push('REASON_REQUIRED');
  else if (reason.length > MAX_CALL_REASON) refusals.push('REASON_TOO_LONG');

  const allowed = refusals.length === 0;
  return { allowed, refusals, calleeUserId: allowed ? (i.custody as { operatorUserId: string }).operatorUserId : null };
}

/**
 * WHAT THE CONFIRM SCREEN REVIEWS — the object, in W2521's own word.
 *
 * The tank, the centre, the temperature the operator will be asked about, and the person who will be reached. The
 * temperature carries its own currency: `telemetryVerdict`'s state, so a confirm screen never presents a forty-minute
 * old reading as the tank's condition (TENANT-6d-1's ruling, and the reason this call is being placed is often that
 * the number is old).
 */
export interface BmcCallObject {
  unitId: string;
  mccCode: string;
  mccName: string;
  /** One decimal, as a string, or null when nothing has ever been read from this tank. */
  tempC: string | null;
  /** False when the reading is older than the tenant's silence threshold — the screen says so beside the number. */
  tempIsCurrent: boolean;
  gapMinutes: number | null;
  /** The person who will be reached, by NAME. No number, here or anywhere. */
  operatorName: string | null;
  /** True when custody is recorded but the platform cannot verify the holder's name (6d-2's tenancy-checked join
   *  returns nothing for a user who holds no active role here). The call may still be placed: the provider bridges by
   *  id, and a name this platform cannot stand behind is not printed. */
  operatorUnnamed: boolean;
  heldSince: string | null;
}

export function callObject(
  unit: { id: string; mccCode: string; mccName: string },
  reading: { tempC: string | null; telemetry: TelemetryVerdict },
  custody: { operatorUserId: string; operatorName: string | null; assignedAt: string } | null,
): BmcCallObject {
  return {
    unitId: unit.id,
    mccCode: unit.mccCode,
    mccName: unit.mccName,
    tempC: reading.tempC,
    tempIsCurrent: reading.telemetry.state === 'live',
    gapMinutes: reading.telemetry.ageMinutes,
    operatorName: custody?.operatorName ?? null,
    operatorUnnamed: custody !== null && (custody.operatorName === null || custody.operatorName.trim().length === 0),
    heldSince: custody?.assignedAt ?? null,
  };
}

/**
 * *"Retry"* — W170's telemetry-gap state, and W2523's *"Retry — back to confirm"*. TWO DIFFERENT THINGS.
 *
 * TENANT-6a ruled on the first one and this wave reuses that ruling rather than restating it: the gap card's Retry is a
 * PAGE LOAD. There is nothing on this platform to retry — a sensor that has stopped reporting is not waiting for a
 * request from us, `cold_chain_logs` is append-only from the device's side, and a button that appeared to poll a
 * cooler would be a button that lies about what it did. So it is a link to the monitor, and W2521's confirm step does
 * not apply to it: the shared mutate pattern is for *"every destructive or state-changing action"* (Completeness Law
 * B4), and reloading a screen is neither.
 *
 * The second Retry — the one on the FAILURE screen — is the retry OF this act: back to the confirm step with the
 * object and the typed reason intact, which is exactly what TENANT-6d-4 ruled for the form chain's failure state.
 */
export function gapRetryIsAPageLoad(): true { return true; }
