// modules/orders/domain/orders.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';
export class CartNotFoundError extends DomainError { constructor() { super('CART_NOT_FOUND', 'Active cart not found', 404); } }
export class CartEmptyError extends DomainError { constructor() { super('CART_EMPTY', 'Cart is empty', 422); } }
export class OrderNotFoundError extends DomainError { constructor(id: string) { super('ORDER_NOT_FOUND', `Order ${id} not found`, 404); } }
export class OrderConcurrencyError extends DomainError { constructor(id: string) { super('ORDER_CONCURRENCY_CONFLICT', `Order ${id} was modified concurrently; retry`, 409); } }
export class ListingNotPurchasableError extends DomainError { constructor(id: string) { super('LISTING_NOT_PURCHASABLE', `Listing ${id} is not available for purchase`, 409, { listingId: id }); } }
export class InsufficientListingStockError extends DomainError { constructor(id: string, requested: number, available: number) { super('LISTING_INSUFFICIENT_STOCK', `Listing ${id}: requested ${requested} exceeds available ${available}`, 409, { listingId: id, requested, available }); } }
export class OrderForbiddenError extends DomainError { constructor(msg = 'Not allowed on this order') { super('ORDER_FORBIDDEN', msg, 403); } }
export class InvalidQuantityError extends DomainError { constructor() { super('ORDER_INVALID_QUANTITY', 'Quantity must be positive', 422); } }
export class OrderNotAwaitingPaymentError extends DomainError { constructor(id: string, status: string) { super('ORDER_NOT_AWAITING_PAYMENT', `Order ${id} is '${status}', not awaiting payment`, 409, { orderId: id, status }); } }

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
