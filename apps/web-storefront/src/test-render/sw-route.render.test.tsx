// apps/web-storefront/src/test-render/sw-route.render.test.tsx · PC-56 HOTFIX-8 · D1 (b) — THE WORKER IS VERSIONED BY THE BUILD. The route
// `app/sw.js/route.ts` is called as Next calls it (a GET, a Web `Response` back) and its body read:
//   • the cache VERSION is `kv-sw-<NEXT_PUBLIC_BUILD_ID>` — two builds → two different workers (a deploy is a new worker byte, so the
//     browser installs it and `activate` drops the old build's caches); an id with unsafe characters or none → 'dev', never injected;
//   • `Cache-Control: no-cache`, JavaScript, noindex;
//   • `activate` deletes every cache not named for this build; the shell is fetched with `cache: 'reload'`;
//   • PC-24c's fetch rules unchanged: never a non-GET, cross-origin, /v1/ or /api/, or a request with Authorization; page responses never cached.
// (Named file deviation: the brief's `sw-route.test.ts` — the render harness matches `*.render.test.tsx`.) Mutant M3 (VERSION back to a
// constant) turns this red. What jsdom cannot run — the worker's install/activate in a browser — is the browser proof owed (report §8).
import { GET } from '../app/sw.js/route';
import { serviceWorkerSource, swBuildId, swCacheName } from '../features/offline/sw-source';

const served = async (buildId: string | undefined) => {
  if (buildId === undefined) delete process.env.NEXT_PUBLIC_BUILD_ID; else process.env.NEXT_PUBLIC_BUILD_ID = buildId;
  const r = GET();
  return { r, body: await r.text() };
};
afterAll(() => { delete process.env.NEXT_PUBLIC_BUILD_ID; });

describe('HOTFIX-8 · D1 (b) · the service worker is served by a route, versioned by the build', () => {
  it('the served worker carries the build id as its cache VERSION; two builds → two different workers', async () => {
    const one = await served('b1a2b3c4'); const two = await served('7c39c9e8.rc-2');
    expect(one.body).toContain("const VERSION = 'kv-sw-b1a2b3c4';");
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
    expect(swBuildId('a'.repeat(65))).toBe('dev'); expect(swCacheName('abc')).toBe('kv-sw-abc');
  });

  it('activate drops every cache not named for this build; the shell is fetched fresh (cache: reload)', () => {
    const src = serviceWorkerSource('b9');
    expect(src).toContain('keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))');
    expect(src).toContain("c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))");
    expect(src).toContain("const SHELL = ['/offline',");
  });

  it("PC-24c's privacy rules are unchanged: never a non-GET, cross-origin, /v1/, /api/ or an authed request; page responses never cached", () => {
    const src = serviceWorkerSource('b9');
    expect(src).toContain("if (req.method !== 'GET') return;");
    expect(src).toContain('if (url.origin !== self.location.origin) return;');
    expect(src).toContain("if (url.pathname.startsWith('/v1/') || url.pathname.startsWith('/api/')) return;");
    expect(src).toContain("if (req.headers.get('authorization')) return;");
    expect(src).toContain("event.respondWith(fetch(req).catch(() => caches.match('/offline')));");
    // the only `put` is in the static branch (navigations are never stored)
    expect(src.match(/c\.put\(/g)).toHaveLength(1);
    expect(src.indexOf('c.put(')).toBeGreaterThan(src.indexOf('const isStatic'));
    // the worker source is valid JavaScript
    expect(() => new Function(src)).not.toThrow();
  });
});
