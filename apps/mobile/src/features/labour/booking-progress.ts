// apps/mobile/src/features/labour/booking-progress.ts · PURE presentation logic for the employer's
// "Job In Progress" booking-detail (screen 51). No React / no SDK I/O (SDK types are `import type` → erased) →
// unit-tested. It maps a booking's SERVER status to a 3-stage stepper (Scheduled → In progress → Done) so the
// screen can show honest progress WITHOUT fabricating a percentage or clock time — the employer has no attendance
// read yet (§13: degrade, never fake). Money is never computed here (wages settle server-side, Law 2).
import type { LabourAssignment } from '@krishalaya/sdk-js';

export type ProgressStage = 'scheduled' | 'working' | 'done' | 'cancelled';
export const PROGRESS_STEPS: readonly Exclude<ProgressStage, 'cancelled'>[] = ['scheduled', 'working', 'done'] as const;

/** Map the booking status to a coarse progress stage. This is the ONLY honest progress signal the employer has —
 * a real work-percentage / clock-in time needs the (not-yet-exposed) attendance read, so the screen shows the
 * stepper, never a fabricated "50%". Pure. */
export function bookingProgressStage(status: string): ProgressStage {
  switch (status) {
    case 'in_progress': return 'working';
    case 'completed':
    case 'paid': return 'done';
    case 'cancelled':
    case 'rejected':
    case 'expired': return 'cancelled';
    default: return 'scheduled'; // pending | open | confirmed | accepted
  }
}

/** Index of the current step within PROGRESS_STEPS (0..2), or -1 for a cancelled/terminal-negative booking.
 * Drives which dots in the stepper are filled. Pure. */
export function progressStepIndex(status: string): number {
  const stage = bookingProgressStage(status);
  if (stage === 'cancelled') return -1;
  return PROGRESS_STEPS.indexOf(stage);
}

/** True once the job is actively being worked (employer may see live progress / GPS once that read exists). Pure. */
export function isJobActive(status: string): boolean {
  return bookingProgressStage(status) === 'working';
}

/** The assigned worker's id for this booking, from the FIRST accepted assignment (else the first assignment, else
 * null). The employer view is PII-minimised — there is no worker name/phone — so the screen anonymises this id
 * rather than ever inventing a name (§13). Pure. */
export function assignedWorkerId(assignments: LabourAssignment[]): string | null {
  if (!assignments || assignments.length === 0) return null;
  const accepted = assignments.find((a) => a.status === 'accepted' || a.status === 'confirmed');
  return (accepted ?? assignments[0]).workerId ?? null;
}

/** Two-character anonymous avatar initials derived from a worker id (uppercased hex), or null when there is no
 * worker yet. NEVER a real name (we don't have one). Pure. */
export function workerAvatarInitials(workerId: string | null | undefined): string | null {
  const s = (workerId ?? '').replace(/[^a-zA-Z0-9]/g, '');
  if (!s) return null;
  return s.slice(0, 2).toUpperCase();
}
