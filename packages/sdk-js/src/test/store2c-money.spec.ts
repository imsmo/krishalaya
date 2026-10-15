// @krishalaya/sdk-js · PC-56 STORE-2c — the money wave's contract, pinned with an injected fake fetch (no network): one payment ATTEMPT per key
// (`order-pay:<orderId>:<attempt>`), the order's attempts read, the failure reason as a closed CODE list, the money refusals by name (and their
// details), and the PUBLIC auction read (anonymous unless asked to carry the session; no bidder identity in the type).
import { createClient } from '../client';
import { SdkError } from '../errors';
import { CHECKOUT_MONEY_REFUSAL_CODES, PAYMENT_FAILURE_REASONS } from '../types';
import type { OrderPaymentAttempts, PaymentIntent, PublicAuction } from '../types';

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

describe('PC-56 STORE-2c · SDK money', () => {
  it('createOrderAttempt posts ONE attempt under the attempt\'s own key, for the order, with the amount it was given', async () => {
    const intent: PaymentIntent = { paymentId: 'p2', gatewayOrderId: 'order_2', provider: 'razorpay', amountMinor: '452000', status: 'initiated', attempt: 2, expiresAt: '2026-10-15T10:15:00.000Z' };
    const { fn, calls } = fakeFetch(() => ({ status: 201, body: { data: intent } }));
    const r = await client(fn).payments.createOrderAttempt({ orderId: 'o1', attempt: 2, amountMinor: '452000', currencyCode: 'INR' });
    expect(r).toEqual(intent);
    expect([new URL(calls[0].url).pathname, calls[0].init.method, hdr(calls[0])['idempotency-key']]).toEqual(['/v1/payments', 'POST', 'order-pay:o1:2']);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ purpose: 'direct_order', amountMinor: '452000', currencyCode: 'INR', referenceType: 'order', referenceId: 'o1' });
    await expect(client(fn).payments.createOrderAttempt({ orderId: 'o1', attempt: 0, amountMinor: '1', currencyCode: 'INR' })).rejects.toThrow('attempt');
  });
  it('orderAttempts reads the order\'s attempts (the next attempt\'s number included)', async () => {
    const body: OrderPaymentAttempts = { latest: { id: 'p1', status: 'failed', amountMinor: '452000', currencyCode: 'INR', failureCode: 'BAD_REQUEST_ERROR', failureReason: 'timed_out', chargedNothing: true, expiresAt: null, attempt: 1 },
      attempts: 1, nextAttempt: 2, liveAttempt: false, ttlSeconds: 900 };
    const { fn, calls } = fakeFetch(() => ({ body: { data: body } }));
    expect(await client(fn).payments.orderAttempts('o1')).toEqual(body);
    expect(new URL(calls[0].url).pathname).toBe('/v1/payments/order/o1/attempts');
  });
  it('the failure reasons and the money refusals are closed, named lists', () => {
    expect(PAYMENT_FAILURE_REASONS).toEqual(['cancelled', 'timed_out', 'declined', 'insufficient_funds', 'authentication_failed', 'limit_exceeded', 'gateway_error', 'unknown']);
    expect(CHECKOUT_MONEY_REFUSAL_CODES).toEqual(['MIXED_CURRENCY', 'LISTING_INSUFFICIENT_STOCK', 'PAYMENT_ATTEMPT_LIVE', 'WALLET_INSUFFICIENT_BALANCE', 'CHARGE_METHOD_UNSUPPORTED']);
  });
  it('a live attempt arrives as SdkError PAYMENT_ATTEMPT_LIVE with its payment and expiry', async () => {
    const { fn } = fakeFetch(() => ({ status: 409, body: { error: { code: 'PAYMENT_ATTEMPT_LIVE', message: 'open', details: { paymentId: 'p1', expiresAt: '2026-10-15T10:15:00.000Z' } } } }));
    try { await client(fn).payments.createOrderAttempt({ orderId: 'o1', attempt: 2, amountMinor: '1', currencyCode: 'INR' }); throw new Error('no'); } catch (e) {
      expect(e).toBeInstanceOf(SdkError);
      expect([(e as SdkError).code, (e as SdkError).details]).toEqual(['PAYMENT_ATTEMPT_LIVE', { paymentId: 'p1', expiresAt: '2026-10-15T10:15:00.000Z' }]);
    }
  });
  it('storefront.auction reads the PUBLIC route anonymously by default, and with the session only when asked', async () => {
    const view = { auctionId: 'a1', reserveMet: true, bids: [{ at: '2026-10-15T09:00:00.000Z', amountMinor: '632000' }], viewer: null } as unknown as PublicAuction;
    const { fn, calls } = fakeFetch(() => ({ body: { data: view } }));
    expect(await client(fn).storefront.auction('a1')).toEqual(view);
    await client(fn).storefront.auction('a1', { withSession: true });
    expect(new URL(calls[0].url).pathname).toBe('/v1/storefront/auctions/a1');
    expect([hdr(calls[0]).authorization, hdr(calls[1]).authorization]).toEqual([undefined, 'Bearer tok']);
    expect(hdr(calls[0])['x-tenant-slug']).toBe('anand-fpo');
  });
});
