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
 * The states this programme's code can actually reach, and no more.
 *
 * TENANT-6c-1 shipped `open|closed`. TENANT-6c-2 added `previewed` — W169's header button, which is also the act that
 * starts every member's dispute window. TENANT-6c-3 adds `approved`: the SECOND SIGNATURE.
 *
 * `paid` is still ABSENT, deliberately. Paying needs a batch that does not exist — `milk_bills.payout_id` has never
 * been written, so W169's *"one bank trip"* has nothing behind it — and a bill still cannot be paid at all while it
 * carries a deduction (0157's `DEDUCTION_HAS_NO_DESTINATION`). A cycle-level `paid` today would be a state nothing
 * could move a cycle into. The database's CHECK tracks this list exactly: a status vocabulary wider than the code is
 * how a board ends up showing a state an operator cannot act on.
 */
export const CYCLE_STATUSES = ['open', 'closed', 'previewed', 'approved'] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

const TRANSITIONS: Readonly<Record<CycleStatus, readonly CycleStatus[]>> = Object.freeze({
  open: ['closed'],
  closed: ['previewed'],
  // A cycle sits in `previewed` while its members read their bills — W169's Thursday morning — and moves on when a
  // SECOND human signs for it on Thursday evening.
  previewed: ['approved'],
  // Terminal for now, and terminal honestly: `paid` needs a payout batch this platform does not have.
  approved: [],
});

/**
 * [PC-56 TENANT-6c-3] Why an approval is refused, as a code an operator can be shown.
 *
 * Kept as a discriminated result rather than thrown from three places, mirroring `payments/domain/settlement-cycle.ts`'s
 * `approveRefusal` — the closest precedent on this platform, and the one whose ruling this borrows: no threshold, every
 * cycle gets two humans.
 */
export type CycleApprovalRefusal =
  | 'DAIRY_CYCLE_NOT_PREVIEWED'
  | 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER';

export function cycleApprovalRefusal(c: { status: CycleStatus; previewedBy: string | null }, actorUserId: string): CycleApprovalRefusal | null {
  if (c.status !== 'previewed') return 'DAIRY_CYCLE_NOT_PREVIEWED';
  // Unconditional, and NOT threshold-based. 0144: "a cycle close is not an amount — it is a decision that turns a
  // fortnight of trade into documents a member will hold and a bank manager will read. Every one of them gets two
  // humans." A milk cycle is 312 families' fortnight.
  if (c.previewedBy !== null && c.previewedBy === actorUserId) return 'DAIRY_CYCLE_CHECKER_IS_PREVIEWER';
  return null;
}

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
