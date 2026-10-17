// apps/web-storefront/src/test-render/cacheable-header.render.test.tsx · PC-56 STORE-6a · D2 (founder Q9) — THE SERVER DECIDES, PER RESPONSE, AFTER
// THE SESSION CHECK. The REAL middleware is called as Next calls it (a NextRequest in, a NextResponse out) over a stand-in API (`fetch`: the host
// lookup and the public flags read):
//   • a public page (a listing on a path store; `/` and `/listings/<id>` on the organisation's own host, rewritten) with NO session cookie and
//     the organisation's `storefront_offline_reads` ON → `X-KV-Cacheable: public` on the response AND the request header the layouts read;
//   • WITH a session cookie (kv_session, kv_refresh or kv_tid) → the header is ABSENT — and the flag is not even asked (mutant M2: a rule that
//     says yes with a session turns this red);
//   • the flag OFF, or unreadable (fail closed) → absent; a page that is never cacheable (cart, account, checkout, an auction) → absent;
//   • a client-sent `x-kv-cacheable` / `x-kv-shell` / `x-kv-tenant-slug` request header is stripped — a client can never mark its own page;
//   • the organisation's offline page is told to render its session-free shell (`x-kv-shell: offline`), on a path store and on its host;
//   • the platform host's own pages read the SAME key with no organisation in context — absent → never marked;
//   • the store's own host answers `/apple-touch-icon.png` 404 (never the platform's icon on an organisation's home screen).
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';
import { forgetOfflineReads } from '../lib/offline-reads';

const F: { on: Record<string, boolean>; down: boolean; flagCalls: Array<string | null>; routing: boolean } = { on: {}, down: false, flagCalls: [], routing: false };
const realFetch = global.fetch;
beforeAll(() => {
  process.env.API_URL_INTERNAL = 'https://api.test';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://bazaar.test';
  global.fetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === '/v1/storefront/host') {
      return new Response(JSON.stringify({ data: F.routing ? { routing: true, platformHost: false, tenant: { slug: 'anand-fpo' }, redirectTo: null, redirectBlockedBy: null } : { routing: false, platformHost: false, tenant: null, redirectTo: null, redirectBlockedBy: null } }), { status: 200 });
    }
    if (u.pathname === '/v1/storefront/flags') {
      const slug = (init?.headers as Record<string, string> | undefined)?.['x-tenant-slug'] ?? null;
      F.flagCalls.push(slug);
      if (F.down) throw new Error('api down');
      const data: Record<string, boolean> = { storefront_pwa: true };
      if (slug) data.storefront_offline_reads = F.on[slug] === true;
      return new Response(JSON.stringify({ data }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
});
afterAll(() => { global.fetch = realFetch; delete process.env.API_URL_INTERNAL; delete process.env.NEXT_PUBLIC_SITE_URL; });
beforeEach(() => { F.on = { 'anand-fpo': true }; F.down = false; F.flagCalls = []; F.routing = false; forgetOfflineReads(); });

const call = async (url: string, opts: { cookie?: string; headers?: Record<string, string> } = {}) => {
  const h = new Headers(opts.headers ?? {}); if (opts.cookie) h.set('cookie', opts.cookie);
  h.set('host', new URL(url).host);                                                     // the browser's Host header (the host routing reads it)
  return middleware(new NextRequest(url, { headers: h }));
};
/** The request headers the middleware forwards to the page (Next's override protocol). */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const LISTING = 'https://localhost:3001/anand-fpo/listings/0190a8b2-0000-7000-8000-00000000000a';

describe('STORE-6a · D2 · X-KV-Cacheable, decided by the server after the session check', () => {
  it('a public page, no session cookie, the organisation ON → the response header AND the request header the layouts read', async () => {
    const r = await call(LISTING);
    expect(r.headers.get('x-kv-cacheable')).toBe('public');
    expect(forwarded(r, 'x-kv-cacheable')).toBe('public');
    expect(F.flagCalls).toEqual(['anand-fpo']);
  });
  it.each([['kv_session', 'kv_session=eyJ.x.y'], ['kv_refresh', 'kv_refresh=r'], ['kv_tid', 'kv_tid=0190a8b2-0000-7000-8000-0000000000aa'], ['all three', 'kv_session=a; kv_refresh=b; kv_tid=c']])(
    'WITH a session cookie (%s) → ABSENT, and the flag is not even asked', async (_n, cookie) => {
      const r = await call(LISTING, { cookie });
      expect(r.headers.get('x-kv-cacheable')).toBeNull();
      expect(forwarded(r, 'x-kv-cacheable')).toBeNull();
      expect(F.flagCalls).toEqual([]);
    });
  it('a device preference or the owner marker is not a session (kv_lang, kvs_owner) → still marked', async () => {
    expect((await call(LISTING, { cookie: 'kv_lang=hi; kvs_owner=AAAA' })).headers.get('x-kv-cacheable')).toBe('public');
  });
  it('the flag OFF, or unreadable (fail closed) → absent', async () => {
    F.on = {};
    expect((await call(LISTING)).headers.get('x-kv-cacheable')).toBeNull();
    forgetOfflineReads(); F.down = true;
    expect((await call(LISTING)).headers.get('x-kv-cacheable')).toBeNull();
  });
  it.each(['/anand-fpo/cart', '/anand-fpo/checkout', '/anand-fpo/checkout/pay', '/anand-fpo/account', '/anand-fpo/orders/x', '/anand-fpo/auctions/x', '/anand-fpo/offers/x', '/anand-fpo/messages', '/anand-fpo/login', '/anand-fpo/offline'])(
    '%s is never cacheable → absent (the flag is not asked)', async (p) => {
      expect((await call(`https://localhost:3001${p}`)).headers.get('x-kv-cacheable')).toBeNull();
      expect(F.flagCalls).toEqual([]);
    });
  it('a client can never mark its own page: incoming x-kv-cacheable / x-kv-shell / x-kv-tenant-slug are stripped', async () => {
    const r = await call('https://localhost:3001/anand-fpo/cart', { headers: { 'x-kv-cacheable': 'public', 'x-kv-shell': 'offline', 'x-kv-tenant-slug': 'evil' } });
    expect(forwarded(r, 'x-kv-cacheable')).toBeNull(); expect(forwarded(r, 'x-kv-shell')).toBeNull(); expect(forwarded(r, 'x-kv-tenant-slug')).toBeNull();
    expect(r.headers.get('x-kv-cacheable')).toBeNull();
  });
  it('the platform host\'s own public pages ask the same key with NO organisation — absent → never marked', async () => {
    const r = await call('https://localhost:3001/trace/KVTR9J4K2M');
    expect(r.headers.get('x-kv-cacheable')).toBeNull();
    expect(F.flagCalls).toEqual([null]);
  });
  it('the organisation\'s offline page is told to render its session-free shell', async () => {
    expect(forwarded(await call('https://localhost:3001/anand-fpo/offline'), 'x-kv-shell')).toBe('offline');
    expect(forwarded(await call('https://localhost:3001/offline'), 'x-kv-shell')).toBeNull();     // the platform's: the (shell) group itself
  });
});

describe('STORE-6a · on the organisation\'s OWN host (host routing)', () => {
  it('`/` and `/listings/<id>` are rewritten and marked; with a session cookie they are not; `/offline` → its shell; `/app`, `/queued` rewritten', async () => {
    F.routing = true;
    const home = await call('https://mandi.anandfpo.test/');
    expect(home.headers.get('x-middleware-rewrite')).toBe('https://mandi.anandfpo.test/anand-fpo');
    expect(home.headers.get('x-kv-cacheable')).toBe('public');
    const listing = await call('https://mandi.anandfpo.test/listings/0190a8b2');
    expect(listing.headers.get('x-kv-cacheable')).toBe('public');
    expect((await call('https://mandi.anandfpo.test/listings/0190a8b2', { cookie: 'kv_session=x' })).headers.get('x-kv-cacheable')).toBeNull();
    const off = await call('https://mandi.anandfpo.test/offline');
    expect(off.headers.get('x-middleware-rewrite')).toBe('https://mandi.anandfpo.test/anand-fpo/offline');
    expect(forwarded(off, 'x-kv-shell')).toBe('offline');
    expect(forwarded(off, 'x-kv-tenant-slug')).toBe('anand-fpo');
    for (const p of ['/app', '/queued']) expect((await call(`https://mandi.anandfpo.test${p}`)).headers.get('x-middleware-rewrite')).toBe(`https://mandi.anandfpo.test/anand-fpo${p}`);
  });
  it('the store host answers /apple-touch-icon.png 404 — never the platform\'s icon on an organisation\'s home screen', async () => {
    F.routing = true;
    expect((await call('https://mandi.anandfpo.test/apple-touch-icon.png')).status).toBe(404);
    F.routing = false;
    expect((await call('https://localhost:3001/apple-touch-icon.png')).status).toBe(200);   // the platform's own host keeps its icon
  });
});
