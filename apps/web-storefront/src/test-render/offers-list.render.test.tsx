// apps/web-storefront/src/test-render/offers-list.render.test.tsx · PC-56 STORE-3b · C1 / C2 — canon W293 "My offers" under the organisation:
//   • status chips with the API's BOUNDED counts — a capped chip says "(n+)"; the current chip from ?status=; the list asked for that status;
//   • a row names the ORGANISATION — never a farmer, never a uuid; the SERVER's value; money in the DATA's currency (USD printed as dollars);
//   • all six statuses labelled in en / hi / gu (`open` included) — never the raw enum;
//   • a converted row links its order with the order's status; a declined row says the reason; "Offer again" pre-fills the listing's form;
//   • the `offers` flag OFF → the honest state and NO offers call; the header link hidden (TenantHeader and SiteHeader); ON → shown;
//   • a load error is NOT an empty list (Retry reloads); empty → "Find a listing"; keyset Next; the platform's /offers is a door.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
jest.mock('next/cache', () => ({ revalidatePath: () => undefined }));
jest.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: () => new Map() }));
jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), useFormStatus: () => ({ pending: jest.requireActual('./store3b-fixtures').C.pending === true }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: 'rzp_test_x' } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store3b-fixtures');
  return { getLang: () => f.C.lang, getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/session', () => ({ resolveSessionToken: async () => 'tok', requireSession: async () => 'tok' }));
jest.mock('../lib/auth', () => ({ getSessionTenant: () => 't', hasSessionCookie: () => jest.requireActual('./store3b-fixtures').C.signedIn === true, getSessionToken: () => 'tok' }));
jest.mock('../lib/api-client', () => {
  const f = jest.requireActual('./store3b-fixtures');
  return { serverClient: f.serverClient, publicClient: f.publicClient, sessionTenantClient: f.sessionTenantClient };
});
jest.mock('server-only', () => ({}), { virtual: true });

import TenantOffersPage from '../app/[tenantSlug]/offers/page';
import PlatformOffersDoor from '../app/(platform)/offers/page';
import { TenantHeader } from '../components/TenantHeader';
import { SiteHeader } from '../components/SiteHeader';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { C, reset, OFFER, OFF, SLUG, SELLER_UUID, FARMER, LISTING_ID, ORDER_ID } from './store3b-fixtures';
import { OFFER_STATUS_LIST } from '../features/store3b/offers';
import { store3bRefusalKeys } from '../features/store3b/refusals';

const page = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await TenantOffersPage({ params: { tenantSlug: SLUG }, searchParams: sp }));
const CATS: Record<string, Record<string, string>> = { en, hi, gu };
beforeEach(() => { reset(); });

describe('STORE-3b · W293 the chips (bounded counts)', () => {
  it('all + the six statuses with their counts; a capped chip says "(n+)"; the current chip from ?status=; the list asked for it', async () => {
    C.list.countered = [OFFER(OFF.countered)];
    const h = await page({ status: 'countered' });
    for (const s of ['all', ...OFFER_STATUS_LIST]) expect(h).toContain(`data-kv-tab="${s}"`);
    expect(h).toContain(`class="kv-tab kv-tab--current" aria-current="page" data-kv-tab="countered" href="/${SLUG}/offers?status=countered"`);
    expect(h).toContain('data-kv-count="expired" data-kv-capped="true"');
    expect(text(h)).toContain('(100+)');
    expect(text(h)).toContain(`${en['offers.status.countered']} (1)`);
    expect(C.calls).toContainEqual(['offers.list', expect.objectContaining({ box: 'outgoing', status: 'countered' })]);
  });
  it('the counts unreadable → the chips are still links, with no number invented', async () => {
    C.counts = new Error('down');
    const h = await page();
    expect(h).toContain('data-kv-tab="open"');
    expect(h).not.toContain('data-kv-count=');
  });
});

describe('STORE-3b · W293 the rows', () => {
  it('the listing · qty + unit, the ORGANISATION (never a farmer or a uuid), the counter on the table, the round, whose turn, the SERVER value', async () => {
    C.list.all = [OFFER(OFF.countered)];
    const h = await page();
    const tx = text(h);
    expect(tx).toContain('Lokwan wheat · 12 quintal');
    expect(h).toContain('data-kv-seller="organisation"');
    expect(tx).toContain('Anand FPO');
    expect(h).not.toContain(SELLER_UUID); expect(tx).not.toContain(FARMER);
    expect(h).toContain('data-kv-table="theirs"');
    expect(tx).toContain('The organisation countered ₹2,490.00 per quintal');
    expect(tx).toContain('round 2');
    expect(h).toContain('data-kv-turn="yours"');
    expect(h).toContain('data-kv-value="server"');
    expect(tx).toContain('Value ₹29,880.00');                                   // offerValueMinor as served — never computed here
    expect(h).toContain(`data-kv-respond-by="${OFF.countered}"`);
  });
  it('money in the DATA\'s currency (USD → dollars, never ₹); the buyer\'s own price on an odd round', async () => {
    C.list.all = [OFFER(OFF.open, { status: 'open', round: 1, counterPriceMinor: null, currencyCode: 'USD', offeredPriceMinor: '120050', offerValueMinor: '1440600', yourTurn: false, allowedActs: [] })];
    const h = await page();
    expect(h).toContain('data-kv-money="USD"');
    expect(text(h)).toMatch(/You offered (US)?\$1,200\.50 per quintal × 12/);
    expect(text(h)).not.toContain('₹');
    expect(h).toContain('data-kv-turn="theirs"');
  });
  it.each(['en', 'hi', 'gu'])('%s: every one of the six statuses carries its own label — `open` included, never the raw enum', async (lang) => {
    C.lang = lang;
    C.list.all = OFFER_STATUS_LIST.map((s, i) => OFFER(`0211c000-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`, { status: s }));
    const h = await page();
    for (const s of OFFER_STATUS_LIST) expect(h).toContain(`data-kv-chip="${s}">${CATS[lang][`offers.status.${s}`]}<`);
  });
  it('a converted row links its order with the order\'s status; a declined row says who and why; expired / declined offer again (pre-filled)', async () => {
    C.list.all = [
      OFFER(OFF.converted, { status: 'converted', convertedOrderId: ORDER_ID, convertedOrderStatus: 'delivered', conversion: 'converted', yourTurn: false, allowedActs: [] }),
      OFFER(OFF.rejected, { status: 'rejected', declineReasonCode: 'lot_committed', declinedBy: 'seller', yourTurn: false, allowedActs: [] }),
      OFFER(OFF.expired, { status: 'expired', yourTurn: false, allowedActs: [] }),
    ];
    const h = await page();
    expect(h).toContain(`href="/${SLUG}/orders/${ORDER_ID}"`);
    expect(text(h)).toContain(`Became an order — ${en['order.status.delivered']}`);
    expect(text(h)).toContain(`The organisation declined — ${en['store3b.reason.lot_committed']}`);
    expect(h).toContain(`class="kv-btn--link" data-kv-offer-again="${OFF.expired}" href="/${SLUG}/listings/${LISTING_ID}?qty=12&amp;price=2490#offer"`);
    expect(h).toContain(`data-kv-offer-again="${OFF.rejected}"`);
    expect(h).not.toContain(`data-kv-offer-again="${OFF.converted}"`);
    expect(h).not.toContain(`data-kv-respond-by="${OFF.converted}"`);
  });
  it('keyset Next only (the cursor carried, the chip kept)', async () => {
    C.list.open = [OFFER(OFF.open, { status: 'open', round: 1 })]; C.next = 'abc';
    expect(await page({ status: 'open' })).toContain(`href="/${SLUG}/offers?status=open&amp;cursor=abc"`);
  });
});

describe('STORE-3b · W293 the states', () => {
  it('the `offers` flag OFF → the honest state, NO offers call (it would 404)', async () => {
    C.flags = { ...C.flags, offers: false };
    const h = await page();
    expect(h).toContain('data-kv-state="flag-off"');
    expect(text(h)).toContain(en['store3b.off.title']);
    expect(C.calls.filter((c) => String(c[0]).startsWith('offers.'))).toEqual([]);
  });
  it('a load error is NOT an empty list: said, with a Retry that reloads (W3124–W3126 DECOR); the refusals still printed', async () => {
    C.list.all = new Error('down');
    const h = await page();
    expect(h).toContain('data-kv-state="error"');
    expect(h).not.toContain('data-kv-state="empty"');
    expect(h).toContain(`href="/${SLUG}/offers" class="kv-btn" data-kv-retry="reload"`);
    for (const k of store3bRefusalKeys('offers')) expect(text(h)).toContain(en[k]);
  });
  it('empty → "Find a listing" (the store) and the refusals by name (buying history, the farmer\'s name, numbered pages)', async () => {
    const h = await page();
    expect(h).toContain('data-kv-state="empty"');
    expect(h).toContain(`data-kv-cta="find" href="/${SLUG}"`);
    for (const k of store3bRefusalKeys('offers')) expect(text(h)).toContain(en[k]);
  });
});

describe('STORE-3b · the header link is flag-aware (survey F-11)', () => {
  const tenantHeader = async () => renderToStaticMarkup(await TenantHeader({ slug: SLUG, name: 'Anand FPO', logoSrc: null, showPoweredBy: true }));
  it('TenantHeader: signed in + `offers` ON → "Offers" → /<slug>/offers; OFF → no link; signed out → no link', async () => {
    expect(await tenantHeader()).toContain(`class="kv-header__link" data-kv-nav="offers" href="/${SLUG}/offers"`);
    C.flags = { ...C.flags, offers: false };
    expect(await tenantHeader()).not.toContain('data-kv-nav="offers"');
    C.flags = { ...C.flags, offers: true }; C.signedIn = false;
    expect(await tenantHeader()).not.toContain('data-kv-nav="offers"');
  });
  it('SiteHeader (the platform\'s): the session store\'s flag decides; unreadable → no link', async () => {
    expect(renderToStaticMarkup(await SiteHeader())).toContain('class="kv-header__link" data-kv-nav="offers" href="/offers"');
    C.flags = { ...C.flags, offers: false };
    expect(renderToStaticMarkup(await SiteHeader())).not.toContain('data-kv-nav="offers"');
    C.flags = new Error('down');
    expect(renderToStaticMarkup(await SiteHeader())).not.toContain('data-kv-nav="offers"');
  });
});

describe('STORE-3b · the platform /offers is a door', () => {
  it('→ /<slug>/offers, carrying the status and the cursor', async () => {
    await expect(PlatformOffersDoor({ searchParams: { status: 'expired', cursor: 'c1' } })).rejects.toThrow(`REDIRECT /${SLUG}/offers?status=expired&cursor=c1`);
  });
  it('the session\'s store unreadable → said, with a Retry (a reload of the door)', async () => {
    C.doorFails = true;
    const h = renderToStaticMarkup(await PlatformOffersDoor({ searchParams: {} }));
    expect(h).toContain('data-kv-state="error"');
    expect(h).toContain('href="/offers" class="kv-btn" data-kv-retry="reload"');
  });
});

void React;
