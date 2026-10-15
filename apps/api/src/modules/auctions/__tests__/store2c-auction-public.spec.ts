// modules/auctions/__tests__/store2c-auction-public.spec.ts · PC-56 STORE-2c · B7 (survey C-3 / B27 / F-23, founder 2a D1) — the PUBLIC auction read,
// against in-memory fakes: every figure is the SERVER's (the aggregate's own rules); the reserve is met / not met only (never its amount);
// the bid history has NO bidder identity; a sealed auction hides amounts while open; a viewer's own facts only for the viewer. The live proof
// (anonymous over HTTP, the flag OFF → 404, a bid without a session → 401) is apps/api/src/__tests__/store2c-checkout.integration.spec.ts (8).
import { Auction } from '../domain/auction.entity';
import { AuctionPublicReadModel, PUBLIC_BID_HISTORY_LIMIT } from '../read-models/auction-public.read-model';
import { AuctionNotFoundError } from '../domain/auctions.errors';

const T0 = new Date(Date.now() - 3600_000); const END = new Date(Date.now() + 3600_000);
const ID = '0199e2c4-0000-7000-8000-00000000a001';
function auction(o: Record<string, unknown> = {}) {
  const a = Auction.create({ id: ID, tenantId: 't1', listingId: 'l1', kind: 'english_open', quantity: '60.000', unitCode: 'quintal',
    startPriceMinor: 600_000n, reservePriceMinor: 630_000n, minIncrementMinor: 2_000n, emdMinor: 0n, emdPctBps: 200, startsAt: T0, endsAt: END,
    autoExtendSecs: 120, extendTriggerSecs: 90, ...o } as never);
  a.open();
  return a;
}
const bidRows = (amounts: bigint[], who: string[]) => amounts.map((m, i) => ({ id: `b${i}`, bidderUserId: who[i], amountMinor: m.toString(), createdAt: new Date(T0.getTime() + i * 60_000), createdAtRaw: '' }));
function read(a: Auction, rows: ReturnType<typeof bidRows>, lot: Record<string, unknown> | null = {}) {
  const high = rows.length ? rows.map((r) => BigInt(r.amountMinor)).reduce((x, y) => (y > x ? y : x)) : null;
  const replica = { forTenant: () => ({ query: async (sql: string, p: unknown[]) => {
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: rows.length }] };
    if (/minor_units/.test(sql)) return { rows: [{ minor_units: 2 }] };
    if (/max\(amount_minor\)/.test(sql)) { const mine = rows.filter((r) => r.bidderUserId === p[2]).map((r) => BigInt(r.amountMinor)); return { rows: [{ best: mine.length ? mine.reduce((x, y) => (y > x ? y : x)).toString() : null }] }; }
    if (/bidder_user_id FROM bids WHERE tenant_id=\$1 AND id=\$2/.test(sql)) return { rows: rows.filter((r) => r.id === p[1]).map((r) => ({ bidder_user_id: r.bidderUserId })) };
    return { rows: [] };
  } }) };
  const auctions = { getVisible: async () => a };
  const bids = { statsFor: async () => new Map([[ID, { highMinor: high, bidders: new Set(rows.map((r) => r.bidderUserId)).size }]]),
    listFor: async () => [...rows].reverse() };
  const listings = { auctionLotFacts: async () => (lot === null ? null : { title: 'Bold Groundnut 60 qtl', unitCode: 'quintal', currencyCode: 'INR',
    organisation: { slug: 'girnar', name: 'Girnar Agro FPO' }, district: 'Junagadh', sellerSuspended: false, ...lot }) };
  return new AuctionPublicReadModel(replica as never, auctions as never, bids as never, listings as never);
}

describe('STORE-2c · B7 — the public auction read', () => {
  it('no bids: reserve NOT met (boolean), min next = the start price, lot totals from the server, no history', async () => {
    const v = await read(auction(), []).view('t1', ID, null);
    expect([v.reserveMet, v.hasBids, v.currentBidMinor, v.lotTotalMinor, v.minNextBidMinor, v.minNextLotTotalMinor]).toEqual([false, false, null, null, '600000', '36000000']);
    expect([v.bids, v.viewer, v.currencyCode, v.exponent, v.isOpen]).toEqual([[], null, 'INR', 2, true]);
  });
  it('bids: the current bid, min next = current + the increment, lot total = 60 × current — all server figures; reserve met only as a boolean', async () => {
    const v = await read(auction(), bidRows([620_000n, 632_000n], ['u1', 'u2'])).view('t1', ID, null);
    expect([v.currentBidMinor, v.minNextBidMinor, v.lotTotalMinor, v.minNextLotTotalMinor, v.reserveMet]).toEqual(['632000', '634000', '37920000', '38040000', true]);
    expect(JSON.stringify(v)).not.toContain('630000');            // the reserve AMOUNT never leaves the read
    expect(Object.keys(v)).not.toContain('reservePriceMinor');
  });
  it('the bid history carries the time and the amount — NO bidder identity of any kind (no id, label, mask or name)', async () => {
    const v = await read(auction(), bidRows([620_000n, 632_000n], ['u-secret-1', 'u-secret-2'])).view('t1', ID, null);
    expect(v.bids.map((b) => Object.keys(b).sort())).toEqual([['amountMinor', 'at'], ['amountMinor', 'at']]);
    expect(JSON.stringify(v)).not.toMatch(/u-secret|B1|bidder/);
    expect(PUBLIC_BID_HISTORY_LIMIT).toBe(20);
  });
  it('the anti-snipe rule and the EMD rule are the auction\'s own (never a literal); the balance window is the domain\'s', async () => {
    const v = await read(auction(), []).view('t1', ID, null);
    expect([v.antiSnipe, v.emd, v.balanceDueHours]).toEqual([{ triggerSec: 90, extendSec: 120 }, { flatMinor: null, pctBps: 200 }, 48]);
  });
  it('a viewer sees ONLY their own facts: their best bid and whether it leads', async () => {
    const r = read(auction(), bidRows([620_000n, 632_000n], ['u1', 'u2']));
    expect((await r.view('t1', ID, 'u2')).viewer).toEqual({ bestBidMinor: '632000', leading: true, won: false, orderId: null });
    expect((await r.view('t1', ID, 'u1')).viewer).toEqual({ bestBidMinor: '620000', leading: false, won: false, orderId: null });
  });
  it('a SEALED auction hides amounts and the current bid while open (and says nothing about the reserve)', async () => {
    const v = await read(auction({ kind: 'sealed' }), bidRows([650_000n], ['u1'])).view('t1', ID, null);
    expect([v.sealedHidden, v.currentBidMinor, v.reserveMet, v.bids[0].amountMinor, v.minNextBidMinor]).toEqual([true, null, false, null, '600000']);
  });
  it('a suspended seller\'s auction, an unknown lot or a malformed id is 404', async () => {
    await expect(read(auction(), [], { sellerSuspended: true }).view('t1', ID, null)).rejects.toBeInstanceOf(AuctionNotFoundError);
    await expect(read(auction(), [], null).view('t1', ID, null)).rejects.toBeInstanceOf(AuctionNotFoundError);
    await expect(read(auction(), []).view('t1', 'not-a-uuid', null)).rejects.toBeInstanceOf(AuctionNotFoundError);
  });
});
