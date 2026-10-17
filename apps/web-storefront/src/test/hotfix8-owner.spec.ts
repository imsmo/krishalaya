// apps/web-storefront/src/test/hotfix8-owner.spec.ts · PC-56 HOTFIX-8 · D1 (c) — the owner rule and the clear route's answer, pure
// (features/offline/owner.ts): `ownerChanged(prev, next)`, the `Clear-Site-Data` value, the marker (random, never a token, never a user id),
// its binding, the clear route's 204 / 303 / armed answers; plus the wiring facts read from the sources (the worker is a route now, the
// registration says `updateViaCache: 'none'`, the offline page lives in the session-free group).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ownerChanged, ownerTag, mintOwnerMarker, isOwnerMarker, clearSiteDataHeader, tokenSubject, clearSiteHref, cookieFrom, clearRouteAnswer,
  OWNER_COOKIE, OWNER_TAG_COOKIE, CLEAR_SITE_COOKIE, CLEAR_SITE_PATH,
} from '../features/offline/owner';

const A = '0190a8b2-0000-7000-8000-00000000000a';
const B = '0190a8b2-0000-7000-8000-00000000000b';
const jwt = (claims: Record<string, unknown>) => `h.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.sig`;
const SRC = join(__dirname, '..');

describe('HOTFIX-8 · D1 (c) · the owner marker and Clear-Site-Data', () => {
  it('the header value is exactly "cache", "storage" (never "cookies": the new session survives it)', () => {
    expect(clearSiteDataHeader()).toBe('"cache", "storage"');
    expect(clearSiteDataHeader()).not.toMatch(/cookies|executionContexts|\*/);
  });

  it('a marker is random, 22 base64url characters, never a token and never the user id', () => {
    const m1 = mintOwnerMarker(); const m2 = mintOwnerMarker();
    expect(isOwnerMarker(m1)).toBe(true); expect(m1).not.toBe(m2);
    expect(m1).not.toContain('.'); expect(m1).not.toContain(A);
    expect(mintOwnerMarker(() => Buffer.alloc(16, 7))).toBe(Buffer.alloc(16, 7).toString('base64url'));
    expect([OWNER_COOKIE, OWNER_TAG_COOKIE, CLEAR_SITE_COOKIE]).toEqual(['kvs_owner', 'kvs_owner_tag', 'kvs_csd']);
  });

  it('ownerChanged: the same person → false; another person, no marker, a malformed marker, no tag or a forged tag → true (fail closed)', () => {
    const m = mintOwnerMarker(); const tag = ownerTag(m, A);
    expect(tag).toMatch(/^[0-9a-f]{32}$/); expect(tag).not.toContain(A.replace(/-/g, '').slice(0, 8));
    expect(ownerChanged({ marker: m, tag }, A)).toBe(false);
    expect(ownerChanged({ marker: m, tag }, B)).toBe(true);
    expect(ownerChanged(null, A)).toBe(true);
    expect(ownerChanged({}, A)).toBe(true);
    expect(ownerChanged({ marker: 'short', tag }, A)).toBe(true);
    expect(ownerChanged({ marker: m, tag: null }, A)).toBe(true);
    expect(ownerChanged({ marker: m, tag: ownerTag(mintOwnerMarker(), A) }, A)).toBe(true);   // a tag minted for another marker
    expect(ownerChanged({ marker: m, tag }, null)).toBe(true);                               // no subject → unknown → changed
  });

  it('tokenSubject reads the access token\'s `sub` (unverified) and nothing else; garbage → null', () => {
    expect(tokenSubject(jwt({ sub: A, tid: B, roles: ['customer'] }))).toBe(A);
    expect(tokenSubject('not-a-jwt')).toBeNull(); expect(tokenSubject(jwt({ sub: 42 }))).toBeNull(); expect(tokenSubject(undefined)).toBeNull();
  });

  it('clearSiteHref: through the clear route, `next` same-origin only', () => {
    expect(clearSiteHref('/')).toBe(`${CLEAR_SITE_PATH}?next=%2F`);
    expect(clearSiteHref('/login?step=done&next=%2Fcart')).toBe(`${CLEAR_SITE_PATH}?next=${encodeURIComponent('/login?step=done&next=%2Fcart')}`);
    expect(clearSiteHref('//evil.example')).toBe(`${CLEAR_SITE_PATH}?next=%2F`);
    expect(CLEAR_SITE_PATH.startsWith('/api/')).toBe(true);   // the worker never touches /api/, the middleware skips it
  });

  it('the clear route: armed → 303 + Clear-Site-Data + the arm dropped; unarmed → 303, nothing cleared; Next\'s rsc prefetch → 204 untouched', () => {
    const armed = clearRouteAnswer({ next: '/login?step=done', cookie: `kv_lang=hi; ${CLEAR_SITE_COOKIE}=1; kvs_owner=x`, rsc: false });
    expect(armed.status).toBe(303);
    expect(armed.headers).toEqual(expect.arrayContaining([['Location', '/login?step=done'], ['Clear-Site-Data', '"cache", "storage"'], ['Cache-Control', 'no-store']]));
    expect(armed.headers.find(([k]) => k === 'Set-Cookie')?.[1]).toMatch(/^kvs_csd=; Path=\/; Max-Age=0; HttpOnly/);
    const plain = clearRouteAnswer({ next: 'https://evil.example', cookie: 'kv_lang=hi', rsc: false });
    expect(plain.status).toBe(303);
    expect(plain.headers).toContainEqual(['Location', '/']);
    expect(plain.headers.map(([k]) => k)).not.toContain('Clear-Site-Data');
    const pre = clearRouteAnswer({ next: '/', cookie: `${CLEAR_SITE_COOKIE}=1`, rsc: true });
    expect(pre.status).toBe(204);
    expect(pre.headers.map(([k]) => k)).toEqual(['Cache-Control']);   // the arm is kept for the browser's own pass
    expect(cookieFrom('a=1; kvs_csd=1', 'kvs_csd')).toBe('1'); expect(cookieFrom('xkvs_csd=1', 'kvs_csd')).toBeNull(); expect(cookieFrom(null, 'a')).toBeNull();
  });

  it('wiring: the worker is the build-versioned route (public/sw.js is gone); the registration says updateViaCache none; /offline lives in (shell)', () => {
    expect(existsSync(join(SRC, '..', 'public', 'sw.js'))).toBe(false);
    expect(existsSync(join(SRC, 'app', 'sw.js', 'route.ts'))).toBe(true);
    expect(readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8')).toContain("register('/sw.js',{updateViaCache:'none'})");
    expect(existsSync(join(SRC, 'app', '(shell)', 'offline', 'page.tsx'))).toBe(true);
    expect(existsSync(join(SRC, 'app', '(platform)', 'offline'))).toBe(false);
    const imports = readFileSync(join(SRC, 'app', '(shell)', 'layout.tsx'), 'utf8').split('\n').filter((l) => l.startsWith('import '));
    expect(imports.join('\n')).not.toMatch(/SiteHeader|SiteFooter|lib\/auth|lib\/session|api-client|cart\/summary|\(platform\)/);
    // both places a person is signed in on the storefront apply the owner rule (the login's finish() and the organisation signup)
    for (const f of [['app', '(platform)', 'login', 'actions.ts'], ['app', '(platform)', 'for-organisations', 'actions.ts']]) {
      const src = readFileSync(join(SRC, ...f), 'utf8');
      expect(src.match(/setSession\(/g)?.length).toBe(1);
      expect(src).toMatch(/settleOwnerAtSignIn\(r\.tokens\.accessToken\) \? clearSiteHref\(/);
    }
    const cfg = readFileSync(join(SRC, '..', 'next.config.js'), 'utf8');
    expect(cfg).toMatch(/generateBuildId: async \(\) => buildId/); expect(cfg).toMatch(/NEXT_PUBLIC_BUILD_ID: buildId/);
  });
});
