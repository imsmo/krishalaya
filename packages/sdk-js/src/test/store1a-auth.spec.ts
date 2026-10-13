// @krishalaya/sdk-js · PC-56 STORE-1a — the storefront sign-in contract, pinned with an injected fake fetch (no network):
//   B1  requestOtp is typed to the real answer and sends `channel` only when asked;
//   A3  verifyOtp / refresh omit `tenantId` when the caller has none (the API then reads the request's tenant context);
//   B6  logout / sessions / revokeSession hit the real routes with the bearer;
//   C4  storefront.tenant() is an anonymous GET that carries X-Tenant-Slug;
//   C2  the per-request header hook carries the signed client-IP headers, and can never override a reserved header.
import { createClient } from '../client';
import { SdkError } from '../errors';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call, n: number) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call, calls.length);
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status,
      headers: { get: () => null },
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => c.init.headers as Record<string, string>;
const body = (c: Call) => JSON.parse(String(c.init.body ?? '{}')) as Record<string, unknown>;

describe('PC-56 STORE-1a · SDK auth + storefront', () => {
  it('requestOtp returns {sent, resendInSec, ttlSec}; channel is sent only when given; the idempotency key rides the header', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { sent: true, resendInSec: 30, ttlSec: 300 } } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    const r = await c.auth.requestOtp('+919812345678', 'idem-1');
    expect(r).toEqual({ sent: true, resendInSec: 30, ttlSec: 300 });
    expect(calls[0].url).toBe('https://api.test/v1/auth/otp');
    expect(body(calls[0])).toEqual({ phone: '+919812345678' });
    expect(hdr(calls[0])['idempotency-key']).toBe('idem-1');
    await c.auth.requestOtp('+919812345678', 'idem-2', 'ivr');
    expect(body(calls[1])).toEqual({ phone: '+919812345678', channel: 'ivr' });
  });

  it('a refused channel surfaces as SdkError 409 OTP_CHANNEL_UNAVAILABLE with its details', async () => {
    const { fn } = fakeFetch(() => ({ status: 409, body: { error: { code: 'OTP_CHANNEL_UNAVAILABLE', message: 'x', details: { channel: 'ivr' } } } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    const e = await c.auth.requestOtp('+919812345678', 'k', 'ivr').catch((x) => x);
    expect(e).toBeInstanceOf(SdkError);
    expect(e).toMatchObject({ code: 'OTP_CHANNEL_UNAVAILABLE', status: 409, details: { channel: 'ivr' } });
  });

  it('verifyOtp / refresh omit tenantId when the caller has none, and send it when given', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r'.repeat(30), expiresInSec: 900 };
    const { fn, calls } = fakeFetch(() => ({ body: { data: tokens } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, tenantSlug: 'anand-fpo' });
    await c.auth.verifyOtp('+919812345678', '123456', 'k1');
    expect(body(calls[0])).toEqual({ phone: '+919812345678', code: '123456' });
    expect(hdr(calls[0])['x-tenant-slug']).toBe('anand-fpo');
    await c.auth.verifyOtp('+919812345678', '123456', 'k2', '00000000-0000-4000-8000-000000000001');
    expect(body(calls[1]).tenantId).toBe('00000000-0000-4000-8000-000000000001');
    await c.auth.refresh('r'.repeat(30));
    expect(body(calls[2])).toEqual({ refreshToken: 'r'.repeat(30) });
    await c.auth.refresh('r'.repeat(30), '00000000-0000-4000-8000-000000000001');
    expect(body(calls[3])).toEqual({ refreshToken: 'r'.repeat(30), tenantId: '00000000-0000-4000-8000-000000000001' });
    for (const call of calls) expect(hdr(call).authorization).toBeUndefined();   // anonymous
  });

  it('a wrong code is SdkError 401 OTP_INVALID carrying reason + attemptsLeft', async () => {
    const { fn } = fakeFetch(() => ({ status: 401, body: { error: { code: 'OTP_INVALID', message: 'x', details: { reason: 'wrong', attemptsLeft: 2 } } } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn });
    const e = await c.auth.verifyOtp('+919812345678', '000000', 'k').catch((x) => x);
    expect(e).toMatchObject({ code: 'OTP_INVALID', status: 401, details: { reason: 'wrong', attemptsLeft: 2 } });
  });

  it('logout / sessions / revokeSession use the real routes WITH the bearer', async () => {
    const { fn, calls } = fakeFetch((call) => ({ body: { data: call.url.endsWith('/sessions') ? [{ id: 's1', deviceFamily: 'android', current: false, lastSeenAt: 'x', createdAt: 'x', expiresAt: 'x', revokedAt: null }] : { ok: true } } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 'tok' });
    await c.auth.logout();
    expect(calls[0].url).toBe('https://api.test/v1/auth/logout');
    expect(calls[0].init.method).toBe('POST');
    expect(body(calls[0])).toEqual({ allDevices: false });
    expect(hdr(calls[0]).authorization).toBe('Bearer tok');
    const list = await c.auth.sessions();
    expect(list[0].deviceFamily).toBe('android');
    expect(calls[1].url).toBe('https://api.test/v1/auth/sessions');
    await c.auth.revokeSession('s/1');
    expect(calls[2].url).toBe('https://api.test/v1/auth/sessions/s%2F1');
    expect(calls[2].init.method).toBe('DELETE');
  });

  it('storefront.tenant() is an anonymous GET carrying X-Tenant-Slug', async () => {
    const t = { tenantId: 'id', slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' };
    const { fn, calls } = fakeFetch(() => ({ body: { data: t } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, tenantSlug: 'anand-fpo', getToken: () => 'tok' });
    expect(await c.storefront.tenant()).toEqual(t);
    expect(calls[0].url).toBe('https://api.test/v1/storefront/tenant');
    expect(hdr(calls[0])['x-tenant-slug']).toBe('anand-fpo');
    expect(hdr(calls[0]).authorization).toBeUndefined();
  });

  it('the per-request header hook carries the signed client-IP headers but never overrides a reserved header', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: { sent: true, resendInSec: 30, ttlSec: 300 } } }));
    let n = 0;
    const c = createClient({
      baseUrl: 'https://api.test', fetchImpl: fn, tenantSlug: 'anand-fpo',
      getHeaders: () => { n++; return { 'x-kv-client-ip': '203.0.113.9', 'x-kv-client-ts': String(1000 + n), 'x-kv-client-sig': 'ab'.repeat(32), 'x-tenant-slug': 'evil', 'idempotency-key': 'evil' }; },
    });
    await c.auth.requestOtp('+919812345678', 'idem-1');
    await c.auth.requestOtp('+919812345678', 'idem-2');
    expect(hdr(calls[0])['x-kv-client-ip']).toBe('203.0.113.9');
    expect(hdr(calls[0])['x-kv-client-sig']).toBe('ab'.repeat(32));
    expect(hdr(calls[0])['x-tenant-slug']).toBe('anand-fpo');
    expect(hdr(calls[0])['idempotency-key']).toBe('idem-1');
    expect(hdr(calls[1])['x-kv-client-ts']).toBe('1002');   // evaluated per request, not once per client
  });
});
