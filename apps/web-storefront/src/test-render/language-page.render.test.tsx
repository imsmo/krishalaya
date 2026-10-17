// apps/web-storefront/src/test-render/language-page.render.test.tsx · PC-56 STORE-SWEEP-b · C3 (founder D3 — canon W323) — THE LANGUAGE PAGE, BOTH CHROMES:
//   • EXACTLY the live languages as buttons (en / hi / gu — the code registry, pinned to the seed by languages-drift.spec), each written in itself with its
//     own `lang`, in ONE form that POSTs to `/api/lang` with `from` = where the person came from (the link's `?from=`, else a same-host Referer, else
//     the chrome's home — `/` on the platform and on a store's own host, `/<slug>` on a path store);
//   • the language in use marked; the rest as ONE "not available yet" line (never a button);
//   • "change it later on your preferences page" with THIS chrome's preferences link; "Back without changing" → `from`;
//   • no speaker, no IP guess, no font download, no first-visit interstitial — refused by name; no platform name under a store.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./sweep-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./sweep-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient }; });
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import PlatformLanguage from '../app/(platform)/language/page';
import TenantLanguage from '../app/[tenantSlug]/language/page';
import { en } from '../i18n/en';
import { gu } from '../i18n/gu';
import { text } from './store1b-harness';
import { S, SLUG, reset } from './sweep-fixtures';
import { sweepRefusalKeys } from '../features/sweep/refusals';

const platform = (sp: Record<string, string> = {}) => renderToStaticMarkup(<>{PlatformLanguage({ searchParams: sp })}</>);
const store = (sp: Record<string, string> = {}) => renderToStaticMarkup(<>{TenantLanguage({ params: { tenantSlug: SLUG }, searchParams: sp })}</>);
const fromOf = (h: string) => h.match(/<input type="hidden" name="from" value="([^"]*)"/)?.[1];
beforeEach(() => reset());

describe('STORE-SWEEP-b · W323 the language page', () => {
  it.each([['the platform', platform], ['a store', store]] as const)('%s: exactly the live languages, each in itself, one form to /api/lang', (_n, render) => {
    const h = render();
    expect(h.match(/<form [^>]*action="\/api\/lang"[^>]*method="post"/g)).toHaveLength(1);
    const choices = [...h.matchAll(/data-kv-lang-choice="([a-z]+)"/g)].map((m) => m[1]);
    expect(choices).toEqual(['hi', 'en', 'gu']);
    expect(h).toMatch(/<button type="submit" name="lang" value="hi" lang="hi" dir="ltr"[^>]*>हिन्दी/);
    expect(h).toMatch(/<button type="submit" name="lang" value="gu" lang="gu" dir="ltr"[^>]*>ગુજરાતી/);
    expect(h).toMatch(/value="en"[^>]*aria-pressed="true"/);                  // the language in use
    expect(text(h)).toContain(en['sweep.language.inUse']);
  });
  it('the rest as ONE "not available yet" line — never a button', () => {
    const h = platform();
    expect(h).toContain('data-kv-coming-soon="11"');
    expect(text(h)).toContain('Not available yet (11), so they cannot be chosen:');
    expect(h).toContain('<span lang="mr" dir="ltr" data-kv-soon-lang="mr">मराठी</span>');
    expect(h).toContain('<span lang="ur" dir="rtl" data-kv-soon-lang="ur">اردو</span>');
    expect(h).not.toMatch(/value="(mr|ur|ar|ta)"/);
  });
  it('`from`: the link\'s ?from=, else a same-host Referer, else home (/ on the platform, /<slug> on a path store, / on the store\'s own host)', () => {
    expect(fromOf(platform({ from: '/orders?tab=active' }))).toBe('/orders?tab=active');
    S.headers = { host: 'shop.example.test', referer: 'https://shop.example.test/listings/abc?x=1' };
    expect(fromOf(platform())).toBe('/listings/abc?x=1');
    expect(fromOf(store())).toBe('/listings/abc?x=1');
    S.headers = { host: 'shop.example.test', referer: 'https://elsewhere.example.test/x' };
    expect(fromOf(platform())).toBe('/');
    expect(fromOf(store())).toBe(`/${SLUG}`);
    S.headers = { host: 'mandi.anandfpo.test', 'x-kv-tenant-slug': SLUG };        // host-routed by the middleware
    expect(fromOf(store())).toBe('/');
    expect(fromOf(platform({ from: '//evil.example.test' }))).toBe('/');
    expect(store({ from: `/${SLUG}/cart` })).toContain(`<a href="/${SLUG}/cart" class="kv-btn--link" data-kv-link="back">`);
  });
  it('"change it later" links THIS chrome\'s preferences page; the browser\'s own setting is named', () => {
    expect(platform()).toContain('href="/account/preferences"');
    expect(store()).toContain(`href="/${SLUG}/account/preferences"`);
    expect(text(platform())).toContain(en['sweep.language.browserNote']);
  });
  it('the refusals by name: no IP guess, no speaker, no font download, no first-visit interstitial; no platform name under a store', () => {
    const h = store(); const w = text(h);
    for (const k of sweepRefusalKeys('language')) expect(w).toContain(en[k as keyof typeof en]);
    expect(h).not.toMatch(/<audio|speaker-btn|data-kv-speaker|geo|@font-face/i);
    for (const lit of [PLATFORM_BRAND.name, PLATFORM_BRAND.platformStoreName]) expect(w).not.toContain(lit);
  });
  it('in Gujarati: the page in Gujarati, the buttons still each in itself', () => {
    S.lang = 'gu';
    const h = store(); const w = text(h);
    expect(w).toContain(gu['sweep.language.title']);
    expect(h).toMatch(/value="gu"[^>]*aria-pressed="true"/);
    expect(h).toMatch(/lang="en"[^>]*>English/);
  });
});
