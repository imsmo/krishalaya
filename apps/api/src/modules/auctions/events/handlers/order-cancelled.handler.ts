// modules/auctions/events/handlers/order-cancelled.handler.ts · PC-56 TENANT-11a · F-2 — NEVER LEAVE THE APPLIED EMD STRANDED.
// Consumes orders.order_cancelled. The winner's EMD was applied to the auction's order at settlement and sits in escrow;
// if that order is cancelled before it completes, the EMD must go somewhere:
//   • cancelled by the BUYER (the winner walked away) → FORFEITED to the seller (`emd-forfeit:`), the auction `defaulted`;
//   • cancelled by the SELLER or the SYSTEM for any other reason → RETURNED to the winner (`emd-return:`), who did not default.
// The default sweep cancels the order itself AFTER forfeiting, so by the time this event arrives the settlement already
// has its outcome and this is a no-op. Runs through AuctionService in the request-tier kv_app unit of work (F-9) — never on
// the relay's kv_relay transaction, which has no grant on `auction_settlements`. A non-auction order is a no-op.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { AuctionService } from '../../services/auction.service';

@Injectable()
export class AuctionOrderCancelledHandler implements OutboxHandler {
  readonly eventType = 'orders.order_cancelled';
  constructor(private readonly auctions: AuctionService) {}

  async handle(event: OutboxEvent): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = event.aggregateId;
    if (!tenantId || !orderId) return;
    const role = typeof event.payload.role === 'string' ? (event.payload.role as string) : 'system';
    await this.auctions.onOrderCancelled(tenantId, orderId, role);
  }
}
