// apps/web-storefront/src/test-render/accessibility.render.test.tsx · PC-56 STORE-5a · C4 (founder D4 / Q17) — canon W324 and its save chain:
//   • ONE screen under BOTH chromes (the platform's /account/accessibility and /<slug>/account/accessibility), no sign-in (a device preference);
//   • three modes — Senior, High contrast, Calm motion — each a form posting /api/mechanism with `chain=a11y` and the value that toggles it
//     (no confirm: W3074 is a DELTA); the state read from THIS device's cookies;
//   • the modes STACK: the root layout sets data-senior, data-contrast and data-motion together;
//   • the route: a chain post sets the cookie and answers `?a11y=saved&mode=` (W3075); a value the mode does not take sets NOTHING and answers
//     `?a11y=err&want=` (W3076) — the page says "Couldn't save — the previous setting still applies" with Retry re-posting the SAME values; a
//     post without the chain (4c's senior toggle) keeps its old answer;
//   • "Always true" — the floor the stylesheet proves (44px, 56px money actions, the focus ring); Voice-first and the other claims refused;
//   • 4c's preferences page links here (its senior toggle stays).
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
jest.mock('next/headers', () => ({ cookies: () => jest.requireActual('./store5a-fixtures').cookieJar() }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null } }));
jest.mock('../lib/i18n', () => {
  const { Translator: Tr } = jest.requireActual('@krishalaya/i18n');
  const cat = (l: string) => jest.requireActual(`../i18n/${l}`)[l];
  const f = jest.requireActual('./store5a-fixtures');
  return { getLang: () => f.C.lang, getLanguageDef: () => ({ code: f.C.lang, dir: 'ltr' }), getTranslator: () => new Tr(f.C.lang).register('en', cat('en')).register('hi', cat('hi')).register('gu', cat('gu')) };
});
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('../styles/globals.css', () => ({}), { virtual: true });
jest.mock('../features/branding/brand-theme', () => ({ PLATFORM_BRAND: { platformStoreName: 'Krishalaya' } }));

import PlatformA11yPage from '../app/(platform)/account/accessibility/page';
import TenantA11yPage from '../app/[tenantSlug]/account/accessibility/page';
import RootLayout from '../app/layout';
import { POST } from '../app/api/mechanism/route';
import { en } from '../i18n/en';
import { text } from './store1b-harness';
import { C, reset, SLUG } from './store5a-fixtures';
import { store5aRefusalKeys } from '../features/store5a/refusals';

const platform = (sp: Record<string, string> = {}) => renderToStaticMarkup(PlatformA11yPage({ searchParams: sp }));
const tenant = (sp: Record<string, string> = {}) => renderToStaticMarkup(TenantA11yPage({ params: { tenantSlug: SLUG }, searchParams: sp }));
type Req = Parameters<typeof POST>[0];
const req = (body: Record<string, string> | null, referer = 'http://store.test/account/accessibility') => ({
  formData: async () => { if (!body) throw new Error('not a form'); const f = new FormData(); for (const [k, v] of Object.entries(body)) f.set(k, v); return f; },
  headers: { get: (h: string) => (h === 'referer' ? referer : null) }, nextUrl: { origin: 'http://store.test' }, url: 'http://store.test/api/mechanism',
}) as unknown as Req;
const cookiesOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(/,(?=\s*kvs_)/).map((c) => c.trim().split(';')[0]).filter(Boolean);
beforeEach(() => { reset(); });

describe('STORE-5a · W324 the page under both chromes', () => {
  it('three modes, each a form posting /api/mechanism with chain=a11y and the value that TOGGLES it; the device\'s state; no sign-in needed', () => {
    const h = platform();
    expect(h).toContain('data-kv-screen="accessibility" data-kv-chrome="platform" data-kv-active="none"');
    for (const [m, v] of [['senior', 'on'], ['contrast', 'on'], ['motion', 'calm']]) {
      expect(h).toMatch(new RegExp(`data-kv-mode="${m}" data-kv-on="false"`));
      expect(h).toMatch(new RegExp(`<form action="/api/mechanism" method="post" class="kv-inline-form" data-kv-form="a11y-${m}"><input type="hidden" name="chain" value="a11y"/><input type="hidden" name="${m}" value="${v}"/>`));
    }
    expect(text(h)).toContain(en['store5a.a11y.deviceOnly']);
    const t = tenant();
    expect(t).toContain(`data-kv-chrome="${SLUG}"`);
    expect(t).toContain(`href="/${SLUG}/account"`);
  });
  it('with the cookies on: each mode says On and posts the value that turns it OFF', () => {
    C.cookies.set('kvs_senior', 'on'); C.cookies.set('kvs_contrast', 'on'); C.cookies.set('kvs_motion', 'calm');
    const h = platform();
    expect(h).toContain('data-kv-active="senior contrast motion"');
    for (const [m, v] of [['senior', 'off'], ['contrast', 'off'], ['motion', 'off']]) {
      expect(h).toMatch(new RegExp(`data-kv-mode="${m}" data-kv-on="true"`));
      expect(h).toContain(`<input type="hidden" name="${m}" value="${v}"/>`);
    }
  });
  it('"Always true" — only the floor the stylesheet proves (44 · 56 · focus); the refusals by name (Voice-first, speaking buttons, …)', () => {
    const h = platform();
    expect(h).toContain('data-kv-floor="3"');
    expect(text(h)).toContain('Every button and field is at least 44 pixels tall.');
    expect(text(h)).toMatch(/is at least 56 pixels tall, in every mode\./);
    expect(text(h)).toContain(en['store5a.a11y.floor.focus']);
    for (const k of store5aRefusalKeys('accessibility')) expect(text(h)).toContain(en[k as keyof typeof en]);
    expect(store5aRefusalKeys('accessibility')).toEqual(expect.arrayContaining(['store5a.refusal.voiceFirst', 'store5a.refusal.speaks', 'store5a.refusal.helper', 'store5a.refusal.everywhere', 'store5a.refusal.phoneLine', 'store5a.refusal.sellerPreview']));
    const outside = text(h.replace(/<section class="kv-refused"[\s\S]*?<\/section>/, ''));
    expect(outside).not.toMatch(/Voice-first|speaks|\*123#|elsewhere on next open|Sell \d+ quintals/i);
  });
});

describe('STORE-5a · W3075 / W3076 the save chain (no confirm — a device preference)', () => {
  it('W3075: a chain post sets the cookie and answers ?a11y=saved&mode= — the page says "Saved on this device" (and that modes are stacked)', async () => {
    const res = await POST(req({ chain: 'a11y', contrast: 'on' }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://store.test/account/accessibility?a11y=saved&mode=contrast');
    expect(cookiesOf(res)).toEqual(['kvs_contrast=on']);
    C.cookies.set('kvs_contrast', 'on'); C.cookies.set('kvs_motion', 'calm');
    const h = platform({ a11y: 'saved', mode: 'contrast' });
    expect(h).toContain('data-kv-a11y="saved" data-kv-saved-mode="contrast"');
    expect(text(h)).toContain(en['store5a.a11y.saved']);
    expect(h).toContain('data-kv-stacked="2"');
  });
  it('W3076: a value the mode does not take → NO cookie set (nothing half-switched), ?a11y=err; an unreadable post → err too', async () => {
    const bad = await POST(req({ chain: 'a11y', motion: 'wild', contrast: 'on' }));
    expect(cookiesOf(bad)).toEqual([]);
    expect(bad.headers.get('location')).toBe('http://store.test/account/accessibility?a11y=err');
    const none = await POST(req(null));
    expect(cookiesOf(none)).toEqual([]);
    expect(none.headers.get('location')).toContain('a11y=err');
  });
  it('W3076 page: "Couldn\'t save — the previous setting still applies" + Retry re-posting the SAME values (only a real mode and value)', () => {
    const h = platform({ a11y: 'err', want: 'motion:calm' });
    expect(h).toContain('data-kv-a11y="err"');
    expect(text(h)).toContain(en['store5a.a11y.failed']);
    expect(h).toMatch(/data-kv-form="a11y-retry"><input type="hidden" name="chain" value="a11y"\/><input type="hidden" name="motion" value="calm"\/><button[^>]*data-kv-want="motion:calm"/);
    expect(platform({ a11y: 'err', want: 'motion:wild' })).not.toContain('data-kv-form="a11y-retry"');
  });
  it('a post WITHOUT the chain (4c\'s senior toggle, the theme) keeps its old answer: back to the page as it was, the lenient senior rule', async () => {
    const res = await POST(req({ senior: 'on' }, 'http://store.test/account/preferences'));
    expect(res.headers.get('location')).toBe('http://store.test/account/preferences');
    expect(cookiesOf(res)).toEqual(['kvs_senior=on']);
    expect(cookiesOf(await POST(req({ senior: 'yes' })))).toEqual(['kvs_senior=off']);
  });
});

describe('STORE-5a · the modes STACK (the root layout)', () => {
  it('senior + contrast + calm motion together: three attributes on <html>; none without the cookies', () => {
    C.cookies.set('kvs_senior', 'on'); C.cookies.set('kvs_contrast', 'on'); C.cookies.set('kvs_motion', 'calm');
    const h = renderToStaticMarkup(RootLayout({ children: <main id="main">x</main> }));
    expect(h).toMatch(/<html[^>]*data-senior="true"/);
    expect(h).toMatch(/<html[^>]*data-contrast="true"/);
    expect(h).toMatch(/<html[^>]*data-motion="calm"/);
    reset();
    const plain = renderToStaticMarkup(RootLayout({ children: <main id="main">x</main> }));
    expect(plain).not.toMatch(/data-senior=|data-contrast=|data-motion=/);
  });
});
