// apps/web-storefront/src/test-render/store3a-fixtures.ts · PC-56 STORE-3a — the shared world of the order list / order / cancel render tests (not a
// test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page under test
// and the test read the same mutable state `C`: the session, the store's flags, the buyer's orders (one list per tab + the counts), each order's
// detail, events and payment attempts, the cancel-reason vocabulary, the cookie jar, and every act the Server Actions made.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const SLUG = 'anand-fpo';
export const SELLER_UUID = '0210a000-0000-7000-8000-00000000beef';
export const OID = Object.freeze({
  cod: '0210e000-0000-7000-8000-000000000001', paid: '0210e000-0000-7000-8000-000000000002', pending: '0210e000-0000-7000-8000-000000000003',
  auction: '0210e000-0000-7000-8000-000000000004', cancelled: '0210e000-0000-7000-8000-000000000005', late: '0210e000-0000-7000-8000-000000000006',
});
export const REASONS = [
  ['changed_mind', 'I changed my mind'], ['found_better_price', 'I found a better price'], ['ordered_by_mistake', 'I ordered by mistake'],
  ['delivery_too_slow', 'Delivery would take too long'], ['quantity_or_grade_doubt', 'I am unsure of the quantity or the grade'],
  ['payment_issue', 'A problem with the payment'], ['other', 'Other (reason written by the buyer)'],
].map(([code, name], i) => ({ id: `0210c000-0000-7000-8000-00000000000${i + 1}`, code, name, sortOrder: i + 1, meta: code === 'other' ? { textRequired: true } : {} }));
export const reasonId = (code: string) => REASONS.find((r) => r.code === code)!.id;

export const DETAIL = (id: string, over: Record<string, unknown> = {}) => ({
  id, orderNo: `KV2026-${id.slice(-4).toUpperCase()}`, status: 'confirmed', paymentState: 'none', source: 'direct', currencyCode: 'INR', checkoutGroupId: null,
  organisation: { slug: SLUG, name: 'Anand FPO' }, subtotalMinor: '6150000', deliveryFeeMinor: '7500', discountMinor: '0', taxMinor: '0', commissionMinor: '0',
  platformFeeMinor: '15375', buyerCommissionMinor: '0', totalMinor: '6172875', amountDueMinor: '6172875', depositAppliedMinor: '0', cancelReasonCode: null,
  acceptanceDeadline: '2026-10-16T11:42:00.000Z', qualityWindowEnds: null, createdAt: '2026-10-15T11:42:00.000Z',
  items: [{ listing_id: 'l1', title_snapshot: 'GG-20 Groundnut', quantity: 10, delivered_quantity: null, unit_code: 'quintal', unit_price_minor: '615000', line_total_minor: '6150000' }],
  ...over,
});
export const ROW = (id: string, status: string, over: Record<string, unknown> = {}) => ({
  id, orderNo: `KV2026-${id.slice(-4).toUpperCase()}`, status, source: 'direct', totalMinor: '6172875', currencyCode: 'INR', paymentState: 'none',
  acceptanceDeadline: null, organisation: { slug: SLUG, name: 'Anand FPO' }, createdAt: '2026-10-15T11:42:00.000Z',
  primaryItem: { title: 'GG-20 Groundnut', quantity: 10, unitCode: 'quintal' }, itemCount: 1, ...over,
});
const NO_ATTEMPTS = { latest: null, attempts: 0, nextAttempt: 1, liveAttempt: false, ttlSeconds: 900, refund: { state: 'none', amountMinor: '0', currencyCode: null, initiatedAt: null, completedAt: null, gatewayRefundId: null } };

export const C: {
  lang: string; flags: any; list: Record<string, any[]>; next: string | null; counts: any; orders: Record<string, any>; events: Record<string, any>;
  attempts: Record<string, any>; reasons: any; calls: any[]; fail: Record<string, any>; cookies: Map<string, string>; pending: boolean; doorFails: boolean;
} = {} as any;
export function reset(): void {
  Object.assign(C, {
    lang: 'en', flags: { storefront_browse: true, storefront_cart: true, online_payments: true, disputes: false },
    list: { all: [] }, next: null,
    counts: { all: { count: 23, capped: false }, active: { count: 4, capped: false }, attention: { count: 1, capped: false }, completed: { count: 17, capped: false }, cancelled: { count: 1, capped: false } },
    orders: {}, events: {}, attempts: {}, reasons: REASONS, calls: [], fail: {}, cookies: new Map(), pending: false, doorFails: false,
  });
}
reset();

const answer = (v: any) => { if (v instanceof SdkError) throw v; if (v instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down'); return v; };
export function serverClient(): any {
  return {
    orders: {
      groups: async () => answer(C.counts),
      list: async (q: { group?: string; cursor?: string }) => { C.calls.push(['orders.list', q]); const l = C.list[q.group ?? 'all']; if (l instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down'); return { items: l ?? [], nextCursor: C.next }; },
      get: async (id: string) => { const o = C.orders[id]; if (o instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down'); if (!o) throw new SdkError('ORDER_NOT_FOUND', 404, 'nf'); return o; },
      events: async (id: string) => answer(C.events[id] ?? []),
      cancel: async (id: string, key: string, rid?: string, note?: string) => { C.calls.push(['orders.cancel', id, key, rid, note]); const f = C.fail['orders.cancel']; if (f) throw new SdkError(f.code, f.status ?? 409, f.code); return { ok: true }; },
      complete: async (id: string, key: string) => { C.calls.push(['orders.complete', id, key]); const f = C.fail['orders.complete']; if (f) throw new SdkError(f.code, f.status ?? 409, f.code); return { ok: true }; },
    },
    payments: {
      orderAttempts: async (id: string) => answer(C.attempts[id] ?? NO_ATTEMPTS),
      invoices: { downloadUrl: async () => { throw new SdkError('NOT_FOUND', 404, 'nf'); } },
    },
    disputes: { raise: async (b: unknown, k: string) => { C.calls.push(['disputes.raise', b, k]); return { id: 'd1' }; } },
    lookups: { values: async (type: string) => { C.calls.push(['lookups.values', type]); return answer(C.reasons); } },
  };
}
export function publicClient(): any { return { storefront: { flags: async () => answer(C.flags) } }; }
export function sessionTenantClient(): any {
  return { storefront: { tenant: async () => { if (C.doorFails) throw new Error('down'); return { tenantId: 't', slug: SLUG, displayName: 'Anand FPO' }; } } };
}
export const cookieJar = () => ({
  get: (n: string) => (C.cookies.has(n) ? { name: n, value: C.cookies.get(n) } : undefined),
  set: (n: string, v: string, o?: { maxAge?: number }) => { C.calls.push(['cookie.set', n, o?.maxAge]); if (o?.maxAge === 0) C.cookies.delete(n); else C.cookies.set(n, v); },
  delete: (n: string) => { C.cookies.delete(n); },
});
