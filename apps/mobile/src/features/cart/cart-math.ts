// apps/mobile/src/features/cart/cart-math.ts · PURE cart helpers (no React/native; SDK types are `import type` →
// erased) → unit-tested. The cart's authoritative subtotal + line totals come from the SERVER (prices recomputed
// live); these helpers only derive UI state (item count, checkout blockers). Money is bigint minor-unit strings
// (Law 2) — never summed as a float here (the server owns the subtotal).
import type { CartItem, Cart, Address, CheckoutPreview } from '@krishalaya/sdk-js';

/** Total distinct line items (for the cart-tab badge). */
export function cartCount(cart: Cart | null): number {
  return cart?.items.length ?? 0;
}

export type CartBlocker = { listingId: string; reason: 'unavailable' | 'insufficient' | 'price_changed' };

/** Per-item issues that must be surfaced before checkout: an item gone unpurchasable, a quantity above what's
 * available, or a price that moved since it was added (the buyer must re-confirm). Derived from server fields. */
export function cartBlockers(cart: Cart | null): CartBlocker[] {
  const out: CartBlocker[] = [];
  for (const it of cart?.items ?? []) {
    if (!it.purchasable) out.push({ listingId: it.listingId, reason: 'unavailable' });
    else if (it.quantity > it.available) out.push({ listingId: it.listingId, reason: 'insufficient' });
    else if (it.priceChanged) out.push({ listingId: it.listingId, reason: 'price_changed' });
  }
  return out;
}

/** Checkout is allowed only when the cart is non-empty and every item is purchasable + within stock. A
 * price_changed item does NOT hard-block (the buyer sees the new price), but unavailable/insufficient do. The
 * SERVER re-validates at checkout regardless — this is UX gating only. */
export function canCheckout(cart: Cart | null): boolean {
  if (!cart || cart.items.length === 0) return false;
  return cart.items.every((it) => it.purchasable && it.quantity <= it.available);
}

/** Step a cart quantity by ±1 within [1, available]; pure so the screen's +/- buttons are predictable. */
export function clampQuantity(current: number, delta: number, available: number): number {
  const next = current + delta;
  if (next < 1) return 1;
  if (available > 0 && next > available) return available;
  return next;
}

/** Line total for a buy-now/add-to-cart preview = unit price (minor) × quantity, computed as BIGINT (Law 2 — never
 * a float). `priceMinor` is the per-unit price in paise; `qty` a positive integer. Returns a minor-unit string. The
 * SERVER recomputes the authoritative total at checkout — this is the on-screen preview only. */
export function lineTotalMinor(priceMinor: string, qty: number): string {
  const n = Math.max(0, Math.trunc(qty));
  let unit: bigint;
  try { unit = BigInt(priceMinor); } catch { return '0'; }
  return (unit * BigInt(n)).toString();
}

/** Stock read-out for a listing detail (screen 14): in-stock vs out-of-stock from the available quantity. Pure. */
export function stockState(quantityAvailable: number): 'in_stock' | 'out_of_stock' {
  return quantityAvailable > 0 ? 'in_stock' : 'out_of_stock';
}

/** One-line, PII-light address label for pickers/summaries. Never dumps the contact phone unless present + asked. */
export function formatAddress(a: Address): string {
  const parts = [a.line1, a.line2, a.village, a.pincode].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.join(', ');
}

// --- checkout bill summary (screen 96) — from the SERVER-authoritative CheckoutPreview (no client money math) ---
export type SummaryRowKey = 'subtotal' | 'delivery' | 'platformFee' | 'discount';
export interface SummaryRow { key: SummaryRowKey; minor: string; free?: boolean; negative?: boolean }

/** Zero delivery fee renders as the design's green "FREE". Pure string compare (minor-unit; never a float). */
export function isFreeDelivery(feeMinor: string): boolean { return (feeMinor ?? '').trim() === '0'; }

/** Ordered summary rows from the server bill: Subtotal, Delivery (free when 0), Platform fee, and Discount ONLY
 * when non-zero (shown as a negative). Every value is the server's minor-unit string — the client never re-adds
 * money (Law 2); the grand total is read straight from the preview. §13: the preview carries no separate GST/tax
 * line (tax is applied on the created order), so no GST row is fabricated here. Pure. */
export function checkoutSummaryRows(p: Pick<CheckoutPreview, 'subtotalMinor' | 'deliveryFeeMinor' | 'platformFeeMinor' | 'discountMinor'>): SummaryRow[] {
  const rows: SummaryRow[] = [
    { key: 'subtotal', minor: p.subtotalMinor },
    { key: 'delivery', minor: p.deliveryFeeMinor, free: isFreeDelivery(p.deliveryFeeMinor) },
    { key: 'platformFee', minor: p.platformFeeMinor },
  ];
  if ((p.discountMinor ?? '').trim() !== '0' && (p.discountMinor ?? '') !== '') rows.push({ key: 'discount', minor: p.discountMinor, negative: true });
  return rows;
}

/** Map listingId → unitCode from the preview's per-seller item slices (the Cart row itself carries no unit label).
 * Degrades to an empty map when there's no preview. Pure. */
export function previewUnitMap(preview: CheckoutPreview | null): Record<string, string> {
  const m: Record<string, string> = {};
  for (const s of preview?.sellers ?? []) for (const it of s.items) if (it.unitCode) m[it.listingId] = it.unitCode;
  return m;
}
