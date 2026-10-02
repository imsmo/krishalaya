// @krishalaya/sdk-js · PC-56 TENANT-11a · A13 — the auctions resource speaks the API's contract. At d0f4afe `approve` sent no
// Idempotency-Key (the API now requires one — W139 "idempotent (double-click safe)"), `cancel` sent `{}` (the API now
// requires a reason, sent to every bidder), there was no `update`, `pauseEntry` or `resumeEntry`, and `list` could not ask
// for a grouped tab. Pinned here with an injected fake fetch (no network).
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

describe('A13 · auctions resource ↔ the real API', () => {
  it('list asks for a grouped tab and returns counts + total', async () => {
    const { c, calls } = client({ data: [{ auctionId: 'a1', quantity: '200.000', unitCode: 'kg' }], meta: { nextCursor: 'cur', total: 3, counts: { live: 1, scheduled: 2, awaiting_approval: 0, ended: 0, cancelled: 0 } } });
    const p = await c.auctions.list({ group: 'live', limit: 25 });
    expect(calls[0].url).toBe('https://api.test/v1/auctions?group=live&limit=25');
    expect(p).toMatchObject({ nextCursor: 'cur', total: 3, counts: { live: 1, scheduled: 2 } });
  });
  it('create carries the Idempotency-Key, a per-unit price and (for the desk) the seller + consent', async () => {
    const { c, calls } = client({ data: { auctionId: 'a1', auctionNo: 'AUC-2026-0713-01' } });
    await c.auctions.create({ listingId: 'l1', startPriceMinor: '61000', startsAt: 's', endsAt: 'e', decisionWindowHours: 24, sellerUserId: 'u9', consent: { channel: 'voice', mediaId: 'm1' } }, 'idem-a1');
    expect(calls[0].init.method).toBe('POST');
    expect(hdr(calls[0])['idempotency-key']).toBe('idem-a1');
    expect(json(calls[0])).toMatchObject({ startPriceMinor: '61000', sellerUserId: 'u9', consent: { channel: 'voice', mediaId: 'm1' } });
  });
  it('approve sends the Idempotency-Key (and the consent when staff decide)', async () => {
    const { c, calls } = client({ data: { auctionId: 'a1', status: 'settled', orderId: 'o1' } });
    await c.auctions.approve('a1', 'idem-ap');
    expect(calls[0].url).toBe('https://api.test/v1/auctions/a1/approve');
    expect(hdr(calls[0])['idempotency-key']).toBe('idem-ap');
    expect(json(calls[0])).toEqual({});
    await c.auctions.approve('a1', 'idem-ap2', { channel: 'otp' });
    expect(json(calls[1])).toEqual({ consent: { channel: 'otp' } });
  });
  it('cancel sends the reason; pause/resume entry send theirs; update PATCHes', async () => {
    const { c, calls } = client({ data: { ok: true } });
    await c.auctions.cancel('a1', 'quality complaint on the lot');
    expect(calls[0].url).toBe('https://api.test/v1/auctions/a1/cancel');
    expect(json(calls[0])).toEqual({ reason: 'quality complaint on the lot' });
    await c.auctions.pauseEntry('a1', 'checking a ring');
    expect(calls[1].url).toBe('https://api.test/v1/auctions/a1/pause-entry');
    await c.auctions.resumeEntry('a1', 'ring cleared');
    expect(calls[2].url).toBe('https://api.test/v1/auctions/a1/resume-entry');
    expect(json(calls[2])).toEqual({ reason: 'ring cleared' });
    await c.auctions.update('a1', { reservePriceMinor: null });
    expect(calls[3].init.method).toBe('PATCH');
  });
  it('listBids returns the masked stream meta (bidders, sealed, revealed)', async () => {
    const { c } = client({ data: [{ id: 'b1', bidderLabel: 'B1', bidderUserId: null, amountMinor: '65500', isMine: false }], meta: { nextCursor: null, bidders: 4, sealedHidden: false, identitiesRevealed: false } });
    const p = await c.auctions.listBids('a1');
    expect(p).toMatchObject({ bidders: 4, sealedHidden: false, identitiesRevealed: false });
    expect(p.items[0].bidderLabel).toBe('B1');
  });
});
