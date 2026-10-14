'use server';
// apps/web-storefront/src/app/[tenantSlug]/listings/[id]/actions.ts · the buyer mutations on a listing detail
// page — add-to-cart and make-an-offer. Both are AUTHENTICATED: they call requireSession (anonymous visitors are
// bounced to /login with a return path back to this listing, so no private write happens unauthenticated), then
// invoke the authed serverClient scoped to the tenant slug. The session token never leaves the server. offers.make
// carries an Idempotency-Key (Law 3) so a double-submit can't post two offers; cart.addItem is naturally
// idempotent server-side (it merges quantity) and the SDK exposes no key for it. Money is parsed major→minor as
// an INTEGER STRING (Law 2) via the shared pure helper — never a float. On completion we redirect back to the
// listing with a ?status= flag the page renders as a localized notice (works with no client JS).
import { randomUUID } from 'crypto';
import { redirect } from 'next/navigation';
import { serverClient, publicClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import { parseMajorToMinor } from '../../../../features/discovery/query';
import { currencyExponent } from '../../../../features/discovery/money';
import { parseQuantity } from '../../../../features/store2a/listing';
import { SdkError } from '@krishalaya/sdk-js';
import { carryValues } from '../../../../features/forms/chain';
import { checkQuantity, refusalOf } from '../../../../features/store2b/cart';

function listingPath(tenantSlug: string, id: string): string {
  return `/${encodeURIComponent(tenantSlug)}/listings/${encodeURIComponent(id)}`;
}

/** PC-56 STORE-2a · C3: a DECIMAL quantity (numeric(14,3)) in (0, available] as a canonical decimal string — string math
 *  (features/store2a/listing.ts parseQuantity), never a float comparison; the API re-validates. */
function parseQty(raw: string, available: number): string | null {
  return parseQuantity(raw, String(available));
}

/**
 * Add the listing to the buyer's cart, then return to the listing with a status notice.
 *
 * PC-56 STORE-2b · C3 — canon W3099–W3102 (the "+" on W277). The typed quantity is checked as a DECIMAL STRING first (not a number / below
 * the minimum / above what is available — features/store2b/cart.ts `checkQuantity`) and sent AS A STRING (no float on the way); every API
 * refusal comes back BY NAME (`refusalOf`: below the minimum, above available, LICENCE_REQUIRED, WRONG_STORE — the other store's sign-in
 * link, a suspended seller, sold out, buying paused, …) with the typed quantity kept (`carryValues`, features/forms/chain.ts) — never "check
 * your entry". No review page (W3100 is a DELTA: the cart is the review). An anonymous add goes to THIS store's sign-in (requireSession).
 */
export async function addToCartAction(formData: FormData): Promise<void> {
  const tenantSlug = String(formData.get('tenantSlug') ?? '');
  const listingId = String(formData.get('listingId') ?? '');
  const path = listingPath(tenantSlug, listingId);
  const raw = String(formData.get('quantity') ?? '').trim().slice(0, 20);
  const refused = (refusal: string) => `${path}?${carryValues('error', { refusal, qty: raw }).query}#add`;
  if (!tenantSlug || !listingId) redirect(`${path}?status=err`);
  const check = checkQuantity(raw, { min: String(formData.get('min') ?? '') || null, available: String(formData.get('available') ?? '') || null });
  if (!check.ok) redirect(refused(check.refusal));

  await requireSession(path);
  let next: string;
  try {
    await serverClient(tenantSlug).cart.addItem(listingId, check.qty);   // a decimal STRING — never a float
    next = `${path}?status=added`;
  } catch (e) {
    // never auto-retry a mutation; the refusal is named, the typed quantity kept
    next = refused(refusalOf(e instanceof SdkError ? e.code : null, e instanceof SdkError ? (e.details ?? null) : null));
  }
  redirect(next);
}

/** Make a price offer on the listing (per-unit price + quantity), then return with a status notice. */
export async function makeOfferAction(formData: FormData): Promise<void> {
  const tenantSlug = String(formData.get('tenantSlug') ?? '');
  const listingId = String(formData.get('listingId') ?? '');
  const available = Number(formData.get('available') ?? '0');
  const path = listingPath(tenantSlug, listingId);
  const qty = parseQty(String(formData.get('quantity') ?? ''), Number.isFinite(available) ? available : 0);
  // PC-56 HOTFIX-4 · C4 (survey C-6): the typed offer is parsed with the LISTING's own currency exponent (read server-side, never the form's
  // word for it, never the legacy two decimals); an unknown currency refuses the offer rather than guessing.
  let exponent: number | null = null;
  if (tenantSlug && listingId) {
    try { exponent = currencyExponent((await publicClient(tenantSlug).listings.getPublic(listingId)).currencyCode); } catch { exponent = null; }
  }
  const offeredPriceMinor = exponent === null ? undefined : parseMajorToMinor(String(formData.get('offerPrice') ?? ''), exponent);
  if (!tenantSlug || !listingId || qty === null || !offeredPriceMinor || offeredPriceMinor === '0') {
    redirect(`${path}?status=err`);
  }

  await requireSession(path);
  try {
    await serverClient(tenantSlug).offers.make(
      { listingId, quantity: qty as string, offeredPriceMinor: offeredPriceMinor as string },
      randomUUID(),
    );
  } catch {
    redirect(`${path}?status=err`);
  }
  redirect(`${path}?status=offer_sent`);
}
