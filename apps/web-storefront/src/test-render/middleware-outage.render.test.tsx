// apps/web-storefront/src/test-render/middleware-outage.render.test.tsx · PC-56 STORE-SWEEP-b · C3 (founders D4 / D5; survey F-6 / B12 / E4 — canon W320)
// — THE REAL MIDDLEWARE over a stand-in API (`fetch`):
//   • a store host whose organisation cannot be looked up (the API unreachable, or answering 5xx) → 503 small HTML: `lang`/`dir` per the `kv_lang`
//     cookie in en / hi / gu, the lookup-failed + try-again words, the code in small print, `retry-after` kept, text/html; NO brand and NO
//     organisation name (mutant M3 — the plain-text answer back — turns this red);
//   • a host no organisation is served at → 404 small HTML, the same rules;
//   • D5 on a store's own host: `/for-organisations` → 307 to the platform origin; `/language` and the trace entry `/trace` → the store's own pages.
// The host answers are cached per host inside the middleware's module (10 s for a miss) — every case uses its own host.
import { NextRequest } from 'next/server';
import { PLATFORM_BRAND } from '@krishalaya/tokens';
import { middleware } from '../middleware';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const realFetch = global.fetch;
beforeAll(() => {
  process.env.API_URL_INTERNAL = 'https://api.test';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://bazaar.example.test';
  global.fetch = (async (url: string) => {
    const u = new URL(url);
    const host = u.searchParams.get('host') ?? '';
    if (u.pathname === '/v1/storefront/host') {
      if (host.startsWith('down')) throw new Error('ECONNREFUSED');
      if (host.startsWith('fivexx')) return new Response(JSON.stringify({ error: { code: 'INTERNAL' } }), { status: 502 });
      if (host.startsWith('nobody')) return new Response(JSON.stringify({ data: { routing: true, platformHost: false, tenant: null, redirectTo: null, redirectBlockedBy: null } }), { status: 200 });
      return new Response(JSON.stringify({ data: { routing: true, platformHost: false, tenant: { slug: 'anand-fpo' }, redirectTo: null, redirectBlockedBy: null } }), { status: 200 });
    }
    if (u.pathname === '/v1/storefront/flags') return new Response(JSON.stringify({ data: { storefront_pwa: true, storefront_offline_reads: false } }), { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; delete process.env.API_URL_INTERNAL; delete process.env.NEXT_PUBLIC_SITE_URL; });

let n = 0;
const call = async (hostPrefix: string, path = '/', lang?: string) => {
  const host = `${hostPrefix}-${++n}.example.test`;
  const h = new Headers(); h.set('host', host);
  if (lang) h.set('cookie', `kv_lang=${lang}`);
  return middleware(new NextRequest(`https://${host}${path}`, { headers: h }));
};
const NO_NAMES = [PLATFORM_BRAND.name, PLATFORM_BRAND.platformStoreName, 'कृषालय', 'કૃષાલય', 'anand-fpo', 'Anand'];

describe('STORE-SWEEP-b · D4 · the organisation cannot be looked up → 503, localized HTML', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: lang/dir from kv_lang, the words, retry-after, text/html, no brand, no organisation', async (l, cat) => {
    const r = await call('down', '/listings/abc', l);
    expect(r.status).toBe(503);
    expect(r.headers.get('retry-after')).toBe('10');
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await r.text();
    expect(html).toContain(`<html lang="${l}" dir="ltr">`);
    expect(html).toContain(cat['sweep.edge.lookupFailed']);
    expect(html).toContain(cat['sweep.edge.tryAgain']);
    expect(html).toContain('<small>503</small>');
    for (const lit of NO_NAMES) expect([lit, html.includes(lit)]).toEqual([lit, false]);
  });
  it('a 5xx from the lookup is the same 503; no cookie → the default language', async () => {
    const r = await call('fivexx');
    expect(r.status).toBe(503);
    expect(await r.text()).toContain('<html lang="en" dir="ltr">');
  });
});

describe('STORE-SWEEP-b · D4 · no organisation at this host → 404, localized HTML', () => {
  it.each([['en', en], ['hi', hi], ['gu', gu]] as const)('%s: the words, the code, text/html, no retry-after, no names', async (l, cat) => {
    const r = await call('nobody', '/', l);
    expect(r.status).toBe(404);
    expect(r.headers.get('retry-after')).toBeNull();
    expect(r.headers.get('content-type')).toBe('text/html; charset=utf-8');
    const html = await r.text();
    expect(html).toContain(`<html lang="${l}" dir="ltr">`);
    expect(html).toContain(cat['sweep.edge.noOrganisation']);
    expect(html).toContain('<small>404</small>');
    for (const lit of NO_NAMES) expect([lit, html.includes(lit)]).toEqual([lit, false]);
  });
});

describe('STORE-SWEEP-b · D5 · on a store\'s own host (the real middleware)', () => {
  it('/for-organisations → 307 to the platform origin, the query kept', async () => {
    const r = await call('mandi', '/for-organisations?ref=x');
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toBe('https://bazaar.example.test/for-organisations?ref=x');
  });
  it.each(['/language', '/trace'])('%s → the store\'s own page (rewritten to /anand-fpo%s), never redirected', async (p) => {
    const r = await call('mandi', `${p}?code=AB12CD`);
    expect(r.status).toBe(200);
    expect(r.headers.get('location')).toBeNull();
    expect(new URL(r.headers.get('x-middleware-rewrite')!).pathname).toBe(`/anand-fpo${p}`);
    expect(new URL(r.headers.get('x-middleware-rewrite')!).search).toBe('?code=AB12CD');
  });
});
