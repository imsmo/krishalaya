// apps/mobile/src/features/labour/hire.api.ts · data layer for the EMPLOYER (farmer) hire vertical (P-14). Keeps
// screens thin (guide §3). Reads degrade-never-die (null/empty). Mutations (create/assign/start/complete/cancel/
// pay) are ONLINE transitions that throw so the screen shows the precise outcome (422 wage-below-floor, 403
// not-owner, 409 illegal-transition) — the server is the authority. create/assign/pay carry an Idempotency-Key
// (Law 3). Money is bigint minor strings (Law 2); the app never moves money — payWages signals the server (Law 11).
import type { WorkerCard, LabourBooking, LabourAssignment, CreateBookingInput, LabourLookups, ReviewSummary } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

/** Labour lookups (work types, skills, regions) to resolve a worker's skill/region ids to localized names on the
 * worker profile (screen 25). Degrades to null so the screen omits those bits rather than showing opaque ids. */
export async function labourLookups(): Promise<LabourLookups | null> {
  try { return await apiClient().labour.lookups(); } catch { return null; }
}

/** A worker's public rating summary (avg + count) keyed to their user id. Degrades to null. */
export async function workerRatingSummary(userId: string): Promise<ReviewSummary | null> {
  try { return await apiClient().reviews.summary({ targetUserId: userId }); } catch { return null; }
}

export interface WorkersPage { items: WorkerCard[]; nextCursor: string | null }
export interface BookingsPage { items: LabourBooking[]; nextCursor: string | null }

/** Browse the worker pool. Returns consent-gated CARDS: name/rating/job-count are present only for workers who
 * opted in (discoverable=true); others are anonymous availability cards. Degrades to an empty page. */
export async function browseWorkers(filter: { villageRegionId?: string; ageVerified?: boolean } = {}, cursor?: string): Promise<WorkersPage> {
  try { return await apiClient().labour.listWorkers({ ...filter, cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getWorker(id: string): Promise<WorkerCard | null> {
  try { return await apiClient().labour.getWorker(id); } catch { return null; }
}

/** The employer's own bookings (box=mine). Degrades to an empty page. */
export async function myBookings(status?: string, cursor?: string): Promise<BookingsPage> {
  try { return await apiClient().labour.listBookings({ box: 'mine', status, cursor }); } catch { return { items: [], nextCursor: null }; }
}
export async function getBooking(id: string): Promise<LabourBooking | null> {
  try { return await apiClient().labour.getBooking(id); } catch { return null; }
}
/** Assignments for a booking the caller owns (who accepted/declined). Degrades to []. */
export async function bookingAssignments(bookingId: string): Promise<LabourAssignment[]> {
  try { return (await apiClient().labour.bookingAssignments(bookingId)).items; } catch { return []; }
}

/** The employer's bookings enriched with each booking's assigned worker (screen 50). Bounded to the loaded page;
 * each assignment lookup degrades to null. No combined read-model yet, so we join client-side (§13). */
export async function myBookingsWithWorkers(): Promise<Array<{ booking: LabourBooking; workerId: string | null }>> {
  const { items } = await myBookings();
  const workers = await Promise.all(items.map((b) => bookingAssignments(b.id).then((a) => a[0]?.workerId ?? null).catch(() => null)));
  return items.map((b, i) => ({ booking: b, workerId: workers[i] }));
}

// --- mutations (throw on a real error) ---
export function createBooking(input: CreateBookingInput): Promise<LabourBooking> {
  return apiClient().labour.createBooking(input, newId());
}
export function assignWorker(bookingId: string, workerId: string, wageMinor?: string): Promise<LabourAssignment> {
  return apiClient().labour.assignWorker(bookingId, { workerId, wageMinor }, newId());
}
export function startBooking(bookingId: string): Promise<LabourBooking> { return apiClient().labour.startBooking(bookingId); }
export function completeBooking(bookingId: string): Promise<LabourBooking> { return apiClient().labour.completeBooking(bookingId); }
export function cancelBooking(bookingId: string, reason?: string): Promise<LabourBooking> { return apiClient().labour.cancelBooking(bookingId, reason); }
export function payWages(bookingId: string): Promise<LabourBooking> { return apiClient().labour.payWages(bookingId, newId()); }
