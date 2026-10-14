// @krishalaya/sdk-js · PC-56 STORE-1c — the public plans read (founder D2), the flags type's platform switch (D1) and the signup call the
// storefront makes (B3), pinned with an injected fake fetch (no network).
import { createClient } from '../client';
import { SdkError } from '../errors';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call);
    const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;

describe('PC-56 STORE-1c · SDK', () => {
  it('plans(country): anonymous GET storefront/plans?country=IN; money stays minor STRINGS with currency + exponent; no bearer', async () => {
    const data = { country: 'IN', trialDays: 14, plans: [{ code: 'starter', name: 'Starter', monthlyMinor: '499900', annualMinor: '4999900', setupFeeMinor: '0', currency: 'INR', exponent: 2 }] };
    const { fn, calls } = fakeFetch(() => ({ body: { data } }));
    const c = createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', fetchImpl: fn });
    const r = await c.storefront.plans('IN');
    expect(r).toEqual(data);
    expect(typeof r.plans[0].monthlyMinor).toBe('string');
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/v1/storefront/plans');
    expect(Object.fromEntries(u.searchParams)).toEqual({ country: 'IN' });
    expect(calls[0].init.method).toBe('GET');
    expect(hdr(calls[0]).authorization).toBeUndefined();
  });

  it('plans() with no country sends no country — and the API\'s named refusal surfaces as SdkError 400 COUNTRY_REQUIRED', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 400, body: { error: { code: 'COUNTRY_REQUIRED', message: 'x', details: {} } } }));
    const e = await createClient({ baseUrl: 'https://api.test', fetchImpl: fn }).storefront.plans().catch((x) => x);
    expect(new URL(calls[0].url).search).toBe('');
    expect(e).toBeInstanceOf(SdkError);
    expect(e).toMatchObject({ status: 400, code: 'COUNTRY_REQUIRED' });
  });

  it('flags() on a platform page: only the platform switch comes back (no tenant → no group_lots)', async () => {
    const { fn } = fakeFetch(() => ({ body: { data: { org_self_signup: false } } }));
    const f = await createClient({ baseUrl: 'https://api.test', fetchImpl: fn }).storefront.flags();
    expect(f).toEqual({ org_self_signup: false });
    expect(f.group_lots).toBeUndefined();
  });

  it('tenancy.signUp: POST tenant-signup with the Idempotency-Key the page minted; SIGNUP_DISABLED surfaces as 403', async () => {
    const { fn, calls } = fakeFetch(() => ({ status: 403, body: { error: { code: 'SIGNUP_DISABLED', message: 'x', details: {} } } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    const key = '0190a8b2-0000-7000-8000-00000000c0de';
    const e = await c.tenancy.signUp({ phone: '+919876543210', code: '123456', fullName: 'Kavita', orgName: 'Bhavnagar Kisan FPC', orgTypeId: '0190a8b2-0000-7000-8000-0000000000f0', lang: 'gu' }, key).catch((x) => x);
    expect(calls[0].url).toBe('https://api.test/v1/tenant-signup');
    expect(calls[0].init.method).toBe('POST');
    expect(hdr(calls[0])['idempotency-key']).toBe(key);
    expect(e).toMatchObject({ status: 403, code: 'SIGNUP_DISABLED' });
  });
});
