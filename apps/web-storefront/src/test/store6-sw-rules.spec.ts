// apps/web-storefront/src/test/store6-sw-rules.spec.ts · PC-56 STORE-6a · D2 / D3 / D4 (survey E3) — THE OFFLINE RULES, PINNED, AND THE WORKER RUN.
// Two halves:
//   1. the pure rules (features/store6/sw-rules.ts): which (internal) path may be marked cacheable, never with a session cookie, never with the
//      flag OFF; the worker's request routing, the response rule (the `X-KV-Cacheable: public` HEADER — never the body), the bound (20 pages,
//      7 days — `evictPlan`, mutant M3), the fallback;
//   2. THE BUILT WORKER, RUN: the very source `/sw.js` serves (features/offline/sw-source.ts) executed in a sandbox (node's `vm` — jsdom is not
//      installed in this repo, and jsdom cannot run a worker either) with a fake Cache Storage, a fake network and a controllable clock:
//      install pre-caches the shell set only (no prefetch) and does NOT take over; `SKIP_WAITING` does; activate keeps exactly
//      `kv-sw-<build>` + `kv-pages-<build>`; a public page marked by the server is kept (with its stored instant), an unmarked one never; offline,
//      a navigation gets ITS kept copy, else the shell; a copy older than 7 days is never served; the 21st page evicts the least recently stored;
//      mutations, other origins, API paths, photos and authorised requests are never touched; the OFF worker deletes every `kv-*` cache,
//      claims and unregisters.
// What a sandbox cannot prove — a real browser's install, update and offline navigation — is the browser proof owed (report §8).
import vm from 'node:vm';
import {
  PAGE_DAYS, PAGE_LIMIT, cacheableRule, cacheableScope, evictPlan, formsDirty, hasSessionCookie, isTenantOfflinePath, swFallback, swRoute, swStorable, updateNoticeAllowed,
} from '../features/store6/sw-rules';
import { serviceWorkerSource, unregisterWorkerSource } from '../features/offline/sw-source';

const DAY = 24 * 60 * 60 * 1000;

describe('STORE-6a · D2 · the server\'s cacheable rule', () => {
  it.each([
    ['/anand-fpo', 'the organisation\'s page'], ['/anand-fpo/listings/0190a8b2-0000-7000-8000-00000000000a', 'a listing'],
    ['/anand-fpo/trace/KVTR9J4K2M', 'a trace page'], ['/anand-fpo/trace/KVTR9J4K2M/verify', 'its verify page'],
    ['/anand-fpo/certificates/0190a8b2-0000-7000-8000-00000000000c', 'a certificate'], ['/anand-fpo/search', 'the browse list'],
  ])('%s (%s): a tenant scope; cacheable ONLY with no session AND the flag ON', (path) => {
    expect(cacheableScope(path)).toEqual({ kind: 'tenant', slug: 'anand-fpo' });
    expect(cacheableRule(path, false, true)).toBe(true);
    expect(cacheableRule(path, true, true)).toBe(false);                          // a session cookie → never (mutant M2)
    expect(cacheableRule(path, false, false)).toBe(false);                        // the flag OFF (or unreadable) → never
    expect(cacheableRule(path, true, false)).toBe(false);
  });
  it('the platform host\'s own public pages are a PLATFORM scope (whose flag reads OFF — lib/offline-reads.ts)', () => {
    for (const p of ['/trace/KVTR9J4K2M', '/trace/KVTR9J4K2M/verify', '/certificates/0190a8b2', '/search']) expect(cacheableScope(p)).toEqual({ kind: 'platform' });
  });
  it.each([
    '/anand-fpo/cart', '/anand-fpo/checkout', '/anand-fpo/checkout/pay', '/anand-fpo/checkout/confirm', '/anand-fpo/account', '/anand-fpo/account/data',
    '/anand-fpo/orders', '/anand-fpo/orders/x', '/anand-fpo/orders/x/cancel', '/anand-fpo/messages', '/anand-fpo/messages/x', '/anand-fpo/notifications',
    '/anand-fpo/auctions', '/anand-fpo/auctions/x', '/anand-fpo/offers', '/anand-fpo/offers/x', '/anand-fpo/login', '/anand-fpo/offline',
    '/anand-fpo/trace/x/export', '/anand-fpo/trace/x/dairy', '/anand-fpo/certificates', '/anand-fpo/queued', '/anand-fpo/app', '/anand-fpo/sellers',
    '/', '/offline', '/cart', '/account', '/login', '/checkout', '/orders/x', '/messages', '/auctions/x', '/offers/x', '/about', '/app', '/queued',
    '/trace', '/certificates', '/for-organisations', '/sw.js', '/api/ping', '/anand-fpo/listings', '/anand-fpo/listings/x/extra', '//evil', '',
  ])('%s: NEVER cacheable (account, orders, messages, cart, checkout, payment, auctions, offers, the inbox, sign-in, the shell…)', (path) => {
    expect(cacheableScope(path)).toBeNull();
    expect(cacheableRule(path, false, true)).toBe(false);
  });
  it('the session cookies: kv_session, kv_refresh or kv_tid — any one is a session', () => {
    expect(hasSessionCookie((n) => n === 'kv_refresh')).toBe(true);
    expect(hasSessionCookie((n) => n === 'kv_tid')).toBe(true);
    expect(hasSessionCookie((n) => n === 'kv_lang' || n === 'kvs_owner')).toBe(false);   // a device preference / the owner marker is not a session
  });
  it('the organisation\'s offline page is the one its layout renders session-free', () => {
    expect(isTenantOfflinePath('/anand-fpo/offline')).toBe(true);
    expect(isTenantOfflinePath('/offline')).toBe(false);
    expect(isTenantOfflinePath('/anand-fpo/offline/x')).toBe(false);
  });
});

describe('STORE-6a · the worker\'s pure rules', () => {
  const O = 'https://store.test';
  const SHELL = ['/offline', '/icon-192.png', '/icon-512.png', '/favicon.svg', '/manifest.webmanifest'];
  it('routing: never a mutation, another origin, an API path, a photo or an authorised request; navigations; the shell + build chunks static', () => {
    expect(swRoute('POST', `${O}/anand-fpo/cart`, O, false, 'navigate', 'document', SHELL)).toBe('pass');
    expect(swRoute('GET', 'https://api.test/v1/x', O, false, 'cors', '', SHELL)).toBe('pass');
    expect(swRoute('GET', `${O}/v1/storefront/flags`, O, false, 'cors', '', SHELL)).toBe('pass');
    expect(swRoute('GET', `${O}/api/ping`, O, false, 'cors', '', SHELL)).toBe('pass');
    expect(swRoute('GET', `${O}/media/listing/1.jpg`, O, false, 'navigate', 'image', SHELL)).toBe('pass');
    expect(swRoute('GET', `${O}/anand-fpo`, O, true, 'navigate', 'document', SHELL)).toBe('pass');
    expect(swRoute('GET', `${O}/anand-fpo`, O, false, 'navigate', 'document', SHELL)).toBe('navigate');
    expect(swRoute('GET', `${O}/_next/static/chunks/a.js`, O, false, 'no-cors', 'script', SHELL)).toBe('static');
    expect(swRoute('GET', `${O}/icon-192.png`, O, false, 'no-cors', 'image', SHELL)).toBe('static');
    expect(swRoute('GET', `${O}/_next/image?url=x`, O, false, 'no-cors', 'image', SHELL)).toBe('pass');   // no image beyond the shell's icons
    expect(swRoute('GET', `${O}/anand-fpo/listings/x`, O, false, 'cors', '', SHELL)).toBe('pass');         // an RSC fetch is not a navigation
  });
  it('a response is kept ONLY when it is a plain 200 HTML page the server marked `X-KV-Cacheable: public`', () => {
    expect(swStorable(200, 'basic', false, 'public', 'text/html; charset=utf-8')).toBe(true);
    expect(swStorable(200, 'basic', false, null, 'text/html')).toBe(false);
    expect(swStorable(200, 'basic', false, 'private', 'text/html')).toBe(false);
    expect(swStorable(200, 'basic', true, 'public', 'text/html')).toBe(false);
    expect(swStorable(200, 'opaque', false, 'public', 'text/html')).toBe(false);
    expect(swStorable(404, 'basic', false, 'public', 'text/html')).toBe(false);
    expect(swStorable(200, 'basic', false, 'public', 'image/jpeg')).toBe(false);
  });
  it('evictPlan: 20 pages, 7 days, the least recently STORED out first (mutant M3: keeping 21 turns this red)', () => {
    const now = 100 * DAY;
    const e = Array.from({ length: 21 }, (_, i) => ({ url: `/p${i}`, storedAt: now - (21 - i) * 60_000 }));   // p0 the oldest
    expect(evictPlan(e, now)).toEqual(['/p0']);
    expect(evictPlan(e.slice(1), now)).toEqual([]);
    expect(evictPlan([{ url: '/old', storedAt: now - 7 * DAY - 1 }, { url: '/edge', storedAt: now - 7 * DAY }], now)).toEqual(['/old']);
    expect(evictPlan([{ url: '/nostamp', storedAt: NaN }, { url: '/zero', storedAt: 0 }], now)).toEqual(['/nostamp', '/zero']);
    expect(PAGE_LIMIT).toBe(20); expect(PAGE_DAYS).toBe(7);                     // the copy's numbers ARE the defaults
    const many = Array.from({ length: 30 }, (_, i) => ({ url: `/q${i}`, storedAt: now - i * 1000 }));
    expect(evictPlan(many, now).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `/q${i + 20}`).sort());
  });
  it('the fallback is the host-root /offline (one worker per origin; a path store gets the platform shell — the named limit)', () => {
    expect(swFallback('/anand-fpo/listings/x')).toBe('/offline');
    expect(swFallback('/listings/x')).toBe('/offline');
  });
  it('the polite update: never over a form with content', () => {
    const doc = (fields: Array<Record<string, unknown>>) => ({ querySelectorAll: () => fields as never });
    expect(formsDirty(doc([{ type: 'hidden', value: 'k', defaultValue: '' }, { type: 'text', value: '', defaultValue: '' }]))).toBe(false);
    expect(formsDirty(doc([{ type: 'text', value: 'wheat', defaultValue: '' }]))).toBe(true);
    expect(updateNoticeAllowed(true)).toBe(false); expect(updateNoticeAllowed(false)).toBe(true);
  });
});

// ─────────────────────────────── the built worker, run ───────────────────────────────

const ORIGIN = 'https://store.test';
class FakeCache {
  m = new Map<string, Response>();
  key(r: string | Request) { return new URL(typeof r === 'string' ? r : r.url, ORIGIN).href; }
  async put(r: string | Request, res: Response) { this.m.set(this.key(r), res); }
  async match(r: string | Request) { const h = this.m.get(this.key(r)); return h ? h.clone() : undefined; }
  async keys() { return [...this.m.keys()].map((u) => new Request(u)); }
  async delete(r: string | Request) { return this.m.delete(this.key(r)); }
  async addAll(rs: Request[]) { for (const r of rs) { const res = await NET.fetch(r); if (!res.ok) throw new Error('addAll'); await this.put(r, res); } }
}
class FakeStorage {
  c = new Map<string, FakeCache>();
  async open(n: string) { if (!this.c.has(n)) this.c.set(n, new FakeCache()); return this.c.get(n)!; }
  async keys() { return [...this.c.keys()]; }
  async delete(n: string) { return this.c.delete(n); }
  async match(r: string | Request) { for (const c of this.c.values()) { const h = await c.match(r); if (h) return h; } return undefined; }
}
/** A same-origin network answer is `type: 'basic'` in a browser (node's Response says 'default'). */
class BasicResponse extends Response { get type(): ResponseType { return 'basic'; } }
const NET: { down: boolean; seen: string[]; fetch: (r: Request | string) => Promise<Response>; page: (url: string) => Response } = {
  down: false, seen: [],
  page: (url: string) => new BasicResponse(`<html>${url}</html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
  fetch: async (r) => {
    const url = new URL(typeof r === 'string' ? r : r.url, ORIGIN);
    NET.seen.push(url.pathname);
    if (NET.down) throw new TypeError('Failed to fetch');
    if (url.pathname.startsWith('/anand-fpo/listings/')) return new BasicResponse(`<html>${url.pathname}</html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-kv-cacheable': 'public' } });
    return NET.page(url.pathname);
  },
};
function boot(src: string) {
  const L: Record<string, Array<(e: unknown) => void>> = {};
  const clock = { t: 50 * DAY };
  class FD extends Date { static now() { return clock.t; } }
  const caches = new FakeStorage();
  const self = { addEventListener: (t: string, f: (e: unknown) => void) => { (L[t] ||= []).push(f); }, location: { origin: ORIGIN },
    skipWaiting: jest.fn(async () => undefined), clients: { claim: jest.fn(async () => undefined) }, registration: { unregister: jest.fn(async () => true) } };
  class SReq extends Request { constructor(u: string | Request, init?: RequestInit) { super(typeof u === 'string' ? new URL(u, ORIGIN).href : u, init); } }
  vm.runInContext(src, vm.createContext({ self, caches, fetch: (r: Request) => NET.fetch(r), Request: SReq, Response, Headers, URL, Promise, Date: FD, Number, String, isFinite, Math }));
  const fire = async (type: string, extra: Record<string, unknown> = {}) => {
    const waits: Promise<unknown>[] = []; let responded: Promise<Response> | null = null;
    const ev = { ...extra, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, respondWith: (p: Promise<Response>) => { responded = p; } };
    for (const f of L[type] ?? []) f(ev);
    const res = responded ? await (responded as Promise<Response>) : null;
    await Promise.all(waits); await Promise.all(waits);   // keep() schedules its own work inside its promise
    return res as Response | null;
  };
  const nav = (path: string, init: { method?: string; auth?: boolean; mode?: string } = {}) => {
    const h = new Headers(init.auth ? { authorization: 'Bearer x' } : {});
    const request = { url: new URL(path, ORIGIN).href, method: init.method ?? 'GET', headers: h, mode: init.mode ?? 'navigate', destination: init.mode && init.mode !== 'navigate' ? '' : 'document' };
    return fire('fetch', { request });
  };
  return { L, self, caches, clock, fire, nav };
}

describe('STORE-6a · the built worker (`/sw.js` ON), run in a sandbox', () => {
  beforeEach(() => { NET.down = false; NET.seen = []; });
  it('install pre-caches the SHELL SET ONLY (no prefetch, founder D3) and does not take over; SKIP_WAITING does', async () => {
    const w = boot(serviceWorkerSource('b6a'));
    await w.fire('install');
    expect([...(await w.caches.keys())]).toEqual(['kv-sw-b6a']);
    expect(NET.seen.sort()).toEqual(['/favicon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/offline']);
    expect(w.self.skipWaiting).not.toHaveBeenCalled();
    await w.fire('message', { data: { type: 'SKIP_WAITING' } });
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
    await w.fire('message', { data: { type: 'ANYTHING_ELSE' } });
    expect(w.self.skipWaiting).toHaveBeenCalledTimes(1);
  });
  it('activate keeps exactly kv-sw-<build> and kv-pages-<build>; every other cache (older builds, anything else) is deleted', async () => {
    const w = boot(serviceWorkerSource('b6a'));
    for (const n of ['kv-sw-old', 'kv-pages-old', 'kv-sw-b6a', 'kv-pages-b6a', 'someone-else']) await w.caches.open(n);
    await w.fire('activate');
    expect((await w.caches.keys()).sort()).toEqual(['kv-pages-b6a', 'kv-sw-b6a']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });
  it('never touches a mutation, another origin, an API path, a photo or an authorised request', async () => {
    const w = boot(serviceWorkerSource('b6a'));
    expect(await w.nav('/anand-fpo/cart', { method: 'POST' })).toBeNull();
    expect(await w.nav('https://api.test/v1/x', { mode: 'cors' })).toBeNull();
    expect(await w.nav('/v1/storefront/flags', { mode: 'cors' })).toBeNull();
    expect(await w.nav('/media/x.jpg')).toBeNull();
    expect(await w.nav('/anand-fpo/listings/x', { auth: true })).toBeNull();
  });
  it('online: a page the server MARKED is kept with its stored instant; an unmarked page (a cart, an account) never', async () => {
    const w = boot(serviceWorkerSource('b6a'));
    const r = await w.nav('/anand-fpo/listings/l1');
    expect(r?.status).toBe(200);
    const pages = await w.caches.open('kv-pages-b6a');
    const kept = await pages.match('/anand-fpo/listings/l1');
    expect(kept?.headers.get('x-kv-stored-at')).toBe(String(w.clock.t));
    await w.nav('/anand-fpo/cart'); await w.nav('/anand-fpo/account');
    expect((await pages.keys()).map((k) => new URL(k.url).pathname)).toEqual(['/anand-fpo/listings/l1']);
  });
  it('offline: a navigation gets ITS kept copy; an unkept one gets the shell; a copy older than 7 days is never served', async () => {
    const w = boot(serviceWorkerSource('b6a'));
    await w.fire('install');
    await w.nav('/anand-fpo/listings/l1');
    NET.down = true;
    expect(await (await w.nav('/anand-fpo/listings/l1'))!.text()).toBe('<html>/anand-fpo/listings/l1</html>');
    expect(await (await w.nav('/anand-fpo/listings/never-opened'))!.text()).toBe('<html>/offline</html>');
    expect(await (await w.nav('/anand-fpo/cart'))!.text()).toBe('<html>/offline</html>');
    w.clock.t += 7 * DAY + 1;
    expect(await (await w.nav('/anand-fpo/listings/l1'))!.text()).toBe('<html>/offline</html>');
  });
  it('bounded: the 21st kept page evicts the least recently stored', async () => {
    const w = boot(serviceWorkerSource('b6a'));
    for (let i = 0; i < 21; i++) { w.clock.t += 1000; await w.nav(`/anand-fpo/listings/l${i}`); }
    const left = (await (await w.caches.open('kv-pages-b6a')).keys()).map((k) => new URL(k.url).pathname);
    expect(left.length).toBe(20);
    expect(left).not.toContain('/anand-fpo/listings/l0');
    expect(left).toContain('/anand-fpo/listings/l20');
  });
});

describe('STORE-6a · D4 · the OFF worker (`storefront_pwa` OFF), run in a sandbox', () => {
  it('takes over at once, deletes every kv-* cache (and nothing else), claims and unregisters; it intercepts nothing', async () => {
    const w = boot(unregisterWorkerSource());
    for (const n of ['kv-sw-b6a', 'kv-pages-b6a', 'kv-sw-old', 'someone-else']) await w.caches.open(n);
    await w.fire('install');
    expect(w.self.skipWaiting).toHaveBeenCalled();
    await w.fire('activate');
    expect(await w.caches.keys()).toEqual(['someone-else']);
    expect(w.self.clients.claim).toHaveBeenCalled();
    expect(w.self.registration.unregister).toHaveBeenCalled();
    expect(w.L.fetch).toBeUndefined();
  });
});
