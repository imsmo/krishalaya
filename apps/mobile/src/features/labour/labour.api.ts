// apps/mobile/src/features/labour/labour.api.ts · data layer for the worker app (P-12). Keeps screens thin
// (guide §3). Reads degrade-never-die (null/empty). Register is idempotent (Law 3). Respond (accept/decline) is an
// online transition that throws so the screen shows the precise outcome (409 window-expired / 403 not-allowed) —
// the server enforces the accept/decline window + the 18+ gate. Money is bigint minor strings (Law 2).
import type { WorkerProfile, LabourBooking, LabourAssignment, WorkerPrefsInput, ReviewSummary, LabourLookups } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export interface JobsPage { items: LabourBooking[]; nextCursor: string | null }
export interface OffersPage { items: LabourAssignment[]; nextCursor: string | null }

/** Labour lookups (skills/regions/work-types) to resolve a booking's task skill id to a localized name on the
 * offer screen. Public read; degrades to null so the screen shows a generic task label rather than an opaque id. */
export async function labourLookups(): Promise<LabourLookups | null> {
  try { return await apiClient().labour.lookups(); } catch { return null; }
}

export async function getMyWorker(): Promise<WorkerProfile | null> {
  try { return (await apiClient().labour.myWorker()).worker; } catch { return null; }
}
export function registerWorker(input: WorkerPrefsInput): Promise<WorkerProfile> {
  return apiClient().labour.registerWorker(input, newId());
}
export function updateWorker(patch: WorkerPrefsInput): Promise<WorkerProfile> {
  return apiClient().labour.updateWorker(patch);
}
/** Browse OPEN jobs (the marketplace). Degrades to an empty page. */
export async function browseJobs(cursor?: string): Promise<JobsPage> {
  try { return await apiClient().labour.listBookings({ box: 'open', cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getJob(id: string): Promise<LabourBooking | null> {
  try { return await apiClient().labour.getBooking(id); } catch { return null; }
}
/** The worker's own assignments (job offers). Degrades to an empty page. */
export async function myOffers(status?: string, cursor?: string): Promise<OffersPage> {
  try { return await apiClient().labour.listAssignments({ box: 'mine', status, cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getOffer(id: string): Promise<LabourAssignment | null> {
  try { return await apiClient().labour.getAssignment(id); } catch { return null; }
}
/** Accept/decline an offer within the server-enforced window. Throws on a real error. */
export function respondOffer(id: string, decision: 'accept' | 'reject'): Promise<LabourAssignment> {
  return apiClient().labour.respondAssignment(id, decision);
}

/** Worker SELF-APPLIES to an open booking (screen 31): creates an 'applied' assignment (an interest pool — NOT a
 * confirmed job; the employer/ambassador still assigns). Idempotent (Law 3). Online transition → throws so the
 * screen can show the precise outcome (409 already-applied / 403 not-eligible). The server enforces the 18+ gate. */
export function applyToJob(bookingId: string): Promise<LabourAssignment> {
  return apiClient().labour.applyToBooking(bookingId, newId());
}

// ---- P-13: active-job / earnings / reviews (reads over the SAME labour + reviews contracts) ----

/** The caller's OWN work-history (attendance days, newest first; screen 138). Keyset-paged; degrades to an empty
 * page. Attendance carries date/hours/status/paid — NOT the task/farmer/wage/rating/review (those aren't on the
 * contract, so the screen degrades them, never fakes them). */
export async function workHistory(cursor?: string): Promise<{ items: import('@krishalaya/sdk-js').LabourAttendance[]; nextCursor: string | null }> {
  try { return await apiClient().labour.workHistory(cursor, 20); } catch { return { items: [], nextCursor: null }; }
}

/** All of the caller's assignments (every status) for the My-Jobs view; categorized client-side. Keyset-paged;
 * degrades to an empty page. */
export async function myJobs(cursor?: string): Promise<OffersPage> {
  try { return await apiClient().labour.listAssignments({ box: 'mine', cursor }); } catch { return { items: [], nextCursor: null }; }
}

/** The current (unconfirmed) attendance row for ONE assignment (screen 33) — found in the caller's own work
 * history. Degrades to null (no open attendance / read failed). The SERVER is the authority on hours + the ≤100m
 * geofence; this is a read for display. */
export async function currentAttendance(assignmentId: string): Promise<import('@krishalaya/sdk-js').LabourAttendance | null> {
  try {
    const { items } = await apiClient().labour.workHistory(undefined, 20);
    return items.find((a) => a.assignmentId === assignmentId && a.status !== 'confirmed') ?? null;
  } catch { return null; }
}

/** Worker clocks IN on their own assignment (screen 33). The device sends only its GPS fix; the ≤100m farm
 * geofence is enforced SERVER-side. Idempotent (Law 3). Online → throws so the screen shows the outcome. */
export function clockInJob(assignmentId: string, fix: { lat: number; lng: number }): Promise<import('@krishalaya/sdk-js').LabourAttendance> {
  return apiClient().labour.clockIn(assignmentId, fix, newId());
}

/** Worker clocks OUT of today's open attendance ("Mark job complete"), declaring the unpaid break taken. The
 * server stamps the time + computes hours; the employer then dual-confirms + pays. Idempotent (Law 3). Throws. */
export function clockOutJob(assignmentId: string, breakMinutes: number): Promise<import('@krishalaya/sdk-js').LabourAttendance> {
  return apiClient().labour.clockOut(assignmentId, breakMinutes, newId());
}

/** The worker's schedule (screen 32): their assignments enriched with each one's booking (task/date/wage context).
 * Bounded to the loaded assignments page (keyset, ≤50) — the distinct bookings are fetched in parallel and each
 * degrades to null on failure (§13 — no combined read-model yet, so we join client-side rather than fake context).
 * Degrade-never-die: an empty list on a hard failure. */
export async function myScheduledJobs(): Promise<import('./worker-schedule').ScheduledJob[]> {
  const { items } = await myJobs();
  const ids = Array.from(new Set(items.map((a) => a.bookingId)));
  const bookings = await Promise.all(ids.map((id) => getJob(id)));
  const byId = new Map(ids.map((id, i) => [id, bookings[i]]));
  return items.map((a) => ({ assignment: a, booking: byId.get(a.bookingId) ?? null }));
}

/** Worker rating summary (real, best-effort): the generic reviews summary keyed to the worker's own user id. The
 * server resolves the aggregate; degrades to null when reviews are off or none exist. */
export async function workerRating(userId: string): Promise<ReviewSummary | null> {
  try { return await apiClient().reviews.summary({ targetUserId: userId }); } catch { return null; }
}

/** The PUBLIC reviews about the worker (screen 40). PII-free (no reviewer id/name) and keyset-paginated; degrades
 * to an empty list when the `reviews` flag is off or none exist. */
export async function workerReviews(userId: string, cursor?: string): Promise<import('@krishalaya/sdk-js').PublicReview[]> {
  try { return (await apiClient().reviews.publicReviews({ targetUserId: userId, cursor })).items; } catch { return []; }
}
