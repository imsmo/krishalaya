// modules/group-lots/domain/deadline.ts · PC-56 STORE-3c · B8 (founder D3, survey B25) — THE PLEDGE DEADLINE IS A CLOCK. PURE.
//
// What was true: nothing ever ended a lot at its deadline. A lot stayed `pledging` past `pledge_deadline` until a coordinator cancelled it or
// marked it ready by hand, so W279's "if the lot doesn't fill by then it closes" was false as automatic (survey 1A).
// What is true now: the `group-lots-deadline` clock (jobs/deadline.job.ts, core/jobs/clock-cadence.ts) cancels a lot THIS rule calls due, with
// the reason `target_missed` (the 0188 vocabulary), by the system. No money moves: nothing is paid before a sale (pledges are promises; the
// proceeds exist only once the lot's listing sells — group-lot-money.ts). A lot that reached its target is already `ready` (the entity's
// applyPledge rule), and `ready` / `listed` / `sold` / `settled` lots are never touched.
import { parseQtyMilli } from './settle';

/** The cancel reason the clock records (lookup `group_lot_cancel_reason`, seeded by 0188). */
export const GROUP_LOT_DEADLINE_REASON = 'target_missed';
/** The statuses the clock may cancel — exactly one. */
export const GROUP_LOT_DEADLINE_STATUSES = ['pledging'] as const;

/** Due: still `pledging`, its deadline has PASSED (strictly before `now`), and the pledged quantity is short of the target. */
export function deadlineCancelDue(p: { status: string; pledgeDeadline: string | Date; pledgedQuantity: string; targetQuantity: string }, now: Date): boolean {
  if (!(GROUP_LOT_DEADLINE_STATUSES as readonly string[]).includes(p.status)) return false;
  const d = new Date(p.pledgeDeadline).getTime();
  if (!Number.isFinite(d) || d >= now.getTime()) return false;
  return parseQtyMilli(p.pledgedQuantity) < parseQtyMilli(p.targetQuantity);
}
