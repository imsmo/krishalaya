// @krishalaya/sdk-js · PC-56 TENANT-10b · F-7 — the promotions resource speaks the REAL API's contract. Every call below
// 400'd against the API at cd6dd86: `create` / `createCoupon` sent no Idempotency-Key, `setActive` sent `{ active }` against
// a strict `{ isActive }`, `coupons()` sent no `promotionId`. Pinned here with an injected fake fetch (no network).
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: unknown) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (body: unknown) => { const f = fakeFetch(body); return { c: createClient({ baseUrl: 'https://api.test', fetchImpl: f.fn, getToken: () => 'tok' }), calls: f.calls }; };
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const json = (c: Call) => JSON.parse(String(c.init.body));

describe('F-7 · promotions resource ↔ the real API', () => {
  it('create sends the Idempotency-Key and a budget', async () => {
    const { c, calls } = client({ data: { id: 'p1', status: 'scheduled', budgetMinor: '500000', spentMinor: '0' } });
    const p = await c.promotions.create({ promoType: 'discount', defaultName: 'Kharif 5%', rules: { discountType: 'percent', percentOff: 5 }, budgetMinor: '500000', startsAt: '2026-07-01T00:00:00Z', endsAt: '2026-07-31T00:00:00Z' }, 'idem-p1');
    expect(calls[0].url).toBe('https://api.test/v1/promotions');
    expect(calls[0].init.method).toBe('POST');
    expect(hdr(calls[0])['idempotency-key']).toBe('idem-p1');
    expect(json(calls[0]).budgetMinor).toBe('500000');
    expect(p.spentMinor).toBe('0');
  });
  it('setActive sends { isActive, reason } (never { active })', async () => {
    const { c, calls } = client({ data: { id: 'p1', status: 'paused' } });
    await c.promotions.setActive('p1', false, 'stock ran out');
    expect(calls[0].url).toBe('https://api.test/v1/promotions/p1/active');
    expect(json(calls[0])).toEqual({ isActive: false, reason: 'stock ran out' });
  });
  it('createCoupon sends the Idempotency-Key; coupons(promotionId) sends the required promotionId', async () => {
    const a = client({ data: { id: 'c1', code: 'KHARIF5' } });
    await a.c.promotions.createCoupon({ promotionId: 'p1', code: 'KHARIF5', perUserLimit: 1 }, 'idem-c1');
    expect(a.calls[0].url).toBe('https://api.test/v1/coupons');
    expect(hdr(a.calls[0])['idempotency-key']).toBe('idem-c1');
    const b = client({ data: [], meta: { nextCursor: null } });
    await b.c.promotions.coupons('p1');
    expect(b.calls[0].url).toBe('https://api.test/v1/coupons?promotionId=p1&limit=50');
  });
  it('the new reads: get · summary · allCoupons (total) · couponRedemptions · review · reviewCoupon', async () => {
    const g = client({ data: { id: 'p1' } }); await g.c.promotions.get('p1'); expect(g.calls[0].url).toBe('https://api.test/v1/promotions/p1');
    const s = client({ data: { year: 2026, spentYearMinor: '4126000' } }); expect((await s.c.promotions.summary()).spentYearMinor).toBe('4126000');
    expect(s.calls[0].url).toBe('https://api.test/v1/promotions/summary');
    const all = client({ data: [{ id: 'c1', code: 'KHARIF5', maxUses: null, redeemedValueMinor: '2840000' }], meta: { nextCursor: 'n1', total: 9 } });
    const page = await all.c.promotions.allCoupons({ limit: 3 });
    expect(all.calls[0].url).toBe('https://api.test/v1/coupons/all?limit=3');
    expect(page).toMatchObject({ nextCursor: 'n1', total: 9 });
    expect(page.items[0].maxUses).toBeNull();
    const r = client({ data: [], meta: { nextCursor: null } });
    await r.c.promotions.couponRedemptions('c1', { cursor: 'k' });
    expect(r.calls[0].url).toBe('https://api.test/v1/coupons/c1/redemptions?cursor=k&limit=20');
    const rv = client({ data: { ready: false, refusals: [{ field: 'budgetMinor', code: 'BUDGET_REQUIRED' }] } });
    expect((await rv.c.promotions.review({ defaultName: 'x' })).refusals[0].code).toBe('BUDGET_REQUIRED');
    expect(rv.calls[0].url).toBe('https://api.test/v1/promotions/review');
    const rc = client({ data: { ready: true } }); await rc.c.promotions.reviewCoupon({ code: 'K5' });
    expect(rc.calls[0].url).toBe('https://api.test/v1/coupons/review');
  });
  it('deleteCoupon is a DELETE carrying the reason', async () => {
    const { c, calls } = client({ data: { id: 'c1', deleted: true } });
    await c.promotions.deleteCoupon('c1', 'printed on the wrong poster');
    expect(calls[0].url).toBe('https://api.test/v1/coupons/c1');
    expect(calls[0].init.method).toBe('DELETE');
    expect(json(calls[0])).toEqual({ reason: 'printed on the wrong poster' });
  });
});
