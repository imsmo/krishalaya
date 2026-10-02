// modules/auctions/domain/auctions.events.ts · integration events (via outbox, Law 4).
export const AuctionEventType = {
  Created: 'auctions.auction_created',
  Opened: 'auctions.auction_opened',
  BidPlaced: 'auctions.bid_placed',
  Extended: 'auctions.auction_extended',
  Ended: 'auctions.auction_ended',
  Won: 'auctions.auction_won',          // winner determined → orders may create the order (downstream)
  FailedReserve: 'auctions.auction_failed_reserve',
  Cancelled: 'auctions.auction_cancelled',
  Outbid: 'auctions.bidder_outbid',     // a higher bid arrived → notify the previous high bidder
  WatchStarted: 'auctions.watch_started',
  WatchersEnded: 'auctions.watchers_auction_ended', // an auction closed → notify everyone who WATCHED it (fanout)
  Updated: 'auctions.auction_updated',  // seller edited a scheduled auction's terms
  EmdReleased: 'auctions.emd_released', // a (losing) bidder's EMD hold was returned
  // ---- PC-56 TENANT-11a ----
  Lapsed: 'auctions.auction_lapsed',          // the seller did not decide by decision_due_at → ended, no sale (F-13)
  Defaulted: 'auctions.auction_defaulted',    // the winner did not pay the balance → EMD forfeited to the seller (F-2)
  EntryPaused: 'auctions.entry_paused',       // tenant_admin stopped NEW bidders (A11)
  EntryResumed: 'auctions.entry_resumed',
  EmdApplied: 'auctions.emd_applied',         // the winner's EMD was applied to the order at settlement (F-2)
  EmdReturned: 'auctions.emd_returned',       // the applied EMD went back to the winner (seller / system cancelled the order)
} as const;
export type AuctionEventType = typeof AuctionEventType[keyof typeof AuctionEventType];
export type DomainEvent = { type: string; payload: Record<string, unknown> };
