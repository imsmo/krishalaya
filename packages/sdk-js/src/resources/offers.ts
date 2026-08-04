// @krishalaya/sdk-js · offers (negotiation) resource (module 3). Buyer makes an offer on a listing; the seller
// (or buyer, on a counter) counters/accepts/rejects. Accept converts the offer into an order SERVER-SIDE
// (`convertedOrderId`). `make` carries an Idempotency-Key (Law 3). Money is bigint minor-unit strings (Law 2);
// the per-party authorization (buyer vs the listing's seller) + the legal transition are enforced server-side.
// Gated server-side by the `offers` flag.
import { HttpClient } from '../http';
import { ListingOffer, Page } from '../types';

export type OfferBox = 'outgoing' | 'incoming';

export class OffersResource {
  constructor(private readonly http: HttpClient) {}

  /** Make an offer: per-unit price (minor units) + quantity (decimal string). Idempotent. */
  async make(input: { listingId: string; quantity: string; offeredPriceMinor: string; expiresAt?: string }, idempotencyKey: string): Promise<ListingOffer> {
    return (await this.http.request<ListingOffer>('POST', 'offers', { idempotencyKey, body: input })).data;
  }
  /** outgoing = offers I made (buyer); incoming = offers on a listing I own (seller; requires listingId). Keyset. */
  async list(params: { box: OfferBox; listingId?: string; status?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<ListingOffer>> {
    const r = await this.http.request<ListingOffer[]>('GET', 'offers', { query: { box: params.box, listingId: params.listingId, status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<ListingOffer> {
    return (await this.http.request<ListingOffer>('GET', `offers/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Counter with a new per-unit price (minor units). The other party then accepts/counters/rejects. */
  async counter(id: string, priceMinor: string): Promise<ListingOffer> {
    return (await this.http.request<ListingOffer>('POST', `offers/${encodeURIComponent(id)}/counter`, { body: { priceMinor } })).data;
  }
  /** Accept the current (offered or countered) price → the server creates the order. */
  async accept(id: string): Promise<ListingOffer> {
    return (await this.http.request<ListingOffer>('POST', `offers/${encodeURIComponent(id)}/accept`, { body: {} })).data;
  }
  async reject(id: string): Promise<ListingOffer> {
    return (await this.http.request<ListingOffer>('POST', `offers/${encodeURIComponent(id)}/reject`, { body: {} })).data;
  }
}
