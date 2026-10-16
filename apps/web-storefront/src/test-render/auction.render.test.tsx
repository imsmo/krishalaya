// apps/web-storefront/src/test-render/auction.render.test.tsx · PC-56 STORE-2c · C6 — canon W278 under the organisation's chrome:
//   • the reserve is MET / NOT MET only — its amount never appears; every figure is the SERVER's (current bid, minimum next bid, both lot totals,
//     the anti-snipe seconds, the EMD rule) — no client arithmetic; the bid history has NO bidder identity;
//   • the states: no bids / leading / outbid / won (an order, paid within the API's window — never "by tomorrow 18:00") / ended / scheduled /
//     connection lost → Retry / flagged off (the DB flag decides);
//   • the bid form only with a session of THIS organisation (its key minted at render); the amount parsed with the API's exponent;
//   • shill detection, outbid SMS, the seller's rating, the mandi price and masked bidder names refused by name.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SdkError } from '@krishalaya/sdk-js';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }) }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store2c-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => jest.requireActual('./store2c-fixtures').C.token, requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store2c-fixtures').C.sessionTenant }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store2c-fixtures').shell(s) }));
jest.mock('../lib/checkout-flow', () => jest.requireActual('./store2c-fixtures').checkoutFlow);
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store2c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});

import TenantAuctionPage from '../app/[tenantSlug]/auctions/[id]/page';
import { placeBidAction } from '../app/[tenantSlug]/auctions/[id]/actions';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, AUCTION, AUCTION_VIEW, T_OTHER } from './store2c-fixtures';
import { store2cRefusalKeys } from '../features/store2/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantAuctionPage({ params: { tenantSlug: 'anand-fpo', id: AUCTION }, searchParams: sp }));
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
beforeEach(() => reset());

describe('STORE-2c · W278 the auction', () => {
  it('reserve met as a sentence only; the server\'s figures; no reserve amount, no client math', async () => {
    const h = await page();
    expect(h).toContain('data-kv-reserve="met"');
    expect(text(h)).toContain(en['store2c.auction.reserveMet']);
    expect(text(h)).toMatch(/₹\s?6,320\.00 per quintal/);
    expect(text(h)).toMatch(/For the whole lot ₹\s?3,79,200\.00/);
    expect(text(h)).toMatch(/₹\s?6,340\.00 per quintal · ₹\s?3,80,400\.00 for the whole lot/);
    expect(text(h)).toContain('A bid in the last 90 seconds extends the auction by 120 seconds.');
    expect(text(h)).not.toMatch(/Reserve price/);
    C.auction = AUCTION_VIEW({ reserveMet: false });
    expect(await page()).toContain('data-kv-reserve="not-met"');
  });
  it('the bid history: the time and the amount — NO bidder identity at all', async () => {
    const h = await page();
    expect(h).toContain('data-kv-history="2"');
    expect(text(h)).not.toMatch(/Buyer [A-Z]•|B1|A bidder|Rajkot/);
    expect(text(h)).toContain(en['store2c.refusal.bidderNames']);
  });
  it('the states from the read: no bids, leading, outbid (both numbers), won (an order within the API\'s window), ended, scheduled', async () => {
    C.auction = AUCTION_VIEW({ hasBids: false, bids: [], currentBidMinor: null, lotTotalMinor: null });
    expect(await page()).toContain('data-kv-state="no-bids"');
    C.auction = AUCTION_VIEW({ viewer: { bestBidMinor: '632000', leading: true, won: false, orderId: null } });
    expect(await page()).toContain('data-kv-state="leading"');
    C.auction = AUCTION_VIEW({ viewer: { bestBidMinor: '620000', leading: false, won: false, orderId: null } });
    let h = await page();
    expect(h).toContain('data-kv-state="outbid"');
    expect(text(h)).toMatch(/your best bid is ₹\s?6,200\.00; the next valid bid is ₹\s?6,340\.00/);
    C.auction = AUCTION_VIEW({ status: 'settled', isOpen: false, viewer: { bestBidMinor: '632000', leading: false, won: true, orderId: 'o-won' } });
    h = await page();
    expect(h).toContain('data-kv-state="won"');
    expect(text(h)).toContain('pay its balance within 48 hours');
    expect(text(h)).not.toMatch(/tomorrow 18:00/);
    // PC-56 STORE-3c · C4 (founder D2): the won state links THIS store's pay step for the balance and the order under the organisation's chrome
    expect(h).toContain('data-kv-pay-balance="o-won" href="/anand-fpo/checkout/pay?o=o-won"');
    expect(h).toContain('href="/anand-fpo/orders/o-won"');
    C.auction = AUCTION_VIEW({ status: 'ended', isOpen: false });
    expect(await page()).toContain('data-kv-state="ended"');
    C.auction = AUCTION_VIEW({ status: 'scheduled' });
    expect(await page()).toContain('data-kv-state="scheduled"');
  });
  it('connection lost → Retry (a reload); a 404 → "not available"; the flag OFF → the honest off state (the DB decides)', async () => {
    C.auction = new Error('down');
    expect(await page()).toContain('data-kv-retry="reload"');
    C.auction = new SdkError('NOT_FOUND', 404, 'nf');
    expect(await page()).toContain('data-kv-state="not-found"');
    reset();
    C.flags = { ...C.flags, auctions: false };
    const h = await page();
    expect(h).toContain('data-kv-state="auctions-off"');
    expect(text(h)).not.toMatch(/tenant\/plan|store settings/);
  });
  it('the bid form only with a session of THIS organisation; anonymous / another store → sign in to bid', async () => {
    expect(await page()).toContain('data-kv-form="bid"');
    C.token = null;
    expect(await page()).toContain('data-kv-bid="signin"');
    reset(); C.sessionTenant = T_OTHER;
    expect(await page()).not.toContain('data-kv-form="bid"');
  });
  it('the EMD rule as the API holds it; the typed bid parsed with the API\'s exponent and sent under the key minted at render', async () => {
    const h = await page();
    expect(text(h)).toContain('Your first bid holds a refundable deposit of 2% of the lot value');
    const key = '0209cc00-0000-7000-8000-000000000001';
    await expect(placeBidAction(form({ slug: 'anand-fpo', auctionId: AUCTION, idempotencyKey: key, amount: '6,340.50' }))).rejects.toThrow(`REDIRECT /anand-fpo/auctions/${AUCTION}?status=bid`);
    expect(C.calls.find((c) => c[0] === 'placeBid')!.slice(1)).toEqual([AUCTION, '634050', key]);
    await expect(placeBidAction(form({ slug: 'anand-fpo', auctionId: AUCTION, idempotencyKey: key, amount: '6340.505' }))).rejects.toThrow('status=bad_amount');
    C.fail.placeBid = { code: 'BID_TOO_LOW', status: 422 };
    await expect(placeBidAction(form({ slug: 'anand-fpo', auctionId: AUCTION, idempotencyKey: key, amount: '6300' }))).rejects.toThrow('status=too_low');
  });
  it('the W278 refusals by name; no shill claim, no SMS promise, no rating, no mandi price', async () => {
    const h = await page();
    for (const k of store2cRefusalKeys('auction')) expect([k, text(h).includes(en[k as keyof typeof en])]).toEqual([k, true]);
    expect(text(h)).not.toMatch(/4\.6★|89 sales|APMC|voids bids/);
  });
});
