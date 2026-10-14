// apps/web-storefront/src/test-render/home.render.test.tsx · PC-56 STORE-1b — THE PLATFORM HOME (canon W273), rendered inside its real platform
// layout (SiteHeader + SiteFooter), state by state. Proves, in the markup a buyer receives:
//   • ERROR ≠ EMPTY: an outage prints "Couldn't load today's listings — nothing was lost…" with Retry = a link to the SAME URL; a real empty
//     answer prints "No organisation has published a listing this week" + Browse all organisations — never each other;
//   • no `/market/` href (the hard-coded slug is gone); every card links into ITS organisation's store and names the ORGANISATION;
//   • the brand is the platform store name from packages/tokens (founder D2) with the catalogue's vernacular sub-line;
//   • no "1800" / "*123#" / "12 languages" / "Gujarat" (region-neutral, no helpline the gateway cannot answer);
//   • GMV and the mandi pulse are REFUSALS (a sentence, never a figure); the counts print "as of" (AsOf); never-computed → "not counted yet".
import * as React from 'react';

const mock: { stats: unknown; feed: unknown; cats: unknown; lang: string } = { stats: null, feed: null, cats: [], lang: 'en' };
const fail = (status: number) => { throw Object.assign(new Error('api'), { status }); };

jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: true, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => mock.lang, getTranslator: () => new T(mock.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => false }));
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 0 }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => ({
  publicClient: () => ({
    storefront: {
      stats: async () => (mock.stats instanceof Error ? fail(503) : mock.stats),
      discover: async () => (mock.feed instanceof Error ? fail(503) : mock.feed),
    },
    lookups: { categories: async () => mock.cats },
  }),
}));

import { PLATFORM_BRAND } from '@krishalaya/tokens';
import PlatformLayout from '../app/(platform)/layout';
import HomePage from '../app/(platform)/page';
import { SiteHeader } from '../components/SiteHeader';
import { STORE1B_REFUSALS } from '../features/home/refusals';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';

const CARD = (i: number, org = 'Anand FPO', slug = 'anand-fpo') => ({
  listingId: `0190a8b2-0000-7000-8000-00000000010${i}`, tenantSlug: slug, organisation: org, title: `Groundnut lot ${i}`,
  priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal', organic: i === 1, grade: 'Grade A', district: 'Junagadh',
});
const STATS = { liveListings: 2418, verifiedOrganisations: 312, districts: 41, computedAt: new Date(Date.now() - 5 * 60_000).toISOString() };
const CATS = [
  { id: 'c-grain', parentId: null, code: 'grain', defaultName: 'Grains & oilseeds', path: 'grain', depth: 1, commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 },
  { id: 'c-wheat', parentId: 'c-grain', code: 'wheat', defaultName: 'Wheat', path: 'grain.wheat', depth: 2, commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, minAge: null, isActive: true, sortOrder: 1 },
];

async function home(): Promise<string> {
  // the layout is called for its tree (so its <SiteHeader/> element is in it), then the async header is resolved in place
  return renderResolved(PlatformLayout({ children: await HomePage() }), [SiteHeader]);
}

beforeEach(() => {
  mock.lang = 'en'; mock.stats = STATS; mock.feed = { items: [CARD(1), CARD(2, 'Kisan Sathi FPC', 'kisan-sathi')], nextCursor: null }; mock.cats = CATS;
});

describe('STORE-1b · W273 the platform home', () => {
  it('ERROR ≠ EMPTY: an outage says the refresh failed and nothing was lost, with Retry = a link to the same URL', async () => {
    mock.feed = new Error('down');
    const html = await home();
    expect(text(html)).toContain("Couldn't load today's listings — nothing was lost, only this refresh failed.");
    expect(html).toMatch(/<a href="\/" class="kv-btn" data-kv-retry="reload">Retry<\/a>/);
    expect(text(html)).not.toContain(en['home.fresh.empty']);
  });

  it('EMPTY only for a real empty answer: "No organisation has published a listing this week" + Browse all organisations', async () => {
    mock.feed = { items: [], nextCursor: null };
    const html = await home();
    expect(text(html)).toContain('No organisation has published a listing this week.');
    expect(html).toContain('href="/organisations"');
    expect(html).not.toContain('data-kv-retry');
    expect(text(html)).not.toContain(en['home.fresh.error']);
  });

  it('cards link INTO their organisation\'s store and name the ORGANISATION; no /market/ href anywhere', async () => {
    const html = await home();
    expect(html).toContain(`href="/anand-fpo/listings/${CARD(1).listingId}"`);
    expect(html).toContain(`href="/kisan-sathi/listings/${CARD(2).listingId}"`);
    expect(text(html)).toContain('Sold by Anand FPO · Junagadh');
    expect(text(html)).toContain('Sold by Kisan Sathi FPC');
    expect(html).not.toMatch(/href="\/market\//);
    expect(html).toContain('₹6,150.00');
  });

  it('the brand is the platform store name from packages/tokens (founder D2) with the vernacular sub-line from the catalogue', async () => {
    const html = await home();
    expect(PLATFORM_BRAND.platformStoreName).toBe('Krishalaya Bazaar');
    expect(html).toContain(`<span data-kv-mark="platform-store">${PLATFORM_BRAND.platformStoreName}</span>`);
    expect(text(html)).toContain('Straight from the farmer');
    mock.lang = 'gu';
    expect(await home()).toContain('ખેડૂતથી સીધું');
    mock.lang = 'hi';
    expect(await home()).toContain('किसान से सीधे');
  });

  it('region-neutral and no helpline: no "1800", "*123#", "12 languages" or "Gujarat" — in any language', async () => {
    for (const lang of ['en', 'hi', 'gu']) {
      mock.lang = lang;
      const html = await home();
      // the region (not the language switcher's own "ગુજરાતી" / "Gujarati" label) — a region literal is refused, the language name is not one
      expect([lang, html.match(/.{0,40}(?:1800|\*123#|12 languages|Gujarat(?!i)|ગુજરાત(?!ી)|गुजरात(?!ी)).{0,40}/)?.[0] ?? null]).toEqual([lang, null]);
    }
  });

  it('GMV and the mandi pulse are REFUSALS (a sentence, never a figure); the counts print "as of"', async () => {
    const html = await home();
    expect(html).toContain('data-kv-refusal="gmv_yesterday"');
    expect(html).toContain('data-kv-refusal="mandi_pulse"');
    expect(text(html)).toContain(en['home.refusal.gmv']);
    expect(text(html)).toContain(en['home.refusal.mandi']);
    expect(html).not.toMatch(/₹1,86,44,290|AGMARKNET, updated this morning|▲|▼/);
    expect(text(html)).toContain('Counted as of');
    expect(html).toMatch(/<time dateTime="[^"]+">/);
    expect(text(html)).toContain('2,418 live listings');
    expect(text(html)).toContain('312 verified organisations');
    expect(text(html)).toContain('41 districts');
  });

  it('never computed → "not counted yet" (no zeros printed as a measurement); stats outage → its own sentence', async () => {
    mock.stats = { liveListings: 0, verifiedOrganisations: 0, districts: 0, computedAt: null };
    let html = await home();
    expect(text(html)).toContain(en['home.glance.notYet']);
    expect(text(html)).not.toContain('0 live listings');
    mock.stats = new Error('down');
    html = await home();
    expect(text(html)).toContain(en['home.glance.error']);
  });

  it('category tiles + the header strip come from master data → /discover?category=; the trace entry is a GET form, no camera', async () => {
    const html = await home();
    expect(html).toContain('href="/discover?category=c-grain"');
    expect(html).not.toContain('href="/discover?category=c-wheat"');   // top level only
    expect(html).toMatch(/<form method="get" action="\/trace"[^>]*>/);
    expect(html).toMatch(/<form method="get" action="\/discover" role="search"/);
    expect(text(html)).toContain(en['home.trace.noCamera']);
    expect(text(html)).toContain(en['home.trace.demoRefused']);
  });

  it('the RECORDED refusals are not rendered: no "region-restricted", no platform-level "group lots disabled"', async () => {
    const html = await home();
    expect(html).not.toMatch(/region-restricted|Group lots disabled|group-lot buying/i);
    for (const r of STORE1B_REFUSALS.filter((x) => x.answer !== 'rendered')) expect(html).not.toContain(`data-kv-refusal="${r.id}"`);
  });

  it('the platform footer: Help; Returns and Contact ANNOUNCED (not dead links); storefront signup; how trace works', async () => {
    const html = await home();
    expect(html).toContain('href="/help"'); expect(html).toContain('href="/for-organisations"'); /* STORE-1c: W307's route */ expect(html).toContain('href="/trace"');
    expect(html).not.toMatch(/href="#returns"|href="#contact"/);
    expect((html.match(/data-kv-soon="STORE-5"/g) ?? []).length).toBe(2);
  });
});
