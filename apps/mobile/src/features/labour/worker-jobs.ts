// apps/mobile/src/features/labour/worker-jobs.ts · PURE worker active-job logic (P-13). No React/native (SDK types
// are `import type` → erased) → unit-tested. Money is bigint minor-unit strings (Law 2): earnings are summed with
// BigInt, never a float. The SERVER is the authority on wage floors, the geofence, and when an assignment becomes
// `paid` — these helpers only bucket/aggregate what the server already returned for display.
import type { LabourAssignment } from '@krishalaya/sdk-js';

/** Where a worker's assignment belongs in "My Jobs". `pending_worker` is an OFFER (lives in the Offers tab, P-12)
 * so it's excluded from the jobs buckets. */
export type JobBucket = 'upcoming' | 'paid' | 'closed' | 'offer';
export function jobBucket(assignmentStatus: string): JobBucket {
  switch (assignmentStatus) {
    case 'accepted': return 'upcoming';     // accepted → working/about to work (booking drives in-progress)
    case 'paid': return 'paid';             // wage settled by employer (completed→paid)
    case 'rejected': case 'expired': return 'closed';
    default: return 'offer';                // pending_worker (or unknown) — handled elsewhere
  }
}

export interface JobBuckets { upcoming: LabourAssignment[]; paid: LabourAssignment[]; closed: LabourAssignment[] }
/** Split the worker's assignments into the My-Jobs sections (offers excluded). Order within a bucket is preserved
 * (the server returns newest-first via keyset). */
export function categorizeAssignments(items: LabourAssignment[]): JobBuckets {
  const out: JobBuckets = { upcoming: [], paid: [], closed: [] };
  for (const a of items ?? []) {
    const b = jobBucket(a.status);
    if (b === 'upcoming') out.upcoming.push(a);
    else if (b === 'paid') out.paid.push(a);
    else if (b === 'closed') out.closed.push(a);
  }
  return out;
}

/** Total earnings = sum of `wageMinor` over PAID assignments, as a bigint-minor string (Law 2). Bad/absent values
 * are skipped, never coerced to a float. */
export function sumEarningsMinor(items: LabourAssignment[]): string {
  let total = 0n;
  for (const a of items ?? []) {
    if (a.status !== 'paid') continue;
    try { total += BigInt(a.wageMinor); } catch { /* skip malformed */ }
  }
  return total.toString();
}

/** Whether the active-job UI should even offer a clock-in control: only once the employer has STARTED the booking
 * (booking `in_progress`). The geofence (core/location) is the second gate; the server is the final authority. */
export function canClockIn(bookingStatus: string | undefined): boolean {
  return bookingStatus === 'in_progress';
}

/** Whether an accepted assignment's wage has been received (drives the "Payment received" affordance). */
export function isWagePaid(assignmentStatus: string): boolean {
  return assignmentStatus === 'paid';
}
