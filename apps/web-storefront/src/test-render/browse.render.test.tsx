// apps/web-storefront/src/test-render/browse.render.test.tsx · PC-56 STORE-2a · C1 — canon W275 BROWSE on a tenant store (/[tenantSlug]), in
// the markup a buyer receives: facets WITH their capped counts as links; the active filters as remove-one chips; the capped count line ("126
// listings" / "1,000+ listings") true under a filter; the category breadcrumb from the public tree; cards with the CONFIRMED grade, the organic
// kind, "Sold by <org> · <district>" and the regulated lock — never a farmer; "Show more" keeps the sort the cursor belongs to; EMPTY without
// "Tell me when" (refused by name); ERROR ≠ EMPTY with Retry = the same URL; the kill-switch OFF → "temporarily unavailable" (never "for
// this tenant/plan", never "no listings"); every §E refusal of the surface printed.
import * as React from 'react';

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
import { en } from '../i18n/en';
import { store2aRefusalKeys } from '../features/store2/refusals';
import { renderResolved, text } from './store1b-harness';
import { S, reset, PAGE, CARD, OFF, ID } from './store2a-fixtures';

const outsideRefusals = (html: string) => html.replace(/<section class="kv-refused"[\s\S]*?<\/section>/g, '');

const browse = async (sp: Record<string, string> = {}) => renderResolved(await TenantStorefront({ params: { tenantSlug: 'anand-fpo' }, searchParams: sp }), []);
beforeEach(reset);

describe('STORE-2a · W275 browse — facets, chips, the capped count', () => {
  it('facets WITH counts (grade incl. Not graded, organic split, district, sale type) as one-param links that drop the cursor', async () => {
    const html = await browse({ cursor: 'OLD', sort: 'price_asc' });
    expect(html).toContain('data-kv-facet="grade"');
    expect(text(html)).toContain('Grade A (74)');
    expect(text(html)).toContain('Not graded (11)');
    expect(text(html)).toContain('Natural farming (38)');
    expect(text(html)).toContain('Certified organic (9)');
    expect(text(html)).toContain('Junagadh (52)');
    expect(text(html)).toContain('Auction (17)');
    // a facet link sets ONE param, keeps the sort, never carries the old cursor
    expect(html).toContain(`href="/anand-fpo?grade=${ID.gradeA}&amp;sort=price_asc"`);
    expect(html).toContain(`href="/anand-fpo?district=${ID.junagadh}&amp;sort=price_asc"`);
    expect(html).not.toMatch(/cursor=OLD/);
  });

  it('active filters render as remove-one chips; the count line is TRUE under the filter and capped above the cap', async () => {
    let html = await browse({ grade: ID.gradeA, district: ID.junagadh, organic: 'natural' });
    expect(S.seen[0]).toMatchObject({ grade: ID.gradeA, district: ID.junagadh, organic: 'natural' });
    expect(html).toContain('data-kv-chip="grade"');
    expect(html).toContain(`href="/anand-fpo?district=${ID.junagadh}&amp;organic=natural"`);    // remove grade, keep the rest
    expect(html).toContain(`href="/anand-fpo?grade=${ID.gradeA}&amp;organic=natural"`);        // remove district
    expect(text(html)).toContain('126 listings');
    S.search = PAGE({ total: 1001, facets: null });
    html = await browse({ grade: ID.gradeA });
    expect(text(html)).toContain('1,000+ listings');
    expect(text(html)).not.toContain('1,001');
    expect(html).toContain('data-kv-state="facets-withheld"');                                   // above the cap: no sampled figures
    expect(html).not.toContain('data-kv-facet="grade"');
  });

  it('the category path: ?category= keeps the subtree; the breadcrumb comes from the public tree', async () => {
    const html = await browse({ category: ID.gnut });
    expect(S.seen[0]).toMatchObject({ category: ID.gnut });
    expect(html).toContain('data-kv-crumbs="category"');
    expect(text(html)).toMatch(/All lots\s+Crops\s+Oilseeds\s+Groundnut/);
    expect(html).toContain(`href="/anand-fpo?category=${ID.oil}"`);
  });

  it('cards: the confirmed grade, the organic kind, "Sold by <org> · <district>", the lock — never a farmer; Show more keeps the sort', async () => {
    S.search = PAGE({ items: [CARD(1, { licenceRequired: true }), CARD(2, { grade: null, organic: null, organicClaim: false })] });
    const html = await browse({ sort: 'price_desc' });
    expect((html.match(/data-kv-grade="confirmed"/g) ?? []).length).toBe(1);
    expect(text(html)).toContain('Sold by Anand FPO · Junagadh');
    expect((html.match(/data-kv-lock="licence"/g) ?? []).length).toBe(1);
    expect(text(html)).toContain('Licence required to buy');
    expect(html).not.toMatch(/Ramesh|member #|km\b/);
    expect(html).toContain('href="/anand-fpo?sort=price_desc&amp;cursor=CUR2"');
  });
});

describe('STORE-2a · W275 browse — states', () => {
  it('EMPTY without "Tell me when" (the refusal is printed by name instead)', async () => {
    S.search = PAGE({ items: [], nextCursor: null, total: 0 });
    const html = await browse({ grade: ID.gradeA });
    expect(html).toContain('data-kv-state="empty"');
    expect(outsideRefusals(html)).not.toMatch(/Tell me when/);                                      // never offered…
    expect(html).not.toMatch(/<(a|button)[^>]*>[^<]*Tell me when/);
    expect(html).toContain('data-kv-refusal="tell_me_when"');
  });

  it('ERROR ≠ EMPTY: its own sentence, filters kept, Retry = the same URL', async () => {
    S.search = new Error('down');
    const html = await browse({ grade: ID.gradeA, sort: 'price_asc' });
    expect(html).toContain('data-kv-state="error"');
    expect(html).not.toContain('data-kv-state="empty"');
    expect(text(html)).toContain(en['browse.errorKept']);
    expect(html).toContain(`<a href="/anand-fpo?grade=${ID.gradeA}&amp;sort=price_asc" class="kv-btn" data-kv-retry="reload">Retry</a>`);
  });

  it('kill-switch OFF (flags) → temporarily unavailable, no listings read, never "for this tenant/plan"', async () => {
    S.flags = { ...S.flags, storefront_browse: false };
    const html = await browse();
    expect(html).toContain('data-kv-state="browse-off"');
    expect(text(html)).toContain(en['store2a.browseOff.title']);
    expect(S.seen).toHaveLength(0);
    expect(html).not.toContain('data-kv-state="empty"');
    expect(text(html)).not.toMatch(/for this tenant\/plan|See store settings/);
  });

  it('kill-switch OFF answered by the read itself (503 STOREFRONT_BROWSE_OFF) → the same off state, not an error', async () => {
    S.search = OFF;
    const html = await browse();
    expect(html).toContain('data-kv-state="browse-off"');
    expect(html).not.toContain('data-kv-state="error"');
  });

  it('every §E refusal of this surface is printed by name', async () => {
    const html = await browse();
    for (const k of store2aRefusalKeys('browse')) expect(text(html)).toContain(en[k]);
    expect(store2aRefusalKeys('browse').length).toBeGreaterThanOrEqual(6);
  });
});
