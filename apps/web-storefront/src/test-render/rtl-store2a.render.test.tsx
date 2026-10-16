// apps/web-storefront/src/test-render/rtl-store2a.render.test.tsx · PC-56 STORE-2a · C7 — the five STORE-2a surfaces under dir="rtl": browse,
// search (platform + store), the lot, the organisation's page and farm inputs carry no PHYSICAL-direction class or inline style, and every
// "Show more" arrow is the direction-safe DirArrow (no bare arrow outside .kv-dir-flip). Same guards as rtl-store1b (store1b-harness).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('../lib/session', () => ({ requireSession: async () => 'tok' }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store2a-fixtures');
  return { getLang: () => f.S.lang, getTranslator: () => new Tr(f.S.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('../lib/auth', () => ({ hasSessionCookie: () => false }));
jest.mock('../features/cart/summary', () => ({ getCartItemCount: async () => 0 }));
jest.mock('../lib/storefront-data', () => {
  const f = jest.requireActual('./store2a-fixtures');
  return {
    loadTenantShell: async () => ({ kind: 'ok', tenant: { tenantId: f.T, slug: 'anand-fpo', displayName: 'Anand FPO', countryCode: null, defaultLang: null, phoneDefaultCountry: 'IN' }, branding: { displayName: 'Anand FPO', logoUrl: null, brand: null } }),
    loadTenantProfile: async () => ({ ok: true, data: f.S.profile }),
  };
});
jest.mock('../lib/api-client', () => ({ publicClient: () => jest.requireActual('./store2a-fixtures').apiClient() }));

import TenantStorefront from '../app/[tenantSlug]/page';
import PlatformSearch from '../app/(platform)/search/page';
import TenantSearch from '../app/[tenantSlug]/search/page';
import ListingDetail from '../app/[tenantSlug]/listings/[id]/page';
import OrganisationSellerPage from '../app/[tenantSlug]/sellers/page';
import FarmInputs from '../app/[tenantSlug]/inputs/page';
import { bareArrows, physical, resolveTree } from './store1b-harness';
import { reset, L1, S } from './store2a-fixtures';

const rtl = async (node: React.ReactNode) => renderToStaticMarkup(<div dir="rtl">{await resolveTree(node, [])}</div>);
beforeEach(() => { reset(); S.lang = 'en'; });

const SURFACES: Array<[string, () => Promise<React.ReactNode>]> = [
  ['W275 browse', () => TenantStorefront({ params: { tenantSlug: 'anand-fpo' }, searchParams: { sort: 'price_asc' } })],
  ['W276 platform search', () => PlatformSearch({ searchParams: { q: 'groundnut' } })],
  ['W276 store search', () => TenantSearch({ params: { tenantSlug: 'anand-fpo' }, searchParams: { q: 'groundnut' } })],
  ['W277 the lot', () => ListingDetail({ params: { tenantSlug: 'anand-fpo', id: L1 }, searchParams: {} })],
  ['W280 the organisation', () => OrganisationSellerPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: {} })],
  ['W282 farm inputs', () => FarmInputs({ params: { tenantSlug: 'anand-fpo' }, searchParams: {} })],
];

describe('STORE-2a · rtl', () => {
  it.each(SURFACES)('%s: no physical-direction class or style, no bare arrow', async (_name, make) => {
    const html = await rtl(await make());
    expect(physical(html)).toEqual([]);
    expect(bareArrows(html)).toBe(0);
  });
  it('the Show more arrows flip (browse, search, the organisation)', async () => {
    for (const [, make] of [SURFACES[0], SURFACES[1], SURFACES[2], SURFACES[4]]) {
      expect(await rtl(await make())).toMatch(/Show more <span class="kv-dir-flip">→<\/span>/);
    }
  });
  it('in Hindi and Gujarati too (the same markup rules hold in every catalogue)', async () => {
    for (const lang of ['hi', 'gu']) {
      S.lang = lang;
      const html = await rtl(await SURFACES[0][1]());
      expect(physical(html)).toEqual([]);
      expect(bareArrows(html)).toBe(0);
    }
  });
});
