// apps/web-storefront/src/test-render/store5a-fixtures.ts · PC-56 STORE-5a — the shared world of the review and accessibility render tests (not a
// test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page under test
// and the test read the same mutable state `C`: the session store's flags, the order and its events, the server's review answers (eligibility,
// the author's review, the preview), the `review_dimension` vocabulary, the cookie jar (the review draft, the device modes), every act the
// Server Actions made, and the failures to answer with.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const SLUG = 'anand-fpo';
export const OID = '0218e000-0000-7000-8000-000000000001';
export const RID = '0218f000-0000-7000-8000-0000000000aa';
export const SELLER_UUID = '0218a000-0000-7000-8000-00000000beef';
export const BUYER_UUID = '0218b000-0000-7000-8000-00000000b0b0';
export const KEY = 'review:0218c000-0000-4000-8000-000000000001';
export const EKEY = 'review-edit:0218c000-0000-4000-8000-000000000002';
export const DIMS = [
  { id: '0218d000-0000-7000-8000-000000000001', code: 'quality', name: 'Quality', sortOrder: 1, meta: {} },
  { id: '0218d000-0000-7000-8000-000000000002', code: 'freshness', name: 'Freshness', sortOrder: 2, meta: {} },
  { id: '0218d000-0000-7000-8000-000000000003', code: 'packaging', name: 'Packaging', sortOrder: 3, meta: {} },
];
export const ORDER = (over: Record<string, unknown> = {}) => ({
  id: OID, orderNo: 'KV2026-0001', status: 'completed', paymentState: 'none', source: 'direct', currencyCode: 'INR', checkoutGroupId: null,
  organisation: { slug: SLUG, name: 'Anand FPO' }, subtotalMinor: '6150000', deliveryFeeMinor: '0', discountMinor: '0', taxMinor: '0', commissionMinor: '0',
  platformFeeMinor: '0', buyerCommissionMinor: '0', totalMinor: '6150000', amountDueMinor: '6150000', depositAppliedMinor: '0', cancelReasonCode: null,
  acceptanceDeadline: null, qualityWindowEnds: null, createdAt: '2026-10-15T11:42:00.000Z',
  items: [{ listing_id: 'l1', title_snapshot: 'Okra', quantity: 120, delivered_quantity: null, unit_code: 'kg', unit_price_minor: '51250', line_total_minor: '6150000' }],
  ...over,
});
export const MINE = (over: Record<string, unknown> = {}) => ({
  id: RID, targetType: 'seller', stars: 4, subRatings: { quality: 4 }, body: 'Fresh and honest weight', tags: [], isVerifiedPurchase: true, label: 'verified_buyer',
  respondedBy: null, sellerResponse: null, sellerRespondedAt: null, helpfulCount: 0, createdAt: '2026-10-16T08:00:00.000Z', orderId: OID, status: 'published',
  editLocksAt: '2026-10-23T08:00:00.000Z', editable: true, ...over,
});
export const PREVIEW = (over: Record<string, unknown> = {}) => ({
  orderId: OID, organisation: { name: 'Anand FPO' }, stars: 5, subRatings: [{ code: 'quality', label: 'Quality', stars: 5 }, { code: 'freshness', label: 'Freshness', stars: 4 }],
  body: 'Very fresh', label: 'verified_buyer', editLocksAt: '2026-10-24T08:00:00.000Z', expiresAt: '2026-11-15T08:00:00.000Z', ...over,
});

export const C: {
  lang: string; flags: any; order: any; events: any[]; elig: any; mine: any; preview: any; dims: any; calls: any[]; fail: Record<string, any>;
  cookies: Map<string, string>; pending: boolean;
} = {} as any;
export function reset(): void {
  Object.assign(C, {
    lang: 'en', flags: { reviews: true, disputes: false, storefront_browse: true, storefront_cart: true },
    order: ORDER(), events: [{ fromStatus: 'out_for_delivery', toStatus: 'delivered', actorRole: 'seller', at: '2026-10-14T09:00:00.000Z' }],
    elig: { eligible: true, expiresAt: '2026-11-15T08:00:00.000Z', windowOpen: true, reviewed: false }, mine: null, preview: PREVIEW(), dims: DIMS,
    calls: [], fail: {}, cookies: new Map(), pending: false,
  });
}
reset();

const answer = (v: any) => { if (v instanceof SdkError) throw v; if (v instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down'); return v; };
const failIf = (k: string) => { const f = C.fail[k]; if (f) throw (f instanceof SdkError ? f : new SdkError(f.code, f.status ?? 409, f.code)); };
export function serverClient(): any {
  return {
    orders: {
      get: async (id: string) => { C.calls.push(['orders.get', id]); failIf('orders.get'); if (!C.order) throw new SdkError('ORDER_NOT_FOUND', 404, 'nf'); return C.order; },
      events: async () => answer(C.events),
      complete: async (id: string, key: string) => { C.calls.push(['orders.complete', id, key]); failIf('orders.complete'); return { ok: true }; },
    },
    payments: { orderAttempts: async () => ({ latest: null, attempts: 0, nextAttempt: 1, liveAttempt: false, ttlSeconds: 900, refund: { state: 'none', amountMinor: '0', currencyCode: null, initiatedAt: null, completedAt: null, gatewayRefundId: null } }),
      invoices: { downloadUrl: async () => { throw new SdkError('NOT_FOUND', 404, 'nf'); } } },
    reviews: {
      eligibility: async (q: any) => { C.calls.push(['reviews.eligibility', q]); failIf('reviews.eligibility'); return C.elig; },
      mine: async (q: any) => { C.calls.push(['reviews.mine', q]); failIf('reviews.mine'); if (!C.mine) throw new SdkError('NOT_FOUND', 404, 'nf'); return C.mine; },
      preview: async (b: any) => { C.calls.push(['reviews.preview', b]); failIf('reviews.preview'); return C.preview; },
      create: async (b: any, key: string) => { C.calls.push(['reviews.create', b, key]); failIf('reviews.create'); return { id: RID }; },
      edit: async (id: string, b: any, key: string) => { C.calls.push(['reviews.edit', id, b, key]); failIf('reviews.edit'); return { id }; },
    },
    disputes: { raise: async () => ({ id: 'd1' }) },
  };
}
export function publicClient(): any {
  return {
    storefront: { flags: async () => { C.calls.push(['storefront.flags']); return answer(C.flags); } },
    lookups: { values: async (type: string) => { C.calls.push(['lookups.values', type]); return answer(C.dims); } },
  };
}
export function sessionTenantClient(): any { return { storefront: { tenant: async () => ({ tenantId: 't', slug: SLUG, displayName: 'Anand FPO' }) } }; }
export const cookieJar = () => ({
  get: (n: string) => (C.cookies.has(n) ? { name: n, value: C.cookies.get(n) } : undefined),
  set: (n: string, v: string, o?: { maxAge?: number; path?: string; httpOnly?: boolean }) => { C.calls.push(['cookie.set', n, o?.maxAge, o?.path, o?.httpOnly]); if (o?.maxAge === 0 || v === '') C.cookies.delete(n); else C.cookies.set(n, v); },
  delete: (n: string) => { C.cookies.delete(n); },
});
/** the API calls made (not the flags / vocabulary reads) */
export const apiCalls = () => C.calls.filter((c) => typeof c[0] === 'string' && (c[0].startsWith('reviews.') || c[0].startsWith('orders.')));
