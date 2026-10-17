// apps/web-storefront/src/test-render/sweep-host-routing.render.test.tsx · PC-56 STORE-SWEEP-a · C2 (founder D4) — THE REAL MIDDLEWARE, ON A STORE'S
// OWN HOST, over a stand-in API (`fetch`: the host lookup and the public flags read):
//   • `/help`, `/quality-promise`, `/contact` are REWRITTEN to the store's pages (the store's chrome, never the platform's);
//   • `/about`, `/press`, `/pricing`, `/blog`, `/trust-data` answer 307 to the platform origin's same path, the query kept;
//   • with no platform origin configured nothing is redirected (no loop to nowhere);
//   • on the platform's own host nothing is redirected or rewritten.
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';

const realFetch = global.fetch;
beforeAll(() => {
  process.env.API_URL_INTERNAL = 'https://api.test';
  global.fetch = (async (url: string) => {
    const u = new URL(url);
    if (u.pathname === '/v1/storefront/host') {
      return new Response(JSON.stringify({ data: { routing: true, platformHost: false, tenant: { slug: 'anand-fpo' }, redirectTo: null, redirectBlockedBy: null } }), { status: 200 });
    }
    if (u.pathname === '/v1/storefront/flags') return new Response(JSON.stringify({ data: { storefront_pwa: true, storefront_offline_reads: false } }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; delete process.env.API_URL_INTERNAL; delete process.env.NEXT_PUBLIC_SITE_URL; });
beforeEach(() => { process.env.NEXT_PUBLIC_SITE_URL = 'https://bazaar.example.test'; });

const call = (url: string) => {
  const h = new Headers(); h.set('host', new URL(url).host);
  return middleware(new NextRequest(url, { headers: h }));
};
const STORE = 'https://mandi.anandfpo.test';

describe('STORE-SWEEP-a · D4 · a store\'s own host', () => {
  it.each(['/help', '/quality-promise', '/contact'])('%s is the STORE\'s page: rewritten to /anand-fpo%s', async (p) => {
    const r = await call(`${STORE}${p}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('x-middleware-rewrite')).toBe(`${STORE}/anand-fpo${p}`);
    expect(r.headers.get('location')).toBeNull();
  });
  it.each(['/about', '/press', '/pricing', '/blog', '/trust-data'])('%s is the PLATFORM\'s: 307 to the platform origin', async (p) => {
    const r = await call(`${STORE}${p}`);
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe(`https://bazaar.example.test${p}`);
  });
  it('the query is kept; a path under a platform-only page goes too', async () => {
    expect((await call(`${STORE}/pricing?country=IN`)).headers.get('location')).toBe('https://bazaar.example.test/pricing?country=IN');
    expect((await call(`${STORE}/blog/a-post`)).headers.get('location')).toBe('https://bazaar.example.test/blog/a-post');
  });
  it('no platform origin configured → no redirect (the request falls through as before)', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = '';
    const r = await call(`${STORE}/about`);
    expect(r.status).toBe(200);
    expect(r.headers.get('location')).toBeNull();
  });
  it('the platform\'s own host: /about and /help are served as they are', async () => {
    for (const p of ['/about', '/help', '/trust-data']) {
      const r = await call(`https://bazaar.example.test${p}`);
      expect([p, r.status, r.headers.get('location'), r.headers.get('x-middleware-rewrite')]).toEqual([p, 200, null, null]);
    }
  });
});
