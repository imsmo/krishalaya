// apps/web-storefront/src/test-render/search.render.test.tsx · PC-56 STORE-2a · C2 — canon W276 SEARCH, platform (/search) and tenant
// (/[tenantSlug]/search): "Results for …", the HONEST matching sentence, the Listings / Organisations tabs on the platform (name prefix,
// 0207) and none in a store, the capped count in a store, EMPTY with "Browse categories", ERROR with "browsing still works" + the category
// links, the kill-switch OFF; multilingual / spelling / voice / closest matches refused by name; the header search targets.
import * as React from 'react';

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

import PlatformSearch from '../app/(platform)/search/page';
import TenantSearch from '../app/[tenantSlug]/search/page';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { en } from '../i18n/en';
import { store2aRefusalKeys } from '../features/store2/refusals';
import { renderResolved, text } from './store1b-harness';
import { S, reset, PAGE, OFF } from './store2a-fixtures';

const platform = async (sp: Record<string, string> = {}) => renderResolved(await PlatformSearch({ searchParams: sp }), []);
const store = async (sp: Record<string, string> = {}) => renderResolved(await TenantSearch({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }), []);
beforeEach(reset);

describe('STORE-2a · W276 search — the platform', () => {
  it('"Results for …", the honest sentence, the Listings tab over the discovery feed (no grade printed — D2), Show more', async () => {
    const html = await platform({ q: 'groundnut' });
    expect(text(html)).toContain('Results for “groundnut”');
    expect(text(html)).toContain(en['search.honest.platform']);
    expect(html).toContain('data-kv-tab="listings" aria-current="page"');
    expect(text(html)).toContain('Sold by Anand FPO');
    expect(text(html)).not.toContain('Grade A');                                  // 0204's feed cannot say whether a person confirmed it
    expect(html).toContain('href="/search?q=groundnut&amp;after=D2"');
  });
  it('the Organisations tab reads the name-prefix search; no tab in a store', async () => {
    const html = await platform({ q: 'anand', tab: 'organisations' });
    expect(S.orgSeen[0]).toEqual({ q: 'anand' });
    expect(html).toContain('data-kv-card="organisation"');
    expect(html).toContain('href="/anand-fpo"');
    expect(await store({ q: 'groundnut' })).not.toContain('data-kv-tab=');
  });
  it('a query shorter than two letters asks for more (nothing searched); EMPTY → "Browse categories"', async () => {
    expect(await platform({ q: 'g' })).toContain('data-kv-state="prompt"');
    S.discover = { items: [], nextCursor: null };
    const html = await platform({ q: 'mugfali' });
    expect(html).toContain('data-kv-state="empty"');
    expect(text(html)).toContain('Browse categories');
    expect(html).toContain('data-kv-browse-links="categories"');
    expect(text(html)).not.toContain('Closest matches:');
  });
  it('ERROR → "search is having trouble; browsing still works" + the category links + Retry (a reload)', async () => {
    S.discover = new Error('down');
    const html = await platform({ q: 'groundnut' });
    expect(text(html)).toContain(en['search.error']);
    expect(html).toContain('data-kv-browse-links="categories"');
    expect(html).toContain('href="/search?q=groundnut" class="kv-btn" data-kv-retry="reload"');
  });
  it('kill-switch OFF → temporarily unavailable', async () => {
    S.flags = { ...S.flags, storefront_browse: false };
    expect(await platform({ q: 'groundnut' })).toContain('data-kv-state="browse-off"');
  });
  it('multilingual / spelling / voice / closest matches — refused by name, never claimed', async () => {
    const html = await platform({ q: 'groundnut' });
    for (const k of store2aRefusalKeys('search')) expect(text(html)).toContain(en[k]);
    expect(text(html)).not.toMatch(/three languages at once|spelling doesn't have to be perfect|Spoken search works|never show an empty wall/);
  });
});

describe('STORE-2a · W276 search — a store', () => {
  it('the tenant feed with the words, the capped count, the honest sentence, Show more with the sort', async () => {
    const html = await store({ q: 'groundnut', sort: 'price_asc' });
    expect(S.seen[0]).toMatchObject({ q: 'groundnut', sort: 'price_asc' });
    expect(text(html)).toContain('126 listings');
    expect(text(html)).toContain(en['search.honest.store']);
    expect(html).toContain('href="/anand-fpo/search?q=groundnut&amp;sort=price_asc&amp;cursor=CUR2"');
  });
  it('EMPTY → Browse categories (this store); ERROR ≠ EMPTY; the read refusing by name → the off state', async () => {
    S.search = PAGE({ items: [], total: 0, nextCursor: null });
    let html = await store({ q: 'zzz' });
    expect(html).toContain('data-kv-state="empty"');
    expect(html).toContain('href="/anand-fpo" class="kv-btn" data-kv-browse="categories"');
    S.search = new Error('down');
    html = await store({ q: 'zzz' });
    expect(html).toContain('data-kv-state="error"');
    expect(text(html)).toContain(en['search.error']);
    S.search = OFF;
    expect(await store({ q: 'zzz' })).toContain('data-kv-state="browse-off"');
  });
});

describe('STORE-2a · C2 — the header search targets', () => {
  it('the platform header searches /search; a tenant header searches /<slug>/search', async () => {
    const site = await renderResolved(<SiteHeader />, [SiteHeader]);
    expect(site).toMatch(/<form method="get" action="\/search" role="search"/);
    const tenant = await renderResolved(<TenantHeader slug="anand-fpo" name="Anand FPO" logoSrc={null} showPoweredBy />, [TenantHeader]);
    expect(tenant).toMatch(/<form method="get" action="\/anand-fpo\/search" role="search"/);
  });
});
