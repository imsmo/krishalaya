// @krishalaya/sdk-js · PC-56 STORE-3a — the orders wave's contract, pinned with an injected fake fetch (no network): the buyer's tabs (`group` on
// the list, `groups()` counts), the cancel with its reason + note under the caller's key, the complete under its key, the refund read on the
// order's attempts, the amount due / deposit applied on the detail, and the order refusals as a closed, named list.
import { createClient } from '../client';
import { SdkError } from '../errors';
import { ORDER_GROUPS, ORDER_REFUSAL_CODES } from '../types';
import type { OrderGroupCounts, OrderPaymentAttempts, OrderDetail } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call); const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });

describe('PC-56 STORE-3a · SDK orders', () => {
  it('list carries the tab (`group`); groups() reads the bounded counts', async () => {
    const counts: OrderGroupCounts = { all: { count: 23, capped: false }, active: { count: 4, capped: false }, attention: { count: 1, capped: false },
      completed: { count: 100, capped: true }, cancelled: { count: 1, capped: false } };
    const { fn, calls } = fakeFetch((c) => ({ body: c.url.includes('/groups') ? { data: counts } : { data: [], meta: { nextCursor: null } } }));
    await client(fn).orders.list({ role: 'buyer', group: 'attention', limit: 20 });
    const u = new URL(calls[0].url);
    expect([u.pathname, u.searchParams.get('group'), u.searchParams.get('role'), u.searchParams.has('status')]).toEqual(['/v1/orders', 'attention', 'buyer', false]);
    expect(await client(fn).orders.groups()).toEqual(counts);
    expect(new URL(calls[1].url).pathname).toBe('/v1/orders/groups');
    expect(ORDER_GROUPS).toEqual(['all', 'active', 'attention', 'completed', 'cancelled']);
  });
  it('cancel posts the reason (and a note only when given) under the caller\'s key; complete posts under its key', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: { ok: true } } }));
    await client(fn).orders.cancel('o1', 'k-1', 'r-other', 'bought locally');
    await client(fn).orders.cancel('o1', 'k-2', 'r-changed');
    await client(fn).orders.complete('o1', 'k-3');
    expect([new URL(calls[0].url).pathname, hdr(calls[0])['idempotency-key'], JSON.parse(String(calls[0].init.body))]).toEqual(['/v1/orders/o1/cancel', 'k-1', { reasonId: 'r-other', note: 'bought locally' }]);
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ reasonId: 'r-changed' });
    expect([new URL(calls[2].url).pathname, calls[2].init.method, hdr(calls[2])['idempotency-key']]).toEqual(['/v1/orders/o1/complete', 'POST', 'k-3']);
  });
  it('a refused cancel / complete arrives as SdkError with its code and details', async () => {
    const { fn } = fakeFetch(() => ({ status: 422, body: { error: { code: 'CANCEL_NOTE_REQUIRED', message: 'say why', details: { reasonCode: 'other' } } } }));
    try { await client(fn).orders.cancel('o1', 'k', 'r-other'); throw new Error('not refused'); } catch (e) {
      expect([(e as SdkError).code, (e as SdkError).status, (e as SdkError).details]).toEqual(['CANCEL_NOTE_REQUIRED', 422, { reasonCode: 'other' }]);
    }
    expect(ORDER_REFUSAL_CODES).toEqual(['CANCEL_REASON_REQUIRED', 'CANCEL_REASON_UNKNOWN', 'CANCEL_NOTE_REQUIRED', 'ORDER_COMPLETE_REQUIRES_ESCROW', 'ORDER_ILLEGAL_TRANSITION', 'ORDER_FORBIDDEN', 'ORDER_CONCURRENCY_CONFLICT']);
  });
  it('the refund read rides on the order\'s attempts; the detail carries the amount due and the deposit applied as strings', async () => {
    const attempts: OrderPaymentAttempts = { latest: null, attempts: 1, nextAttempt: 2, liveAttempt: false, ttlSeconds: 900,
      refund: { state: 'refunded', amountMinor: '452000', currencyCode: 'INR', initiatedAt: '2026-10-15T10:00:00.000Z', completedAt: '2026-10-15T10:00:01.000Z', gatewayRefundId: 'rfnd_x' } };
    const detail = { id: 'o1', orderNo: 'KV2026-1', status: 'payment_pending', paymentState: 'pending', source: 'auction', currencyCode: 'INR', subtotalMinor: '1', deliveryFeeMinor: '0',
      discountMinor: '0', taxMinor: '0', commissionMinor: '0', platformFeeMinor: '0', buyerCommissionMinor: '0', totalMinor: '13100000', items: [],
      amountDueMinor: '12100000', depositAppliedMinor: '1000000', cancelReasonCode: null } as OrderDetail;
    const { fn } = fakeFetch((c) => ({ body: { data: c.url.includes('attempts') ? attempts : detail } }));
    expect((await client(fn).payments.orderAttempts('o1')).refund).toEqual(attempts.refund);
    const d = await client(fn).orders.get('o1');
    expect([d.amountDueMinor, d.depositAppliedMinor]).toEqual(['12100000', '1000000']);
  });
});
