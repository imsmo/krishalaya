// apps/mobile/src/features/labour/work-history.ts · PURE presentation logic for the worker Work-History screen
// (138). No React / no SDK I/O (SDK types `import type` → erased) → unit-tested. It works off the REAL attendance
// contract (workHistory → LabourAttendance: workDate, hours, status, paid). The design's rich per-job detail —
// task/crop, farmer name, wage ₹, star rating, review quote — is NOT on the attendance contract, so this file
// never assembles it (§13: the screen degrades those to a neutral card, never fabricates "Ramesh Patel"/"₹400"/
// "Excellent worker"). Hours are numbers (not money — wages settle only in the ledger, Law 2).
import type { LabourAttendance } from '@krishalaya/sdk-js';

/** Total worked hours for a day = regular + overtime, or null when the server hasn't stamped hours yet. Pure. */
export function attendanceTotalHours(att: Pick<LabourAttendance, 'hoursRegular' | 'hoursOvertime'>): number | null {
  const reg = att.hoursRegular;
  const ot = att.hoursOvertime ?? 0;
  if (reg == null && !ot) return null;
  return Math.max(0, (reg ?? 0) + ot);
}

export type HistoryStatus = 'paid' | 'confirmed' | 'clocked_out' | 'clocked_in' | 'pending';

/** The lifecycle badge for a work day: paid > employer-confirmed > clocked-out > clocked-in > pending. Pure. */
export function attendanceStatusKey(att: Pick<LabourAttendance, 'status' | 'paid' | 'confirmedByEmployer'>): HistoryStatus {
  if (att.paid) return 'paid';
  if (att.confirmedByEmployer || att.status === 'confirmed') return 'confirmed';
  if (att.status === 'clocked_out') return 'clocked_out';
  if (att.status === 'clocked_in') return 'clocked_in';
  return 'pending';
}

// Only the honestly-computable filters (the design's 5★ / crop chips need rating/crop that attendance doesn't
// carry, so we don't fabricate their counts).
export const HISTORY_FILTERS = ['all', 'this_year'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

function yearOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).getUTCFullYear();
}

/** Does a work day match the active filter? 'all' always; 'this_year' when its workDate is the current year. Pure. */
export function matchesHistoryFilter(att: Pick<LabourAttendance, 'workDate'>, filter: HistoryFilter, nowMs: number = Date.now()): boolean {
  if (filter === 'all') return true;
  const y = yearOf(att.workDate);
  return y != null && y === new Date(nowMs).getUTCFullYear();
}

/** Count of days in the current calendar year (drives the honest "This year · N" chip). Pure. */
export function thisYearCount(items: readonly Pick<LabourAttendance, 'workDate'>[], nowMs: number = Date.now()): number {
  return (items ?? []).filter((a) => matchesHistoryFilter(a, 'this_year', nowMs)).length;
}
