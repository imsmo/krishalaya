// apps/web-storefront/src/test-render/inputs.render.test.tsx · PC-56 STORE-2a · C5 — canon W282 FARM INPUTS of a store: the tenant feed over
// the inputs subtree of the PUBLIC tree (commerce kind input_regulated — data, not a code); the "Licence required to buy" LOCK shown on the
// card, never used to hide it; nothing about licence states; FIFO / expiry / MRP-capped / 18+ / the label helpline / "hasn't switched on input
// sales" refused by name; no inputs category → said plainly; ERROR with Retry; the kill-switch OFF.
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

import FarmInputs from '../app/[tenantSlug]/inputs/page';
import { en } from '../i18n/en';
import { store2aRefusalKeys } from '../features/store2/refusals';
import { renderResolved, text } from './store1b-harness';
import { S, reset, PAGE, CARD, CATS, ID } from './store2a-fixtures';

const page = async () => renderResolved(await FarmInputs({ params: { tenantSlug: 'anand-fpo' }, searchParams: {} }), []);
beforeEach(reset);

describe('STORE-2a · W282 farm inputs', () => {
  it('reads the inputs subtree; the lock is SHOWN on a licence-required card, never hidden', async () => {
    S.search = PAGE({ items: [CARD(1, { title: 'Chlorpyrifos 20% EC', licenceRequired: true, grade: null }), CARD(2, { title: 'Urea 45 kg', grade: null })] });
    const html = await page();
    expect(S.seen[0]).toMatchObject({ category: ID.inputs });
    expect(text(html)).toContain('Chlorpyrifos 20% EC');
    expect((html.match(/data-kv-lock="licence"/g) ?? []).length).toBe(1);
    expect(text(html)).toContain(en['inputs.lockShown']);
    expect(text(html)).not.toMatch(/Licence pending|Licence expired|Upload renewal|verified within a day/);
  });
  it('FIFO / expiry / MRP-capped / 18+ / helpline / per-organisation switch — refused by name, never claimed', async () => {
    const html = await page();
    for (const k of store2aRefusalKeys('inputs')) expect(text(html)).toContain(en[k]);
    expect(text(html)).not.toMatch(/oldest batch ships first|MRP-capped price|sow-by|expiry Nov/);
  });
  it('no inputs category in the public tree → said plainly (no invented aisle); ERROR → Retry; OFF → unavailable', async () => {
    S.categories = CATS.filter((c) => c.commerceKind !== 'input_regulated');
    expect(await page()).toContain('data-kv-state="no-inputs-category"');
    reset(); S.search = new Error('down');
    expect(await page()).toContain('href="/anand-fpo/inputs" class="kv-btn" data-kv-retry="reload"');
    reset(); S.flags = { ...S.flags, storefront_browse: false };
    expect(await page()).toContain('data-kv-state="browse-off"');
  });
});
