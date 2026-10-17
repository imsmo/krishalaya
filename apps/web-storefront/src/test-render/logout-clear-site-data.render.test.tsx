// apps/web-storefront/src/test-render/logout-clear-site-data.render.test.tsx · PC-56 HOTFIX-8 · D1 (c) — `Clear-Site-Data` ON SIGN-OUT AND
// ON A DIFFERENT PERSON'S SIGN-IN, end to end through the REAL Server Actions (`logoutAction`, `verifyCodeAction` → `finish`) and the REAL
// clear route (`app/api/session/clear/route.ts`), over a mocked cookie jar (it keeps each cookie's options) and a stand-in API.
//   • sign-out → the action arms the one-shot `kvs_csd` and redirects THROUGH `/api/session/clear?next=/`; the browser's pass through the
//     route gets `Clear-Site-Data: "cache", "storage"` on a 303 to `/` and the arm dropped; the session cookies are gone; the owner marker
//     is KEPT (it is not a session — the next sign-in compares against it);
//   • the FIRST person on a device → marker minted (JS-readable, random, never the user id or a token) + its httpOnly binding → cleared;
//   • the SAME person again → straight to the done page, no arm, nothing cleared, the marker unchanged;
//   • ANOTHER person → a fresh marker, cleared;
//   • the route unarmed (a link from elsewhere) → 303, no header; Next's in-process `rsc` prefetch → 204, the arm kept for the browser.
// (Named file deviation: the brief's `logout-clear-site-data.test.ts` — the render harness matches `*.render.test.tsx`.) Mutant M2
// (`Clear-Site-Data` dropped from sign-out) turns this red.
type Opts = { httpOnly?: boolean; maxAge?: number; path?: string; sameSite?: string; secure?: boolean };
const S: { jar: Map<string, { value: string; opts: Opts }>; sub: string; logouts: number } = { jar: new Map(), sub: '', logouts: 0 };

jest.mock('server-only', () => ({}), { virtual: true });
jest.mock('next/headers', () => ({
  cookies: () => ({
    get: (n: string) => (S.jar.has(n) ? { name: n, value: S.jar.get(n)!.value } : undefined),
    set: (n: string, value: string, opts: Opts = {}) => { S.jar.set(n, { value, opts }); },
    delete: (n: string) => { S.jar.delete(n); },
  }),
  headers: () => new Headers(),
}));
jest.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error(`REDIRECT ${to}`), { to }); } }));
jest.mock('../lib/env', () => ({ env: { publicApiUrl: 'https://api.test', serverApiUrl: 'https://api.test', appName: 'Krishalaya', siteUrl: '', platformTenantSlug: 'bazaar', tenantAppUrl: null, razorpayKeyId: null } }));
const jwt = (claims: Record<string, unknown>) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.sig`;
jest.mock('../lib/api-client', () => ({
  publicClient: () => ({ auth: {
    verifyOtp: async () => ({ accessToken: jwt({ sub: S.sub, tid: '0190a8b2-0000-7000-8000-0000000000aa', roles: ['customer'] }), refreshToken: `refresh-${S.sub}`, expiresInSec: 900 }),
    refresh: async () => { throw new Error('not expected'); },
  } }),
  serverClient: () => ({ auth: { logout: async () => { S.logouts++; } } }),
  tokenClient: () => ({ onboarding: { selectRole: async () => undefined } }),
}));
jest.mock('../lib/tenant-context', () => ({
  resolveStorefrontTenant: async () => ({ ok: true, slug: 'bazaar', tenant: { tenantId: '0190a8b2-0000-7000-8000-0000000000aa', countryCode: 'IN', phoneDefaultCountry: 'IN' } }),
}));

import { logoutAction, verifyCodeAction } from '../app/(platform)/login/actions';
import { GET as clearRoute } from '../app/api/session/clear/route';

const A = '0190a8b2-0000-7000-8000-00000000000a';
const B = '0190a8b2-0000-7000-8000-00000000000b';
const where = async (p: Promise<unknown>): Promise<string> => { try { await p; } catch (e) { return (e as { to?: string }).to ?? String(e); } return 'no redirect'; };
const cookieHeader = () => [...S.jar].map(([n, c]) => `${n}=${c.value}`).join('; ');
/** The browser follows the action's redirect: a document GET (no `rsc`) with this device's cookies; the route's Set-Cookie applied. */
async function follow(href: string): Promise<Response> {
  const r = clearRoute(new Request(`https://store.test${href}`, { headers: { cookie: cookieHeader() } }));
  for (const sc of r.headers.getSetCookie?.() ?? []) { const [nv] = sc.split(';'); const [n, v] = nv.split('='); if (/Max-Age=0/.test(sc)) S.jar.delete(n); else S.jar.set(n, { value: v, opts: {} }); }
  return r;
}
async function signIn(sub: string): Promise<string> {
  S.sub = sub;
  S.jar.set('kv_login', { value: Buffer.from(JSON.stringify({ typed: '9898012742', phone: '+919898012742' }), 'utf8').toString('base64url'), opts: {} });
  const fd = new FormData(); fd.set('code', '123456'); fd.set('next', '/cart'); fd.set('idem', '0190a8b2-0000-7000-8000-0000000000ff');
  return where(verifyCodeAction(fd));
}
beforeEach(() => { S.jar = new Map(); S.logouts = 0; });

describe('HOTFIX-8 · D1 (c) · Clear-Site-Data on sign-out and on a different person\'s sign-in', () => {
  it('sign-out: armed, redirected THROUGH the clear route; the browser\'s pass gets Clear-Site-Data + 303 to `/`; the arm dropped; the marker kept', async () => {
    await signIn(A);
    const marker = S.jar.get('kvs_owner')!.value;
    S.jar.delete('kvs_csd');                                                     // the sign-in's own pass already happened
    expect(await where(logoutAction())).toBe('/api/session/clear?next=%2F');
    expect(S.logouts).toBe(1);
    expect([...S.jar.keys()].filter((k) => /^kv_(session|refresh|tid|login|2fa)$/.test(k))).toEqual([]);
    expect(S.jar.get('kvs_csd')).toMatchObject({ value: '1', opts: { httpOnly: true, maxAge: 120, path: '/' } });
    const r = await follow('/api/session/clear?next=%2F');
    expect(r.status).toBe(303);
    expect(r.headers.get('clear-site-data')).toBe('"cache", "storage"');
    expect(r.headers.get('location')).toBe('/');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(S.jar.has('kvs_csd')).toBe(false);                                   // one shot
    expect(S.jar.get('kvs_owner')!.value).toBe(marker);                         // the marker outlives sign-out
    const again = await follow('/api/session/clear?next=%2F');                  // a second pass (a replayed link) clears nothing
    expect(again.headers.get('clear-site-data')).toBeNull();
  });

  it('the FIRST person on this device → a marker (JS-readable, random, not the user id) + its httpOnly binding → cleared', async () => {
    const to = await signIn(A);
    expect(to.startsWith('/api/session/clear?next=')).toBe(true);
    expect(decodeURIComponent(to.split('next=')[1])).toMatch(/^\/login\?step=done/);
    const m = S.jar.get('kvs_owner')!; const tag = S.jar.get('kvs_owner_tag')!;
    expect(m.opts.httpOnly).toBe(false); expect(m.value).toMatch(/^[A-Za-z0-9_-]{22}$/); expect(m.value).not.toContain(A);
    expect(tag.opts.httpOnly).toBe(true); expect(tag.value).not.toContain(A);
    expect(S.jar.get('kv_session')!.value).not.toBe(m.value);
    const r = await follow(to);
    expect(r.headers.get('clear-site-data')).toBe('"cache", "storage"');
    expect(r.headers.get('location')).toMatch(/^\/login\?step=done/);
  });

  it('the SAME person again → straight to the done page: no arm, no header, the marker unchanged', async () => {
    await follow(await signIn(A));
    const marker = S.jar.get('kvs_owner')!.value;
    await where(logoutAction()); await follow('/api/session/clear?next=%2F');
    const to = await signIn(A);
    expect(to).toMatch(/^\/login\?step=done/);
    expect(S.jar.has('kvs_csd')).toBe(false);
    expect(S.jar.get('kvs_owner')!.value).toBe(marker);
    expect((await follow(`/api/session/clear?next=${encodeURIComponent(to)}`)).headers.get('clear-site-data')).toBeNull();
  });

  it('ANOTHER person after the first (even without a sign-out between) → a fresh marker, cleared', async () => {
    await follow(await signIn(A));
    const marker = S.jar.get('kvs_owner')!.value;
    const to = await signIn(B);
    expect(to.startsWith('/api/session/clear?next=')).toBe(true);
    expect(S.jar.get('kvs_owner')!.value).not.toBe(marker);
    expect((await follow(to)).headers.get('clear-site-data')).toBe('"cache", "storage"');
  });

  it('Next\'s in-process prefetch of the redirect (rsc: 1) → 204, nothing cleared, the arm kept for the browser\'s own pass', async () => {
    await where(logoutAction());
    const pre = clearRoute(new Request('https://store.test/api/session/clear?next=%2F', { headers: { cookie: cookieHeader(), rsc: '1' } }));
    expect(pre.status).toBe(204);
    expect(pre.headers.get('clear-site-data')).toBeNull();
    expect(S.jar.get('kvs_csd')?.value).toBe('1');
    expect((await follow('/api/session/clear?next=%2F')).headers.get('clear-site-data')).toBe('"cache", "storage"');
  });
});
