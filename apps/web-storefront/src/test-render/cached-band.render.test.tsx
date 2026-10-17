// apps/web-storefront/src/test-render/cached-band.render.test.tsx · PC-56 STORE-6a · D2 + D5 — A KEPT PAGE SAYS HOW OLD IT IS.
//   • the chromes stamp ONLY a page the middleware marked cacheable (`x-kv-cacheable: public`): `<meta name="kv-cacheable">` (the metadata),
//     `data-kv-rendered-at` on <main>, the hidden band and its inline script; an unmarked page carries none of it;
//   • the band's view in each tier (fresh / aging / prominent / full — "prices may have moved" only at full);
//   • the inline script embeds stale-tiers.ts `bandState` by its text and the labels JSON-escaped (no `</script>` can close it early);
//   • the script RUN against a small DOM double: offline → the band shows, always, with the relative age; online and fresh → hidden; past 1 h
//     every `.kv-money` cell gets `data-kv-stale="money"` AND the word (never colour alone); back to fresh → the marks are lifted.
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => { const f = jest.requireActual('./store6a-fixtures'); return { cookies: f.cookiesImpl, headers: f.headersImpl }; });
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND'); }, redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); }, usePathname: () => '/', useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: () => undefined }) }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: null, tenantAppUrl: null, razorpayKeyId: null } }));
jest.mock('../app/(platform)/login/actions', () => ({ logoutAction: async () => undefined }));
jest.mock('../lib/api-client', () => { const f = jest.requireActual('./store6a-fixtures'); return { publicClient: f.publicClient, serverClient: f.serverClient, sessionTenantClient: () => f.publicClient() }; });
jest.mock('../lib/storefront-data', () => { const f = jest.requireActual('./store6a-fixtures'); return { loadTenantShell: f.loadTenantShell }; });

import PlatformLayout, { generateMetadata as platformMeta } from '../app/(platform)/layout';
import TenantLayout, { generateMetadata as tenantMeta } from '../app/[tenantSlug]/layout';
import { CachedBandView, cachedBandRun, cachedBandScript, type BandLabels } from '../components/offline/CachedBand';
import { SiteHeader } from '../components/SiteHeader';
import { TenantHeader } from '../components/TenantHeader';
import { bandState } from '../features/store6/stale-tiers';
import { en } from '../i18n/en';
import { renderResolved, text } from './store1b-harness';
import { C, SLUG, reset } from './store6a-fixtures';

const L: BandLabels = {
  offline: en['store6.band.offline'], online: en['store6.band.online'], asOf: en['store6.band.asOf'], now: en['asOf.now'], minutes: en['asOf.minutes'],
  hours: en['asOf.hours'], days: en['asOf.days'], ago: en['asOf.ago'], pricesMoved: en['store6.band.pricesMoved'], moneyWord: en['store6.band.moneyWord'], reload: en['store6.band.reload'],
};
beforeEach(() => reset());

describe('STORE-6a · D2 · the chromes stamp ONLY a page the server marked cacheable', () => {
  it.each([['the platform', async () => renderResolved(PlatformLayout({ children: <p>page</p> }), [SiteHeader]), () => platformMeta()],
    ['the organisation', async () => renderResolved(await TenantLayout({ children: <p>page</p>, params: { tenantSlug: SLUG } }), [TenantHeader]), () => tenantMeta({ params: { tenantSlug: SLUG } })]] as const)(
    '%s: marked → <meta kv-cacheable>, data-kv-rendered-at on <main>, the hidden band + script; unmarked → none', async (_n, render, meta) => {
      C.headers = { 'x-kv-cacheable': 'public' };
      let h = await render();
      expect(h).toMatch(/<main class="kv-container" id="main" data-kv-rendered-at="\d{4}-\d\d-\d\dT[\d:.]+Z">/);
      expect(h).toMatch(/<div class="kv-state kv-cached-band kv-cached-band--fresh" data-kv-cached-band=""[^>]* hidden="">/);
      expect(h).toContain(String(bandState).slice(0, 40));
      expect((await meta()).other).toEqual({ 'kv-cacheable': 'public' });
      C.headers = {};
      h = await render();
      expect(h).not.toMatch(/data-kv-rendered-at|data-kv-cached-band/);
      expect((await meta()).other).toBeUndefined();
    });
});

describe('STORE-6a · D5 · the band', () => {
  it('the view in each tier; "prices may have moved" only at full; the as-of IST time', () => {
    const at = '2026-10-17T04:30:00.000Z';
    for (const tier of ['fresh', 'aging', 'prominent', 'full'] as const) {
      const h = renderToStaticMarkup(<CachedBandView at={at} tier={tier} online={false} labels={L} />);
      expect(h).toContain(`data-kv-tier="${tier}"`);
      expect(text(h)).toContain(`${L.offline} ${L.asOf} 2026-10-17 10:00 IST`);
      expect(h).toContain(tier === 'full' ? `<span data-kv-band-full="">${L.pricesMoved}` : `<span data-kv-band-full="" hidden="">`);
    }
  });
  it('the script embeds bandState by its text and escapes the labels (no </script> breaks out)', () => {
    const s = cachedBandScript({ ...L, offline: '</script><script>alert(1)</script>' });
    expect(s).toContain(String(bandState)); expect(s).toContain(String(cachedBandRun));
    expect(s).not.toContain('</script>');
    expect(s).toContain('\\u003c/script>');
    expect(() => new Function(s)).not.toThrow();                                    // parses as JavaScript (not run here — below it is)
  });
});

// ── the script RUN: a small DOM double ──
class N {
  tag: string; attrs = new Map<string, string>(); kids: N[] = []; parentNode: N | null = null; textContent = ''; hidden = false; className = '';
  constructor(tag: string, attrs: Record<string, string> = {}) { this.tag = tag; for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v); }
  getAttribute(n: string) { return this.attrs.get(n) ?? null; } setAttribute(n: string, v: string) { this.attrs.set(n, v); } removeAttribute(n: string) { this.attrs.delete(n); }
  appendChild(c: N) { c.parentNode = this; this.kids.push(c); return c; } removeChild(c: N) { this.kids.splice(this.kids.indexOf(c), 1); c.parentNode = null; return c; }
  all(): N[] { return this.kids.flatMap((k) => [k, ...k.all()]); }
  is(sel: string) { const m = /^([a-z]+)?(?:\[([\w-]+)\]|\.([\w-]+))?$/.exec(sel)!; return (!m[1] || m[1] === this.tag) && (!m[2] || this.attrs.has(m[2])) && (!m[3] || this.className.split(' ').includes(m[3]) || (this.attrs.get('class') ?? '').split(' ').includes(m[3])); }
  querySelector(sel: string) { return this.all().find((n) => n.is(sel)) ?? null; } querySelectorAll(sel: string) { return this.all().filter((n) => n.is(sel)); }
}
function runAt(renderedAgoMs: number, online: boolean) {
  const now = Date.parse('2026-10-17T10:00:00.000Z');
  const body = new N('body');
  const main = body.appendChild(new N('main', { 'data-kv-rendered-at': new Date(now - renderedAgoMs).toISOString() }));
  const band = main.appendChild(new N('div', { 'data-kv-cached-band': '' })); band.hidden = true;
  band.appendChild(new N('strong', { 'data-kv-band-state': '' })); band.appendChild(new N('span', { 'data-kv-band-rel': '' }));
  const full = band.appendChild(new N('span', { 'data-kv-band-full': '' })); full.hidden = true;
  const price = main.appendChild(new N('span', { class: 'kv-money' })); price.textContent = '6,150';
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = { document: g.document, window: g.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), now: Date.now };
  const listeners: Record<string, () => void> = {};
  g.document = { querySelector: (s: string) => body.querySelector(s), createElement: (t: string) => new N(t) };
  g.window = { addEventListener: (t: string, f: () => void) => { listeners[t] = f; }, setInterval: () => 0 };
  Object.defineProperty(globalThis, 'navigator', { value: { onLine: online }, configurable: true });
  Date.now = () => now;
  try { cachedBandRun(bandState, L); } finally {
    g.document = saved.document; g.window = saved.window; Date.now = saved.now;
    if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator);
  }
  return { band, full, price, listeners, rel: band.querySelector('[data-kv-band-rel]')!.textContent, state: band.querySelector('[data-kv-band-state]')!.textContent };
}
describe('STORE-6a · D5 · the band\'s script, run', () => {
  it('offline: ALWAYS shown, with the age; online and fresh: hidden; it listens for online / offline / pageshow', () => {
    const off = runAt(5 * 60_000, false);
    expect([off.band.hidden, off.band.getAttribute('data-kv-tier'), off.state, off.rel]).toEqual([false, 'fresh', L.offline, `5 ${L.minutes} ${L.ago}`]);
    expect(Object.keys(off.listeners).sort()).toEqual(['offline', 'online', 'pageshow']);
    const on = runAt(5 * 60_000, true);
    expect(on.band.hidden).toBe(true);
    expect(runAt(20 * 60_000, true).band.hidden).toBe(false);                          // online, past fresh: the as-of line
  });
  it('past 1 h: every price cell marked data-kv-stale="money" WITH the word; full past 24 h shows "prices may have moved"', () => {
    const p = runAt(2 * 60 * 60_000 + 5 * 60_000, false);
    expect([p.band.getAttribute('data-kv-tier'), p.rel]).toEqual(['prominent', `2 ${L.hours} 5 ${L.minutes} ${L.ago}`]);
    expect(p.price.getAttribute('data-kv-stale')).toBe('money');
    expect(p.price.querySelector('.kv-money__kept')!.textContent).toBe(` (${L.moneyWord})`);
    expect(p.full.hidden).toBe(true);
    const f = runAt(30 * 60 * 60_000, false);
    expect([f.band.getAttribute('data-kv-tier'), f.full.hidden, f.rel]).toEqual(['full', false, `1 ${L.days} ${L.ago}`]);
    const fresh = runAt(60_000, false);
    expect(fresh.price.getAttribute('data-kv-stale')).toBeNull();
  });
});
