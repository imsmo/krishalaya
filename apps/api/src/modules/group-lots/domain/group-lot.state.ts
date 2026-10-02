// modules/group-lots/domain/group-lot.state.ts · STATE MACHINE for group_lots.status (Law 5).
//   pledging → ready → listed → sold → settled   (+ cancelled from any non-terminal pre-sale state)
// A coordinator opens a lot for pledges; it moves to ready at the target (automatically) or by hand at any % with a reason;
// `POST /:id/list` creates its ONE listing (listed); the sale order's completion, delivered through the outbox, records the
// sale and holds the seller net (sold); the second person's confirm pays every pledger (settled). The DB trigger
// trg_gl_moves (0188) refuses any other edge. settled + cancelled are terminal. (PC-56 TENANT-11c: every edge has a writer.)
import { DomainError } from '../../../shared/errors/app-error';

export const GROUP_LOT_STATUSES = ['pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled'] as const;
export type GroupLotStatus = (typeof GROUP_LOT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<GroupLotStatus, readonly GroupLotStatus[]>> = Object.freeze({
  pledging: ['ready', 'cancelled'],
  ready:    ['listed', 'pledging', 'cancelled'],   // can reopen pledging if short, or cancel
  listed:   ['sold', 'cancelled'],
  sold:     ['settled'],
  settled:  [],
  cancelled: [],
});

export class IllegalGroupLotTransitionError extends DomainError {
  constructor(from: string, to: string) { super('GROUP_LOT_ILLEGAL_TRANSITION', `Cannot move group lot ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: GroupLotStatus, to: GroupLotStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: GroupLotStatus, to: GroupLotStatus): void { if (!canTransition(from, to)) throw new IllegalGroupLotTransitionError(from, to); }
export function isTerminal(s: GroupLotStatus): boolean { return s === 'settled' || s === 'cancelled'; }
