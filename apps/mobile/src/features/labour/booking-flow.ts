// apps/mobile/src/features/labour/booking-flow.ts · PURE employer (hire) logic for P-14. No React/native (SDK/ui
// types are `import type` → erased) → unit-tested. Money is bigint minor-unit strings (Law 2): the wage is built
// from whole rupees via BigInt, never a float. The SERVER is the authority on the statutory wage floor, the
// accept/decline window, and every lifecycle transition — these helpers only drive the employer UI/validation.
import type { PillTone } from '@krishalaya/ui-native';
import type { LabourBooking, LabourAssignment, CreateBookingInput } from '@krishalaya/sdk-js';

export type EmployerAction = 'assign' | 'start' | 'complete' | 'pay' | 'cancel';
/** Which lifecycle actions the employer (booking owner) may attempt for a booking status. The server re-checks
 * (e.g. start needs ≥1 accepted worker, pay needs completed) and rejects anything illegal. */
export function bookingLifecycleActions(status: string): EmployerAction[] {
  switch (status) {
    case 'open': return ['assign', 'cancel'];
    case 'in_progress': return ['complete', 'cancel'];
    case 'completed': return ['pay'];
    default: return []; // paid / cancelled / expired — terminal
  }
}

/** Booking status → chip tone (mirrors the worker view for consistency). */
export function bookingStatusTone(status: string): PillTone {
  switch (status) {
    case 'open': return 'info';
    case 'in_progress': return 'accent';
    case 'completed': case 'paid': return 'success';
    case 'cancelled': case 'expired': return 'danger';
    default: return 'neutral';
  }
}

export interface AssignmentTally { accepted: number; pending: number; rejected: number; total: number }
/** Count a booking's assignments by outcome — drives the detail's "X accepted / Y pending / Z declined" (48/49). */
export function tallyAssignments(items: LabourAssignment[]): AssignmentTally {
  const t: AssignmentTally = { accepted: 0, pending: 0, rejected: 0, total: 0 };
  for (const a of items ?? []) {
    t.total += 1;
    if (a.status === 'accepted' || a.status === 'paid') t.accepted += 1;
    else if (a.status === 'pending_worker') t.pending += 1;
    else if (a.status === 'rejected' || a.status === 'expired') t.rejected += 1;
  }
  return t;
}

/** Can the employer assign another worker? Only while OPEN and below the headcount (the server re-checks both). */
export function canAssignMore(booking: Pick<LabourBooking, 'status' | 'workersNeeded'>, acceptedOrAssigned: number): boolean {
  return booking.status === 'open' && acceptedOrAssigned < booking.workersNeeded;
}

/** Worker-pool filter form → list query params (drops empties). `ageVerified` true filters to workers eligible to
 * accept work (the 18+ gate); the server still re-checks on assign. */
export function workerFilterParams(form: { villageRegionId?: string; verifiedOnly?: boolean }): { villageRegionId?: string; ageVerified?: boolean } {
  const out: { villageRegionId?: string; ageVerified?: boolean } = {};
  const r = (form.villageRegionId ?? '').trim();
  if (r) out.villageRegionId = r;
  if (form.verifiedOnly) out.ageVerified = true;
  return out;
}

export type BookingDraftField = 'taxonomy' | 'workers' | 'dates' | 'wage' | 'location';
export interface BookingDraftForm {
  demandTypeCode?: string; taskSkillId?: string; regionId?: string; skillLevel?: string;
  workersNeeded?: string; startDate?: string; endDate?: string;
  wageKind?: string; wageRupees?: string; womenOnly?: boolean;
  farmLat?: number | null; farmLng?: number | null; respondByHours?: string;
}
export interface BookingDraftResult { ok: boolean; input?: CreateBookingInput; errors: BookingDraftField[] }

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const SKILL = new Set(['unskilled', 'semi_skilled', 'skilled', 'highly_skilled']);
const WAGE_KIND = new Set(['per_day', 'per_hour', 'per_task']);

/** Validate + assemble a create-booking payload from the multi-step form. Returns the list of invalid field-groups
 * so the UI can point the employer at what's missing. Wage rupees → paise via BigInt (Law 2). NOTE: the taxonomy
 * ids (demand type / skill / region / skill-level) have no lookups read endpoint yet, so until one exists the
 * `taxonomy` group will be flagged here rather than faked — see the README. */
export function buildBookingDraft(form: BookingDraftForm): BookingDraftResult {
  const errors: BookingDraftField[] = [];

  const demandTypeCode = (form.demandTypeCode ?? '').trim();
  const taskSkillId = (form.taskSkillId ?? '').trim();
  const regionId = (form.regionId ?? '').trim();
  const skillLevel = (form.skillLevel ?? '').trim();
  if (!demandTypeCode || !taskSkillId || !regionId || !SKILL.has(skillLevel)) errors.push('taxonomy');

  const workersNeeded = Number((form.workersNeeded ?? '').trim());
  if (!Number.isInteger(workersNeeded) || workersNeeded < 1 || workersNeeded > 500) errors.push('workers');

  const startDate = (form.startDate ?? '').trim();
  const endDate = (form.endDate ?? '').trim();
  if (!DATE.test(startDate) || !DATE.test(endDate) || endDate < startDate) errors.push('dates');

  const wageMinor = rupeesToMinor(form.wageRupees ?? '');
  const wageKind = (form.wageKind ?? 'per_day').trim();
  if (!wageMinor || wageMinor === '0' || !WAGE_KIND.has(wageKind)) errors.push('wage');

  const { farmLat, farmLng } = form;
  if (typeof farmLat !== 'number' || typeof farmLng !== 'number' || !Number.isFinite(farmLat) || !Number.isFinite(farmLng)) errors.push('location');

  if (errors.length > 0) return { ok: false, errors };

  const respondBy = Number((form.respondByHours ?? '').trim());
  const input: CreateBookingInput = {
    demandTypeCode, taskSkillId, regionId, skillLevel: skillLevel as CreateBookingInput['skillLevel'],
    workersNeeded, startDate, endDate, wageKind: wageKind as CreateBookingInput['wageKind'],
    wageOfferedMinor: wageMinor!, womenOnly: !!form.womenOnly, farmLat: farmLat!, farmLng: farmLng!,
    ...(Number.isInteger(respondBy) && respondBy >= 1 && respondBy <= 720 ? { respondByHours: respondBy } : {}),
  };
  return { ok: true, input, errors: [] };
}

/** Whole-rupees → paise minor string (non-negative integer), or undefined to reject. */
export function rupeesToMinor(rupees: string): string | undefined {
  const clean = (rupees ?? '').trim();
  if (!/^\d{1,13}$/.test(clean)) return undefined;
  try { return (BigInt(clean) * 100n).toString(); } catch { return undefined; }
}
