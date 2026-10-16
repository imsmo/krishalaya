// @krishalaya/sdk-js · PC-56 HOTFIX-7 — the contract this hotfix touches, pinned with an injected fake fetch (no network):
//   B5 the PUBLIC review reads are keyed by the ORGANISATION: `summary({ targetType: 'organisation' })` / `publicReviews({ targetType: 'organisation' })`
//      send `targetType=organisation` and NO targetId; a person's uuid (`targetUserId`, kept for mobile) still compiles and is sent as `seller` — the
//      API refuses it by name (REVIEW_PUBLIC_SELLER_REFUSED) and the SdkError carries that code;
//   B10 the public trace (v2) names the organisation and carries no uuid; TRACE_NOT_PUBLISHED arrives as its own code (≠ TRACE_SCAN_NOT_FOUND);
//   B25 the storefront flags type carries `traceability`.
import { createClient } from '../client';
import { SdkError } from '../errors';
import type { StorefrontFlags, TraceProvenance } from '../types';

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

describe('PC-56 HOTFIX-7 · SDK public reviews keyed by the organisation (B5)', () => {
  it('summary / publicReviews with targetType organisation send no person id', async () => {
    const { fn, calls } = fakeFetch((c) => (c.url.includes('summary') ? { body: { data: { count: 2, avgStars: 4.5 } } } : { body: { data: [{ stars: 5, body: 'ok' }], meta: { nextCursor: null } } }));
    expect(await client(fn).reviews.summary({ targetType: 'organisation' })).toEqual({ averageStars: 4.5, count: 2 });
    const page = await client(fn).reviews.publicReviews({ targetType: 'organisation', limit: 10 });
    expect(page.items[0]).not.toHaveProperty('id');
    expect(qs(calls[0])).toEqual({ targetType: 'organisation' });
    expect(qs(calls[1])).toEqual({ targetType: 'organisation', limit: '10' });
  });
  it('no argument but a person id (the mobile shape) still compiles and is sent as `seller`; the API\'s named refusal arrives as SdkError', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 422, body: { error: { code: 'REVIEW_PUBLIC_SELLER_REFUSED', message: 'per organisation' } } }));
    await expect(client(fn).reviews.summary({ targetUserId: 'u1' })).rejects.toMatchObject({ code: 'REVIEW_PUBLIC_SELLER_REFUSED', status: 422 });
    expect(qs(calls[0])).toEqual({ targetType: 'seller', targetId: 'u1' });
    expect(new SdkError('REVIEW_PUBLIC_BUYER_REFUSED', 422, 'x').code).toBe('REVIEW_PUBLIC_BUYER_REFUSED');
  });
});

describe('PC-56 HOTFIX-7 · SDK public trace v2 (B10 / B25)', () => {
  it('scan returns the organisation-named, uuid-free shape; TRACE_NOT_PUBLISHED is its own code', async () => {
    const v2: TraceProvenance = { qrToken: 'QR', organisation: { displayName: 'Anand FPO' }, createdAt: '2026-10-17T00:00:00.000Z', anchored: false, events: [{ eventCode: 'harvested', at: '2026-10-17T00:00:00.000Z', meta: { variety: 'GG-20' } }] };
    const ok = fakeFetch(() => ({ body: { data: v2 } }));
    expect(await client(ok.fn).traceability.scan('QR')).toEqual(v2);
    const off = fakeFetch(() => ({ status: 404, body: { error: { code: 'TRACE_NOT_PUBLISHED', message: 'not published' } } }));
    await expect(client(off.fn).traceability.scan('QR')).rejects.toMatchObject({ code: 'TRACE_NOT_PUBLISHED', status: 404 });
    const f: StorefrontFlags = { org_self_signup: false, traceability: true };
    expect(f.traceability).toBe(true);
  });
});
