// apps/web-storefront/src/test-render/store3b-fixtures.ts · PC-56 STORE-3b — the shared world of the offer list / thread render tests (not a test
// file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page under test and
// the test read the same mutable state `C`: the store's flags, the buyer's offers (one list per status + the counts), each offer's read, the
// public listing, every act the Server Actions made, and the refusals the fake API answers with.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const SLUG = 'anand-fpo';
export const SELLER_UUID = '0211a000-0000-7000-8000-00000000beef';
export const FARMER = 'Ramesh Kumar Patel';
export const LISTING_ID = '0211b000-0000-7000-8000-000000000001';
export const OFF = Object.freeze({
  open: '0211c000-0000-7000-8000-000000000001', countered: '0211c000-0000-7000-8000-000000000002', accepted: '0211c000-0000-7000-8000-000000000003',
  converted: '0211c000-0000-7000-8000-000000000004', rejected: '0211c000-0000-7000-8000-000000000005', expired: '0211c000-0000-7000-8000-000000000006',
});
export const ORDER_ID = '0211d000-0000-7000-8000-000000000001';

/** An offer as the API reads it to its BUYER (STORE-3b fields included). Defaults: countered, round 2, the buyer's turn. */
export const OFFER = (id: string, over: Record<string, unknown> = {}) => ({
  offerId: id, listingId: LISTING_ID, buyerUserId: 'buyer-self', quantity: '12.000', offeredPriceMinor: '244000', counterPriceMinor: '249000',
  round: 2, status: 'countered', expiresAt: '2026-10-17T06:50:00.000Z', convertedOrderId: null, createdAt: '2026-10-15T05:35:00.000Z', currencyCode: 'INR',
  listingTitle: 'Lokwan wheat', unitCode: 'quintal', organisation: { slug: SLUG, name: 'Anand FPO' },
  currentPriceMinor: '249000', offerValueMinor: '2988000', yourTurn: true, allowedActs: ['accept', 'counter', 'decline'],
  respondBy: '2026-10-17T06:50:00.000Z', roundTtlHours: 48, maxLifeEndsAt: '2026-10-29T05:35:00.000Z',
  rounds: [
    { round: 1, party: 'buyer', act: 'offer', priceMinor: '244000', at: '2026-10-15T05:35:00.000000Z' },
    { round: 2, party: 'seller', act: 'counter', priceMinor: '249000', at: '2026-10-15T06:50:00.000000Z' },
  ],
  declineReasonCode: null, declinedBy: null, conversion: null, convertedOrderStatus: null,
  ...over,
});
export const LISTING = { id: LISTING_ID, title: 'Lokwan wheat', unitCode: 'quintal', priceMinor: '252000', currencyCode: 'INR', quantityAvailable: 18, quantityTotal: 40,
  minOrderQty: 1, saleType: 'both', status: 'published', organisation: { slug: SLUG, name: 'Anand FPO' } };

export const C: {
  lang: string; flags: any; list: Record<string, any>; next: string | null; counts: any; offers: Record<string, any>; listing: any; calls: any[];
  fail: Record<string, any>; pending: boolean; doorFails: boolean; signedIn: boolean;
} = {} as any;
export function reset(): void {
  Object.assign(C, {
    lang: 'en', flags: { storefront_browse: true, storefront_cart: true, offers: true, online_payments: true },
    list: { all: [] }, next: null,
    counts: { all: { count: 9, capped: false }, open: { count: 2, capped: false }, countered: { count: 1, capped: false }, accepted: { count: 0, capped: false },
      rejected: { count: 1, capped: false }, expired: { count: 100, capped: true }, converted: { count: 4, capped: false } },
    offers: {}, listing: LISTING, calls: [], fail: {}, pending: false, doorFails: false, signedIn: true,
  });
}
reset();

const answer = (v: any) => { if (v instanceof SdkError) throw v; if (v instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down'); return v; };
const refuse = (name: string) => { const f = C.fail[name]; if (f) throw new SdkError(f.code, f.status ?? 409, f.code, undefined, f.details); };
export function serverClient(): any {
  return {
    offers: {
      counts: async () => { C.calls.push(['offers.counts']); return answer(C.counts); },
      list: async (q: { status?: string; cursor?: string; box: string }) => {
        C.calls.push(['offers.list', q]);
        const l = C.list[q.status ?? 'all'];
        if (l instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down');
        return { items: l ?? [], nextCursor: C.next };
      },
      get: async (id: string) => {
        C.calls.push(['offers.get', id]);
        const o = C.offers[id];
        if (o instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down');
        if (!o) throw new SdkError('NOT_FOUND', 404, 'nf');
        return o;
      },
      accept: async (id: string, key?: string) => { C.calls.push(['offers.accept', id, key]); refuse('offers.accept'); return { ...C.offers[id], status: 'accepted', conversion: 'creating' }; },
      counter: async (id: string, price: string, key?: string) => { C.calls.push(['offers.counter', id, price, key]); refuse('offers.counter'); return C.offers[id]; },
      reject: async (id: string, key?: string, reason?: string) => { C.calls.push(['offers.reject', id, key, reason]); refuse('offers.reject'); return C.offers[id]; },
    },
  };
}
export function publicClient(): any {
  return {
    storefront: { flags: async () => { C.calls.push(['storefront.flags']); return answer(C.flags); } },
    listings: { getPublic: async () => answer(C.listing) },
  };
}
export function sessionTenantClient(): any {
  return {
    storefront: {
      tenant: async () => { if (C.doorFails) throw new Error('down'); return { tenantId: 't', slug: SLUG, displayName: 'Anand FPO' }; },
      flags: async () => answer(C.flags),
    },
  };
}
