'use server';
// apps/web-storefront/src/app/[tenantSlug]/cart/actions.ts · PC-56 STORE-2b · C2 / C4 — the cart's acts (the W3041–W3047 chains), each a Server
// Action that ends in a redirect to the cart with the chain's state in the URL (features/store2b/cart.ts `cartChain`; no client JS):
//   • UPDATE the quantity (the canon's "+"): the typed value is checked as a DECIMAL STRING first (not a number / below the minimum / above
//     what is available — features/store2b/cart.ts `checkQuantity`; the API re-validates); a refusal returns to THIS line with the named
//     refusal and the typed value kept (`carryValues`, features/forms/chain.ts — W3041); success → the recomputed line + a notice (W3043);
//   • REMOVE (confirmed on the page first — W3045): success → the cart without the line (W3046); failure → named (W3047);
//   • ACCEPT the changed price (confirmed with BOTH numbers first): the price the buyer was SHOWN travels as `expectedPriceMinor`, so a price
//     that moved AGAIN is refused PRICE_CHANGED and the line re-renders with the newest two numbers (W3047) — nothing is accepted unseen.
// Every act requires the session (an anonymous post goes to THIS store's sign-in) and calls the API through the store's slug. No act is
// retried automatically; none writes an audit row (a cart writes none — the canon's audit sentence is refused by name).
import { redirect } from 'next/navigation';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { carryValues } from '../../../features/forms/chain';
import { cartHref, checkQuantity, lineAnchor, refusalOf } from '../../../features/store2b/cart';

const SLUG = /^[a-z0-9][a-z0-9-]{0,49}$/;
const UUIDISH = /^[0-9a-fA-F-]{8,64}$/;
function read(formData: FormData): { slug: string; id: string } {
  const slug = String(formData.get('tenantSlug') ?? '').toLowerCase();
  const id = String(formData.get('listingId') ?? '');
  return { slug: SLUG.test(slug) ? slug : '', id: UUIDISH.test(id) ? id : '' };
}
const errOf = (e: unknown) => refusalOf(e instanceof SdkError ? e.code : null, e instanceof SdkError ? (e.details ?? null) : null);
const stateHref = (slug: string, step: string, values: Record<string, string>, id: string) =>
  `/${encodeURIComponent(slug)}/cart?${carryValues(step, values).query}#${lineAnchor(id)}`;

/** W3041–W3044 · set a line's quantity (a decimal string). */
export async function updateCartLineAction(formData: FormData): Promise<void> {
  const { slug, id } = read(formData);
  if (!slug || !id) redirect('/cart');
  await requireSession(cartHref(slug));
  const raw = String(formData.get('quantity') ?? '').trim().slice(0, 20);
  const check = checkQuantity(raw, { min: String(formData.get('min') ?? '') || null, available: String(formData.get('available') ?? '') || null });
  if (!check.ok) redirect(stateHref(slug, 'error', { line: id, err: check.refusal, qty: raw }, id));
  let next: string;
  try {
    await serverClient(slug).cart.updateItem(id, check.qty);
    next = cartHref(slug, { done: 'updated', line: id }, lineAnchor(id));
  } catch (e) {
    next = stateHref(slug, 'error', { line: id, err: errOf(e), qty: raw }, id);
  }
  redirect(next);
}

/** W3045–W3047 · remove a line (after its confirm). */
export async function removeCartLineAction(formData: FormData): Promise<void> {
  const { slug, id } = read(formData);
  if (!slug || !id) redirect('/cart');
  await requireSession(cartHref(slug));
  let next: string;
  try {
    await serverClient(slug).cart.removeItem(id);
    next = cartHref(slug, { done: 'removed' });
  } catch (e) {
    next = stateHref(slug, 'failure', { act: 'remove', line: id, err: errOf(e) }, id);
  }
  redirect(next);
}

/** W3045–W3047 · accept the line's CURRENT price (after its confirm with both numbers). */
export async function acceptPriceAction(formData: FormData): Promise<void> {
  const { slug, id } = read(formData);
  if (!slug || !id) redirect('/cart');
  await requireSession(cartHref(slug));
  const expected = String(formData.get('expectedPriceMinor') ?? '');
  let next: string;
  try {
    await serverClient(slug).cart.acceptPrice(id, /^\d{1,18}$/.test(expected) ? expected : undefined);
    next = cartHref(slug, { done: 'accepted', line: id }, lineAnchor(id));
  } catch (e) {
    next = stateHref(slug, 'failure', { act: 'accept', line: id, err: errOf(e) }, id);
  }
  redirect(next);
}
