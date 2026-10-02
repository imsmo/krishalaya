// modules/auctions/read-models/my-bids.read-model.ts
// Read-side (replica, CQRS): the caller's OWN bids across ALL auctions, newest-first keyset. Always
// scoped to the caller's userId (no IDOR). Surfaces the EMD hold amount per bid + whether this bid is
// the auction's current winning bid. Money is bigint minor-unit strings (Law 2). No mutations.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { BidRepository } from '../repositories/bid.repository';
import { emdForLot } from '../domain/lot';
import { encodeCursor } from '../domain/cursor';

/** PURE: the EMD held for a bidder in an auction — PC-56 TENANT-11a F-27b: the SAME rule the entity charges (domain/lot.ts
 *  `emdForLot`): the flat `emd_minor` FIRST, else `emd_pct_bps` of the LOT value of the bidder's FIRST bid (quantity × per-unit
 *  price). The old read gave the percentage precedence and applied it to the bid in hand, so "my bids" could show a hold
 *  that was never taken. `quantity` defaults to one unit for callers that predate the lot. Exported for unit tests. */
export function emdHeldMinor(firstAmountMinor: bigint, emdMinor: bigint, emdPctBps: number | null, quantity = '1'): bigint {
  return emdForLot(firstAmountMinor, quantity, emdMinor, emdPctBps);
}

@Injectable()
export class MyBidsReadModel {
  constructor(@Inject(METRICS) private readonly metrics: Metrics, private readonly bids: BidRepository) {}

  async forBidder(tenantId: string, bidderUserId: string, opts: { cursor?: { c: string; id: string }; limit: number }) {
    const rows = await this.bids.listForBidder(tenantId, bidderUserId, opts);
    const items = rows.map((b) => ({
      bidId: b.id,
      auctionId: b.auctionId,
      listingId: b.listingId,
      amountMinor: b.amountMinor,
      emdHeldMinor: emdHeldMinor(BigInt(b.firstAmountMinor), BigInt(b.emdMinor), b.emdPctBps, b.quantity).toString(),
      quantity: b.quantity, unitCode: b.unitCode,
      auctionStatus: b.auctionStatus,
      endsAt: b.endsAt,
      isWinning: b.winningBidId != null && b.winningBidId === b.id,
      createdAt: b.createdAt,
    }));
    const last = rows[rows.length - 1];
    this.metrics.inc('auctions.my_bids', { tenant: tenantId });
    return { items, nextCursor: rows.length === opts.limit && last ? encodeCursor(last.createdAtRaw, last.id) : null };
  }
}
