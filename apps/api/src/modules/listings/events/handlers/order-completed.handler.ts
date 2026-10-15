// modules/listings/events/handlers/order-completed.handler.ts
// PC-56 STORE-2c · B1 (founder D1) — COMPLETION NO LONGER TOUCHES STOCK. A NO-OP THAT LOGS.
//
// What was true: this class decremented the lot on `orders.order_completed` and claimed "Order layer reserves stock at checkout, so this
// should not happen" — and it was never registered with the outbox relay (no `eventType`; ListingsModule registers only its bulk applier),
// so no sale ever moved stock at all (survey F-2 / C-2, re-verified in STORE-2c).
// What is true now: stock is RESERVED at placement (CheckoutService → ListingService.reserveInTx, under the listing's row lock) and RELEASED
// on cancel (orders/events/handlers/order-cancelled-restock.handler.ts). A decrement here as well would take the same quantity TWICE — an
// oversell in the other direction (the lot sold out with stock in the barn). So completion is a no-op: if anything ever calls this, it logs
// and returns. Kept as a class (exported by ListingsModule) so no import breaks; it is deliberately NOT an OutboxHandler.
import { Injectable, Logger } from '@nestjs/common';

interface OrderCompletedV1 { v: 1; tenantId: string; listingId: string; quantity: number; orderId: string; }

@Injectable()
export class OrderCompletedHandler {
  private readonly log = new Logger(OrderCompletedHandler.name);

  async handle(evt: OrderCompletedV1): Promise<void> {
    this.log.log(`order ${evt?.orderId ?? '?'} completed — stock was reserved at placement; completion does not decrement (STORE-2c D1)`);
  }
}
