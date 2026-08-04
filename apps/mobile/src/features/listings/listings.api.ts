// apps/mobile/src/features/listings/listings.api.ts · the farmer's listings data layer. Reads "my listings" and
// creates new ones through the platform API (SDK generic request escape-hatch — there is no dedicated
// seller-listings SDK method yet; `mine: true` is the API's owner filter — GET /v1/listings?mine=true, added
// alongside QueryListingSchema/ListingSearchReadModel; the API 401s a mine=true call with no authenticated
// caller). Creates are OFFLINE-FIRST: if
// the device is offline the op is enqueued (OfflineQueue) with a stable idempotency key and replayed later, so
// the farmer never loses a listing started in a low-signal field (Law 3 idempotency + Law 12 degrade-never-die).
import type { ListingCard, CreateListingInput, ListingAnalytics, GalleryItem, BoostTier, BoostWalletPayResult, ListingInquiry } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import type { QueuedOp, ReplayResult } from '../../core/api/offline-queue';
import { isConnectivityFailure, classifyReplayFailure } from '../../core/api/write-classify';
import { registerOpHandler, enqueueOp } from '../../core/offline/sync-queue';
import { cache } from '../../core/offline/sqlite.db';
import { currentScope } from '../../core/offline/scope';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';
import { track, EVENTS } from '../../core/observability';

export type { CreateListingInput };

export const LISTING_CREATE_OP = 'listing.create';

type ListingsPage = { items: ListingCard[]; nextCursor: string | null };

/** My listings (owner box), keyset paginated. Read-through SWR cache (usable offline); on a hard failure with no
 * cache, degrades to an empty page (caller shows empty state). Cache is scoped to the current user. */
export async function myListings(cursor?: string, limit = 30): Promise<ListingsPage> {
  try {
    const { value } = await cache.read<ListingsPage>({
      scope: currentScope(), ns: 'listings.mine', parts: [cursor ?? 'first', limit], policy: POLICY.shortList,
      fetcher: async () => {
        const r = await apiClient().request<ListingCard[]>('GET', 'listings', { query: { mine: true, cursor, limit } });
        return { items: r.data ?? [], nextCursor: (r.meta?.nextCursor as string | null) ?? null };
      },
    });
    return value;
  } catch {
    return { items: [], nextCursor: null };
  }
}

/** A single owned listing by id (authenticated owner read), cached. Returns null on not-found/failure (caller
 * degrades). `status` is the HTTP status when known, so the screen can distinguish 404 from a transient failure. */
export async function getListing(id: string): Promise<{ listing: ListingCard | null; status: number }> {
  try {
    const { value } = await cache.read<ListingCard>({
      scope: currentScope(), ns: 'listings.detail', parts: [id], policy: POLICY.shortList,
      fetcher: async () => (await apiClient().request<ListingCard>('GET', `listings/${encodeURIComponent(id)}`)).data,
    });
    return { listing: value, status: 200 };
  } catch (e: unknown) {
    return { listing: null, status: (e as { status?: number })?.status ?? 0 };
  }
}

/** Owner engagement analytics for screen 112 (views/offers/price-changes/boosts + publishedAt). Owner-only on the
 * server (404 for non-owners — anti-IDOR). Degrades to null on failure so the detail screen hides the stats. */
export async function listingAnalytics(id: string): Promise<ListingAnalytics | null> {
  try { return await apiClient().listings.analytics(id); } catch { return null; }
}

/** The listing's photo gallery (ordered). Degrades to [] on failure (the screen shows 0 photos, never a fake count). */
export async function listingMedia(id: string): Promise<GalleryItem[]> {
  try { return await apiClient().listings.media(id); } catch { return []; }
}

/** Create a listing (draft). Tries the API immediately; on a TRUE connectivity failure (SdkNetworkError /
 * SdkTimeoutError — the request never reached the API) it enqueues the op for later replay and returns
 * { queued: true } (no id yet). EVERY OTHER failure (validation 4xx, permission, a real 5xx, anything else) is
 * RETHROWN with the server's own (localized) message so the screen can show the farmer what actually went
 * wrong — it must never be silently queued and misreported as "offline" (KV-MF-02: a founder saw "Saved. It
 * will publish when you're back online" while fully online, because a real POST failure was swallowed here).
 * The idempotency key is shared between the live attempt and the queued op, so a replay can never double-create.
 * `mediaIds` are confirmed uploads (core/media). Post-success bookkeeping (cache invalidate / funnel track) is
 * its OWN best-effort try/catch — it must never be able to turn an already-successful create into a "queued"
 * result (that was the second half of KV-MF-02: an unrelated post-success throw got caught by this function's
 * try/catch and re-enqueued a create that had already landed as a draft, which is also why the draft never
 * reached the publish step). */
export async function createListing(input: CreateListingInput): Promise<{ id?: string; queued: boolean }> {
  const idempotencyKey = newId();
  const body: CreateListingInput = { ...input, currencyCode: input.currencyCode ?? 'INR' };
  let id: string;
  try {
    ({ id } = await apiClient().listings.create(body, idempotencyKey));
  } catch (e: unknown) {
    if (isConnectivityFailure(e)) { // true connectivity failure only — everything else surfaces
      await enqueueOp({ type: LISTING_CREATE_OP, payload: body, idempotencyKey, id: idempotencyKey, now: Date.now() });
      return { queued: true };
    }
    throw e; // real client/server error — surface it (screen shows e.message, the API's own localized text)
  }
  // The create already succeeded server-side — nothing below may turn that into a "queued"/failed result.
  try { await cache.invalidate(currentScope(), 'listings.mine'); } catch { /* best-effort refresh, never fatal */ }
  try { track(EVENTS.listingCreateSuccess); } catch { /* best-effort funnel (consent-gated, no PII) — §6 */ }
  return { id, queued: false };
}

/** Publish a draft listing, then invalidate the owner list/detail caches so the change shows. */
export async function publishListing(id: string): Promise<{ ok: boolean }> {
  const res = await apiClient().listings.publish(id);
  await cache.invalidate(currentScope(), 'listings.mine');
  await cache.invalidate(currentScope(), 'listings.detail', [id]);
  return res;
}

/** Change a listing's price (optimistic version). Money is a bigint minor-unit string (Law 2). */
export async function changeListingPrice(id: string, priceMinor: string, expectedVersion: number): Promise<{ ok: boolean }> {
  const res = await apiClient().listings.changePrice(id, priceMinor, expectedVersion);
  await cache.invalidate(currentScope(), 'listings.mine');
  await cache.invalidate(currentScope(), 'listings.detail', [id]);
  return res;
}

/** Repost an expired/sold-out listing back live for a fresh window (screen 116). Optionally updates the price in
 * the same op (paise BigInt — Law 2). Errors are RETHROWN so the screen can surface a validation/conflict message
 * (e.g. an illegal source state). On success the owner list/detail caches are invalidated so the change shows. */
export async function repostListing(id: string, opts: { newPriceMinor?: string; durationDays?: number } = {}): Promise<{ ok: boolean }> {
  const res = await apiClient().listings.repost(id, opts);
  await cache.invalidate(currentScope(), 'listings.mine');
  await cache.invalidate(currentScope(), 'listings.detail', [id]);
  return res;
}

/** The paid-boost tier catalogue (screen 114). id/name/price/days are server truth; degrades to [] on failure so
 * the screen shows its empty state (never a fabricated tier or price). */
export async function loadBoostTiers(): Promise<BoostTier[]> {
  try { return await apiClient().listings.boostTiers(); } catch { return []; }
}

/** Pay for a boost STRAIGHT FROM THE WALLET (screen 114). The client sends only the listing id + chosen tier id;
 * the SERVER resolves the price and debits the wallet atomically (fails closed on insufficient balance — Law 2).
 * Idempotency-keyed (Law 3): the caller passes a key stable across re-taps so a retry can never double-charge.
 * On success the owner list/detail caches are invalidated so the boosted state shows. Errors are RETHROWN (a
 * wallet/validation failure must surface to the user — boosting is an online, immediate-feedback action, not a
 * silently-queued write). */
export async function payListingBoost(id: string, boostTierId: string, idempotencyKey: string, currencyCode?: string): Promise<BoostWalletPayResult> {
  const res = await apiClient().listings.payBoostFromWallet(id, boostTierId, idempotencyKey, currencyCode);
  await cache.invalidate(currentScope(), 'listings.mine');
  await cache.invalidate(currentScope(), 'listings.detail', [id]);
  track(EVENTS.listingCreateSuccess); // reuse the seller funnel bucket (consent-gated, no PII) — §6
  return res;
}

/** Lower-level boost start (records a boost against an already-captured wallet txn). Retained for callers that do
 * the wallet debit themselves; screen 114 uses payListingBoost (server-resolved) instead. `paymentTxnId` proves
 * the wallet already captured payment (Law 2). */
export async function startBoost(id: string, dto: { boostTierId: string; priceMinor: string; currencyCode?: string; days: number; paymentTxnId: string }): Promise<{ ok: boolean }> {
  return apiClient().listings.startBoost(id, dto, newId());
}

/** Push an ACTIVE listing's expiry out by `days` (screen 112 EXTEND cta, KV-BL-031). Idempotency-keyed per tap
 * (Law 3) so a double-tap/retry never double-extends. Errors are RETHROWN (immediate-feedback action, same
 * convention as repost/boost) so the screen can show a precise message. On success the detail/list caches are
 * invalidated so the refreshed expiry shows next read. */
export async function extendListing(id: string, days: number): Promise<{ id: string; expiresAt: string | null }> {
  const res = await apiClient().listings.extend(id, days, newId());
  await cache.invalidate(currentScope(), 'listings.mine');
  await cache.invalidate(currentScope(), 'listings.detail', [id]);
  return res;
}

/** ADD PHOTO — attach one more already-uploaded, clean image to the caller's OWN, already-created listing
 * (screen 112 "Listing health → Add more photos" cta; KV-MF-14). The mobile screen picks/captures + uploads
 * the file first (core/media uploadPickedImage → confirmed mediaId), then calls this with just that id.
 * Errors are RETHROWN (an immediate-feedback action, same convention as repost/extend/archive) so the screen
 * can show the server's real reason (e.g. the 10-photo cap). On success the detail cache is invalidated so
 * the refreshed gallery/count shows on the next read. */
export async function addListingPhoto(id: string, mediaAssetId: string): Promise<{ photoCount: number }> {
  const res = await apiClient().listings.addPhoto(id, mediaAssetId);
  await cache.invalidate(currentScope(), 'listings.detail', [id]);
  return res;
}

/** REMOVE — archive the seller's own listing for good (screen 112 Remove cta; KV-MF-08). Terminal (the domain
 * state machine has no transition out of 'archived') — the screen must confirm before calling. Idempotency-keyed
 * per tap (Law 3) so a double-tap/retry never attempts a second (illegal) transition. Errors are RETHROWN (an
 * immediate-feedback destructive action, same convention as repost/extend/boost) so the screen can show the
 * server's real reason. On success the owner list/detail caches are invalidated so the removal shows immediately. */
export async function archiveListing(id: string): Promise<{ id: string; status: string }> {
  const res = await apiClient().listings.archive(id, newId());
  await cache.invalidate(currentScope(), 'listings.mine');
  await cache.invalidate(currentScope(), 'listings.detail', [id]);
  return res;
}

/** Paginated buyer inquiries into the caller's OWN listing (screen 112 "Recent inquiries", KV-BL-031). Owner-only
 * on the server (404 for non-owners — anti-IDOR). Degrades to an empty page on failure so the screen shows its
 * empty/coming-soon state rather than an error (a non-critical read, same convention as myListings). */
export async function listingInquiries(id: string, params: { cursor?: string; limit?: number } = {}): Promise<{ items: ListingInquiry[]; nextCursor: string | null }> {
  try { return await apiClient().listings.inquiries(id, params); } catch { return { items: [], nextCursor: null }; }
}

/** The replay handler, registered on the shared offline queue (dispatched by op.type). ONLY a true connectivity
 * failure (SdkNetworkError/SdkTimeoutError) is 'retry' — a real 4xx/5xx will fail EXACTLY the same way on every
 * future attempt (it's a poison op), so it must dead-letter on the FIRST retry, not hammer the API for up to
 * MAX_ATTEMPTS tries while the farmer keeps seeing "[sdk] POST …" failure toasts (KV-MF-02 bug 2). */
async function replayListingCreate(op: QueuedOp): Promise<ReplayResult> {
  try {
    await apiClient().listings.create(op.payload as CreateListingInput, op.idempotencyKey);
    return 'ok';
  } catch (e: unknown) {
    return classifyReplayFailure(e);
  }
}
registerOpHandler(LISTING_CREATE_OP, replayListingCreate);
