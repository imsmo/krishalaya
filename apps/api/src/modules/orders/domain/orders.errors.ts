// modules/orders/domain/orders.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';
export class CartNotFoundError extends DomainError { constructor() { super('CART_NOT_FOUND', 'Active cart not found', 404); } }
export class CartEmptyError extends DomainError { constructor() { super('CART_EMPTY', 'Cart is empty', 422); } }
export class OrderNotFoundError extends DomainError { constructor(id: string) { super('ORDER_NOT_FOUND', `Order ${id} not found`, 404); } }
export class OrderConcurrencyError extends DomainError { constructor(id: string) { super('ORDER_CONCURRENCY_CONFLICT', `Order ${id} was modified concurrently; retry`, 409); } }
/** PC-56 STORE-2b · B1 (survey F-18 cart half): the REASON travels — sold_out · paused · expired · withdrawn · suspended · not_found (cart-rules.ts
 *  LINE_REASONS) — so the buyer is told why, never a bare "unavailable". The reason is optional only for the callers that predate it. */
export class ListingNotPurchasableError extends DomainError { constructor(id: string, reason?: string) { super('LISTING_NOT_PURCHASABLE', `Listing ${id} is not available for purchase${reason ? ` (${reason})` : ''}`, 409, { listingId: id, ...(reason ? { reason } : {}) }); } }
export class InsufficientListingStockError extends DomainError { constructor(id: string, requested: number | string, available: number | string) { super('LISTING_INSUFFICIENT_STOCK', `Listing ${id}: requested ${requested} exceeds available ${available}`, 409, { listingId: id, requested, available }); } }
export class OrderForbiddenError extends DomainError { constructor(msg = 'Not allowed on this order') { super('ORDER_FORBIDDEN', msg, 403); } }
export class InvalidQuantityError extends DomainError { constructor() { super('ORDER_INVALID_QUANTITY', 'Quantity must be positive', 422); } }
export class OrderNotAwaitingPaymentError extends DomainError { constructor(id: string, status: string) { super('ORDER_NOT_AWAITING_PAYMENT', `Order ${id} is '${status}', not awaiting payment`, 409, { orderId: id, status }); } }
/** PC-56 HOTFIX-4: a SELLER may not confirm an order that is still awaiting the buyer's online payment — only the payment's capture
 *  (Order.markPaid) moves `payment_pending → confirmed`. Before this a seller confirm took the same edge, and an unpaid order read as paid. */
export class OrderAwaitingPaymentError extends DomainError { constructor(id: string) { super('ORDER_AWAITING_PAYMENT', `Order ${id} is awaiting the buyer's online payment; it confirms when the payment is captured`, 409, { orderId: id }); } }

// ── PC-56 TENANT-SW-a · B1 (F-5) — placement charges the CHOSEN zone, and an address no zone serves is refused kindly ──
/** The buyer's delivery pincode is served by no active zone of this organisation. The storefront prints its own kind sentence for this
 *  code in the buyer's language ("we don't deliver here yet") — the API message is the English fallback of the same words. */
export class UnserviceablePincodeError extends DomainError {
  constructor(pincode: string | null) { super('UNSERVICEABLE_PINCODE', "We don't deliver here yet", 422, { pincode }); }
}
/** Zones apply to this organisation, so placement needs the address to deliver to. */
export class DeliveryAddressRequiredError extends DomainError {
  constructor() { super('DELIVERY_ADDRESS_REQUIRED', 'Choose the address to deliver to', 422); }
}
/** More than one zone serves the address and the buyer chose none — the fee would be a guess. */
export class DeliveryMethodRequiredError extends DomainError {
  constructor(options: number) { super('DELIVERY_METHOD_REQUIRED', 'Choose a delivery option for this address', 422, { options }); }
}
/** The chosen zone is not active or does not serve this address. */
export class DeliveryMethodNotServingError extends DomainError {
  constructor(zoneId: string) { super('DELIVERY_METHOD_NOT_SERVING', 'That delivery option does not serve this address — choose another', 422, { zoneId }); }
}

// ── PC-56 STORE-2b — WHAT'S IN THE CART IS REAL (founder D1–D4). Each refusal names what the buyer needs to act on it. ──
/** D4: the quantity is below the listing's minimum order — the minimum and its unit named (decimal strings, numeric(14,3)). */
export class BelowMinOrderError extends DomainError {
  constructor(listingId: string, minOrderQty: string, unitCode: string, requested: string) {
    super('BELOW_MIN_ORDER', `Listing ${listingId}: the minimum order is ${minOrderQty} ${unitCode}`, 422, { listingId, minOrderQty, unitCode, requested });
  }
}
/** D4 (survey B11 / F-13): the listing's price changed after the buyer added it (or after they last accepted). BOTH numbers, minor units +
 *  the currency — placement never charges a price the buyer has not seen; the buyer accepts the new price explicitly or removes the line. */
export class PriceChangedError extends DomainError {
  constructor(listingId: string, addedPriceMinor: string, currentPriceMinor: string, currencyCode: string | null) {
    super('PRICE_CHANGED', `Listing ${listingId}: the price changed since it was added — accept the new price or remove it`, 409,
      { listingId, addedPriceMinor, currentPriceMinor, currencyCode });
  }
}
/** D1: a NATIONAL `license_required` rule binds this product — it cannot be added to a cart (no buyer licence flow exists). */
export class LicenceRequiredError extends DomainError {
  constructor(listingId: string) { super('LICENCE_REQUIRED', `Listing ${listingId}: a licence is required to buy this product; a buyer licence flow does not exist yet`, 422, { listingId }); }
}
/** D1: a `banned_state` rule binds this product in the region the delivery address lies in — the region named. */
export class BannedInRegionError extends DomainError {
  constructor(listingId: string, region: string) { super('BANNED_IN_REGION', `Listing ${listingId} cannot be delivered to ${region}: its sale is banned there`, 422, { listingId, region }); }
}
/** D3: the listing belongs to ANOTHER organisation's store than the one this session is signed in to (one store per session). */
export class WrongStoreError extends DomainError {
  constructor(listingId: string, listingTenantSlug: string | null, listingTenantName: string | null) {
    super('WRONG_STORE', `Listing ${listingId} is sold by another organisation's store — sign in to that store to buy it`, 409, { listingId, listingTenantSlug, listingTenantName });
  }
}

// ── PC-56 STORE-2c — THE MONEY WAVE (founder D1–D8). ──
/** B4 (survey F-10 / B25, Rule Zero): one order — and one checkout — is in ONE currency, the LISTINGS' own (`listings.currency_code`). A cart
 *  whose lines are priced in different currencies cannot be placed or previewed as one bill: refused by name with the currencies found. */
export class MixedCurrencyError extends DomainError {
  constructor(currencies: string[]) { super('MIXED_CURRENCY', `The cart holds lots priced in different currencies (${currencies.join(', ')}) — check them out separately`, 422, { currencies }); }
}
/** PC-56 HOTFIX-5 · B4 (Rule Zero, survey F-8): an order is written in its LISTING's currency — a listing (or a caller) that carries none is
 *  refused by name, never priced in an assumed 'INR' (the offer / auction / quote doors defaulted to it). */
export class OrderCurrencyUnknownError extends DomainError {
  constructor(source: string, ref: string) { super('ORDER_CURRENCY_UNKNOWN', `The ${source} order for ${ref} has no currency from its listing — refused rather than priced in an assumed currency`, 422, { source, ref }); }
}

// ── PC-56 STORE-3a — YOUR ORDERS TELL THE TRUTH (founder D1 / D5 / D6). Each refusal names what the buyer needs to act on it. ──
/** D1 / D5: a BUYER's cancel carries a reason from the `cancel_reason` vocabulary (0210) — none was sent. */
export class CancelReasonRequiredError extends DomainError {
  constructor() { super('CANCEL_REASON_REQUIRED', 'Choose why you are cancelling this order', 422); }
}
/** D5: the reason is not an ACTIVE `cancel_reason` value visible to this organisation (a platform value, or the organisation's own). */
export class CancelReasonUnknownError extends DomainError {
  constructor(reasonId: string) { super('CANCEL_REASON_UNKNOWN', 'That cancel reason is not one this store offers', 422, { reasonId }); }
}
/** D5: the chosen reason's meta says textRequired (`other`) and no note came with it. */
export class CancelNoteRequiredError extends DomainError {
  constructor(reasonCode: string) { super('CANCEL_NOTE_REQUIRED', 'Say in a few words why you are cancelling', 422, { reasonCode }); }
}
/** D6 (Law 9 — HOTFIX-5 Q1 is still open): the BUYER's "I received it" completes — and so releases escrow to the organisation — ONLY an order
 *  whose money reached escrow by an online capture (placed `payment_pending`; `QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT`, the clock's one
 *  switch). A pay-on-delivery order is refused BY NAME and nothing moves: its settlement would credit the seller from an escrow that never
 *  held the money (HOTFIX-5's live probe). The organisation (or a moderator) completes such an order. */
export class OrderCompleteRequiresEscrowError extends DomainError {
  constructor(id: string) { super('ORDER_COMPLETE_REQUIRES_ESCROW', `Order ${id} was not paid into escrow; the organisation completes it`, 409, { orderId: id }); }
}
