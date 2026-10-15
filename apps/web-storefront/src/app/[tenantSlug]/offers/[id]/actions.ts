'use server';
// apps/web-storefront/src/app/[tenantSlug]/offers/[id]/actions.ts · PC-56 STORE-3b · C3 — the response acts (canon W3121 → W3122 / W3123).
// AUTHENTICATED (requireSession + the authed serverClient). Each act runs under the Idempotency-Key MINTED WHEN THE CONFIRM RENDERED, so a double
// tap or a Retry after a refusal is the SAME request (the API binds the key to this offer — sha256(offerId:key) under offers.accept / .counter /
// .reject — one round row, one effect). The counter's typed price is parsed with the LISTING's own exponent, read from the offer here on the
// server (never the form's word for the currency; the legacy two-decimal caller is gone — C-4). The decline needs one of the six reasons
// (founder D3; no free text). SUCCESS (W3122) → the thread `?ok=`; FAILURE (W3123) → back to the same confirm with the named outcome and the
// same key (and the organisation's remainder for a stock refusal). The `offers` flag OFF answers 404 for every offers route: the action re-reads
// the store's flag and says so by name. "Message seller" is GONE (founder D6 — `messageSellerAction` deleted; STORE-4 builds messaging).
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { SdkError } from '@krishalaya/sdk-js';
import { serverClient, publicClient } from '../../../../lib/api-client';
import { requireSession } from '../../../../lib/session';
import {
  offerHref, offersHref, counterMinor, readDeclineReason, offerFailureOf, ACT_KEY, type OfferActName, type OfferFailure, type OfferOk,
} from '../../../../features/store3b/offers';

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function read(fd: FormData) {
  return { slug: String(fd.get('slug') ?? ''), id: String(fd.get('id') ?? ''), key: String(fd.get('key') ?? '') };
}

/** An API refusal → the named failure; a 404 is `flag_off` only when the store's `offers` flag is OFF (re-read — never guessed). */
async function failureOf(slug: string, e: unknown): Promise<{ failure: OfferFailure; available: string | null }> {
  const code = e instanceof SdkError ? e.code : null;
  const status = e instanceof SdkError ? e.status : null;
  let failure = offerFailureOf(code, status);
  if (status === 404) {
    try { if ((await publicClient(slug).storefront.flags()).offers !== true) failure = 'flag_off'; } catch { /* unreadable → stays `failed` */ }
  }
  const d = e instanceof SdkError ? (e.details as Record<string, unknown> | undefined) : undefined;
  return { failure, available: failure === 'stock_short' && typeof d?.available === 'string' ? d.available : null };
}

function back(slug: string, id: string, act: OfferActName, failure: OfferFailure, key: string, extra: Record<string, string> = {}): never {
  redirect(offerHref(slug, id, { act, error: failure, ...(ACT_KEY.test(key) ? { k: key } : {}), ...extra }));
}
function done(slug: string, id: string, ok: OfferOk): never {
  revalidatePath(offerHref(slug, id));
  revalidatePath(offersHref(slug));
  redirect(offerHref(slug, id, { ok }));
}

/** W3121 Accept → the API reserves the quantity and the relay creates the order within seconds (W3122: "your order is being created"). */
export async function acceptOfferAction(fd: FormData): Promise<void> {
  const { slug, id, key } = read(fd);
  if (!SLUG.test(slug) || !UUID.test(id)) redirect('/');
  await requireSession(offerHref(slug, id));
  if (!ACT_KEY.test(key)) back(slug, id, 'accept', 'failed', key);
  let refusal: { failure: OfferFailure; available: string | null } | null = null;
  try { await serverClient(slug).offers.accept(id, key); }
  catch (e) { refusal = await failureOf(slug, e); }
  if (refusal) back(slug, id, 'accept', refusal.failure, key, refusal.available ? { av: refusal.available } : {});
  done(slug, id, 'accepted');
}

/** W3121 Counter → the typed per-unit price, parsed with the LISTING's exponent (the offer read's currency), under the confirm's key. */
export async function counterOfferAction(fd: FormData): Promise<void> {
  const { slug, id, key } = read(fd);
  if (!SLUG.test(slug) || !UUID.test(id)) redirect('/');
  await requireSession(offerHref(slug, id));
  const typed = String(fd.get('price') ?? '').trim().slice(0, 24);
  const api = serverClient(slug);
  let currency: string | null = null;
  try { currency = (await api.offers.get(id)).currencyCode ?? null; } catch (e) { const r = await failureOf(slug, e); back(slug, id, 'counter', r.failure, key); }
  const priceMinor = counterMinor(typed, currency);
  if (!priceMinor) redirect(offerHref(slug, id, { act: 'counter', error: 'invalid_price' }));
  if (!ACT_KEY.test(key)) back(slug, id, 'counter', 'failed', key, { price: typed });
  let refusal: { failure: OfferFailure; available: string | null } | null = null;
  try { await api.offers.counter(id, priceMinor as string, key); }
  catch (e) { refusal = await failureOf(slug, e); }
  if (refusal) back(slug, id, 'counter', refusal.failure, key, { price: typed });
  done(slug, id, 'countered');
}

/** W3121 Decline → one of the six reasons (required on the storefront; founder D3), under the confirm's key. */
export async function declineOfferAction(fd: FormData): Promise<void> {
  const { slug, id, key } = read(fd);
  if (!SLUG.test(slug) || !UUID.test(id)) redirect('/');
  await requireSession(offerHref(slug, id));
  const reason = readDeclineReason(fd.get('reason'));
  if (!reason) back(slug, id, 'decline', 'reason_required', key);
  if (!ACT_KEY.test(key)) back(slug, id, 'decline', 'failed', key, { r: reason as string });
  let refusal: { failure: OfferFailure; available: string | null } | null = null;
  try { await serverClient(slug).offers.reject(id, key, reason as string); }
  catch (e) { refusal = await failureOf(slug, e); }
  if (refusal) back(slug, id, 'decline', refusal.failure, key, { r: reason as string });
  done(slug, id, 'declined');
}
