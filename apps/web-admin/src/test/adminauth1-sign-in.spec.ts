// apps/web-admin/src/test/adminauth1-sign-in.spec.ts · PC-56 ADMIN-AUTH-1 — the console's half of operator sign-in.
//
// Pure logic (features/admin-auth) is exercised directly, including the server-to-server forwarder with a fake admin-api;
// the screens and route handlers are checked statically (this jest is node-only, no React/Next runtime — the house style,
// see jest.config.js): what they link to, what they may return to the browser, and that every key they render exists.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  AUTH_COPY_KEYS, FORWARDABLE, activeKeys, authCopy, browserBody, canRevokeOwnKey, ceremonyErrorCode, codeStateKey,
  enrollFormProblem, enrolledViaKey, forwardToAdminApi, isTicket, keyErrorKey, loginErrorKey, safeNext, sameOrigin, sessionFrom,
  ssoStartUrl, stepUpHref, type FetchLike, type KeyView,
} from '../features/admin-auth/admin-auth';
import { ADMIN_NAV, liveNav } from '../features/nav/nav-model';
import { en } from '../i18n/en';

const dict = en as unknown as Record<string, string>;
const ROOT = path.join(__dirname, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FILES = {
  login: ['app', 'login', 'page.tsx'],
  key: ['app', 'login', 'key', 'page.tsx'],
  stepUp: ['app', 'step-up', 'page.tsx'],
  keys: ['app', 'staff', 'keys', 'page.tsx'],
  keysActions: ['app', 'staff', 'keys', 'actions.ts'],
  route: ['app', 'api', 'auth', '[action]', 'route.ts'],
  session: ['app', 'api', 'session', 'route.ts'],
  ceremony: ['components', 'auth', 'KeyCeremony.tsx'],
  stepUpComp: ['components', 'auth', 'StepUpCeremony.tsx'],
  addKey: ['components', 'auth', 'AddKeyPanel.tsx'],
  issueCode: ['components', 'auth', 'IssueCodePanel.tsx'],
  client: ['components', 'auth', 'ceremony-client.ts'],
  layout: ['app', 'layout.tsx'],
  operator: ['app', 'staff', '[id]', 'page.tsx'],
} as const;
const TICKET = 'A'.repeat(43);

describe('ADMIN-AUTH-1 · /login (step 1: the IdP)', () => {
  const src = strip(read(...FILES.login));
  it('links to admin-api\'s URI-versioned /v1/auth/sso/start (the old unversioned path 404ed)', () => {
    expect(src).toMatch(/href=\{ssoStartUrl\(env\.publicAdminApiUrl\)\}/);
    expect(ssoStartUrl('https://admin-api.example.com/')).toBe('https://admin-api.example.com/v1/auth/sso/start');
    expect(src).not.toMatch(/['"`]\/auth\/sso\/start/);
  });
  it('shows ONE generic message for any sign-in failure (no oracle) and a signed-out confirmation', () => {
    expect(loginErrorKey(undefined)).toBeNull();
    expect(loginErrorKey('')).toBeNull();
    for (const anything of ['signin', 'no_binding', 'suspended', '1', '<script>']) expect(loginErrorKey(anything)).toBe('login.failed');
    expect(loginErrorKey('expired')).toBe('login.err.expired');
    expect(loginErrorKey('signedOut')).toBe('login.err.signedOut');
    for (const k of ['login.failed', 'login.err.expired', 'login.err.signedOut', 'login.cta', 'login.lead']) expect(dict[k]).toBeTruthy();
  });
  it('keeps the dev-only bypass exactly as it was', () => {
    expect(src).toMatch(/env\.devLoginEnabled &&/);
    expect(src).toMatch(/action="\/api\/dev-login"/);
  });
});

describe('ADMIN-AUTH-1 · /login/key (step 2: the hardware key) and enrollment', () => {
  it('only a well-formed ticket reaches the ceremony; anything else says "start again"', () => {
    expect(isTicket(TICKET)).toBe(true);
    for (const bad of [undefined, '', 'short', `${TICKET}x`, 'A'.repeat(42) + '!', 7]) expect(isTicket(bad)).toBe(false);
    const src = strip(read(...FILES.key));
    expect(src).toMatch(/isTicket\(ticket\) \?/);
    expect(src).toMatch(/<KeyCeremony ticket=\{ticket\} copy=\{authCopy/);
    expect(src).toMatch(/referrer: 'no-referrer'/);
  });
  it('the ceremony is a client component, runs WebAuthn through @simplewebauthn/browser, and talks only to /api/auth/*', () => {
    const c = read(...FILES.ceremony);
    expect(c.startsWith("'use client';")).toBe(true);
    const client = strip(read(...FILES.client));
    expect(client).toMatch(/from '@simplewebauthn\/browser'/);
    expect(client).toMatch(/fetch\(`\/api\/auth\/\$\{action\}`/);
    expect(client).not.toMatch(/NEXT_PUBLIC|adminApiUrl|authorization/i);
    for (const f of [FILES.ceremony, FILES.stepUpComp, FILES.addKey, FILES.issueCode]) {
      const s = strip(read(...f));
      expect(s).not.toMatch(/['"`]https?:\/\//);
      expect(s).not.toMatch(/document\.cookie|localStorage|sessionStorage/);
    }
  });
  it('the enrollment form is validated before anything is sent', () => {
    expect(enrollFormProblem('ABC', 'Key')).toBe('loginKey.err.codeFormat');
    expect(enrollFormProblem('ABCDE-FGHJK', '   ')).toBe('loginKey.err.label');
    expect(enrollFormProblem('ABCDE-FGHJK', 'x'.repeat(61))).toBe('loginKey.err.label');
    expect(enrollFormProblem('ABCDE-FGHJK-MNPQR-STUVW', 'YubiKey A')).toBeNull();
    const c = strip(read(...FILES.ceremony));
    expect(c).toMatch(/autoComplete="one-time-code"/);
    expect(c).toMatch(/postAction\('key-enroll'/);
    expect(c).toMatch(/postAction\('key-login'/);
  });
  it('maps admin-api refusal codes and browser ceremony errors to messages the operator can act on', () => {
    expect(keyErrorKey('AUTH_TICKET_INVALID')).toBe('loginKey.err.ticket');
    expect(keyErrorKey('AUTH_KEY_REJECTED')).toBe('loginKey.err.key');
    expect(keyErrorKey('AUTH_ENROLLMENT_REFUSED')).toBe('loginKey.err.code');
    expect(keyErrorKey('AUTH_RATE_LIMITED')).toBe('loginKey.err.rate');
    expect(keyErrorKey('ANYTHING_ELSE')).toBe('loginKey.err.generic');
    expect(ceremonyErrorCode({ name: 'NotAllowedError' })).toBe('CEREMONY_CANCELLED');
    expect(ceremonyErrorCode({ name: 'AbortError' })).toBe('CEREMONY_CANCELLED');
    expect(ceremonyErrorCode({ code: 'ERROR_INVALID_DOMAIN' })).toBe('UNSUPPORTED');
    expect(ceremonyErrorCode(new Error('x'))).toBe('GENERIC');
  });
  it('every copy key the client components read exists in en.ts', () => {
    for (const k of AUTH_COPY_KEYS) expect([k, dict[k]]).toEqual([k, expect.any(String)]);
    const copy = authCopy((k) => dict[k]);
    expect(Object.keys(copy)).toHaveLength(AUTH_COPY_KEYS.length);
    // …and every copy[...] lookup in the components names one of them.
    for (const f of [FILES.ceremony, FILES.stepUpComp, FILES.addKey, FILES.issueCode]) {
      for (const m of strip(read(...f)).matchAll(/copy\['([^']+)'\]/g)) expect(AUTH_COPY_KEYS as readonly string[]).toContain(m[1]);
    }
  });
});

describe('ADMIN-AUTH-1 · the route handler: an allow-listed forwarder that never hands the browser a token', () => {
  const src = strip(read(...FILES.route));
  it('forwards only the allow-listed actions', () => {
    const actions = [...src.matchAll(/'([a-z-]+)': \{ what: '(\w+)'/g)].map((m) => [m[1], m[2]]);
    expect(actions).toEqual([
      ['key-options', 'keyOptions'], ['key-enroll', 'keyEnroll'], ['key-login', 'keyLogin'], ['step-up-options', 'stepUpOptions'],
      ['step-up', 'stepUp'], ['add-key-options', 'addKeyOptions'], ['add-key', 'addKey'], ['issue-code', 'issueCode'],
    ]);
    for (const [, what] of actions) expect(Object.keys(FORWARDABLE)).toContain(what);
    expect(src).toMatch(/if \(!spec\) return json\(404/);
    expect(src).toMatch(/if \(!sameOrigin\(req\.headers\.get\('origin'\), req\.url\)\) return json\(403/);
  });
  it('sets the httpOnly session cookie itself and answers only a redirect', () => {
    expect(src).toMatch(/setAdminSession\(session\.token, session\.maxAgeSec\)/);
    expect(src).toMatch(/return json\(200, \{ data: \{ redirect: action === 'step-up' \? safeNext\(input\.next\) : '\/dashboard' \} \}\)/);
    expect(src).toMatch(/return json\(f\.status, browserBody\(f\)\)/);
  });
  it('browserBody strips a token even if admin-api ever returned one, and passes refusal CODES only', () => {
    expect(browserBody({ status: 200, body: { data: { token: 'a.b.c', mode: 'enroll' } } })).toEqual({ data: { mode: 'enroll' } });
    expect(browserBody({ status: 401, body: { code: 'AUTH_TICKET_INVALID', message: 'internal detail' } })).toEqual({ code: 'AUTH_TICKET_INVALID' });
    expect(browserBody({ status: 500, body: {} })).toEqual({ code: 'AUTH_REFUSED' });
  });
  it('sessionFrom accepts only a well-formed minted session', () => {
    expect(sessionFrom({ status: 200, body: { data: { token: 'a.b.c', maxAgeSec: 28800 } } })).toEqual({ token: 'a.b.c', maxAgeSec: 28800 });
    expect(sessionFrom({ status: 200, body: { data: { token: 'a.b.c', maxAgeSec: 999999 } } })?.maxAgeSec).toBe(43200);
    expect(sessionFrom({ status: 200, body: { data: { token: 'nope', maxAgeSec: 10 } } })).toBeNull();
    expect(sessionFrom({ status: 200, body: { data: { token: 'a.b.c', maxAgeSec: 0 } } })).toBeNull();
    expect(sessionFrom({ status: 401, body: { data: { token: 'a.b.c', maxAgeSec: 10 } } })).toBeNull();
  });
  it('forwardToAdminApi: server-to-server POST to /v1/<allow-listed path>, bearer only when given, never throws', async () => {
    const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
    const ok: FetchLike = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, text: async () => '{"data":{"mode":"authenticate"}}' }; };
    const f = await forwardToAdminApi(ok, 'http://admin-api.internal:4001/', 'keyOptions', { ticket: TICKET });
    expect(f).toEqual({ status: 200, body: { data: { mode: 'authenticate' } } });
    expect(calls[0].url).toBe('http://admin-api.internal:4001/v1/auth/webauthn/options');
    expect(calls[0].init.headers.authorization).toBeUndefined();
    await forwardToAdminApi(ok, 'http://a', 'stepUp', {}, { bearer: 'h.p.s' });
    expect(calls[1].url).toBe('http://a/v1/auth/step-up');
    expect(calls[1].init.headers.authorization).toBe('Bearer h.p.s');
    const down: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    await expect(forwardToAdminApi(down, 'http://a', 'keyLogin', {})).resolves.toEqual({ status: 502, body: { code: 'ADMIN_API_UNREACHABLE' } });
    const garbage: FetchLike = async () => ({ ok: false, status: 500, text: async () => '<html>' });
    await expect(forwardToAdminApi(garbage, 'http://a', 'keyLogin', {})).resolves.toEqual({ status: 500, body: {} });
  });
  it('same-origin check', () => {
    expect(sameOrigin('https://admin.k.com', 'https://admin.k.com/api/auth/key-login')).toBe(true);
    expect(sameOrigin('https://evil.com', 'https://admin.k.com/api/auth/key-login')).toBe(false);
    expect(sameOrigin(null, 'https://admin.k.com/x')).toBe(true);
    expect(sameOrigin('garbage', 'https://admin.k.com/x')).toBe(false);
  });
});

describe('ADMIN-AUTH-1 · step-up wiring', () => {
  it('a 403 lands as ?error=elevation; the layout offers /step-up?next=<this page without the error>', () => {
    expect(stepUpHref('/tenants/abc', '?error=elevation&tab=limits')).toBe(`/step-up?next=${encodeURIComponent('/tenants/abc?tab=limits')}`);
    expect(stepUpHref('/flags', '?error=elevation')).toBe(`/step-up?next=${encodeURIComponent('/flags')}`);
    const layout = strip(read(...FILES.layout));
    expect(layout).toMatch(/get\('error'\) === 'elevation'/);
    expect(layout).toMatch(/href=\{stepUpHref\(pathname, search\)\}/);
    expect(strip(read('middleware.ts'))).toMatch(/headers\.set\('x-search'/);
    expect(dict['stepUp.banner']).toBeTruthy();
  });
  it('the step-up screen needs a session and only ever returns to a same-console path', () => {
    const src = strip(read(...FILES.stepUp));
    expect(src).toMatch(/requireAdmin\(\)/);
    expect(src).toMatch(/next=\{safeNext\(next\)\}/);
    expect(safeNext('/tenants/1?x=2')).toBe('/tenants/1?x=2');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil', '/a\r\nx', '/login/key?ticket=x', '/api/auth/step-up', null]) expect(safeNext(bad)).toBe('/dashboard');
  });
});

describe('ADMIN-AUTH-1 · sign-out ends the session server-side', () => {
  it('calls admin-api sign-out with the bearer BEFORE clearing the cookie, and clears it whatever the answer', () => {
    const src = strip(read(...FILES.session));
    const call = src.indexOf("'signOut'");
    const clear = src.indexOf('clearAdminSession()');
    expect(call).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(call);
    expect(src).toMatch(/timeoutMs: 5_000/);
    expect(src).toMatch(/\/login\?error=signedOut/);
  });
});

describe('ADMIN-AUTH-1 · security keys screen', () => {
  const k = (id: string, revokedAt: string | null = null): KeyView => ({ id, label: id, enrolledVia: 'bootstrap', createdAt: '2026-11-24T10:00:00Z', lastUsedAt: null, revokedAt, revokeReason: null });
  it('your last active key is never offered for revocation', () => {
    expect(canRevokeOwnKey([k('a')], 'a')).toBe(false);
    expect(canRevokeOwnKey([k('a'), k('b')], 'a')).toBe(true);
    expect(canRevokeOwnKey([k('a'), k('b', '2026-11-24')], 'a')).toBe(false);
    expect(activeKeys([k('a'), k('b', 'x')]).map((x) => x.id)).toEqual(['a']);
  });
  it('labels', () => {
    expect(enrolledViaKey('bootstrap')).toBe('keys.via.bootstrap');
    expect(enrolledViaKey('enrollment_code')).toBe('keys.via.code');
    expect(enrolledViaKey('self_with_key')).toBe('keys.via.self');
    const now = Date.parse('2026-11-24T12:00:00Z');
    expect(codeStateKey({ consumedAt: 'x', revokedAt: null, expiresAt: '2026-11-25T00:00:00Z' }, now)).toBe('keys.code.used');
    expect(codeStateKey({ consumedAt: null, revokedAt: 'x', expiresAt: '2026-11-25T00:00:00Z' }, now)).toBe('keys.code.revoked');
    expect(codeStateKey({ consumedAt: null, revokedAt: null, expiresAt: '2026-11-24T11:00:00Z' }, now)).toBe('keys.code.expired');
    expect(codeStateKey({ consumedAt: null, revokedAt: null, expiresAt: '2026-11-25T00:00:00Z' }, now)).toBe('keys.code.open');
  });
  it('is in the nav, and the revoke actions go through admin-api (never a direct write)', () => {
    const item = ADMIN_NAV.find((i) => i.href === '/staff/keys');
    expect(item && dict[item.labelKey]).toBeTruthy();
    expect(liveNav().map((i) => i.href)).toContain('/staff/keys');
    const actions = strip(read(...FILES.keysActions));
    expect(actions).toMatch(/adminPost\(`auth\/keys\/\$\{encodeURIComponent\(id\)\}\/revoke`/);
    expect(actions).toMatch(/adminPost\(`auth\/enrollment-codes\/\$\{encodeURIComponent\(id\)\}\/revoke`/);
    expect(actions).toMatch(/safeNext\(str\(formData, 'returnTo'\), '\/staff\/keys'\)/);
  });
  it('every t.t(\'…\') key rendered by the new/changed screens exists in en.ts', () => {
    for (const f of [FILES.login, FILES.key, FILES.stepUp, FILES.keys, FILES.layout, FILES.operator]) {
      for (const m of strip(read(...f)).matchAll(/t\.t\('([^']+)'/g)) expect([m[1], typeof dict[m[1]]]).toEqual([m[1], 'string']);
    }
    for (const key of ['keyAdded', 'keyRevoked', 'codeRevoked']) expect(dict[`keys.ok.${key}`]).toBeTruthy();
    for (const key of ['elevation', 'keyRevoke', 'reason', 'generic']) expect(dict[`keys.err.${key}`]).toBeTruthy();
    expect(dict['st.ok.keyRevoked']).toBeTruthy();
    expect(dict['st.err.keyRevoke']).toBeTruthy();
  });
});
