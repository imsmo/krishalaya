'use server';
// apps/web-storefront/src/app/(platform)/cart/actions.ts · the cart mutations (update quantity, remove a line, clear). All
// AUTHENTICATED: requireSession bounces anonymous callers to /login?next=/cart before any write, and the authed
// serverClient carries the httpOnly session — the token never reaches the browser. The cart is owner-scoped
// server-side (the client never names whose cart). These ops are naturally idempotent (set-quantity / delete) and
// the SDK exposes no Idempotency-Key for them, so none is sent. After each change we revalidate /cart so the page
// re-reads the authoritative, recomputed cart (live prices/availability — never a stale client total).
import { revalidatePath } from 'next/cache';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';

const CART_PATH = '/cart';

function parseQty(raw: string): number | null {
  if (!/^\d{1,7}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 ? n : null;
}

/** Set a line's quantity. Out-of-range input is ignored (the page re-renders with the unchanged authoritative cart). */
export async function updateCartItemAction(formData: FormData): Promise<void> {
  await requireSession(CART_PATH);
  const listingId = String(formData.get('listingId') ?? '');
  const qty = parseQty(String(formData.get('quantity') ?? ''));
  if (listingId && qty !== null) {
    try { await serverClient().cart.updateItem(listingId, qty); } catch { /* stock/price race → re-read shows truth */ }
  }
  revalidatePath(CART_PATH);
}

/** Remove a line from the cart. */
export async function removeCartItemAction(formData: FormData): Promise<void> {
  await requireSession(CART_PATH);
  const listingId = String(formData.get('listingId') ?? '');
  if (listingId) {
    try { await serverClient().cart.removeItem(listingId); } catch { /* already gone → re-read reflects it */ }
  }
  revalidatePath(CART_PATH);
}

/** Empty the cart. */
export async function clearCartAction(): Promise<void> {
  await requireSession(CART_PATH);
  try { await serverClient().cart.clear(); } catch { /* degrade: re-read shows current state */ }
  revalidatePath(CART_PATH);
}
