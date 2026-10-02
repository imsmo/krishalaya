// modules/auctions/domain/auction.state.ts · the auction_status state machine (Law 5).
// Mirrors the auction_status enum in db/migrations/0005_commerce.sql (+ `defaulted`, 0186).
//
// PC-56 TENANT-11a — two edges added, each with the act that walks it:
//   • awaiting_approval → ended   — SellerDecisionLapseJob (F-13): the seller did not decide by `decision_due_at`; the
//                                    auction ends with NO sale, every EMD is returned, the listing is re-published.
//   • settled → defaulted         — AuctionDefaultJob / the winner cancelling the order (F-2): the balance was not paid;
//                                    the applied EMD is forfeited to the seller, the order is cancelled, the listing returns.
import { DomainError } from '../../../shared/errors/app-error';

export const AUCTION_STATUSES = ['scheduled', 'live', 'extended', 'ended', 'awaiting_approval', 'settled', 'cancelled', 'failed_reserve', 'defaulted'] as const;
export type AuctionStatus = (typeof AUCTION_STATUSES)[number];

const TRANSITIONS: Readonly<Record<AuctionStatus, readonly AuctionStatus[]>> = Object.freeze({
  scheduled:         ['live', 'cancelled'],
  live:              ['extended', 'ended', 'cancelled'],
  extended:          ['extended', 'ended', 'cancelled'],   // anti-snipe re-extends
  ended:             ['settled', 'awaiting_approval', 'failed_reserve'],
  awaiting_approval: ['settled', 'cancelled', 'ended'],    // seller approves · declines · the decision clock lapses
  settled:           ['defaulted'],                        // the winner did not pay the balance
  cancelled:         [],
  failed_reserve:    [],
  defaulted:         [],
});

export class IllegalAuctionTransitionError extends DomainError {
  constructor(from: string, to: string) { super('AUCTION_ILLEGAL_TRANSITION', `Cannot move auction ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: AuctionStatus, to: AuctionStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: AuctionStatus, to: AuctionStatus): void { if (!canTransition(from, to)) throw new IllegalAuctionTransitionError(from, to); }
/** Bids are only accepted while live or (auto-)extended — and, since TENANT-11a, only before `ends_at` (the entity). */
export function isBiddable(s: AuctionStatus): boolean { return s === 'live' || s === 'extended'; }
export function isTerminal(s: AuctionStatus): boolean { return s === 'settled' || s === 'cancelled' || s === 'failed_reserve' || s === 'defaulted'; }

/** The console's grouped tabs (W137). One status belongs to exactly one group. A lapsed auction is `ended`. */
export const AUCTION_GROUPS = ['live', 'scheduled', 'awaiting_approval', 'ended', 'cancelled'] as const;
export type AuctionGroup = (typeof AUCTION_GROUPS)[number];
export const GROUP_STATUSES: Readonly<Record<AuctionGroup, readonly AuctionStatus[]>> = Object.freeze({
  live: ['live', 'extended'],
  scheduled: ['scheduled'],
  awaiting_approval: ['awaiting_approval'],
  ended: ['ended', 'settled', 'defaulted'],
  cancelled: ['cancelled', 'failed_reserve'],
});
export function groupOf(s: AuctionStatus): AuctionGroup {
  for (const g of AUCTION_GROUPS) if (GROUP_STATUSES[g].includes(s)) return g;
  return 'ended';
}
