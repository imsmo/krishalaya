// apps/web-storefront/src/test-render/auctions-list.render.test.tsx · PC-56 STORE-3c · C1 / C2 — canon W295 "Auctions" under the organisation:
//   • the tabs (Live / Upcoming / With my bids for a session of THIS store / Ended) — no numbers invented; each tab reads its own API group;
//   • a card names the ORGANISATION — never a bidder, a farmer or a uuid; every figure is the SERVER's (current, minimum next, bidders); a sealed
//     auction hides the current bid; the reserve as met / not met only; money in the DATA's currency;
//   • all NINE statuses labelled in en / hi / gu (never the raw enum); the canon states: reserve not met (deposits released), awaiting (the
//     organisation's own deadline — never "12h"), extended;
//   • the store's `auctions` flag OFF → the honest state and NO list call; error (Retry reloads) ≠ empty ≠ off; the refusals by name;
//   • the headers: "Auctions" / "My bids" / "Group lots" only when the store's flags are ON; the platform's /auctions is a door.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3c-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => {
  const f = jest.requireActual('./store3c-fixtures');
  return { resolveSessionToken: async () => f.C.token, requireSession: async (to: string) => { if (!f.C.token) throw new Error(`REDIRECT /login?next=${to}`); return f.C.token; } };
});
jest.mock('../lib/auth', () => ({ getSessionTenant: () => jest.requireActual('./store3c-fixtures').C.sessionTenant, hasSessionCookie: () => jest.requireActual('./store3c-fixtures').C.signedIn === true }));
jest.mock('../lib/storefront-data', () => ({ loadTenantShell: (s: string) => jest.requireActual('./store3c-fixtures').shell(s) }));
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 0 }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3c-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantAuctionsPage from '../app/[tenantSlug]/auctions/page';
import PlatformAuctionsDoor from '../app/(platform)/auctions/page';
import { TenantHeader } from '../components/TenantHeader';
import { SiteHeader } from '../components/SiteHeader';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, CARD, MINE, A, SLUG, FARMER, BIDDER_UUID } from './store3c-fixtures';
import { AUCTION_STATUS_LIST } from '../features/store3c/auctions';
import { store3cRefusalKeys, STORE3C_REFUSALS } from '../features/store3c/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantAuctionsPage({ params: { tenantSlug: SLUG }, searchParams: sp }));
const CATS: Record<string, Record<string, string>> = { en, hi, gu };
beforeEach(() => { reset(); });

describe('STORE-3c · W295 the tabs', () => {
  it('Live (default) · Upcoming · With my bids (a session of THIS store) · Ended — no numbers invented; Live reads the API group `live`', async () => {
    const h = await page();
    for (const t of ['live', 'upcoming', 'mine', 'ended']) expect(h).toContain(`data-kv-tab="${t}"`);
    expect(h).toContain(`class="kv-tab kv-tab--current" aria-current="page" data-kv-tab="live" href="/${SLUG}/auctions"`);
    expect(h).not.toMatch(/\(\d+\)/);
    expect(C.calls).toContainEqual(['storefront.auctions', expect.objectContaining({ group: 'live' })]);
  });
  it('anonymous → no "With my bids" tab; ?tab=mine anonymously → sign in first', async () => {
    C.token = null; C.signedIn = false;
    const h = await page();
    expect(h).not.toContain('data-kv-tab="mine"');
    await expect(page({ tab: 'mine' })).rejects.toThrow(`REDIRECT /login?next=/${SLUG}/auctions?tab=mine`);
  });
  it('Upcoming / Ended read their own groups; "With my bids" reads the caller\'s per-auction read and says leading / outbid', async () => {
    expect(text(await page({ tab: 'upcoming' }))).toContain('Opens');
    expect(C.calls).toContainEqual(['storefront.auctions', expect.objectContaining({ group: 'upcoming' })]);
    await page({ tab: 'ended' });
    expect(C.calls).toContainEqual(['storefront.auctions', expect.objectContaining({ group: 'ended' })]);
    C.mine = [MINE(A.live), MINE(A.sealed, { leading: true, outbid: false })];
    const h = await page({ tab: 'mine' });
    expect(C.calls).toContainEqual(['auctions.myBids', expect.objectContaining({ limit: 20 })]);
    expect(h).toContain('data-kv-outcome="outbid"');
    expect(h).toContain('data-kv-outcome="leading"');
  });
});

describe('STORE-3c · W295 the cards: the organisation, the server\'s figures, no identity', () => {
  it('title · qty unit · the ORGANISATION; current + minimum next AS SERVED; bidders (never names); reserve met / not met only; the EMD rule', async () => {
    const h = await page();
    const tx = text(h);
    expect(tx).toContain('Bold groundnut');
    expect(tx).toContain('60 quintal · Anand FPO');
    expect(h).toContain('data-kv-current="server"');
    expect(tx).toContain('Current ₹6,320.00 per quintal');
    expect(tx).toContain('Minimum next ₹6,340.00 per quintal');
    expect(tx).toContain('5 bidders');
    expect(h).toContain('data-kv-reserve="met"');
    expect(tx).toContain('Deposit to bid: ₹10,000.00, held on your wallet at your first bid.');
    expect(tx).toContain('A bid in the last 60 seconds extends it by 120 seconds.');
    expect(tx).not.toContain(FARMER); expect(h).not.toContain(BIDDER_UUID);
    expect(h).not.toMatch(/reservePrice|winningBid|settledOrder/);
  });
  it('a SEALED auction hides the current bid ("Bids are hidden until the auction closes") and says the sealed rule; no reserve verdict while hidden', async () => {
    const h = await page();
    const card = h.slice(h.indexOf(`data-kv-auction="${A.sealed}"`));
    expect(card).toContain('data-kv-current="sealed"');
    expect(text(card)).toContain('Sealed — nobody sees anyone’s number until close.');
    expect(card.slice(0, card.indexOf('</li>'))).not.toContain('data-kv-reserve=');
  });
  it('money in the DATA\'s currency (USD printed as dollars, never rupees)', async () => {
    C.lists.live = [CARD(A.live, { currencyCode: 'USD', currentBidMinor: '3500', minNextBidMinor: '3600', emd: { flatMinor: null, pctBps: 200 } })];
    const tx = text(await page());
    expect(tx).toContain('Current $35.00 per quintal');
    expect(tx).toContain('2% of the lot value at your first bid');
    expect(tx).not.toContain('₹');
  });
  it.each(['en', 'hi', 'gu'])('%s: all NINE statuses are labelled — never the raw enum', async (l) => {
    C.lang = l;
    C.lists.ended = AUCTION_STATUS_LIST.map((s, i) => CARD(`0212c000-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`, { status: s, isOpen: ['live', 'extended', 'scheduled'].includes(s) }));
    const tx = text(await page({ tab: 'ended' }));
    for (const s of AUCTION_STATUS_LIST) expect([s, tx.includes(CATS[l][`store3c.status.${s}`])]).toEqual([s, true]);
    for (const raw of ['awaiting_approval', 'failed_reserve', 'defaulted', 'english_open']) expect(tx).not.toContain(raw);
  });
  it('the canon states: reserve not met → deposits released automatically; awaiting → the organisation\'s own deadline (never "12h"); extended', async () => {
    C.lists.ended.push(CARD('0212c000-0000-7000-8000-000000000009', { status: 'extended' }));
    const tx = text(await page({ tab: 'ended' }));
    expect(tx).toContain(en['store3c.note.failedReserve']);
    expect(tx).toMatch(/The organisation decides by .+2026.*; the winning bidder’s deposit stays held until then\./);
    expect(tx).toContain(en['store3c.note.extended']);
    expect(tx).not.toMatch(/12\s?h/);
  });
});

describe('STORE-3c · W295 off ≠ empty ≠ error; keyset; the refusals', () => {
  it('the store\'s `auctions` flag OFF → the honest state and NO list call', async () => {
    C.flags = { ...C.flags, auctions: false };
    const h = await page();
    expect(h).toContain('data-kv-state="flag-off"');
    expect(text(h)).toContain(en['store3c.off.title']);
    expect(C.calls.filter((c) => c[0] === 'storefront.auctions')).toEqual([]);
  });
  it('empty → its own sentence; error → "couldn\'t load" with a Retry that reloads (W3077–W3079 DECOR) — never the empty sentence', async () => {
    C.lists.live = [];
    const e = await page();
    expect(e).toContain('data-kv-state="empty"');
    expect(text(e)).toContain('No auction is live in Anand FPO’s store right now.');
    C.lists.live = new Error('down');
    const x = await page();
    expect(x).toContain('data-kv-state="error"');
    expect(x).toContain(`href="/${SLUG}/auctions" class="kv-btn" data-kv-retry="reload"`);
    expect(text(x)).not.toContain('No auction is live');
  });
  it('keyset: Next carries the tab and the cursor; no numbered pages', async () => {
    C.next = 'c2';
    expect(await page({ tab: 'ended' })).toContain(`rel="next" href="/${SLUG}/auctions?tab=ended&amp;cursor=c2"`);
  });
  it('every W295 refusal is printed by name (EMD of your bid, names masked, KYC, reverse/dutch, 12h, follow, pages, settings)', async () => {
    const h = await page();
    for (const r of STORE3C_REFUSALS.filter((x) => x.surfaces.includes('auctions'))) expect(h).toContain(`data-kv-refusal="${r.id}"`);
    expect(store3cRefusalKeys('auctions').length).toBe(8);
  });
});

describe('STORE-3c · the headers and the platform door (founder D4)', () => {
  it('TenantHeader: Auctions + My bids (signed in) + Group lots only when the store\'s flags are ON; OFF → none', async () => {
    const h = renderToStaticMarkup(await TenantHeader({ slug: SLUG, name: 'Anand FPO', logoSrc: null, showPoweredBy: true }));
    expect(h).toContain(`data-kv-nav="auctions" href="/${SLUG}/auctions"`);
    expect(h).toContain(`data-kv-nav="my-bids" href="/${SLUG}/auctions/bids"`);
    expect(h).toContain(`data-kv-nav="group-lots" href="/${SLUG}/search?saleType=group_lot"`);
    C.flags = { ...C.flags, auctions: false, group_lots: false };
    const off = renderToStaticMarkup(await TenantHeader({ slug: SLUG, name: 'Anand FPO', logoSrc: null, showPoweredBy: true }));
    expect(off).not.toMatch(/data-kv-nav="(auctions|my-bids|group-lots)"/);
    C.flags = { ...C.flags, auctions: true }; C.signedIn = false;
    const anon = renderToStaticMarkup(await TenantHeader({ slug: SLUG, name: 'Anand FPO', logoSrc: null, showPoweredBy: true }));
    expect(anon).toContain('data-kv-nav="auctions"');
    expect(anon).not.toContain('data-kv-nav="my-bids"');
  });
  it('SiteHeader: "Auctions" only for a signed-in buyer whose store has the flag ON (the build-time switch is gone)', async () => {
    expect(renderToStaticMarkup(await SiteHeader())).toContain('href="/auctions"');
    C.flags = { ...C.flags, auctions: false };
    expect(renderToStaticMarkup(await SiteHeader())).not.toContain('href="/auctions"');
    C.flags = { ...C.flags, auctions: true }; C.signedIn = false;
    expect(renderToStaticMarkup(await SiteHeader())).not.toContain('href="/auctions"');
  });
  it('the platform /auctions is a door: a session → its store\'s list (the tab carried); anonymous → "which store" — never a guessed store, never an INR card', async () => {
    await expect(PlatformAuctionsDoor({ searchParams: { tab: 'ended' } })).rejects.toThrow(`REDIRECT /${SLUG}/auctions?tab=ended`);
    C.token = null;
    const h = renderToStaticMarkup(await PlatformAuctionsDoor({ searchParams: {} }));
    expect(h).toContain('data-kv-state="which-store"');
    expect(text(h)).toContain(en['store3c.door.whichStore']);
  });
});
