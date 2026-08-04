// apps/mobile/src/features/labour/labour-status.ts · PURE labour logic for the worker app (P-12). No React/native
// (SDK/ui types are `import type` → erased) → unit-tested. Money is bigint minor-unit strings (Law 2). The SERVER
// is the authority on the 18+ gate, the accept/decline window, and wage floors — these helpers drive UX only.
import type { PillTone } from '@krishalaya/ui-native';
import type { WorkerProfile, LabourBooking } from '@krishalaya/sdk-js';
import type { WorkerPrefsInput } from '@krishalaya/sdk-js';

/** Booking (job) status → chip tone. */
export function bookingStatusTone(status: string): PillTone {
  switch (status) {
    case 'open': return 'info';
    case 'in_progress': return 'accent';
    case 'completed': case 'paid': return 'success';
    case 'cancelled': case 'expired': return 'danger';
    default: return 'neutral';
  }
}

/** Assignment (offer) status → chip tone. */
export function assignmentStatusTone(status: string): PillTone {
  switch (status) {
    case 'accepted': case 'paid': return 'success';
    case 'pending_worker': return 'warning';
    case 'rejected': case 'expired': return 'danger';
    default: return 'neutral';
  }
}

export type AssignmentAction = 'accept' | 'reject';
/** A worker may accept/reject only while the offer is pending. The server also enforces the booking's respond-by
 * window — an expired accept is rejected server-side. */
export function assignmentActions(status: string): AssignmentAction[] {
  return status === 'pending_worker' ? ['accept', 'reject'] : [];
}

/** The 18+ hard gate (verified out-of-band via Aadhaar KYC). A worker can BROWSE without it, but ACCEPTING work
 * requires it — the server is the authority; this only decides whether to show/enable the accept control. */
export function canAcceptWork(worker: WorkerProfile | null): boolean {
  return !!worker && worker.ageVerified18 === true;
}

/** Whole-rupees → paise minor string for a wage expectation (non-negative integer), or undefined to omit. */
export function rupeesToWageMinor(rupees: string): string | undefined {
  const clean = (rupees ?? '').trim();
  if (!/^\d{1,13}$/.test(clean)) return undefined;
  try { return (BigInt(clean) * 100n).toString(); } catch { return undefined; }
}

/** Build a clean worker-prefs patch from a form: trims, drops empties, converts the wage. Returns null if nothing
 * to send (the server's PATCH requires ≥1 field). */
export function buildWorkerPatch(form: { travelKm?: string; stayAwayOk?: string; minWageRupees?: string; emergencyContactName?: string; emergencyContactPhone?: string }): WorkerPrefsInput | null {
  const out: WorkerPrefsInput = {};
  const km = (form.travelKm ?? '').trim();
  if (/^\d{1,4}$/.test(km)) out.travelKm = Number(km);
  if (form.stayAwayOk === 'same_day' || form.stayAwayOk === 'overnight' || form.stayAwayOk === 'weekly' || form.stayAwayOk === 'monthly') out.stayAwayOk = form.stayAwayOk;
  const wage = rupeesToWageMinor(form.minWageRupees ?? '');
  if (wage) out.minWageExpectationMinor = wage;
  if ((form.emergencyContactName ?? '').trim()) out.emergencyContactName = form.emergencyContactName!.trim();
  if ((form.emergencyContactPhone ?? '').trim()) out.emergencyContactPhone = form.emergencyContactPhone!.trim();
  return Object.keys(out).length > 0 ? out : null;
}

/** Whether a booking is still open to take (UX gate; the server re-checks status + window + capacity). */
export function isJobOpen(booking: Pick<LabourBooking, 'status'>): boolean {
  return booking.status === 'open';
}
