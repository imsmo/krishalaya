// apps/web-storefront/src/test-render/quality-promise.render.test.tsx · PC-56 STORE-SWEEP-a · C3 (canon W309; founder D1, money) — THE QUALITY
// PROMISE PRINTS WHAT THE CODE DOES, UNDER BOTH CHROMES. The page is DERIVED here from features/sweep/quality-rules.ts (never a copy): every rule in
// order with its mechanism; "the whole order payment" stated; none of "3%", "6 hours", "credits", "photos" as a promise, "disputed value only" or
// "held until" anywhere (mutant M4 prints "freezes the disputed value only" → red); the store's `disputes` flag decides the dispute rules (OFF →
// "this organisation has not switched on disputes"; unreadable → said so); the refusals by name; no platform name under a store.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import PlatformQuality from '../app/(platform)/quality-promise/page';
import TenantQuality from '../app/[tenantSlug]/quality-promise/page';
import { QUALITY_RULES, QUALITY_WINDOW_HOURS } from '../features/sweep/quality-rules';
import { sweepRefusalKeys } from '../features/sweep/refusals';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { S, SLUG, reset } from './sweep-fixtures';

beforeEach(() => reset());
const platform = () => renderToStaticMarkup(PlatformQuality());
const store = async () => renderToStaticMarkup(await TenantQuality({ params: { tenantSlug: SLUG } }));
const rule = (k: string) => en[k].replace('{hours}', String(QUALITY_WINDOW_HOURS));
const printedRules = (h: string) => [...h.matchAll(/data-kv-rule="([a-z_]+)" data-kv-mechanism="([a-z_]+)"/g)].map((m) => m[1]);

describe('STORE-SWEEP-a · W309 · the rules, derived from the registry', () => {
  it('the platform: EVERY rule in registry order (general, then the dispute rules under "each organisation decides"), each with its words', () => {
    const h = platform(); const w = text(h);
    const general = QUALITY_RULES.filter((r) => !r.disputes).map((r) => r.id);
    const disputes = QUALITY_RULES.filter((r) => r.disputes).map((r) => r.id);
    expect(printedRules(h)).toEqual([...general, ...disputes]);
    for (const r of QUALITY_RULES) expect([r.id, w.includes(rule(r.key))]).toEqual([r.id, true]);
    expect(w).toContain(en['sweep.quality.disputesPerStore']);
    expect(w).toMatch(/whole order payment stays in escrow/);
    expect(w).toContain(`${QUALITY_WINDOW_HOURS} hours after delivery`);
    expect(w).not.toMatch(/disputed value only|held until|\b3\s?%|\b6 hours|\bcredits\b|resolved in days/i);
  });
  it('a store with disputes ON: the same rules, the whole-payment rule stated; no "switched off" sentence', async () => {
    S.flags = { disputes: true };
    const h = await store(); const w = text(h);
    expect(printedRules(h)).toEqual([...QUALITY_RULES.filter((r) => !r.disputes), ...QUALITY_RULES.filter((r) => r.disputes)].map((r) => r.id));
    expect(w).toMatch(/whole order payment stays in escrow/);
    expect(h).toContain('data-kv-disputes="on"');
    expect(w).not.toContain(en['sweep.quality.disputesOff']);
  });
  it('a store with disputes OFF (the seed): no dispute rule, "this organisation has not switched on disputes"', async () => {
    S.flags = { disputes: false };
    const h = await store(); const w = text(h);
    expect(printedRules(h)).toEqual(QUALITY_RULES.filter((r) => !r.disputes).map((r) => r.id));
    expect(h).toContain('data-kv-state="disputes-off"');
    expect(w).toContain(en['sweep.quality.disputesOff']);
    expect(w).not.toContain(rule('sweep.quality.rule.dispute_text'));
  });
  it('a store whose flags cannot be read: no dispute rule, and it says it could not read — never guessed', async () => {
    S.flags = new Error('down');
    const h = await store();
    expect(h).toContain('data-kv-state="disputes-unknown"');
    expect(printedRules(h).some((id) => QUALITY_RULES.find((r) => r.id === id)?.disputes)).toBe(false);
  });
});

describe('STORE-SWEEP-a · W309 · the refusals, the links, the chrome', () => {
  it.each([['the platform', false], ['the organisation', true]] as const)('%s: the refusals by name; none of the canon\'s false promises as an offer', async (_n, isStore) => {
    S.flags = { disputes: true };
    const h = isStore ? await store() : platform(); const w = text(h);
    for (const k of sweepRefusalKeys('quality')) expect([k, w.includes(en[k])]).toEqual([k, true]);
    // outside the refusal block, nothing promises the refused rules
    const body = text(h.split('data-kv-refused="quality"')[0]);
    expect(body).not.toMatch(/disputed value only|held until|\b3\s?%|\b6 hours|\bcredits?\b|photos?|evidence board|resolved in days|re-grade|tolerance/i);
    expect(w).not.toMatch(/disputed value only|held until|\b3\s?%|\b6 hours|\bcredits\b/i);
  });
  it('the cancel rule links the person\'s orders (no ladder page); the trace rule links the code entry /trace — under the store, its own orders', async () => {
    expect(platform()).toContain('href="/orders"');
    const h = await store();
    expect(h).toContain(`href="/${SLUG}/orders"`);
    expect(h).toContain(`href="/${SLUG}/trace"`);   // PC-56 STORE-SWEEP-b · D5: the store's own trace entry (was the platform's /trace)
    expect(h).not.toMatch(/href="[^"]*cancel/);
  });
  it('a store: no platform name in the page', async () => {
    const w = text(await store());
    for (const lit of [PLATFORM_BRAND.name, PLATFORM_BRAND.platformStoreName]) expect(w).not.toContain(lit);
  });
});
