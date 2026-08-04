// apps/mobile/src/features/offers/offers.api.ts · data layer for listing-offer negotiation (P-10). Keeps screens
// thin (guide §3). Reads degrade-never-die (empty/null). Mutations are negotiation TRANSITIONS — online (not
// offline-queued), idempotent where the endpoint requires it (make), and throw so the screen shows the precise
// outcome (409 stale / 403 not your turn). Accept converts the offer to an order SERVER-SIDE (convertedOrderId).
// Money is bigint minor-unit strings (Law 2).
import type { ListingOffer, OfferBox } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';

export interface OffersPage { items: ListingOffer[]; nextCursor: string | null }

export function makeOffer(input: { listingId: string; quantity: string; offeredPriceMinor: string }): Promise<ListingOffer> {
  return apiClient().offers.make(input, newId());
}
export async function listOffers(box: OfferBox, params: { listingId?: string; status?: string; cursor?: string } = {}): Promise<OffersPage> {
  try { return await apiClient().offers.list({ box, ...params }); } catch { return { items: [], nextCursor: null }; }
}
export async function getOffer(id: string): Promise<ListingOffer | null> {
  try { return await apiClient().offers.get(id); } catch { return null; }
}
export function counterOffer(id: string, priceMinor: string): Promise<ListingOffer> { return apiClient().offers.counter(id, priceMinor); }
export function acceptOffer(id: string): Promise<ListingOffer> { return apiClient().offers.accept(id); }
export function rejectOffer(id: string): Promise<ListingOffer> { return apiClient().offers.reject(id); }
