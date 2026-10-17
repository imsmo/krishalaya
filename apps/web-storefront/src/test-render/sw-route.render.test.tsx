// apps/web-storefront/src/test-render/sw-route.render.test.tsx · PC-56 HOTFIX-8 · D1 (b) — THE WORKER IS VERSIONED BY THE BUILD. The route
// `app/sw.js/route.ts` is called as Next calls it (a GET, a Web `Response` back) and its body read:
//   • the cache VERSION is `kv-sw-<NEXT_PUBLIC_BUILD_ID>` — two builds → two different workers (a deploy is a new worker byte, so the
//     browser installs it and `activate` drops the old build's caches); an id with unsafe characters or none → 'dev', never injected;
//   • `Cache-Control: no-cache`, JavaScript, noindex;
//   • `activate` deletes every cache not named for this build; the shell is fetched with `cache: 'reload'`;
//   • PC-24c's fetch rules unchanged: never a non-GET, cross-origin, /v1/ or /api/, or a request with Authorization.
// (Named file deviation: the brief's `sw-route.test.ts` — the render harness matches `*.render.test.tsx`.) Mutant M3 (VERSION back to a
// constant) turns this red. What jsdom cannot run — the worker's install/activate in a browser — is the browser proof owed (report §8).
//
// PC-56 STORE-6a · D2 / D4 (updated, the HOTFIX-8 assertions kept where still true):
//   • the route reads `storefront_pwa` (platform flags, no tenant): ON → the versioned worker (`X-KV-Worker: on`); OFF → the SELF-UNREGISTERING
//     worker (deletes every `kv-*` cache, claims, unregisters; no fetch handler); the read FAILS OPEN (an API error, or an answer without the key,
//     serves the worker — never the kill-switch by accident);
//   • POLITE: no `skipWaiting` at install — only on the page's `SKIP_WAITING` message; `activate` keeps exactly `kv-sw-<build>` and
//     `kv-pages-<build>`;
//   • the rules are features/store6/sw-rules.ts EMBEDDED by their text (`swRoute`, `swStorable`, `evictPlan`, `swFallback`) — the worker's
//     behaviour itself is run in a sandbox by test/store6-sw-rules.spec.ts.
const F: { flags: Record<string, unknown> | Error; calls: number } = { flags: { storefront_pwa: true }, calls: 0 };
jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('../lib/api-client', () => ({
  publicClient: (slug?: string) => ({ storefront: { flags: async () => { F.calls++; if (slug) throw new Error('the worker switch is read with NO tenant'); if (F.flags instanceof Error) throw F.flags; return F.flags; } } }),
}));
import { GET } from '../app/sw.js/route';
import { forgetWorkerSwitch } from '../lib/worker-switch';
import { evictPlan, swFallback, swRoute, swStorable } from '../features/store6/sw-rules';
import { serviceWorkerSource, swBuildId, swCacheName, swPagesCacheName, unregisterWorkerSource } from '../features/offline/sw-source';

const served = async (buildId: string | undefined, flags: Record<string, unknown> | Error = { storefront_pwa: true }) => {
  if (buildId === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID; else process.env.NEXT_PUBLIC_BUILD_ID = buildId;
  F.flags = flags; forgetWorkerSwitch();
  const r = await GET();
  return { r, body: await r.text() };
};
afterAll(() => { delete process.env.NEXT_PUBLIC_BUILD_ID; });

describe('HOTFIX-8 · D1 (b) · the service worker is served by a route, versioned by the build', () => {
  it('the served worker carries the build id as its cache VERSION; two builds → two different workers', async () => {
    const one = await served('b1a2b3c4'); const two = await served('7c39c9e8.rc-2');
    expect(one.body).toContain("const VERSION = 'kv-sw-b1a2b3c4';");
    expect(one.body).toContain("const PAGES = 'kv-pages-b1a2b3c4';");                     // STORE-6a: the kept pages' cache, per build too
    expect(two.body).toContain("const VERSION = 'kv-sw-7c39c9e8.rc-2';");
    expect(one.body).not.toBe(two.body);
    expect(one.body).not.toContain("'kv-sw-v1'");                                    // the PC-24c constant is gone
  });

  it('Cache-Control: no-cache, JavaScript, 200, noindex', async () => {
    const { r } = await served('b1a2b3c4');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-cache');
    expect(r.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
  });

  it('an unsafe or missing build id never reaches the source: → dev', async () => {
    expect((await served("x';self.close();'")).body).toContain("const VERSION = 'kv-sw-dev';");
    expect((await served(undefined)).body).toContain("const VERSION = 'kv-sw-dev';");
    expect(swBuildId('a'.repeat(65))).toBe('dev'); expect(swCacheName('abc')).toBe('kv-sw-abc'); expect(swPagesCacheName('abc')).toBe('kv-pages-abc');
  });

  it('activate keeps ONLY this build\'s two caches; the shell is fetched fresh (cache: reload)', () => {
    const src = serviceWorkerSource('b9');
    expect(src).toContain('keys.filter((k) => k !== VERSION && k !== PAGES).map((k) => caches.delete(k))');
    expect(src).toContain("c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))");
    expect(src).toContain("const SHELL = ['/offline',");
  });

  it("PC-24c's privacy rules are unchanged — now the embedded sw-rules: never a non-GET, cross-origin, /v1/, /api/ or an authed request", () => {
    const src = serviceWorkerSource('b9');
    expect(src).toContain(`const route = (${String(swRoute)});`);
    expect(src).toContain(`const storable = (${String(swStorable)});`);
    expect(src).toContain(`const evictPlan = (${String(evictPlan)});`);
    expect(src).toContain(`const fallback = (${String(swFallback)});`);
    // (the compiled text's line breaks are the compiler's — the assertions allow any whitespace)
    expect(String(swRoute)).toMatch(/if \(method !== 'GET'\)\s*return 'pass';/);
    expect(String(swRoute)).toMatch(/if \(u\.origin !== origin\)\s*return 'pass';/);
    expect(String(swRoute)).toMatch(/p\.indexOf\('\/v1\/'\) === 0 \|\| p\.indexOf\('\/api\/'\) === 0\)\s*return 'pass';/);
    expect(String(swRoute)).toMatch(/if \(hasAuth\)\s*return 'pass';/);
    expect(src).toContain("!!req.headers.get('authorization')");
    // a page is written to the cache ONLY through `keep`, which asks `storable` (the response header) first
    expect(src.match(/caches\.open\(PAGES\)\.then\(\(c\) => c\.put\(/g)).toHaveLength(1);
    expect(src.indexOf('if (!storable(')).toBeLessThan(src.indexOf('caches.open(PAGES).then((c) => c.put('));
    expect(src).toContain("res.headers.get('x-kv-cacheable')");
    // the worker source is valid JavaScript
    expect(() => new Function(src)).not.toThrow();
  });
});

describe('STORE-6a · D4 · the worker is a flagged, switchable, POLITE route', () => {
  it('storefront_pwa ON → the versioned worker; OFF → the self-unregistering worker; the flag is read with no tenant', async () => {
    const on = await served('b7', { storefront_pwa: true, org_self_signup: false });
    expect(on.r.headers.get('x-kv-worker')).toBe('on');
    expect(on.body).toContain("const VERSION = 'kv-sw-b7';");
    const off = await served('b7', { storefront_pwa: false });
    expect(off.r.headers.get('x-kv-worker')).toBe('off');
    expect(off.body).toBe(unregisterWorkerSource());
    expect(off.body).toContain('self.registration.unregister()');
    expect(off.body).toContain("keys.filter((k) => k.indexOf('kv-') === 0).map((k) => caches.delete(k))");
    expect(off.body).toContain('self.clients.claim()');
    expect(off.body).not.toContain("addEventListener('fetch'");                      // no handler: every request goes to the network
    expect(off.r.headers.get('cache-control')).toBe('no-cache');
    expect(() => new Function(off.body)).not.toThrow();
  });

  it('the read FAILS OPEN: an API error, or an answer without the key, still serves the worker (an outage never unregisters every phone)', async () => {
    expect((await served('b7', new Error('api down'))).r.headers.get('x-kv-worker')).toBe('on');
    expect((await served('b7', { org_self_signup: true })).r.headers.get('x-kv-worker')).toBe('on');
  });

  it('POLITE: install never calls skipWaiting — only the page\'s SKIP_WAITING message does; the kill-switch alone takes over at once', () => {
    const src = serviceWorkerSource('b9');
    const install = src.slice(src.indexOf("addEventListener('install'"), src.indexOf("addEventListener('message'"));
    expect(install).not.toContain('skipWaiting');
    expect(src).toContain("if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();");
    expect(src.match(/skipWaiting\(\)/g)).toHaveLength(1);
    expect(unregisterWorkerSource()).toContain('self.skipWaiting()');
  });
});
