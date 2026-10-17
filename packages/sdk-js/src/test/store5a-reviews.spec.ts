// @krishalaya/sdk-js · PC-56 STORE-5a — the review contract this wave adds, pinned with an injected fake fetch (no network):
//   • preview POSTs the input to reviews/preview with NO idempotency key (it writes nothing) and returns the server's review;
//   • mine / eligibility GET with `orderId`; the eligibility shape carries no counterparty id;
//   • dimensions reads the EXISTING public `lookups/values?type=review_dimension` route (anonymous);
//   • edit PATCHes with the key minted at render; flag POSTs `{ action: 'flag' }` to the moderate route;
//   • the named refusals (REVIEW_LOCKED / REVIEW_WINDOW_CLOSED / REVIEW_DIMENSION_UNKNOWN / REVIEW_FLAG_FORBIDDEN) arrive as SdkError codes.
import { createClient } from '../client';
import type { ReviewEligibility, ReviewPreview } from '../types';

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
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });
const qs = (c: Call) => Object.fromEntries(new URL(c.url).searchParams.entries());
const header = (c: Call, h: string) => (c.init.headers as Record<string, string> | undefined)?.[h];
const OID = '0218a000-0000-7000-8000-000000000001';

describe('PC-56 STORE-5a · SDK reviews', () => {
  it('preview POSTs the input (no key — it writes nothing) and returns the server\'s review', async () => {
    const body: ReviewPreview = { orderId: OID, organisation: { name: 'Anand FPO' }, stars: 4, subRatings: [{ code: 'quality', label: 'Quality', stars: 5 }], body: 'good',
      label: 'verified_buyer', editLocksAt: '2026-10-24T06:00:00.000Z', expiresAt: '2026-11-16T06:00:00.000Z' };
    const { fn, calls } = fakeFetch(() => ({ body: { data: body } }));
    expect(await client(fn).reviews.preview({ orderId: OID, stars: 4, subRatings: { quality: 5 }, body: 'good' })).toEqual(body);
    expect(calls[0].init.method).toBe('POST');
    expect(new URL(calls[0].url).pathname).toBe('/v1/reviews/preview');
    expect(header(calls[0], 'idempotency-key')).toBeUndefined();
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ orderId: OID, stars: 4, subRatings: { quality: 5 }, body: 'good' });
  });
  it('mine and eligibility GET with orderId; eligibility carries no counterparty id', async () => {
    const elig: ReviewEligibility = { eligible: true, expiresAt: '2026-11-16T06:00:00.000Z', windowOpen: true, reviewed: false };
    const { fn, calls } = fakeFetch((c) => (c.url.includes('eligibility') ? { body: { data: elig } } : { body: { data: { id: 'r1', stars: 4, editable: true, editLocksAt: null } } }));
    expect(await client(fn).reviews.eligibility({ orderId: OID })).toEqual(elig);
    expect((await client(fn).reviews.mine({ orderId: OID })).editable).toBe(true);
    expect([new URL(calls[0].url).pathname, qs(calls[0])]).toEqual(['/v1/reviews/eligibility', { orderId: OID }]);
    expect([new URL(calls[1].url).pathname, qs(calls[1])]).toEqual(['/v1/reviews/mine', { orderId: OID }]);
    expect(Object.keys(elig).sort()).toEqual(['eligible', 'expiresAt', 'reviewed', 'windowOpen']);
  });
  it('dimensions read the existing lookups route (anonymous)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [{ id: 'd1', code: 'quality', name: 'गुणवत्ता', sortOrder: 1, meta: {} }] } }));
    expect((await client(fn).reviews.dimensions()).map((d) => d.code)).toEqual(['quality']);
    expect([new URL(calls[0].url).pathname, qs(calls[0])]).toEqual(['/v1/lookups/values', { type: 'review_dimension' }]);
    expect(header(calls[0], 'authorization')).toBeUndefined();
  });
  it('edit PATCHes under the key minted at render; flag POSTs { action: flag }; the named refusals arrive by code', async () => {
    const { fn, calls } = fakeFetch((c) => (c.init.method === 'PATCH' ? { status: 409, body: { error: { code: 'REVIEW_LOCKED', message: 'locked' } } }
      : { status: 403, body: { error: { code: 'REVIEW_FLAG_FORBIDDEN', message: 'no' } } }));
    await expect(client(fn).reviews.edit('r1', { stars: 3 }, 'review-edit:k1')).rejects.toMatchObject({ code: 'REVIEW_LOCKED', status: 409 });
    expect([calls[0].init.method, new URL(calls[0].url).pathname, header(calls[0], 'idempotency-key')]).toEqual(['PATCH', '/v1/reviews/r1', 'review-edit:k1']);
    await expect(client(fn).reviews.flag('r1')).rejects.toMatchObject({ code: 'REVIEW_FLAG_FORBIDDEN', status: 403 });
    expect([new URL(calls[1].url).pathname, JSON.parse(String(calls[1].init.body))]).toEqual(['/v1/reviews/r1/moderate', { action: 'flag' }]);
  });
});
