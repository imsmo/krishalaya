// apps/web-storefront/src/test-render/sellers.render.test.tsx · PC-56 STORE-2a · C4 — canon W280 collapsed to THE ORGANISATION's seller page
// (/[tenantSlug]/sellers): the profile (verified = the platform's approval), the capped live-listing count, the live grid + Show more, the
// verified-purchase reviews aggregate ONLY with the reviews flag ON and with NO identity (founder D1); "Follow", the farmer's identity, the
// badges, "reviews translated" and bulk pricing refused by name; ERROR with Retry; the kill-switch OFF.
import * as React from 'react';

jest.mock('../lib/session', () => ({ requireSession: async () => 'tok' }));
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

import OrganisationSellerPage from '../app/[tenantSlug]/sellers/page';
import { en } from '../i18n/en';
import { store2aRefusalKeys } from '../features/store2/refusals';
import { renderResolved, text } from './store1b-harness';
import { S, reset } from './store2a-fixtures';

const page = async (sp: Record<string, string> = {}) => renderResolved(await OrganisationSellerPage({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }), []);
beforeEach(reset);

describe('STORE-2a · W280 → the organisation\'s seller page', () => {
  it('the organisation, verified by the platform, since-year, district, members, the capped live count; the live grid + Show more', async () => {
    const html = await page();
    expect(html).toContain('data-kv-seller-page="organisation"');
    expect(text(html)).toContain('Verified organisation');
    expect(text(html)).toContain('With Krishalaya since 2019');
    expect(text(html)).toContain('38 live listings');
    expect((html.match(/data-kv-grade="confirmed"/g) ?? []).length).toBe(2);
    expect(html).toContain('href="/anand-fpo/sellers?cursor=CUR2"');
    S.org = { ...S.org, listingCount: 1001 };
    expect(text(await page())).toContain('1,000+ live listings');
  });
  it('reviews: NOTHING while the flag is OFF (no "no ratings" either); ON → the verified-purchase aggregate with no identity', async () => {
    let html = await page();
    expect(html).not.toContain('data-kv-reviews');
    S.org = { ...S.org, reviews: { avg: 4.76, count: 98, capped: false, cap: 1000 } };
    html = await page();
    expect(text(html)).toContain('4.8 out of five, from 98 verified-purchase reviews of its sellers');
    expect(html).not.toMatch(/P••• M|Ahmedabad|Buyer [A-Z]/);
    S.org = { ...S.org, reviews: { avg: 4.5, count: 1001, capped: true, cap: 1000 } };
    expect(text(await page())).toContain('the average of the latest 1,000 verified-purchase reviews');
  });
  it('no person, no Follow, no badges — each refused by name', async () => {
    const html = await page();
    expect(html).not.toMatch(/Ramesh|member #|bigha|since Oct|<(a|button)[^>]*>Follow/);
    for (const k of store2aRefusalKeys('sellers')) expect(text(html)).toContain(en[k]);
  });
  it('ERROR → Retry = this URL; a missing organisation → 404; the kill-switch OFF → temporarily unavailable', async () => {
    S.org = new Error('down');
    expect(await page()).toContain('href="/anand-fpo/sellers" class="kv-btn" data-kv-retry="reload"');
    S.org = 404;
    await expect(page()).rejects.toThrow('NEXT_NOT_FOUND');
    reset(); S.flags = { ...S.flags, storefront_browse: false };
    expect(await page()).toContain('data-kv-state="browse-off"');
  });
});
