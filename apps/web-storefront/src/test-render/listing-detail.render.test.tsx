// apps/web-storefront/src/test-render/listing-detail.render.test.tsx · PC-56 STORE-2a · C3 — canon W277 THE LOT, in the markup a buyer
// receives: the CONFIRMED grade with its source ("graded by Anand FPO staff") and never an AI value or a confidence number (founder D2);
// the organic kind, the harvest day, "traceable" only with a trace token; the attributes table; "Where it grew: <district>" only; "Available
// 34 of 40"; "Minimum order"; the TRUE price sentences (fees at checkout — never "includes platform fee"); the offer form HIDDEN while the
// `offers` flag is OFF and shown when ON; the auction door only with `auctions` ON; escrow only with online payments ON; the lock; NO
// person; the TOMBSTONE (sold out / paused / expired / withdrawn) with the title and NO price, "Ask the seller to relist" → the organisation;
// ERROR with Retry; the kill-switch OFF; the §E refusals of this surface printed by name.
import * as React from 'react';

jest.mock('../lib/session', () => ({ requireSession: async () => 'tok' }));
jest.mock('next/navigation', () => ({ ...jest.requireActual('next/navigation'), notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', featureAuctions: true, siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
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

import ListingDetail from '../app/[tenantSlug]/listings/[id]/page';
import { en } from '../i18n/en';
import { store2aRefusalKeys } from '../features/store2/refusals';
import { renderResolved, text } from './store1b-harness';
import { S, reset, DETAIL, L1, OFF } from './store2a-fixtures';

const lot = async (sp: Record<string, string> = {}) => renderResolved(await ListingDetail({ params: { tenantSlug: 'anand-fpo', id: L1 }, searchParams: sp }), []);
const tomb = (status: string) => ({ id: L1, tombstone: true, status, title: 'GG-20 Groundnut — 40 qtl lot', organisation: { slug: 'anand-fpo', name: 'Anand FPO' }, category: { id: '0207c000-0000-7000-8000-000000000003', name: 'Groundnut' } });
beforeEach(reset);

describe('STORE-2a · W277 the lot — what is printed', () => {
  it('the CONFIRMED grade with its source; no AI value, no confidence, no AI banner', async () => {
    const html = await lot();
    expect(text(html)).toContain('Grade A · graded by Anand FPO staff');
    expect(text(html)).not.toMatch(/0\.91|confidence 0|AI photo-grade suggested|AI can be wrong/i);
    S.detail = DETAIL({ grade: null, gradeConfirmed: null });
    const none = await lot();
    expect(none).not.toContain('data-kv-grade="confirmed"');
    expect(text(none)).not.toContain('Grade A');
  });
  it('badges, attributes, where it grew (district only), available x of y, minimum order, traceable only with a token', async () => {
    let html = await lot();
    expect(text(html)).toContain('Organic claim: natural farming');
    expect(text(html)).toContain('Harvested 8 Jul 2026');
    expect(html).toContain('data-kv-trace="lot"');
    expect(html).toContain('data-kv-attributes="lot"');
    expect(text(html)).toContain('Moisture 7.8 %');
    expect(text(html)).toContain('Hand sorted Yes');
    expect(text(html)).toContain('Where it grew: Junagadh');
    expect(text(html)).toContain('Available 34 of 40 quintal');
    expect(text(html)).toContain('Minimum order 5 quintal');
    expect(html).not.toMatch(/Vanthali|taluka|21\.52|70\.45|362001/);
    S.detail = DETAIL({ qrToken: null });
    html = await lot();
    expect(html).not.toContain('data-kv-trace="lot"');
  });
  it('the price sentences are the true ones: fees and taxes at checkout; never "includes platform fee"; no delivery ETA, no per-km', async () => {
    const html = await lot();
    expect(text(html)).toContain(en['lot.feesAtCheckout']);
    expect(text(html)).toContain(en['lot.noReserve']);
    expect(text(html)).not.toMatch(/includes? (grading & )?platform fee|\/qtl\/100km|Delivery to \d/);
  });
  it('the offer form only with the offers flag ON; the auction door only with auctions ON; escrow only with online payments ON', async () => {
    S.detail = DETAIL({ auctionId: 'a1', auctionStatus: 'live' });
    let html = await lot();
    expect(html).not.toContain('data-kv-offer="form"');
    expect(html).not.toContain('id="auction-h"');
    expect(html).not.toContain('data-kv-escrow');
    S.flags = { ...S.flags, offers: true, auctions: true, online_payments: true };
    html = await lot();
    expect(html).toContain('data-kv-offer="form"');
    expect(html).toContain('id="auction-h"');
    expect(text(html)).toContain(en['lot.escrow']);
  });
  it('the regulated lock is SHOWN when the marker says so; the add-to-cart input takes decimals', async () => {
    S.marker = { licenceRequired: true, licenceRequiredIn: [], bannedRegions: [], safetyLabel: null };
    const html = await lot();
    expect(html).toContain('data-kv-lock="licence"');
    expect(html).toMatch(/id="qty-cart"[^>]*step="0.001"/);
  });
  it('no person: no farmer name, no member number — the organisation sells; the breadcrumb is store › category › lot', async () => {
    const html = await lot();
    expect(text(html)).toContain('Sold by Anand FPO');
    expect(html).not.toMatch(/Ramesh|Patel|member #|sellerUserId/);
    expect(text(html)).toMatch(/Store home\s+Crops\s+Oilseeds\s+Groundnut\s+GG-20 Groundnut — 40 qtl lot/);
  });
  it('every §E refusal of this surface is printed by name', async () => {
    const html = await lot();
    for (const k of store2aRefusalKeys('listing')) expect(text(html)).toContain(en[k]);
  });
});

describe('STORE-2a · W277 the lot — tombstone, error, off', () => {
  it.each(['sold_out', 'paused', 'expired', 'withdrawn'])('%s → the title, why, NO price; "Ask the seller to relist" → the organisation', async (status) => {
    S.detail = 404; S.tombstone = tomb(status);
    const html = await lot();
    expect(html).toContain(`data-kv-tombstone="${status}"`);
    expect(text(html)).toContain('GG-20 Groundnut — 40 qtl lot');
    expect(text(html)).toContain(en[`lot.tombstone.${status}`]);
    expect(text(html)).toContain(en['lot.tombstone.noPrice']);
    expect(text(html)).not.toMatch(/₹|6,150|615000|Available \d/);
    expect(html).toContain('href="/anand-fpo/sellers" class="kv-btn" data-kv-relist="organisation"');
    expect(html).toContain('data-kv-refusal="tell_me_if_returns"');
  });
  it('no tombstone either → a real 404', async () => {
    S.detail = 404; S.tombstone = 404;
    await expect(lot()).rejects.toThrow('NEXT_NOT_FOUND');
  });
  it('ERROR (not a 404) → its own sentence + Retry = this URL; the helpline is refused, never offered', async () => {
    S.detail = new Error('down');
    const html = await lot();
    expect(html).toContain('data-kv-state="error"');
    expect(html).toContain(`href="/anand-fpo/listings/${L1}" class="kv-btn" data-kv-retry="reload"`);
    expect(text(html)).not.toMatch(/1800|phone line 1/);
    expect(html).toContain('data-kv-refusal="listing_helpline"');
  });
  it('the kill-switch OFF (flags, or the read refusing by name) → temporarily unavailable', async () => {
    S.flags = { ...S.flags, storefront_browse: false };
    expect(await lot()).toContain('data-kv-state="browse-off"');
    reset(); S.detail = OFF;
    expect(await lot()).toContain('data-kv-state="browse-off"');
  });
});
