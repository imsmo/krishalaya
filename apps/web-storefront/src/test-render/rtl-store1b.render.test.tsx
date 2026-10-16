// apps/web-storefront/src/test-render/rtl-store1b.render.test.tsx · PC-56 STORE-1b — the two homes and their new pages under dir="rtl":
// the platform home (W273) in its platform chrome, a tenant home (W274) in its tenant chrome, /discover, /organisations and /trace, each
// with a "Show more" where there is one. The markup must carry (a) no PHYSICAL-direction class, (b) no physical inline style, (c) no bare
// "→"/"←" outside the flipping `.kv-dir-flip` span — the guards of rtl-store1a / web-tenant's rtl-sweep (store1b-harness.tsx), proven to
// bite first.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const mock = { lang: 'en' };
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: T } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  return { getLang: () => mock.lang, getTranslator: () => new T(mock.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => false }));
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 2 }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/storefront-data', () => ({
  loadTenantShell: async () => ({ kind: 'ok', tenant: { tenantId: 't', slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' }, branding: { displayName: 'Anand FPO', logoUrl: null, brand: null } }),
  loadTenantProfile: async () => ({ ok: true, data: { displayName: 'Anand FPO', legalName: 'Anand FPO Ltd', verified: true, sinceYear: 2019, district: 'Anand', memberFarmers: 12, logoUrl: null, logoPath: null, currencyCode: 'INR' } }),
}));
const CARD = { listingId: 'l1', tenantSlug: 'anand-fpo', organisation: 'Anand FPO', title: 'Groundnut', priceMinor: '615000', currencyCode: 'INR', unitCode: 'quintal', organic: true, grade: 'Grade A', district: 'Junagadh' };
const LISTING = { id: 'x1', title: 'Wheat', priceMinor: '256000', currencyCode: 'INR', unitCode: 'quintal', quantityAvailable: 4, organicClaim: false, saleType: 'direct', regionId: null, sellerUserId: 's', boosted: false };
jest.mock('../lib/api-client', () => ({
  publicClient: () => ({
    storefront: {
      stats: async () => ({ liveListings: 3, verifiedOrganisations: 2, districts: 1, computedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }),
      discover: async () => ({ items: [CARD], nextCursor: 'C2' }),
      organisations: async () => ({ items: [{ slug: 'anand-fpo', displayName: 'Anand FPO', district: 'Anand', logoUrl: null, logoPath: null, memberFarmers: 12 }], nextCursor: 'C2' }),
      flags: async () => ({ group_lots: false }),
    },
    // PC-56 STORE-2a: the tenant store reads its catalogue through `listings.search`
    listings: { browse: async () => ({ items: [LISTING], nextCursor: 'C2', total: 1, totalCap: 1000, membersOnlyCount: 2 }),
      search: async () => ({ items: [LISTING], nextCursor: 'C2', total: 1, totalCap: 1000, membersOnlyCount: 2, facets: null }) },
    lookups: { categories: async () => [], regions: async () => [] },
  }),
}));

import PlatformLayout from '../app/(platform)/layout';
import HomePage from '../app/(platform)/page';
import DiscoverPage from '../app/(platform)/discover/page';
import OrganisationsPage from '../app/(platform)/organisations/page';
import TraceHowPage from '../app/(platform)/trace/page';
import TenantLayout from '../app/[tenantSlug]/layout';
import TenantStorefront from '../app/[tenantSlug]/page';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { DirArrow } from '../components/DirArrow';
import { bareArrows, physical, resolveTree } from './store1b-harness';

const rtl = async (node: React.ReactNode, asyncTypes: Array<(p: any) => unknown>) => // eslint-disable-line @typescript-eslint/no-explicit-any
  renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, asyncTypes)}</div>);

describe('the guards bite (so a pass below means something)', () => {
  it('flags physical classes / styles / bare arrows; passes logical ones', () => {
    expect(physical('<p class="ml-2 pr-4 text-right rounded-l-md border-r float-left left-0"></p>')).toHaveLength(7);
    expect(physical('<p style="margin-left:4px"></p><p style="text-align:right"></p>')).toHaveLength(2);
    expect(physical('<p class="kv-hero kv-btn--link kv-crumb"></p>')).toEqual([]);
    expect(bareArrows('Show more →')).toBe(1);
    expect(bareArrows(renderToStaticMarkup(<p>Show more <DirArrow /></p>))).toBe(0);
  });
});

describe('STORE-1b pages under dir="rtl"', () => {
  const cases: Array<[string, () => Promise<React.ReactNode>, Array<(p: any) => unknown>]> = [   // eslint-disable-line @typescript-eslint/no-explicit-any
    ['W273 platform home (stale as-of, refusals, cards)', async () => PlatformLayout({ children: await HomePage() }), [SiteHeader]],
    ['/discover with "Show more"', async () => PlatformLayout({ children: await DiscoverPage({ searchParams: { q: 'gro' } }) }), [SiteHeader]],
    ['/organisations with "Show more"', async () => PlatformLayout({ children: await OrganisationsPage({ searchParams: {} }) }), [SiteHeader]],
    ['/trace with a malformed code', async () => PlatformLayout({ children: TraceHowPage({ searchParams: { code: '../x' } }) }), [SiteHeader]],
    ['W274 tenant home (members-only, group lots off, Show more)', async () => TenantLayout({ children: await TenantStorefront({ params: { tenantSlug: 'anand-fpo' }, searchParams: {} }), params: { tenantSlug: 'anand-fpo' } }), [TenantHeader]],
  ];
  it.each(cases)('%s', async (_n, build, asyncTypes) => {
    for (const lang of ['en', 'hi', 'gu']) {
      mock.lang = lang;
      const html = await rtl(await build(), asyncTypes);
      expect(html.startsWith('<div dir="rtl">')).toBe(true);
      expect([lang, physical(html)]).toEqual([lang, []]);
      expect([lang, bareArrows(html)]).toEqual([lang, 0]);
    }
  });
  it('every "Show more" on these pages carries the flipping arrow', async () => {
    mock.lang = 'en';
    const html = await rtl(await TenantLayout({ children: await TenantStorefront({ params: { tenantSlug: 'anand-fpo' }, searchParams: {} }), params: { tenantSlug: 'anand-fpo' } }), [TenantHeader]);
    expect(html).toMatch(/Show more <span class="kv-dir-flip">→<\/span>/);
  });
});
