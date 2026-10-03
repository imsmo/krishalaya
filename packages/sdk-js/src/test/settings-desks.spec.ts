// @krishalaya/sdk-js · PC-56 TENANT-13b — the organisation-settings and desks resources: every route, method, idempotency key and body
// shape the console relies on (injected fake fetch, no network).
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

describe('orgSettings (W186)', () => {
  it('registry GET; put PUT with reason + idempotency; preview POST; propose / confirm / refuse; history with cursor; languages PUT', async () => {
    const { fn, calls } = fakeFetch((n) => (n === 5 ? { data: [], meta: { nextCursor: 'c2' } } : { data: { items: [], ok: true } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.orgSettings.registry();
    expect(calls[0].url).toBe('https://api.test/v1/tenant-settings'); expect(calls[0].init.method).toBe('GET');
    await c.orgSettings.put({ key: 'plans.usage_alert_threshold_pct', value: 80, reason: 'warn earlier' }, 'k1');
    expect(calls[1].init.method).toBe('PUT'); expect(hdr(calls[1], 'idempotency-key')).toBe('k1');
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ key: 'plans.usage_alert_threshold_pct', value: 80, reason: 'warn earlier' });
    await c.orgSettings.preview({ key: 'governance.quorum_bp', value: 5000, reason: 'x' });
    expect(calls[2].url).toBe('https://api.test/v1/tenant-settings/preview'); expect(calls[2].init.method).toBe('POST');
    await c.orgSettings.propose({ key: 'governance.quorum_bp', value: 5000, reason: 'twenty or more characters' }, 'k2');
    expect(calls[3].url).toBe('https://api.test/v1/tenant-settings/proposals'); expect(hdr(calls[3], 'idempotency-key')).toBe('k2');
    const page = await c.orgSettings.history({ key: 'governance.quorum_bp', limit: 10, cursor: 'c1' });
    expect(calls[4].url).toBe('https://api.test/v1/tenant-settings/history?key=governance.quorum_bp&cursor=c1&limit=10');
    expect(page.nextCursor).toBe('c2');
    await c.orgSettings.confirm('p-1', 'k3');
    expect(calls[5].url).toBe('https://api.test/v1/tenant-settings/proposals/p-1/confirm'); expect(hdr(calls[5], 'idempotency-key')).toBe('k3');
    await c.orgSettings.refuse('p-1', 'the AGM has not voted on it yet', 'k4');
    expect(JSON.parse(calls[6].init.body as string)).toEqual({ reason: 'the AGM has not voted on it yet' });
    await c.orgSettings.putLanguages({ enabled: ['gu', 'hi'], primary: 'gu' }, 'k5');
    expect(calls[7].url).toBe('https://api.test/v1/tenant-settings/languages'); expect(calls[7].init.method).toBe('PUT');
  });
  it('tenantConfig.settings() keeps the key → value view over the new registry shape', async () => {
    const { fn } = fakeFetch(() => ({ data: { items: [{ key: 'branding.display_name', value: 'Anand', type: 'string' }] } }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    expect(await c.tenantConfig.settings()).toEqual([{ key: 'branding.display_name', value: 'Anand' }]);
  });
});

describe('desks (W185)', () => {
  it('board GET; preview / propose / confirm / refuse; members add / remove — idempotent', async () => {
    const { fn, calls } = fakeFetch(() => ({ data: {} }));
    const c = createClient({ baseUrl: 'https://api.test', fetchImpl: fn, getToken: () => 't' });
    await c.desks.board();
    expect(calls[0].url).toBe('https://api.test/v1/desks');
    await c.desks.preview({ kind: 'create', code: 'support_desk', name: 'Support', permissions: ['support.handle'], reason: 'x' });
    expect(calls[1].url).toBe('https://api.test/v1/desks/preview');
    await c.desks.propose({ kind: 'install_templates', reason: 'install the standard desks before kharif' }, 'd1');
    expect(calls[2].url).toBe('https://api.test/v1/desks/proposals'); expect(hdr(calls[2], 'idempotency-key')).toBe('d1');
    await c.desks.confirm('dp-1', 'd2');
    expect(calls[3].url).toBe('https://api.test/v1/desks/proposals/dp-1/confirm');
    await c.desks.refuse('dp-1', 'not this season — after the AGM', 'd3');
    expect(calls[4].url).toBe('https://api.test/v1/desks/proposals/dp-1/refuse');
    await c.desks.addMember('desk-1', 'u-1', null, 'd4');
    expect(calls[5].url).toBe('https://api.test/v1/desks/desk-1/members'); expect(JSON.parse(calls[5].init.body as string)).toEqual({ userId: 'u-1', reason: null });
    await c.desks.removeMember('desk-1', 'u-1', 'shift ended', 'd5');
    expect(calls[6].url).toBe('https://api.test/v1/desks/desk-1/members/u-1/remove'); expect(hdr(calls[6], 'idempotency-key')).toBe('d5');
  });
});
