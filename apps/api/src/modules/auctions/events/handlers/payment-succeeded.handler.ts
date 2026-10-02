// modules/auctions/events/handlers/payment-succeeded.handler.ts
// Consumes payments.payment_succeeded (delivered by the outbox relay).
//
// PC-56 TENANT-11a (F-2, F-9). What this handler did before: on a payment with referenceType 'auction' it RELEASED the
// winner's EMD (hold → main), reading `bids` on the relay's transaction AS kv_relay — which has no grant on `bids`, so
// the whole event (every handler of it) rolled back and was quarantined (survey F-9). Under the founder's model the
// winner's EMD is no longer released on payment: it was APPLIED to the order at settlement (AuctionService.settleInTx),
// and the winner pays the BALANCE on the order itself (referenceType 'order', amount due = total − applied EMD).
//
// So this handler now does exactly one thing: when an ORDER payment lands for an auction's order, it records the
// settlement `paid` (the default sweep then leaves it alone). It runs through AuctionService — the request-tier kv_app
// unit of work, as TENANT-10a's sale handler does — and never queries on the relay's transaction. A payment that names
// an AUCTION as its reference is no longer a path that settles anything (no money moves; nothing in the platform creates
// one — payment intents for 'auction' are not validated by the payments module either, its own README says so).
import { Injectable, Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { AuctionService } from '../../services/auction.service';

@Injectable()
export class AuctionPaymentSucceededHandler implements OutboxHandler {
  readonly eventType = 'payments.payment_succeeded';
  private readonly log = new Logger(AuctionPaymentSucceededHandler.name);
  constructor(private readonly auctions: AuctionService) {}

  async handle(event: OutboxEvent): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    if (!tenantId || typeof p.referenceId !== 'string') return;
    if (p.referenceType === 'order') { await this.auctions.onOrderPaid(tenantId, p.referenceId); return; }   // no-op unless it is an auction's order
    if (p.referenceType === 'auction') this.log.warn(`payment ${event.aggregateId} names auction ${p.referenceId} directly — not a settlement path since TENANT-11a; nothing moved`);
  }
}
