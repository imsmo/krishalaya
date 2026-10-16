// apps/web-storefront/src/test-render/tenant-home.render.test.tsx · PC-56 STORE-1b — A TENANT'S STORE HOME (canon W274), rendered inside its
// real tenant layout (TenantHeader + TenantFooter), state by state. Proves, in the markup a buyer receives:
//   • the TENANT header is there and the platform SiteHeader brand is NOT (survey F-6); "Powered by Krishalaya" sits IN the header per canon,
//     and follows the 13d rule (gone only when the brand hides it with the plan); the breadcrumb leads back to the platform store;
//   • unknown slug → notFound(); a TRIAL organisation (the API's 404 to an anonymous caller) → notFound(); an OUTAGE → degraded, not 404;
//   • ERROR ≠ EMPTY: the grid failed → its own sentence + Retry = the same URL (with its query), the profile above still shown;
//     a real empty answer → "No listings from <org> yet" + "See other organisations";
//   • the count is CAPPED ("1,000+ published"); "98.2%" is never rendered (refused by name); "members-only" ONLY when > 0;
//     group lots off → the sentence AND no group-lot facet; cards name the ORGANISATION — never a farmer or member number;
//   • "Verified organisation" only when the platform's approval says so.
import * as React from 'react';

type Shell = { kind: 'ok'; tenant: unknown; branding: unknown } | { kind: 'not_found' } | { kind: 'unavailable' };
const mock: { shell: Shell; profile: unknown; listings: unknown; flags: unknown; lang: string } = { shell: { kind: 'not_found' }, profile: null, listings: null, flags: null, lang: 'en' };
const fail = (status: number) => { throw Object.assign(new Error('api'), { status }); };

jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => mock.lang, getTranslator: () => new T(mock.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => false }));
// PC-56 STORE-4c · C1 (F-8): TenantHeader now carries the Sign out form (the existing logout action, whose module is server-only) — as SiteHeader
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 0 }));
jest.mock('../lib/storefront-data', () => ({
  loadTenantShell: async () => mock.shell,
  loadTenantProfile: async () => (mock.profile instanceof Error ? { ok: false, kind: 'unavailable' } : { ok: true, data: mock.profile }),
}));
jest.mock('../lib/api-client', () => ({
  publicClient: () => ({
    // PC-56 STORE-2a: the store's catalogue is read through `listings.search` (the public feed's own method); `browse` stays for old callers
    listings: { browse: async () => (mock.listings instanceof Error ? fail(503) : mock.listings), search: async () => (mock.listings instanceof Error ? fail(503) : mock.listings) },
    lookups: { categories: async () => [], regions: async () => [] },
    storefront: { flags: async () => mock.flags },
  }),
}));

import { PLATFORM_BRAND } from '@krishalaya/tokens';
import TenantLayout from '../app/[tenantSlug]/layout';
import TenantStorefront from '../app/[tenantSlug]/page';
import { TenantHeader } from '../components/TenantHeader';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';

const T = '0190a8b2-0000-7000-8000-000000000001';
const TENANT = { tenantId: T, slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' };
const BRANDING = { displayName: 'Anand FPO', logoUrl: null, brand: null };
const PROFILE = { displayName: 'Anand FPO', legalName: 'Anand Farmer Producer Company Ltd', verified: true, sinceYear: 2019, district: 'Anand', memberFarmers: 1240, logoUrl: null, logoPath: null, currencyCode: 'INR' };
const L = (i: number) => ({ id: `0190a8b2-0000-7000-8000-00000000020${i}`, title: `Lokwan wheat ${i}`, priceMinor: '256000', currencyCode: 'INR', unitCode: 'quintal',
  quantityAvailable: 40, organicClaim: false, saleType: 'direct', regionId: null, sellerUserId: '0190a8b2-0000-7000-8000-0000000000ff', boosted: false });
const page = (sp: Record<string, string> = {}) => ({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp });

async function store(sp: Record<string, string> = {}): Promise<string> {
  const children = await TenantStorefront(page(sp));
  return renderResolved(await TenantLayout({ children, params: { tenantSlug: 'anand-fpo' } }), [TenantHeader]);
}

beforeEach(() => {
  mock.lang = 'en';
  mock.shell = { kind: 'ok', tenant: TENANT, branding: BRANDING };
  mock.profile = PROFILE;
  mock.listings = { items: [L(1), L(2)], nextCursor: 'CUR2', total: 38, totalCap: 1000, membersOnlyCount: 0 };
  mock.flags = { group_lots: true };
});

describe('STORE-1b · W274 the tenant home — chrome', () => {
  it('the TENANT header is present and the platform SiteHeader brand is absent; the breadcrumb returns to the platform store', async () => {
    const html = await store();
    expect(html).toContain('data-kv-header="tenant"');
    expect(html).toContain('<span data-kv-mark="tenant">Anand FPO</span>');
    expect(html).not.toContain('data-kv-mark="platform-store"');
    expect(html).toMatch(/<ol class="kv-crumb"><li><a href="\/">Krishalaya Bazaar<\/a><\/li>/);
    expect(html).toContain('href="/anand-fpo/login"');           // this store's own sign-in
    expect(html).toContain('data-kv-footer="tenant"');
    expect(html).not.toContain('href="/tenants-signup"');         // the platform footer is a DELTA, not copied
  });

  it('"Powered by Krishalaya" IN the header (canon W274) and the footer — gone only when the brand hides it with the plan (13d rule)', async () => {
    let html = await store();
    const header = html.slice(0, html.indexOf('</header>'));
    expect(header).toContain(`data-kv-mark="platform">${PLATFORM_BRAND.poweredByMark}</small>`);
    mock.shell = { kind: 'ok', tenant: TENANT, branding: { ...BRANDING, brand: {
      version: 2, displayName: 'Anand FPO', appShortName: 'Anand', logoPath: `/v1/storefront/branding/logo/${T}/2`, logoMime: 'image/svg+xml',
      colours: { primary: '#1e6f3f', accent: '#f39c12', ink: '#232a33', surface: '#ffffff' }, poweredByHidden: true, publishedAt: '2026-10-01T00:00:00Z' } } };
    html = await store();
    expect(html).not.toContain(PLATFORM_BRAND.poweredByMark);
    expect(html).toContain(`src="https://api.test/v1/storefront/branding/logo/${T}/2"`);
  });

  it('unknown slug → notFound(); a TRIAL organisation (the API 404s an anonymous caller) → notFound(); an outage → DEGRADED, not 404', async () => {
    mock.shell = { kind: 'not_found' };
    await expect(TenantLayout({ children: null, params: { tenantSlug: 'search' } })).rejects.toThrow('NEXT_NOT_FOUND');
    await expect(TenantLayout({ children: null, params: { tenantSlug: 'trial-fpo' } })).rejects.toThrow('NEXT_NOT_FOUND');
    mock.shell = { kind: 'unavailable' };
    const html = await store();
    expect(html).toContain('data-kv-state="degraded"');
    expect(text(html)).toContain(en['tenant.degraded']);
  });
});

describe('STORE-1b · W274 the tenant home — profile, states, counts', () => {
  it('the profile: Verified (platform approval), since, registered name, district, member farmers; the canon\'s figures refused by name', async () => {
    const html = await store();
    expect(text(html)).toContain('Verified organisation');
    expect(text(html)).toContain('With Krishalaya since 2019');
    expect(text(html)).toContain('Registered name: Anand Farmer Producer Company Ltd');
    expect(text(html)).toContain('Based in Anand');
    expect(text(html)).toContain('1,240 member farmers');
    for (const k of ['tenant.refusal.description', 'tenant.refusal.rating', 'tenant.refusal.graded', 'tenant.refusal.why']) expect(text(html)).toContain(en[k]);
    expect(html).not.toMatch(/98\.2|4\.7★|2,180/);
    mock.profile = { ...PROFILE, verified: false };
    expect(await store()).not.toContain('Verified organisation');
  });

  it('ERROR ≠ EMPTY: the grid failed → its sentence + Retry to the same URL (query kept); the profile above still shows', async () => {
    mock.listings = new Error('down');
    const html = await store({ q: 'wheat', saleType: 'direct' });
    expect(text(html)).toContain(en['tenant.error']);
    expect(html).toMatch(/<a href="\/anand-fpo\?q=wheat&amp;saleType=direct" class="kv-btn" data-kv-retry="reload">Retry<\/a>/);
    expect(text(html)).toContain('1,240 member farmers');
    expect(text(html)).not.toContain('No listings from Anand FPO yet');
  });

  it('EMPTY only for a real empty answer: "No listings from <org> yet" + See other organisations', async () => {
    mock.listings = { items: [], nextCursor: null, total: 0, totalCap: 1000, membersOnlyCount: 0 };
    const html = await store();
    expect(text(html)).toContain('No listings from Anand FPO yet');
    expect(html).toContain('href="/organisations"');
    expect(html).not.toContain('data-kv-retry');
  });

  it('"N published" from the API; above the cap it reads "1,000+"; "See all N listings"', async () => {
    let html = await store();
    expect(text(html)).toContain('(38 published)');
    expect(text(html)).toContain('See all 38 listings');
    mock.listings = { items: [L(1)], nextCursor: null, total: 1001, totalCap: 1000, membersOnlyCount: 0 };
    html = await store();
    expect(text(html)).toContain('(1,000+ published)');
    expect(html).toContain('data-kv-count="capped"');
    expect(text(html)).not.toContain('1,001');
  });

  it('"Some lots are members-only" ONLY when the API counted at least one', async () => {
    expect(await store()).not.toContain('data-kv-state="members-only"');
    mock.listings = { items: [L(1)], nextCursor: null, total: 1, totalCap: 1000, membersOnlyCount: 3 };
    const html = await store();
    expect(text(html)).toContain('Some lots are members-only: Anand FPO keeps 3 published listings');
  });

  it('group lots OFF (storefront.flags) → the sentence, and the group-lot facet is not offered; ON → the facet, no sentence', async () => {
    let html = await store();
    expect(html).toContain('value="group_lot"');
    expect(html).not.toContain('data-kv-state="group-lots-off"');
    mock.flags = { group_lots: false };
    html = await store();
    expect(text(html)).toContain(en['tenant.groupLotsOff']);
    expect(html).not.toContain('value="group_lot"');
  });

  it('cards name the ORGANISATION — never a farmer or a member number; "Show more" carries the direction-safe arrow', async () => {
    const html = await store();
    expect((html.match(/Sold by Anand FPO/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/member #|Ramesh|Patel|0190a8b2-0000-7000-8000-0000000000ff/);
    expect(html).toMatch(/Show more <span class="kv-dir-flip">→<\/span><\/a>/);
    expect(html).toContain('href="/anand-fpo?cursor=CUR2"');
    expect(html).not.toMatch(/href="\/market\//);
  });

  it('the price band uses the store currency\'s exponent: a JPY store reads "1500" as 1500 minor units, never ×100', async () => {
    let seen: unknown = null;
    const api = jest.requireMock('../lib/api-client') as { publicClient: () => { listings: { search: (q: unknown) => Promise<unknown> } } };
    const orig = api.publicClient;
    api.publicClient = () => { const c = orig(); return { ...c, listings: { search: async (q: unknown) => { seen = q; return mock.listings; } } }; };
    try {
      mock.profile = { ...PROFILE, currencyCode: 'JPY' };
      await store({ priceMin: '1500' });
      expect(seen).toMatchObject({ priceMinMinor: '1500' });
      mock.profile = { ...PROFILE, currencyCode: 'INR' };
      await store({ priceMin: '1500' });
      expect(seen).toMatchObject({ priceMinMinor: '150000' });
    } finally { api.publicClient = orig; }
  });
});
