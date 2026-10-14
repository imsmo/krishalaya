// modules/orders/domain/orders.events.ts · integration events (via outbox).
import { lineTotalFromMilli, toMilli } from './cart-rules';
export const OrderEventType = {
  Created: 'orders.order_created',
  PaymentRequired: 'orders.payment_required',
  Confirmed: 'orders.order_confirmed',
  Cancelled: 'orders.order_cancelled',
  Packed: 'orders.order_packed',
  Ready: 'orders.order_ready',
  OutForDelivery: 'orders.order_out_for_delivery',
  Delivered: 'orders.order_delivered',
  Completed: 'orders.order_completed',
  Refunded: 'orders.order_refunded',
  PartiallyRefunded: 'orders.order_partially_refunded',
  Disputed: 'orders.order_disputed',
  FromOfferCreated: 'orders.order_from_offer_created',   // an accepted offer became this order (→ offers links back)
  StatusChanged: 'orders.order_status_changed',
  ItemDelivered: 'orders.order_item_delivered',          // a line's delivered quantity was recorded (partial fulfilment)
} as const;
export type OrderEventType = typeof OrderEventType[keyof typeof OrderEventType];
export type DomainEvent = { type: string; payload: Record<string, unknown> };

/** Money math in bigint minor units. qty has ≤3 decimals (numeric(14,3)). Floors to the minor unit.
 *  PC-56 STORE-2b · F-24: the quantity goes through cart-rules `toMilli` (decimal-string math) — never `Math.round(qty * 1000)` on a float. */
export function lineTotalMinor(unitPriceMinor: bigint, qty: number | string): bigint {
  return lineTotalFromMilli(unitPriceMinor, toMilli(qty));
}
