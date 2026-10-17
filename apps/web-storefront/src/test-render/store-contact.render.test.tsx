// apps/web-storefront/src/test-render/store-contact.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (founder D6) — A STORE'S OWN CONTACT PAGE
// (`/<slug>/contact`). The organisation publishes no address, so the page offers the real door — "Message the organisation" about an order or a lot
// (the 4b button lives on the order and lot pages; links: this store's orders, this store's lots) — behind the store's `communication` flag (OFF →
// said; unreadable → said); the refusals by name (phone, short code, chat app, callbacks, one ticket system, a general thread); the PLATFORM's
// Grievances link — on a path store the same origin, on the store's own host the platform origin; no platform name, no mailbox.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: 'https://bazaar.example.test', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./sweep-fixtures'); return { loadTenantShell: f.loadTenantShell }; });
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import StoreContact from '../app/[tenantSlug]/contact/page';
import { sweepRefusalKeys } from '../features/sweep/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { ORG, S, SLUG, reset } from './sweep-fixtures';

beforeEach(() => reset());
const page = async () => renderToStaticMarkup(await StoreContact({ params: { tenantSlug: SLUG } }));

describe('STORE-SWEEP-a · D6 · a store\'s contact page', () => {
  it('messages ON: the order door and the lot door, inside THIS store; the organisation\'s name in the title', async () => {
    S.flags = { communication: true };
    const h = await page(); const w = text(h);
    expect(w).toContain(en['sweep.storeContact.title'].replace('{org}', ORG));
    expect(h).toContain('data-kv-door="order"'); expect(h).toContain('data-kv-door="lot"');
    expect(h).toContain(`href="/${SLUG}/orders"`); expect(h).toContain(`href="/${SLUG}"`);
    expect(w).toContain(en['sweep.storeContact.signIn']);
  });
  it('messages OFF: said — no door offered', async () => {
    S.flags = { communication: false };
    const h = await page();
    expect(h).toContain('data-kv-state="messages-off"');
    expect(h).not.toContain('data-kv-door=');
  });
  it('flags unreadable: said — never guessed', async () => {
    S.flags = new Error('down');
    const h = await page();
    expect(h).toContain('data-kv-state="messages-unknown"');
    expect(h).not.toContain('data-kv-door=');
  });
  it('the refusals by name; no phone, no mailbox, no platform name', async () => {
    const h = await page(); const w = text(h);
    for (const k of sweepRefusalKeys('contact_store')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(sweepRefusalKeys('contact_store').length).toBe(6);
    expect(h).not.toContain('@');
    for (const lit of [PLATFORM_BRAND.name, PLATFORM_BRAND.platformStoreName]) expect(w).not.toContain(lit);
  });
  it('Grievances → the PLATFORM\'s trust page: same origin on a path store, the platform origin on the store\'s own host', async () => {
    expect(await page()).toContain('href="/trust-data#grievances"');
    S.headers = { 'x-kv-tenant-slug': SLUG };          // host-routed by the middleware
    expect(await page()).toContain('href="https://bazaar.example.test/trust-data#grievances"');
  });
});
