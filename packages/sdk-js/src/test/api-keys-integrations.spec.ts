// @krishalaya/sdk-js · PC-56 TENANT-13c — the apiKeys and integrations resources: every route, method, idempotency key and body shape the
// console relies on (injected fake fetch, no network). The old one-call connect / disconnect are gone: every provider change is a proposal.
import { createClient } from '../client';

type Call = { url: string; init: RequestInit };
function fakeFetch(body: (n: number) => unknown) {
  const calls: Call[] = [];
  const fn = (async (url: any, init: any) => {
    calls.push({ url: String(url), init: init ?? {} });
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body(calls.length)) } as any;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call, k: string) => (c.init.headers as Record<string, string>)[k];

describe('apiKeys (W190)', () => {
  it('list with cursor; scopes; preview; create / revoke / confirm / refuse — every write keyed', async () => {
    const { fn, calls } = fakeFetch((n) => (n === 4 ? { data: { id: 'k', key: 'kv_live_a1b2c3d4_' + 'A'.repeat(32), keyShown: true } } : { data: { items: [] } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.apiKeys.list({ cursor: 'c1', limit: 50 });
    expect(calls[0].url).toBe('https://api.test/v1/api-keys?cursor=c1&limit=50'); expect(calls[0].init.method).toBe('GET');
    await c.apiKeys.scopes();
    expect(calls[1].url).toBe('https://api.test/v1/api-keys/scopes');
    await c.apiKeys.preview({ name: 'ERP sync', scopes: ['orders.read'] });
    expect(calls[2].url).toBe('https://api.test/v1/api-keys/preview'); expect(calls[2].init.method).toBe('POST');
    const created = await c.apiKeys.create({ name: 'ERP sync', scopes: ['orders.read'], ratePerHour: 1000 }, 'k1');
    expect(calls[3].url).toBe('https://api.test/v1/api-keys'); expect(hdr(calls[3], 'idempotency-key')).toBe('k1');
    expect(JSON.parse(calls[3].init.body as string)).toEqual({ name: 'ERP sync', scopes: ['orders.read'], ratePerHour: 1000 });
    expect(created.keyShown).toBe(true);
    await c.apiKeys.revoke('id-1', 'vendor offboarded', 'k2');
    expect(calls[4].url).toBe('https://api.test/v1/api-keys/id-1/revoke'); expect(hdr(calls[4], 'idempotency-key')).toBe('k2');
    expect(JSON.parse(calls[4].init.body as string)).toEqual({ reason: 'vendor offboarded' });
    await c.apiKeys.proposals({ status: 'proposed' });
    expect(calls[5].url).toBe('https://api.test/v1/api-keys/proposals?status=proposed');
    await c.apiKeys.confirm('p-1', 'k3');
    expect(calls[6].url).toBe('https://api.test/v1/api-keys/proposals/p-1/confirm'); expect(hdr(calls[6], 'idempotency-key')).toBe('k3');
    await c.apiKeys.refuse('p-1', 'we do not phone members from a script', 'k4');
    expect(calls[7].url).toBe('https://api.test/v1/api-keys/proposals/p-1/refuse'); expect(JSON.parse(calls[7].init.body as string)).toEqual({ reason: 'we do not phone members from a script' });
    // the key never goes into a URL
    for (const call of calls) expect(call.url).not.toMatch(/kv_live_/);
  });
});

describe('integrations (W187)', () => {
  it('providers / list GET; preview; propose (credential in the body, keyed); confirm / refuse; proposals with filters', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: { items: [] } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.integrations.providers(); await c.integrations.list();
    expect(calls.map((x) => x.url)).toEqual(['https://api.test/v1/integrations/providers', 'https://api.test/v1/integrations']);
    await c.integrations.preview({ providerCode: 'razorpay', kind: 'connect' });
    expect(calls[2].url).toBe('https://api.test/v1/integrations/preview');
    const credential = { keyId: 'rzp_live_ABCDEFGH12', keySecret: 'S3cretS3cretS3cret99' };
    await c.integrations.propose({ providerCode: 'razorpay', kind: 'connect', credential, reason: 'connect our own Razorpay account' }, 'k1');
    expect(calls[3].url).toBe('https://api.test/v1/integrations/proposals'); expect(hdr(calls[3], 'idempotency-key')).toBe('k1');
    expect(JSON.parse(calls[3].init.body as string).credential).toEqual(credential);
    expect(calls[3].url).not.toContain('S3cret');
    await c.integrations.proposals({ status: 'open', providerCode: 'razorpay', limit: 10 });
    expect(calls[4].url).toBe('https://api.test/v1/integrations/proposals?status=open&providerCode=razorpay&limit=10');
    await c.integrations.confirm('p-1', 'k2');
    expect(calls[5].url).toBe('https://api.test/v1/integrations/proposals/p-1/confirm'); expect(hdr(calls[5], 'idempotency-key')).toBe('k2');
    await c.integrations.refuse('p-1', 'not ready for our own sender yet', 'k3');
    expect(calls[6].url).toBe('https://api.test/v1/integrations/proposals/p-1/refuse');
    expect((c.integrations as unknown as Record<string, unknown>).connect).toBeUndefined();
    expect((c.integrations as unknown as Record<string, unknown>).disconnect).toBeUndefined();
  });
});
