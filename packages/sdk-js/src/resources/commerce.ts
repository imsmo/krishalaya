// @krishalaya/sdk-js · cart + checkout resources (module 3). The cart is owner-scoped server-side; mutations
// return { ok } so the caller re-reads the authoritative cart (prices/availability are recomputed live — the
// client never trusts a stale line total). Checkout converts the cart into orders under ONE Idempotency-Key
// (Law 3) so a retried "place order" can't double-create. Money is bigint minor-unit strings (Law 2); the final
// charges/discount/tax are computed SERVER-SIDE and read back on the order.
import { HttpClient } from '../http';
import { Cart, CheckoutResult, CheckoutPreview, DeliveryMethodsResult } from '../types';

export class CartResource {
  constructor(private readonly http: HttpClient) {}
  async get(signal?: AbortSignal): Promise<Cart> { return (await this.http.request<Cart>('GET', 'cart', { signal })).data; }
  async addItem(listingId: string, quantity: number): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', 'cart/items', { body: { listingId, quantity } })).data;
  }
  async updateItem(listingId: string, quantity: number): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('PATCH', `cart/items/${encodeURIComponent(listingId)}`, { body: { quantity } })).data;
  }
  async removeItem(listingId: string): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('DELETE', `cart/items/${encodeURIComponent(listingId)}`)).data;
  }
  async clear(): Promise<{ ok: boolean }> { return (await this.http.request<{ ok: boolean }>('DELETE', 'cart')).data; }
}

export class CheckoutResource {
  constructor(private readonly http: HttpClient) {}
  /** Read-only totals preview: server-computed subtotal + delivery + platform fee + member benefits +
   *  coupon (DRY-RUN) for the active cart. No order is created and no money moves — show the bill first. */
  async preview(input: { couponCode?: string } = {}): Promise<CheckoutPreview> {
    return (await this.http.request<CheckoutPreview>('POST', 'checkout/preview', { body: input })).data;
  }
  /** Read-only delivery-methods lookup for the active cart + destination (Indian pincode and/or region id).
   *  Returns the serviceable delivery options + their server-computed fee. No order, no money moved; placement
   *  always recomputes server-side. At least one of pincode/regionId must be provided. */
  async deliveryMethods(input: { pincode?: string; regionId?: string }, signal?: AbortSignal): Promise<DeliveryMethodsResult> {
    const qs = new URLSearchParams();
    if (input.pincode) qs.set('pincode', input.pincode);
    if (input.regionId) qs.set('regionId', input.regionId);
    return (await this.http.request<DeliveryMethodsResult>('GET', `checkout/delivery-methods?${qs.toString()}`, { signal })).data;
  }
  /** Convert the active cart into orders. Idempotency-keyed (Law 3). `couponCode` is validated + redeemed
   * SERVER-SIDE against the primary order (the client never computes the discount). */
  async checkout(input: { deliveryAddressId?: string; deliveryMethodId?: string; couponCode?: string }, idempotencyKey: string): Promise<CheckoutResult> {
    return (await this.http.request<CheckoutResult>('POST', 'checkout', { idempotencyKey, body: input })).data;
  }
}
