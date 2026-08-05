// modules/labour/domain/mgnrega.rules.ts · PC-55 A4 — PURE rules. The 100-day guarantee is a legal right;
// these functions exist so the platform states it precisely and never rounds a worker's entitlement away.
export const MGNREGA_GUARANTEE_DAYS = 100;
export const WORK_STATUSES = ['planned', 'active', 'completed', 'suspended'] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

/** Musters may only be recorded against a work that is actually running (or completed, for late data entry). */
export function canMuster(status: WorkStatus): boolean { return status === 'active' || status === 'completed'; }

/** Legal work-status moves. */
const NEXT: Readonly<Record<WorkStatus, readonly WorkStatus[]>> = Object.freeze({
  planned: ['active', 'suspended'],
  active: ['completed', 'suspended'],
  suspended: ['active', 'completed'],
  completed: [],
});
export function canTransitionWork(from: WorkStatus, to: WorkStatus): boolean { return (NEXT[from] ?? []).includes(to); }

/** Attendance must fall inside the work's own window (a muster outside it is a data error, not a fact). */
export function musterDateInWindow(attendedOn: string, startsOn: string | null, endsOn: string | null, todayIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(attendedOn)) return false;
  if (attendedOn > todayIso) return false;                       // attendance cannot be recorded for the future
  if (startsOn && attendedOn < startsOn) return false;
  if (endsOn && attendedOn > endsOn) return false;
  return true;
}

/** Days observed = Σ day_fraction over ATTENDED musters, rounded DOWN to 2dp then floored to whole days for
 *  the guarantee count — a worker's remaining entitlement is never overstated by rounding up. */
export function observedDays(musters: ReadonlyArray<{ attended: boolean; dayFraction: number }>): number {
  const sum = musters.reduce((s, m) => (m.attended ? s + m.dayFraction : s), 0);
  return Math.round(sum * 100) / 100;
}
export function daysRemaining(observed: number, stateMirrored: number | null): number {
  const used = Math.max(observed, stateMirrored ?? 0);           // the HIGHER count protects the worker's cap
  return Math.max(0, MGNREGA_GUARANTEE_DAYS - Math.floor(used));
}

/** The mirror may only ever be RAISED (never lowered, never invented) — only a real state sync may reduce it. */
export function mirrorShouldRise(currentDaysUsedFy: number, observed: number): boolean {
  return Math.floor(observed) > currentDaysUsedFy;
}
