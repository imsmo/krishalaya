// @krishalaya/sdk-js · PC-56 TENANT-11c · A8 — the group-lots resource speaks the 11c API: one typed method per route, the
// Idempotency-Key where the API requires one (create · pledge · list · confirm), the pledge body `{ farmerUserId?, quantity }`
// with quantity a STRING, no typed gross anywhere. Pinned with an injected fake fetch (no network).
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
const json = (c: Call) => (c.init.body ? JSON.parse(String(c.init.body)) : undefined);
const B = 'https://api.test/v1/group-lots';

describe('A8 · group-lots resource ↔ the 11c API', () => {
  it('list carries box / status / sort=deadline / counts and returns the counts + total', async () => {
    const { c, calls } = client({ data: [{ id: 'g1', lotNo: 'GL-2026-0712-02' }], meta: { nextCursor: 'CUR', counts: { pledging: 4, settled: 11 }, total: 15 } });
    const r = await c.groupLots.list({ box: 'all', status: 'pledging', sort: 'deadline', counts: true, limit: 25 });
    expect(calls[0].url).toBe(`${B}?box=all&status=pledging&sort=deadline&counts=1&limit=25`);
    expect(r).toMatchObject({ nextCursor: 'CUR', counts: { pledging: 4, settled: 11 }, total: 15 });
  });
  it('get · lookups', async () => {
    const { c, calls } = client({ data: { cancelReasons: [{ code: 'other', defaultName: 'Other', textRequired: true }] } });
    await c.groupLots.get('g 1'); await c.groupLots.lookups();
    expect(calls.map((x) => x.url)).toEqual([`${B}/g%201`, `${B}/lookups`]);
  });
  it('create + pledge carry the Idempotency-Key; the pledge body is { farmerUserId?, quantity: string }', async () => {
    const { c, calls } = client({ data: { id: 'g1' } });
    await c.groupLots.create({ productId: 'p1', targetQuantity: '100', unitCode: 'quintal', pledgeDeadline: '2026-07-14T06:30:00.000Z', coordinationFeeBps: 50, coordinatorUserId: 'u2', consent: { channel: 'otp' } }, 'k-c');
    await c.groupLots.pledge('g1', { quantity: '18.5' }, 'k-p');
    await c.groupLots.pledge('g1', { farmerUserId: 'f1', quantity: '12' }, 'k-p2');
    expect(hdr(calls[0])['idempotency-key']).toBe('k-c');
    expect(json(calls[0])).toMatchObject({ coordinatorUserId: 'u2', consent: { channel: 'otp' } });
    expect(calls[1].url).toBe(`${B}/g1/pledges`); expect(hdr(calls[1])['idempotency-key']).toBe('k-p');
    expect(json(calls[1])).toEqual({ quantity: '18.5' });
    expect(json(calls[2])).toEqual({ farmerUserId: 'f1', quantity: '12' });
    expect(typeof json(calls[2]).quantity).toBe('string');
  });
  it('withdraw = DELETE pledges/me; ready / extend / nudge / cancel carry their reasons', async () => {
    const { c, calls } = client({ data: { id: 'g1' } });
    await c.groupLots.withdraw('g1');
    await c.groupLots.markReady('g1', 'list at 86 qtl');
    await c.groupLots.extend('g1', { pledgeDeadline: '2026-07-16T06:30:00.000Z', reason: 'three members close' });
    await c.groupLots.nudge('g1');
    await c.groupLots.cancel('g1', { reasonCode: 'other', reasonText: 'buyer backed out' });
    expect(calls.map((x) => `${x.init.method} ${x.url.replace(B, '')}`)).toEqual(['DELETE /g1/pledges/me', 'POST /g1/ready', 'POST /g1/extend', 'POST /g1/nudge', 'POST /g1/cancel']);
    expect(json(calls[1])).toEqual({ reason: 'list at 86 qtl' });
    expect(json(calls[3])).toEqual({});
    expect(json(calls[4])).toEqual({ reasonCode: 'other', reasonText: 'buyer backed out' });
  });
  it('list (Idempotency-Key, price per unit) · prepare (no body) · confirm (Idempotency-Key) · refuse (reason); no gross is ever sent', async () => {
    const { c, calls } = client({ data: { id: 'g1' } });
    await c.groupLots.listLot('g1', { pricePerUnitMinor: '1250000' }, 'k-l');
    await c.groupLots.prepareSettlement('g1');
    await c.groupLots.confirmSettlement('g1', 'k-s', 'checked');
    await c.groupLots.refuseSettlement('g1', 'pledges disputed');
    expect(calls.map((x) => x.url.replace(B, ''))).toEqual(['/g1/list', '/g1/settle/prepare', '/g1/settle/confirm', '/g1/settle/refuse']);
    expect(hdr(calls[0])['idempotency-key']).toBe('k-l'); expect(json(calls[0])).toEqual({ pricePerUnitMinor: '1250000' });
    expect(hdr(calls[2])['idempotency-key']).toBe('k-s'); expect(json(calls[2])).toEqual({ reason: 'checked' });
    expect(json(calls[3])).toEqual({ reason: 'pledges disputed' });
    for (const x of calls) expect(String(x.init.body ?? '')).not.toMatch(/grossProceedsMinor/);
    expect((c.groupLots as unknown as Record<string, unknown>).settle).toBeUndefined();
  });
});
