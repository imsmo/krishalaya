// apps/web-storefront/src/test-render/help-page.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (canon W311; founder D8 — F-2, the first thing built) —
// HELP TELLS THE TRUTH, UNDER BOTH CHROMES.
//   • under a store, the money answer is the store's `online_payments`: ON → the escrow sentence (recorded in escrow, released on "I received it"
//     or when the window closes — never "held until"); OFF → "you pay on delivery; nothing is held"; flags unreadable → both, said;
//   • on the platform both cases are printed;
//   • no "held until", no "track delivery", no "support team" anywhere on the page (mutant M1 restores help.a2's old sentence → red);
//   • the refusals by name (derived from features/sweep/refusals.ts); every question of the registry, in order; the platform-only question never
//     under a store; "still need help?" → Contact (platform) / the store's contact page (store);
//   • under a store: no platform name (literal or token) in the page body, links stay inside the store.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: 'https://bazaar.example.test', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import PlatformHelp from '../app/(platform)/help/page';
import TenantHelp from '../app/[tenantSlug]/help/page';
import { HELP_ENTRIES, helpEntries } from '../features/sweep/help';
import { sweepRefusalKeys } from '../features/sweep/refusals';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { text } from './store1b-harness';
import { S, SLUG, reset } from './sweep-fixtures';

beforeEach(() => reset());
const platform = () => renderToStaticMarkup(PlatformHelp());
const store = async () => renderToStaticMarkup(await TenantHelp({ params: { tenantSlug: SLUG } }));
const fill = (k: string) => en[k].replace('{hours}', '24');
const FALSE_LINES = /held until|track (your )?deliver|support team|platform wallet|from within your account/i;

describe('STORE-SWEEP-a · W311 · the money answer reads the store', () => {
  it('a store with online payments ON: the escrow sentence only — recorded in escrow, released on "I received it" or the window', async () => {
    S.flags = { online_payments: true };
    const h = await store(); const w = text(h);
    expect(h).toContain('data-kv-money="online"');
    expect(w).toContain(fill('help.a2'));
    expect(w).not.toContain(en['help.a2cod']);
    expect(w).toMatch(/escrow/);
    expect(w).not.toMatch(FALSE_LINES);
  });
  it('a store with online payments OFF (the seed): pay on delivery, nothing held — no escrow sentence', async () => {
    S.flags = { online_payments: false };
    const h = await store(); const w = text(h);
    expect(h).toContain('data-kv-money="on_delivery"');
    expect(w).toContain(en['help.a2cod']);
    expect(w).not.toContain(fill('help.a2'));
    expect(w).not.toMatch(FALSE_LINES);
  });
  it('a store whose flags cannot be read: both cases, and it says it could not read', async () => {
    S.flags = new Error('flags down');
    const h = await store(); const w = text(h);
    expect(h).toContain('data-kv-state="flags-unknown"');
    expect(w).toContain(en['help.a2unknown']);
    expect(w).toContain(fill('help.a2')); expect(w).toContain(en['help.a2cod']);
  });
  it('the platform: BOTH cases, each named', () => {
    const h = platform(); const w = text(h);
    expect(h).toContain('data-kv-money="online on_delivery"');
    expect(w).toContain(`${en['help.a2when.online']} ${fill('help.a2')}`);
    expect(w).toContain(`${en['help.a2when.on_delivery']} ${en['help.a2cod']}`);
    expect(w).not.toMatch(FALSE_LINES);
  });
});

describe('STORE-SWEEP-a · W311 · the questions, the refusals, the chrome', () => {
  it.each([['the platform', 'platform'], ['the organisation', 'tenant']] as const)('%s: every question of the registry in order; the refusals by name', async (_n, kind) => {
    const h = kind === 'platform' ? platform() : await store(); const w = text(h);
    const printed = [...h.matchAll(/data-kv-help-entry="([a-z_]+)"/g)].map((m) => m[1]);
    expect(printed).toEqual(helpEntries(kind).map((e) => e.id));
    for (const e of helpEntries(kind)) expect(w).toContain(en[e.q]);
    for (const k of sweepRefusalKeys('help')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    expect(sweepRefusalKeys('help').length).toBe(9);
    expect(h).not.toMatch(/<input[^>]*type="search"|role="search"/);       // no help search (refused)
    expect(w).not.toMatch(/1800|\*123#|@/);
  });
  it('the platform: "still need help?" → /contact; the platform-only question opens an organisation\'s store', () => {
    const h = platform();
    expect(h).toContain('data-kv-help-entry="open_store"');
    expect(h).toContain('href="/contact"');
    expect(h).toContain('href="/for-organisations"');
    // PC-56 STORE-SWEEP-b · D3: "in your language" → the language page (was the preferences page — SW-a's DELTA help_language_link, closed)
    expect(h).toContain('href="/quality-promise"'); expect(h).toContain('href="/language"'); expect(h).not.toContain('href="/account/preferences"');
  });
  it('a store: every link stays in the store (its orders, its quality promise, its contact page, its language page, its trace entry); no platform name', async () => {
    const h = await store(); const w = text(h);
    expect(h).not.toContain('data-kv-help-entry="open_store"');
    // PC-56 STORE-SWEEP-b: the language page (D3) and the store's own trace entry (D5) — both under /<slug> now
    for (const href of [`/${SLUG}/orders`, `/${SLUG}/quality-promise`, `/${SLUG}/contact`, `/${SLUG}/language`, `/${SLUG}/trace`]) expect(h).toContain(`href="${href}"`);
    expect(h).not.toMatch(/href="\/(trace|language)"/);
    expect(h).not.toMatch(/href="\/(contact|help|quality-promise|for-organisations|orders)"/);
    expect(w).toContain(en['help.contactStore']);
    for (const lit of [PLATFORM_BRAND.name, PLATFORM_BRAND.platformStoreName]) expect(w).not.toContain(lit);
    expect(HELP_ENTRIES.length).toBe(12);
  });
  it('in Hindi the same page renders the Hindi answers (the store\'s money case)', async () => {
    S.lang = 'hi'; S.flags = { online_payments: false };
    const w = text(await store());
    expect(w).toContain(hi['help.a2cod']);
    expect(w).toContain(hi['help.title']);
  });
});
