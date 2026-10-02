// apps/web-tenant/src/features/labour/employer.ts · PURE validators + state-machine helpers for the labour
// employer-admin console. No framework, no I/O → unit-tested. The SERVER stays authoritative: it snapshots the
// statutory min-wage and REJECTS an offer below it (422 — never client-supplied), moves wages only through the
// wallet ledger (Law 2/11), and re-enforces RBAC + the booking/assignment state machines. These helpers only
// pre-validate the form and decide which operator actions to OFFER. Money is bigint minor-unit STRINGS (no float).

export const SKILL_LEVELS = ['unskilled', 'semi_skilled', 'skilled', 'highly_skilled'] as const;
export const WAGE_KINDS = ['per_day', 'per_hour', 'per_task'] as const;
// PC-56 TENANT-11b: `accepted` = roster confirmed (the wages escrowed); a job no longer starts straight from `open`.
export const BOOKING_STATUSES = ['open', 'accepted', 'in_progress', 'completed', 'paid', 'cancelled', 'expired'] as const;
export const ASSIGNMENT_STATUSES = ['applied', 'pending_worker', 'accepted', 'rejected', 'expired', 'paid'] as const;

const MINOR = /^\d{1,15}$/;                 // positive integer minor units
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-fA-F-]{36}$/;
const CODE = /^[a-z][a-z0-9_]{0,39}$/;

export interface BookingFormInput {
  demandTypeCode: string; taskSkillId: string; regionId: string; skillLevel: string;
  workersNeeded: number; startDate: string; endDate: string; wageKind: string;
  wageOfferedMinor: string; farmLat: number; farmLng: number; dailyHours?: number; respondByHours?: number;
}

/** Pre-validate the "post a booking" form. Returns a field code on the first problem, else null.
 *  NOTE: the statutory min-wage floor is enforced SERVER-side — we only check the offer is a positive integer. */
export function validateBookingForm(i: BookingFormInput): string | null {
  if (!CODE.test(i.demandTypeCode)) return 'demandType';
  if (!UUID.test(i.taskSkillId)) return 'skill';
  if (!UUID.test(i.regionId)) return 'region';
  if (!SKILL_LEVELS.includes(i.skillLevel as (typeof SKILL_LEVELS)[number])) return 'skillLevel';
  if (!Number.isInteger(i.workersNeeded) || i.workersNeeded < 1 || i.workersNeeded > 500) return 'workers';
  if (!DATE.test(i.startDate) || !DATE.test(i.endDate)) return 'dates';
  if (i.endDate < i.startDate) return 'dateOrder';
  if (!WAGE_KINDS.includes(i.wageKind as (typeof WAGE_KINDS)[number])) return 'wageKind';
  if (!MINOR.test(i.wageOfferedMinor) || i.wageOfferedMinor === '0') return 'wage';
  if (!(i.farmLat >= -90 && i.farmLat <= 90)) return 'lat';
  if (!(i.farmLng >= -180 && i.farmLng <= 180)) return 'lng';
  if (i.dailyHours != null && !(i.dailyHours >= 0 && i.dailyHours <= 24)) return 'hours';
  if (i.respondByHours != null && !(Number.isInteger(i.respondByHours) && i.respondByHours >= 1 && i.respondByHours <= 720)) return 'respondBy';
  return null;
}

/** A wage assigned to a worker (optional override) must be a positive integer minor-unit string if present. */
export function validateAssignWage(wageMinor?: string): string | null {
  if (wageMinor == null || wageMinor === '') return null;     // server falls back to the booking's offer
  if (!MINOR.test(wageMinor) || wageMinor === '0') return 'wage';
  return null;
}

/** Which lifecycle actions the operator may take on a booking next (mirrors labour-booking.state, Law 5). */
export function bookingActions(status: string): Array<'assign' | 'confirmRoster' | 'start' | 'complete' | 'pay' | 'cancel'> {
  switch (status) {
    case 'open': return ['assign', 'confirmRoster', 'cancel'];
    case 'accepted': return ['start', 'cancel'];
    case 'in_progress': return ['complete', 'pay', 'cancel'];
    case 'completed': return ['pay'];
    default: return [];   // paid / cancelled / expired are terminal for the operator
  }
}

/** Whether the employer can dual-confirm an attendance day (only a clocked-out, unconfirmed day). */
export function canConfirmAttendance(a: { status?: string; confirmedByEmployer?: boolean }): boolean {
  return a.status === 'clocked_out' && !a.confirmedByEmployer;
}

/** The PLANNED wages of the accepted assignments — a PREVIEW (the server escrows the real figure at roster confirm and pays
 *  confirmed attendance at the pay run). PC-56 TENANT-11b (survey W164 #11): this used to sum ONE wage unit per worker —
 *  the same under-count the server paid; it now multiplies by the planned units (days for per_day; days × hours for per_hour;
 *  1 for per_task), in hundredths, half-up once. `plannedUnitsHundredths` defaults to one unit. */
export function previewPayrollMinor(assignments: Array<{ status: string; wageMinor: string }>, plannedUnitsHundredths = 100): string {
  let total = 0n;
  const u = BigInt(Math.max(0, Math.round(plannedUnitsHundredths)));
  for (const a of assignments) if (a.status === 'accepted' && MINOR.test(a.wageMinor)) total += (BigInt(a.wageMinor) * u * 2n + 100n) / 200n;
  return total.toString();
}
