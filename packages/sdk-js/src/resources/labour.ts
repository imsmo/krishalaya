// @krishalaya/sdk-js · labour resource (module 6 — the worker marketplace). Worker self-service: register +
// view/update OWN profile (the server scopes to the caller — userId is never client-supplied); browse OPEN
// bookings (jobs); list + respond to OWN assignments (job offers) within the booking's accept/decline window
// (server-enforced). `age_verified_18` is NOT settable here — it's verified out-of-band (KYC) and the server
// hard-gates accepting work on it. register carries an Idempotency-Key (Law 3). Money is bigint minor strings
// (Law 2). Gated server-side by the `labour` flag.
import { HttpClient } from '../http';
import { WorkerProfile, WorkerCard, LabourBooking, LabourAssignment, LabourAttendance, LabourLookups, Page } from '../types';

export interface WorkerPrefsInput {
  villageRegionId?: string; travelKm?: number; stayAwayOk?: 'same_day' | 'overnight' | 'weekly' | 'monthly';
  minWageExpectationMinor?: string; autoAcceptAboveMinor?: string; hasSmartphone?: boolean;
  emergencyContactName?: string; emergencyContactPhone?: string; eshramNo?: string;
  /** P0-2 consent: opt in to be shown to employers with identity (name/rating/job-count). Default false (DPDP). */
  discoverable?: boolean;
  /** The worker's self-declared skill ids (replaces the whole set on update). Unknown ids are rejected. */
  skillIds?: string[];
}

/** Employer "post a booking" payload (P-14). The server snapshots the statutory min-wage from (regionId,
 * skillLevel, wageKind, startDate) and REJECTS a wageOffered below it (422) — min_wage is never client-supplied.
 * Money is bigint minor strings (Law 2). */
export interface CreateBookingInput {
  demandTypeCode: string; taskSkillId: string; regionId: string;
  skillLevel: 'unskilled' | 'semi_skilled' | 'skilled' | 'highly_skilled';
  workersNeeded: number; startDate: string; endDate: string; dailyHours?: number;
  wageKind?: 'per_day' | 'per_hour' | 'per_task'; wageOfferedMinor: string;
  womenOnly?: boolean; farmLat: number; farmLng: number; respondByHours?: number;
  /** P0-2 booking details (optional): HH:MM work start time-of-day + free-text special instructions (≤300 chars). */
  startTime?: string; notes?: string;
}

export class LabourResource {
  constructor(private readonly http: HttpClient) {}

  // --- worker profile (self) ---
  async registerWorker(input: WorkerPrefsInput, idempotencyKey: string): Promise<WorkerProfile> {
    return (await this.http.request<WorkerProfile>('POST', 'labour/workers', { idempotencyKey, body: input })).data;
  }
  /** The caller's own worker profile, or { worker: null } if not yet registered. */
  async myWorker(signal?: AbortSignal): Promise<{ worker: WorkerProfile | null }> {
    return (await this.http.request<{ worker: WorkerProfile | null }>('GET', 'labour/workers/me', { signal })).data;
  }
  async updateWorker(patch: WorkerPrefsInput): Promise<WorkerProfile> {
    return (await this.http.request<WorkerProfile>('PATCH', 'labour/workers/me', { body: patch })).data;
  }

  // --- jobs (bookings) ---
  /** Browse jobs. `box=open` = the marketplace of open bookings (for workers). Keyset. */
  async listBookings(params: { box?: 'mine' | 'open' | 'all'; status?: string; taskSkillId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<LabourBooking>> {
    const r = await this.http.request<LabourBooking[]>('GET', 'labour/bookings', { query: { box: params.box ?? 'open', status: params.status, taskSkillId: params.taskSkillId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getBooking(id: string, signal?: AbortSignal): Promise<LabourBooking> {
    return (await this.http.request<LabourBooking>('GET', `labour/bookings/${encodeURIComponent(id)}`, { signal })).data;
  }

  // --- assignments (the worker's job offers) ---
  /** `box=mine` = the caller worker's assignments. Keyset. */
  async listAssignments(params: { box?: 'mine' | 'booking'; bookingId?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<LabourAssignment>> {
    const r = await this.http.request<LabourAssignment[]>('GET', 'labour/assignments', { query: { box: params.box ?? 'mine', bookingId: params.bookingId, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getAssignment(id: string, signal?: AbortSignal): Promise<LabourAssignment> {
    return (await this.http.request<LabourAssignment>('GET', `labour/assignments/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Accept or reject an assignment (the caller's own). The server enforces the booking's respond-by window. */
  async respondAssignment(id: string, decision: 'accept' | 'reject', voiceConsentMediaId?: string): Promise<LabourAssignment> {
    return (await this.http.request<LabourAssignment>('POST', `labour/assignments/${encodeURIComponent(id)}/respond`, { body: { decision, voiceConsentMediaId } })).data;
  }
  /** Worker SELF-APPLIES to an open booking — creates an 'applied' assignment (an interest pool that does not
   * consume a slot). The caller's worker profile is resolved server-side from the token. Idempotent (Law 3). */
  async applyToBooking(bookingId: string, idempotencyKey: string): Promise<LabourAssignment> {
    return (await this.http.request<LabourAssignment>('POST', `labour/bookings/${encodeURIComponent(bookingId)}/apply`, { idempotencyKey })).data;
  }
  /** Worker clocks in for today on their OWN accepted assignment. The device sends only its GPS fix; the ≤100m
   * farm geofence is computed + enforced SERVER-side (the client cannot forge proximity). Idempotent (Law 3). */
  async clockIn(assignmentId: string, fix: { lat: number; lng: number }, idempotencyKey: string): Promise<LabourAttendance> {
    return (await this.http.request<LabourAttendance>('POST', `labour/assignments/${encodeURIComponent(assignmentId)}/attendance`, { idempotencyKey, body: fix })).data;
  }
  /** WORKER clocks out of TODAY's open attendance. The SERVER stamps the time + computes hours/overtime; the
   *  client may only declare the unpaid break it took. Idempotent (Law 3). */
  async clockOut(assignmentId: string, breakMinutes: number, idempotencyKey: string): Promise<LabourAttendance> {
    return (await this.http.request<LabourAttendance>('POST', `labour/assignments/${encodeURIComponent(assignmentId)}/attendance/clock-out`, { idempotencyKey, body: { breakMinutes } })).data;
  }
  /** EMPLOYER dual-confirms a worker's clocked-out day (booking owner OR a booking.manage admin). Idempotent. */
  async confirmAttendance(assignmentId: string, workDate: string, idempotencyKey: string): Promise<LabourAttendance> {
    return (await this.http.request<LabourAttendance>('POST', `labour/assignments/${encodeURIComponent(assignmentId)}/attendance/confirm`, { idempotencyKey, body: { workDate } })).data;
  }
  /** The caller's OWN work-history (attendance days, newest first), keyset-paginated. */
  async workHistory(cursor?: string, limit = 20, signal?: AbortSignal): Promise<Page<LabourAttendance>> {
    const r = await this.http.request<LabourAttendance[]>('GET', 'labour/assignments/attendance/history', { query: { cursor, limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  // --- taxonomy ---
  /** The labour catalogue (work-types, skill tree, regions, skill-levels) for rendering pickers with real ids. */
  async lookups(signal?: AbortSignal): Promise<LabourLookups> {
    return (await this.http.request<LabourLookups>('GET', 'labour/lookups', { signal })).data;
  }

  // --- employer / hire side (P-14). All authorized server-side by worker.book; owner-or-admin per booking. ---

  /** Browse the worker pool (employer). Returns consent-gated CARDS: name/rating/job-count appear ONLY for workers
   * who opted in (discoverable=true); everyone else is an anonymous availability card (region/travel). Keyset. */
  async listWorkers(params: { villageRegionId?: string; ageVerified?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<WorkerCard>> {
    const r = await this.http.request<WorkerCard[]>('GET', 'labour/workers', { query: { villageRegionId: params.villageRegionId, ageVerified: params.ageVerified, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getWorker(id: string, signal?: AbortSignal): Promise<WorkerCard> {
    return (await this.http.request<WorkerCard>('GET', `labour/workers/${encodeURIComponent(id)}`, { signal })).data;
  }

  /** Post a booking (the offered wage must clear the server's statutory floor). Idempotent (Law 3). */
  async createBooking(input: CreateBookingInput, idempotencyKey: string): Promise<LabourBooking> {
    return (await this.http.request<LabourBooking>('POST', 'labour/bookings', { idempotencyKey, body: input })).data;
  }
  /** Assign a worker to an OPEN booking (per-worker wage optional, still floor-checked). Idempotent. */
  async assignWorker(bookingId: string, input: { workerId: string; wageMinor?: string }, idempotencyKey: string): Promise<LabourAssignment> {
    return (await this.http.request<LabourAssignment>('POST', `labour/bookings/${encodeURIComponent(bookingId)}/assignments`, { idempotencyKey, body: input })).data;
  }
  async startBooking(bookingId: string): Promise<LabourBooking> {
    return (await this.http.request<LabourBooking>('POST', `labour/bookings/${encodeURIComponent(bookingId)}/start`, {})).data;
  }
  async completeBooking(bookingId: string): Promise<LabourBooking> {
    return (await this.http.request<LabourBooking>('POST', `labour/bookings/${encodeURIComponent(bookingId)}/complete`, {})).data;
  }
  async cancelBooking(bookingId: string, reason?: string): Promise<LabourBooking> {
    return (await this.http.request<LabourBooking>('POST', `labour/bookings/${encodeURIComponent(bookingId)}/cancel`, { body: { reason } })).data;
  }
  /** Settle wages on a COMPLETED booking — server moves money (the app never does, Law 11). Idempotent. */
  async payWages(bookingId: string, idempotencyKey: string): Promise<LabourBooking & { totalPaidMinor?: string; workersPaid?: number }> {
    return (await this.http.request<LabourBooking & { totalPaidMinor?: string; workersPaid?: number }>('POST', `labour/bookings/${encodeURIComponent(bookingId)}/pay`, { idempotencyKey })).data;
  }
  /** Assignments for a booking the caller owns (the employer's view: who accepted/declined). Keyset. */
  async bookingAssignments(bookingId: string, params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<LabourAssignment>> {
    const r = await this.http.request<LabourAssignment[]>('GET', 'labour/assignments', { query: { box: 'booking', bookingId, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}
