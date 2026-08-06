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

// ===== PC-55 B2 · the WORK-DEMAND clock (MGNREGA §3 + Schedule II) =====
// A registered household that demands work is entitled to employment within FIFTEEN DAYS of the demand, and if the
// state fails to provide it an unemployment allowance becomes payable. That clock is a legal fact, so it is computed
// here — purely, from dates — and never stored as an opinion. Everything below counts CALENDAR days: the statute
// does not pause for weekends, and quietly excluding them would hand a household a later deadline than the law gives.
export const DEMAND_ALLOTMENT_DAYS = 15;
export const DEMAND_STATUSES = ['demanded', 'allotted', 'withdrawn', 'closed'] as const;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

/** The date by which work must be provided. Inclusive-of-day arithmetic on the ISO date only (no local timezone:
 *  a district's deadline must not move because a server sits in another zone). */
export function allotmentDueBy(demandedOn: string): string {
  const t = Date.parse(`${demandedOn}T00:00:00Z`);
  if (!Number.isFinite(t)) return demandedOn;
  return new Date(t + DEMAND_ALLOTMENT_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Days left before the statutory deadline (negative once it has passed). */
export function daysUntilDue(demandedOn: string, todayIso: string): number {
  const due = Date.parse(`${allotmentDueBy(demandedOn)}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(today)) return 0;
  return Math.round((due - today) / 86_400_000);
}

/** An unmet demand past its deadline. `todayIso > dueBy` — the household still has the WHOLE due day, so a demand
 *  is not overdue ON the fifteenth day. Being one day harsh here would overstate the state's default; being one day
 *  lenient would understate a household's entitlement. */
export function allotmentOverdue(demandedOn: string, status: DemandStatus, todayIso: string): boolean {
  return status === 'demanded' && todayIso > allotmentDueBy(demandedOn);
}

/** Whether an unemployment allowance has become payable. Identical arithmetic to `allotmentOverdue`, named for what
 *  it MEANS, because a surface must be able to say the consequence without re-deriving it. THE STATE PAYS IT — this
 *  platform records the demand, never the payment. */
export function unemploymentAllowanceDue(demandedOn: string, status: DemandStatus, todayIso: string): boolean {
  return allotmentOverdue(demandedOn, status, todayIso);
}

/** Only an open demand can be allotted, withdrawn (by the household) or closed (by the office, with a reason). */
export function canAllotDemand(status: DemandStatus): boolean { return status === 'demanded'; }
export function canWithdrawDemand(status: DemandStatus): boolean { return status === 'demanded'; }
export function canCloseDemand(status: DemandStatus): boolean { return status === 'demanded'; }

/** A demand cannot be dated in the future (the clock cannot start before the household asked) and cannot be
 *  back-dated beyond one financial year of history, which is the window the register is kept for. */
export function demandDateAcceptable(demandedOn: string, todayIso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(demandedOn)) return false;
  if (demandedOn > todayIso) return false;
  return daysUntilDue(demandedOn, todayIso) > -400;
}

/** Days requested must fit inside the guarantee itself. */
export function daysRequestedAcceptable(days: number): boolean {
  return Number.isInteger(days) && days >= 1 && days <= MGNREGA_GUARANTEE_DAYS;
}
