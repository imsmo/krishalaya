// modules/auctions/read-models/my-bids.read-model.ts
// Read-side (replica, CQRS): the caller's OWN bids across ALL auctions, newest-first keyset. Always
// scoped to the caller's userId (no IDOR). Surfaces the EMD hold amount per bid + whether this bid is
// the auction's current winning bid. Money is bigint minor-unit strings (Law 2). No mutations.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { BidRepository } from '../repositories/bid.repository';
import { applyBpsFloor } from '../../../core/money/rounding';

/** PURE: the EMD held for a bid — a % of the bid amount (basis points) when configured, else the auction's
 *  fixed emd_minor. Integer math only (Law 2): bps path truncates via the platform's canonical `applyBpsFloor`
 *  (DEV-26/Q15), never floats. Exported for unit tests. */
export function emdHeldMinor(amountMinor: bigint, emdMinor: bigint, emdPctBps: number | null): bigint {
  if (emdPctBps != null && emdPctBps > 0) return applyBpsFloor(amountMinor, emdPctBps);
  return emdMinor;
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
      emdHeldMinor: emdHeldMinor(BigInt(b.amountMinor), BigInt(b.emdMinor), b.emdPctBps).toString(),
      auctionStatus: b.auctionStatus,
      endsAt: b.endsAt,
      isWinning: b.winningBidId != null && b.winningBidId === b.id,
      createdAt: b.createdAt,
    }));
    const last = rows[rows.length - 1];
    this.metrics.inc('auctions.my_bids', { tenant: tenantId });
    return { items, nextCursor: rows.length === opts.limit && last ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64') : null };
  }
}
