// apps/web-storefront/src/test-render/store3c-fixtures.ts · PC-56 STORE-3c — the shared world of the auction list / my bids / group lot render
// tests (not a test file: jest.render.config.js matches *.render.test.tsx only). Each test's jest.mock factories `require` THIS module, so the page
// under test and the test read the same mutable state `C`: the session, the store's flags, the public auction list per group, the caller's
// my-bids rows, the public group lot, and every call the pages made.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures stand in for SDK shapes */
import { SdkError } from '@krishalaya/sdk-js';

export const SLUG = 'anand-fpo';
export const T = '0212a000-0000-7000-8000-000000000001';
export const FARMER = 'Ramesh Kumar Patel';
export const BIDDER_UUID = '0212b000-0000-7000-8000-00000000b1d0';
export const A = Object.freeze({
  live: '0212c000-0000-7000-8000-000000000001', sealed: '0212c000-0000-7000-8000-000000000002', upcoming: '0212c000-0000-7000-8000-000000000003',
  failed: '0212c000-0000-7000-8000-000000000004', awaiting: '0212c000-0000-7000-8000-000000000005', won: '0212c000-0000-7000-8000-000000000006',
});
export const ORDER_ID = '0212d000-0000-7000-8000-000000000001';
export const LOT = '0212e000-0000-7000-8000-000000000001';
export const LISTING = '0212f000-0000-7000-8000-000000000001';

/** A card of the PUBLIC list as the API serves it (no reserve amount, no winner, no order id, no identity). */
export const CARD = (id: string, over: Record<string, unknown> = {}) => ({
  auctionId: id, auctionNo: 'AUC-2026-1016-01', status: 'live', kind: 'english_open', isOpen: true,
  lot: { title: 'Bold groundnut', unitCode: 'quintal', quantity: '60.000', organisation: { slug: SLUG, name: 'Anand FPO' } },
  currencyCode: 'INR', exponent: 2, reserveMet: true, hasBids: true, bidderCount: 5, sealedHidden: false, currentBidMinor: '632000', minNextBidMinor: '634000',
  startsAt: '2026-10-16T04:00:00.000Z', endsAt: '2099-10-16T12:30:00.000Z', decisionDueAt: null, antiSnipe: { triggerSec: 60, extendSec: 120 },
  emd: { flatMinor: '1000000', pctBps: null }, ...over,
});
/** A my-bids row (per auction) as the API serves it — the deposit as the LEDGER has it; the settlement for the winner only. */
export const MINE = (id: string, over: Record<string, unknown> = {}) => ({
  auctionId: id, auctionNo: 'AUC-2026-1016-01', listingTitle: 'Bold groundnut', quantity: '60.000', unitCode: 'quintal', organisation: { slug: SLUG, name: 'Anand FPO' },
  currencyCode: 'INR', exponent: 2, status: 'live', kind: 'english_open', endsAt: '2099-10-16T12:30:00.000Z', decisionDueAt: null, isOpen: true, sealedHidden: false,
  currentBidMinor: '632000', minNextBidMinor: '634000', myBestMinor: '624000', myBestAt: '2026-10-16T09:01:00.000Z', myBidCount: 2,
  leading: false, outbid: true, won: false, emd: { state: 'held', amountMinor: '1000000', at: '2026-10-16T08:30:00.000Z' },
  emdRule: { flatMinor: '1000000', pctBps: null }, settlement: null,
  bidId: 'b1', listingId: LISTING, amountMinor: '624000', emdHeldMinor: '1000000', auctionStatus: 'live', isWinning: false, createdAt: '2026-10-16T09:01:00.000Z',
  ...over,
});
export const SETTLEMENT = (over: Record<string, unknown> = {}) => ({
  orderId: ORDER_ID, outcome: 'open', collection: 'online', orderValueMinor: '13100000', emdAppliedMinor: '1000000', balanceDueMinor: '12100000',
  balanceDueAt: '2026-10-18T09:00:00.000Z', amountDueMinor: '12100000', outcomeAt: null, ...over,
});
export const GROUP_LOT = (over: Record<string, unknown> = {}) => ({
  id: LOT, lotNo: 'GL-2026-07', product: { name: 'Vanthali GG-20 Groundnut' }, targetQuantity: '200.000', pledgedQuantity: '148.000', unitCode: 'quintal',
  progressBps: 7400, pledgerCount: 9, pledgeDeadline: '2026-10-20T12:30:00.000Z', status: 'pledging', coordinationFeeBps: 150, currencyCode: 'INR', exponent: 2,
  listingId: null, organisation: { slug: SLUG, name: 'Anand FPO' }, cancelReasonCode: null, ...over,
});

export const C: {
  lang: string; token: string | null; sessionTenant: string | null; signedIn: boolean; flags: any; lists: Record<string, any>; next: string | null;
  mine: any; mineNext: string | null; lot: any; calls: any[];
} = {} as any;
export function reset(): void {
  Object.assign(C, {
    lang: 'en', token: 'tok', sessionTenant: T, signedIn: true,
    flags: { org_self_signup: true, storefront_browse: true, storefront_cart: true, online_payments: true, auctions: true, group_lots: true, offers: false },
    lists: { live: [CARD(A.live), CARD(A.sealed, { kind: 'sealed', sealedHidden: true, currentBidMinor: null, reserveMet: false, bidderCount: 3 })],
      upcoming: [CARD(A.upcoming, { status: 'scheduled', hasBids: false, bidderCount: 0, currentBidMinor: null, reserveMet: false })],
      ended: [CARD(A.failed, { status: 'failed_reserve', isOpen: false, reserveMet: false }), CARD(A.awaiting, { status: 'awaiting_approval', isOpen: false, decisionDueAt: '2026-10-17T09:00:00.000Z' })] },
    next: null, mine: [MINE(A.live)], mineNext: null, lot: GROUP_LOT(), calls: [],
  });
}
reset();

const answer = (v: any) => { if (v instanceof SdkError) throw v; if (v instanceof Error) throw new SdkError('UNAVAILABLE', 503, 'down'); return v; };
export function serverClient(): any {
  return {
    auctions: {
      myBids: async (q: any) => { C.calls.push(['auctions.myBids', q]); const m = answer(C.mine); return { items: m, nextCursor: C.mineNext }; },
    },
  };
}
export function publicClient(): any {
  return {
    storefront: {
      flags: async () => { C.calls.push(['storefront.flags']); return answer(C.flags); },
      auctions: async (q: any) => { C.calls.push(['storefront.auctions', q]); const l = answer(C.lists[q.group ?? 'live'] ?? []); return { items: l, nextCursor: C.next }; },
      groupLot: async (id: string) => { C.calls.push(['storefront.groupLot', id]); return answer(C.lot); },
    },
  };
}
export function sessionTenantClient(): any {
  return { storefront: { tenant: async () => ({ tenantId: T, slug: SLUG, displayName: 'Anand FPO' }), flags: async () => answer(C.flags) } };
}
export const shell = async (slug: string) => ({
  kind: 'ok', tenant: { tenantId: T, slug, displayName: 'Anand FPO', countryCode: 'IN', defaultLang: null, phoneDefaultCountry: 'IN' },
  branding: { displayName: 'Anand FPO', logoUrl: null, brand: null },
});
