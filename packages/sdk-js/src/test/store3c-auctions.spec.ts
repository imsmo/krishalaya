// @krishalaya/sdk-js · PC-56 STORE-3c — the auctions / group-lots wave's contract, pinned with an injected fake fetch (no network): the PUBLIC
// auction list (anonymous unless `mine`, which sends the session), the PUBLIC group lot (always anonymous), the reshaped my-bids row (old
// fields kept, new ones optional — mobile compiles unchanged), the settlement outcome `cancelled_paid`, and the refusals as a closed list.
import { createClient } from '../client';
import { AUCTION_REFUSAL_CODES, AUCTION_STATUSES, GROUP_LOT_STATUSES } from '../types';
import type { MyBid, PublicAuctionCard, SettlementOutcome, StorefrontGroupLot } from '../types';

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = (async (url: unknown, init: unknown) => {
    const call = { url: String(url), init: (init ?? {}) as RequestInit }; calls.push(call);
    const r = handler(call); const status = r.status ?? 200;
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)) } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const hdr = (c: Call) => (c.init.headers ?? {}) as Record<string, string>;
const client = (fn: typeof fetch) => createClient({ baseUrl: 'https://api.test', getToken: () => 'tok', tenantSlug: 'anand-fpo', fetchImpl: fn });

const CARD: PublicAuctionCard = {
  auctionId: 'a1', auctionNo: 'AUC-2026-1016-01', status: 'live', kind: 'english_open', isOpen: true,
  lot: { title: 'Bold groundnut', unitCode: 'quintal', quantity: '60.000', organisation: { slug: 'anand-fpo', name: 'Anand FPO' } },
  currencyCode: 'INR', exponent: 2, reserveMet: true, hasBids: true, bidderCount: 5, sealedHidden: false, currentBidMinor: '632000', minNextBidMinor: '634000',
  startsAt: '2026-10-16T04:00:00.000Z', endsAt: '2026-10-16T12:30:00.000Z', decisionDueAt: null, antiSnipe: { triggerSec: 60, extendSec: 120 }, emd: { flatMinor: '1000000', pctBps: null },
};

describe('PC-56 STORE-3c · SDK auctions and group lots', () => {
  it('storefront.auctions(): the group + keyset, ANONYMOUS by default; `mine` sends the session and `mine=1`', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { data: [CARD], meta: { nextCursor: 'c2' } } }));
    const page = await client(fn).storefront.auctions({ group: 'ended', cursor: 'c1' });
    expect(page).toEqual({ items: [CARD], nextCursor: 'c2' });
    const u = new URL(calls[0].url);
    expect([u.pathname, u.searchParams.get('group'), u.searchParams.get('cursor'), u.searchParams.get('mine')]).toEqual(['/v1/storefront/auctions', 'ended', 'c1', null]);
    expect(hdr(calls[0]).authorization).toBeUndefined();
    await client(fn).storefront.auctions({ mine: true });
    const u2 = new URL(calls[1].url);
    expect([u2.searchParams.get('group'), u2.searchParams.get('mine'), hdr(calls[1]).authorization]).toEqual(['live', '1', 'Bearer tok']);
  });
  it('storefront.groupLot(): the public read, always anonymous', async () => {
    const lot: StorefrontGroupLot = { id: 'g1', lotNo: 'GL-01', product: { name: 'Groundnut' }, targetQuantity: '200.000', pledgedQuantity: '148.000', unitCode: 'quintal',
      progressBps: 7400, pledgerCount: 9, pledgeDeadline: '2026-10-20T12:30:00.000Z', status: 'pledging', coordinationFeeBps: 150, currencyCode: 'INR', exponent: 2,
      listingId: null, organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, cancelReasonCode: null };
    const { fn, calls } = fakeFetch(() => ({ body: { data: lot } }));
    expect(await client(fn).storefront.groupLot('g1')).toEqual(lot);
    expect([new URL(calls[0].url).pathname, hdr(calls[0]).authorization]).toEqual(['/v1/storefront/group-lots/g1', undefined]);
  });
  it('my-bids: the old per-bid fields still type an old row; the per-auction fields are optional; the outcome knows cancelled_paid', () => {
    const old: MyBid = { bidId: 'b', auctionId: 'a', listingId: 'l', amountMinor: '1', emdHeldMinor: '0', auctionStatus: 'live', endsAt: 'x', isWinning: false, createdAt: 'x', currencyCode: 'INR' };
    const now: MyBid = { ...old, myBestMinor: '1', leading: true, emd: { state: 'held', amountMinor: '1000000', at: '2026-10-16T05:00:00.000Z' },
      settlement: { orderId: 'o', outcome: 'cancelled_paid', collection: 'online', orderValueMinor: '13100000', emdAppliedMinor: '1000000', balanceDueMinor: '12100000',
        balanceDueAt: '2026-10-18T05:00:00.000Z', amountDueMinor: '12100000', outcomeAt: null } };
    const o: SettlementOutcome = 'cancelled_paid';
    expect([old.emd, now.emd?.state, now.settlement?.outcome, o]).toEqual([undefined, 'held', 'cancelled_paid', 'cancelled_paid']);
  });
  it('the closed lists: nine auction statuses, six group-lot statuses, the auction refusals by name', () => {
    expect(AUCTION_STATUSES).toHaveLength(9);
    expect(AUCTION_STATUSES).toEqual(expect.arrayContaining(['extended', 'awaiting_approval', 'failed_reserve', 'defaulted']));
    expect(GROUP_LOT_STATUSES).toEqual(['pledging', 'ready', 'listed', 'sold', 'settled', 'cancelled']);
    expect(AUCTION_REFUSAL_CODES).toEqual(expect.arrayContaining(['BID_SEALED_MUST_RAISE', 'ORDER_PAYMENT_AMOUNT_MISMATCH']));
    expect(AUCTION_REFUSAL_CODES).toHaveLength(9);
  });
});
