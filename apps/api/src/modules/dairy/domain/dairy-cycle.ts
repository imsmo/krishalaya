// modules/dairy/domain/dairy-cycle.ts · PC-56 TENANT-6c-1 · the CYCLE's own vocabulary and calendar.
//
// W169 is a screen about a noun this platform did not have (see 0157's header). This file holds the two pure things
// a cycle needs before it can be a row: its STATE MACHINE (Law 5) and the answer to "which window just ended".
//
// WHAT IS DELIBERATELY NOT HERE: the close INSTANT and the PAYDAY. Both depend on the tenant — `tenants.timezone` and
// the `dairy.cycle_payday_offset_days` setting — and both are resolved in SQL at insert time, in
// `DairyBillCycleRepository.ensure`. Deriving "23:59 on the 15th" in TypeScript means deriving it in whatever
// timezone the Node process happens to be running in, which is precisely the defect class TENANT-6b-1 spent a whole
// wave sweeping out of this codebase (`core/database/pg-date.ts`). A cooperative's fortnight shuts at 23:59 where the
// cooperative is, and the only component that knows where that is, is the database row.
import { DomainError } from '../../../shared/errors/app-error';
import { PaymentCycle } from './dairy.events';
import { CycleWindow, cycleWindow } from './dairy-counter';

/**
 * The states this wave's code can actually reach, and no more.
 *
 * W169's timeline names four more acts — `previewed`, `approved`, `paid`, and a per-bill `disputed` that "pauses one
 * bill, never the cycle". None of them has an implementation: nothing sets a dispute window, `MilkBill.dispute()` is
 * called by no service, and preview/approve take only `dairy.manage` with no checker and no `settlement.close`. They
 * arrive with the acts that produce them (TENANT-6c-2), and the database's CHECK constraint admits only these two
 * until then — a status vocabulary wider than the code is how a board ends up showing a state nothing can leave.
 */
export const CYCLE_STATUSES = ['open', 'closed'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

const TRANSITIONS: Readonly<Record<CycleStatus, readonly CycleStatus[]>> = Object.freeze({
  open: ['closed'],
  closed: [],
});

export class IllegalCycleTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('DAIRY_CYCLE_ILLEGAL_TRANSITION', `Cannot move dairy bill cycle ${from}→${to}`, 409, { from, to });
  }
}
export function canTransition(from: CycleStatus, to: CycleStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: CycleStatus, to: CycleStatus): void {
  if (!canTransition(from, to)) throw new IllegalCycleTransitionError(from, to);
}

const DAY_MS = 86_400_000;

/** YYYY-MM-DD as a UTC calendar day. Same discipline as `dairy-counter.ts`: a `date` is a calendar day, never a local
 *  instant, and treating it as one is how an "01–15" window slips to "31–14". */
function utcDay(day: string): Date {
  const [y, m, d] = day.split('-').map((n) => Number(n));
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/** The calendar day before `day`, as YYYY-MM-DD. */
export function dayBefore(day: string): string { return iso(new Date(utcDay(day).getTime() - DAY_MS)); }

/**
 * The window that ended most recently before the one containing `day`.
 *
 * This is the cycle the job has work for: the current window is still collecting milk, and billing half a fortnight
 * pays a farmer for half the milk they poured. Derived by stepping one day back off the current window's own start
 * and asking `cycleWindow` again — so month lengths, February and the ISO-week Monday rule stay in exactly ONE place
 * (`dairy-counter.ts`), which is also the function TENANT-6a's counter board and 6b-2's quality desk already use.
 * Two cycle calendars in one codebase would disagree in a leap year and nowhere else.
 */
export function previousCycleWindow(day: string, cycle: PaymentCycle): CycleWindow {
  return cycleWindow(dayBefore(cycleWindow(day, cycle).from), cycle);
}

/**
 * The windows a cadence tick should make sure exist for a tenant on `day`: the one that just ended, and the one
 * running now — oldest first.
 *
 * The CURRENT window is created even though it has no work yet, because W169's first tile is "Current cycle (01–15
 * Jul) · accrued to 13 Jul · 312 bills in draft" — a running cycle is a thing an operator looks at mid-fortnight, and
 * a screen that can only show a cycle after it shuts would have nothing to display for thirteen days out of fourteen.
 */
export function windowsToEnsure(day: string, cycle: PaymentCycle): [CycleWindow, CycleWindow] {
  return [previousCycleWindow(day, cycle), cycleWindow(day, cycle)];
}
