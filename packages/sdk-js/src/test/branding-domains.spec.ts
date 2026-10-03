// @krishalaya/sdk-js · PC-56 TENANT-13d — the branding and domains resources: every route, method, idempotency key and body shape the
// console relies on (injected fake fetch, no network). The logo travels as the RAW file with its own content type, never JSON.
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

describe('branding (W191 + W2793–W2799)', () => {
  it('console / preview / saveDraft / logo / propose / rollback / confirm / refuse — every write keyed; the logo is raw bytes', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: { items: [] }, meta: { nextCursor: 'n1' } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.branding.console();
    expect(calls[0].url).toBe('https://api.test/v1/tenant-branding'); expect(calls[0].init.method).toBe('GET');
    await c.branding.preview({ primaryColor: '#1e6f3f' });
    expect(calls[1].url).toBe('https://api.test/v1/tenant-branding/preview'); expect(JSON.parse(calls[1].init.body as string)).toEqual({ primaryColor: '#1e6f3f' });
    await c.branding.saveDraft({ displayName: 'Anand FPO Mandi', reason: null }, 'k1');
    expect(calls[2].init.method).toBe('PUT'); expect(calls[2].url).toBe('https://api.test/v1/tenant-branding/draft'); expect(hdr(calls[2], 'idempotency-key')).toBe('k1');
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await c.branding.uploadLogo(bytes, 'image/png', 'k2');
    expect(calls[3].url).toBe('https://api.test/v1/tenant-branding/logo'); expect(hdr(calls[3], 'content-type')).toBe('image/png');
    expect(calls[3].init.body).toBe(bytes); expect(hdr(calls[3], 'idempotency-key')).toBe('k2');
    const h = await c.branding.history({ limit: 2 });
    expect(calls[4].url).toBe('https://api.test/v1/tenant-branding/history?limit=2'); expect(h.nextCursor).toBe('n1');
    await c.branding.propose('Board resolution 21/2026: our own name', 'k3');
    expect(calls[5].url).toBe('https://api.test/v1/tenant-branding/proposals'); expect(JSON.parse(calls[5].init.body as string)).toEqual({ reason: 'Board resolution 21/2026: our own name' });
    await c.branding.rollback(1, 'members found version two hard to read', 'k4');
    expect(calls[6].url).toBe('https://api.test/v1/tenant-branding/rollback'); expect(JSON.parse(calls[6].init.body as string)).toEqual({ version: 1, reason: 'members found version two hard to read' });
    await c.branding.confirm('p-1', 'k5');
    expect(calls[7].url).toBe('https://api.test/v1/tenant-branding/proposals/p-1/confirm'); expect(hdr(calls[7], 'idempotency-key')).toBe('k5');
    await c.branding.refuse('p-1', 'not yet', 'k6');
    expect(calls[8].url).toBe('https://api.test/v1/tenant-branding/proposals/p-1/refuse');
  });
});

describe('domains (W192 + W2591–W2597)', () => {
  it('list / preview / add / recheck / propose / confirm / refuse — the old one-person primary and DELETE are gone', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: { items: [] }, meta: { nextCursor: null } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.domains.list({ limit: 10 });
    expect(calls[0].url).toBe('https://api.test/v1/tenants/me/domains?limit=10');
    await c.domains.preview({ domain: 'mandi.anandfpo.in' });
    expect(calls[1].url).toBe('https://api.test/v1/tenants/me/domains/preview');
    await c.domains.add({ domain: 'mandi.anandfpo.in', reason: 'our printed receipts' }, 'k1');
    expect(calls[2].url).toBe('https://api.test/v1/tenants/me/domains'); expect(hdr(calls[2], 'idempotency-key')).toBe('k1');
    await c.domains.recheck('d-1');
    expect(calls[3].url).toBe('https://api.test/v1/tenants/me/domains/d-1/recheck'); expect(calls[3].init.method).toBe('POST');
    await c.domains.propose({ kind: 'remove', domainId: 'd-1', successorDomainId: 'd-0', reason: 'we moved to the new address' }, 'k2');
    expect(calls[4].url).toBe('https://api.test/v1/tenants/me/domains/proposals');
    expect(JSON.parse(calls[4].init.body as string)).toEqual({ kind: 'remove', domainId: 'd-1', successorDomainId: 'd-0', reason: 'we moved to the new address' });
    await c.domains.confirm('p-1', 'k3');
    expect(calls[5].url).toBe('https://api.test/v1/tenants/me/domains/proposals/p-1/confirm'); expect(hdr(calls[5], 'idempotency-key')).toBe('k3');
    await c.domains.refuse('p-1', 'not yet', 'k4');
    expect(calls[6].url).toBe('https://api.test/v1/tenants/me/domains/proposals/p-1/refuse');
    expect(Object.keys(c.domains)).not.toContain('makePrimary');
  });
});
