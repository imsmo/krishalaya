// apps/mobile/src/features/cart/cart.api.ts · data layer for the buyer cart + checkout (P-09). Keeps screens thin
// (guide §3). The cart is the SERVER's truth (prices/availability recomputed live, Law 2 bigint-minor); reads
// degrade-never-die (empty cart on failure). Mutations return {ok} → the caller re-reads the cart. Checkout is a
// REAL, idempotent (Law 3) cart→orders conversion — NOT offline-queued (it needs live stock/price/coupon
// validation and an immediate result); it throws so the screen shows the precise outcome (409 stale, 422 invalid).
import type { Cart, CheckoutResult, CheckoutPreview, DeliveryMethodsResult } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';
import { track, EVENTS } from '../../core/observability';

const EMPTY: Cart = { items: [], subtotalMinor: '0' };

export async function getCart(): Promise<Cart> {
  try { return await apiClient().cart.get(); } catch { return EMPTY; }
}
export async function addToCart(listingId: string, quantity: number): Promise<boolean> {
  try { return (await apiClient().cart.addItem(listingId, quantity)).ok; } catch { return false; }
}
export async function setCartQuantity(listingId: string, quantity: number): Promise<Cart> {
  try { await apiClient().cart.updateItem(listingId, quantity); } catch { /* degrade — re-read below */ }
  return getCart();
}
export async function removeFromCart(listingId: string): Promise<Cart> {
  try { await apiClient().cart.removeItem(listingId); } catch { /* degrade */ }
  return getCart();
}
export async function clearCart(): Promise<Cart> {
  try { await apiClient().cart.clear(); } catch { /* degrade */ }
  return getCart();
}

/** Server-authoritative bill BEFORE checkout (no order, no money moved): subtotal + delivery + platform fee +
 * discount + grand total, plus per-seller item slices (unit labels). Read-only; degrades to null so the cart
 * screen falls back to the cart subtotal. Money is bigint-minor (Law 2). */
export async function checkoutPreview(couponCode?: string): Promise<CheckoutPreview | null> {
  try { return await apiClient().checkout.preview(couponCode ? { couponCode } : {}); } catch { return null; }
}

/** Available delivery methods + fees for a destination (screen 129 delivery step). The server returns each method
 * with its fee (bigint-minor, Law 2) for the given pincode/region; the buyer's choice binds via placeOrder's
 * deliveryMethodId. Read-only; degrades to null so the screen shows the address step without options rather than
 * crashing. §13: distance/ETA per address are NOT in this contract — the screen never invents them. */
export async function deliveryMethods(pincode?: string, regionId?: string): Promise<DeliveryMethodsResult | null> {
  try { return await apiClient().checkout.deliveryMethods({ pincode, regionId }); } catch { return null; }
}

/** Place the order: convert the cart into orders (idempotent). Throws on a real error so checkout can show it. */
export async function placeOrder(input: { deliveryAddressId?: string; deliveryMethodId?: string; couponCode?: string }): Promise<CheckoutResult> {
  const result = await apiClient().checkout.checkout(input, newId());
  track(EVENTS.checkoutSuccess); // funnel (consent-gated, no PII) — §6
  return result;
}
