// @krishalaya/sdk-js · PC-56 TENANT-11d · A5 — the requirements + responses resources speak the 11d API: one typed method per
// route (responses get / shortlist / accept / reject were routes with no SDK method — survey F-14), PATCH update, the desk's
// pooled-quote routes, the Idempotency-Key where the API requires one, the list's counts / total. Pinned with a fake fetch.
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
const R = 'https://api.test/v1/requirements';
const S = 'https://api.test/v1/responses';

describe('A5 · requirements resource ↔ the 11d API', () => {
  it('list carries box=all / status / sort=need_by / counts and returns counts + total', async () => {
    const { c, calls } = client({ data: [{ id: 'r1', reqNo: 'REQ-0711-08', responsesCount: 2 }], meta: { nextCursor: 'CUR', counts: { open: 14, fulfilled: 31 }, total: 45 } });
    const p = await c.requirements.list({ box: 'all', status: 'open', sort: 'need_by', counts: true, limit: 25 });
    expect(calls[0].url).toBe(`${R}?box=all&status=open&sort=need_by&counts=1&limit=25`);
    expect(p).toMatchObject({ nextCursor: 'CUR', counts: { open: 14, fulfilled: 31 }, total: 45 });
    expect(p.items[0].responsesCount).toBe(2);
  });
  it('create carries the Idempotency-Key and the desk\'s onBehalf { buyerUserId, consent }', async () => {
    const { c, calls } = client({ data: { id: 'r1' } });
    await c.requirements.create({ title: 'GG-20', quantity: '40', unitCode: 'quintal', onBehalf: { buyerUserId: 'b1', consent: { channel: 'voice', mediaId: 'm1' } } }, 'k-1');
    expect(hdr(calls[0])['idempotency-key']).toBe('k-1');
    expect(json(calls[0])).toMatchObject({ onBehalf: { buyerUserId: 'b1', consent: { channel: 'voice', mediaId: 'm1' } } });
  });
  it('update is a PATCH; close carries the reason when given', async () => {
    const { c, calls } = client({ data: { id: 'r1' } });
    await c.requirements.update('r 1', { quantity: '45' });
    await c.requirements.close('r1', 'Posted twice'); await c.requirements.close('r1');
    expect(calls[0].init.method).toBe('PATCH'); expect(calls[0].url).toBe(`${R}/r%201`); expect(json(calls[0])).toEqual({ quantity: '45' });
    expect(json(calls[1])).toEqual({ reason: 'Posted twice' }); expect(json(calls[2])).toEqual({});
  });
  it('quote carries listingId + the Idempotency-Key', async () => {
    const { c, calls } = client({ data: { id: 'q1' } });
    await c.requirements.quote('r1', { quotedPriceMinor: '635000', quantity: '25', listingId: 'l3' }, 'k-q');
    expect(calls[0].url).toBe(`${R}/r1/responses`); expect(hdr(calls[0])['idempotency-key']).toBe('k-q');
    expect(json(calls[0])).toEqual({ quotedPriceMinor: '635000', quantity: '25', listingId: 'l3' });
  });
  it('the member-stock read and every pooled-quote route', async () => {
    const { c, calls } = client({ data: {} });
    await c.requirements.matches('r1'); await c.requirements.groups('r1'); await c.requirements.group('r1', 'g1'); await c.requirements.createGroup('r1');
    await c.requirements.addLine('r1', 'g1', { listingId: 'l1', quantity: '17' });
    await c.requirements.editLine('r1', 'g1', 'x1', { priceMinor: '634500' });
    await c.requirements.removeLine('r1', 'g1', 'x1');
    await c.requirements.recordConsent('r1', 'g1', 'x2', { channel: 'app' });
    await c.requirements.sendGroup('r1', 'g1'); await c.requirements.withdrawGroup('r1', 'g1', 'buyer bought elsewhere');
    expect(calls.map((x) => `${x.init.method} ${x.url.replace(R, '')}`)).toEqual([
      'GET /r1/matches', 'GET /r1/response-groups', 'GET /r1/response-groups/g1', 'POST /r1/response-groups', 'POST /r1/response-groups/g1/lines',
      'PATCH /r1/response-groups/g1/lines/x1', 'POST /r1/response-groups/g1/lines/x1/remove', 'POST /r1/response-groups/g1/lines/x2/consent',
      'POST /r1/response-groups/g1/send', 'POST /r1/response-groups/g1/withdraw',
    ]);
    expect(json(calls[4])).toEqual({ listingId: 'l1', quantity: '17' }); expect(json(calls[7])).toEqual({ channel: 'app' }); expect(json(calls[9])).toEqual({ reason: 'buyer bought elsewhere' });
  });
});

describe('A5 · responses resource (F-14: four routes with no SDK method)', () => {
  it('get · shortlist · accept by quantity · reject, with the buyer\'s consent when the desk acts', async () => {
    const { c, calls } = client({ data: { id: 'q1' } });
    await c.responses.get('q1'); await c.responses.shortlist('q1', { channel: 'otp' });
    await c.responses.accept('q1', { quantity: '20' }); await c.responses.reject('q1');
    await c.responses.acceptGroup('g1', { channel: 'otp' }); await c.responses.rejectGroup('g1');
    expect(calls.map((x) => `${x.init.method} ${x.url.replace(S, '')}`)).toEqual(['GET /q1', 'POST /q1/shortlist', 'POST /q1/accept', 'POST /q1/reject', 'POST /groups/g1/accept', 'POST /groups/g1/reject']);
    expect(json(calls[1])).toEqual({ consent: { channel: 'otp' } }); expect(json(calls[2])).toEqual({ quantity: '20' }); expect(json(calls[3])).toEqual({});
  });
});
