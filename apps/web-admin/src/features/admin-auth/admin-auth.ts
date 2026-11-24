// apps/web-admin/src/features/admin-auth/admin-auth.ts · PC-56 ADMIN-AUTH-1 — the console's half of operator sign-in, as PURE logic.
//
// No React, no Next, no fetch runtime (the caller passes `fetch`) → unit-tested in node (test/adminauth1-sign-in.spec.ts).
// The route handlers under app/api/auth/** are thin wrappers over `forwardToAdminApi` + `sessionFrom`.
//
// THE FLOW, from this side:
//   /login → a plain link to `${NEXT_PUBLIC_ADMIN_API_URL}/v1/auth/sso/start` (the browser goes to admin-api, then the IdP)
//   → admin-api's callback redirects here to /login/key?ticket=… → the key screen's client component asks OUR route handlers
//   (same origin; CSP connect-src 'self') for options, runs the WebAuthn ceremony in the browser, posts the result back →
//   our route handler forwards it to admin-api SERVER-TO-SERVER and, on success, sets the httpOnly `kva_session` cookie
//   itself. **The admin token never reaches browser JavaScript**: the JSON the browser receives is `{ redirect }` only.

/** The only error values /login renders; anything else is shown as the generic message. No oracle about which step failed. */
export const LOGIN_ERRORS = ['signin', 'expired', 'signedOut'] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];
export function loginErrorKey(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const v = String(raw);
  if (v === 'expired') return 'login.err.expired';
  if (v === 'signedOut') return 'login.err.signedOut';
  return 'login.failed';
}

/** The IdP entry point on admin-api (URI-versioned, like every admin-api route). */
export function ssoStartUrl(publicAdminApiUrl: string): string {
  return `${publicAdminApiUrl.replace(/\/+$/, '')}/v1/auth/sso/start`;
}

/** A login ticket as admin-api mints it: 32 random bytes, base64url (43 chars). Anything else never leaves this server. */
export function isTicket(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
}

/** A same-console relative path, or the dashboard. Never `//host`, a scheme, a backslash or a header break. */
export function safeNext(p: unknown, fallback = '/dashboard'): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /[\r\n]/.test(p)) return fallback;
  if (p.startsWith('/login') || p.startsWith('/api/')) return fallback;
  return p.slice(0, 500);
}

/** The i18n key the key / step-up screens show for an admin-api refusal code. */
export function keyErrorKey(code: unknown): string {
  switch (code) {
    case 'AUTH_TICKET_INVALID': return 'loginKey.err.ticket';
    case 'AUTH_KEY_REJECTED': return 'loginKey.err.key';
    case 'AUTH_ENROLLMENT_REFUSED': return 'loginKey.err.code';
    case 'AUTH_RATE_LIMITED': return 'loginKey.err.rate';
    case 'CEREMONY_CANCELLED': return 'loginKey.err.cancelled';
    case 'UNSUPPORTED': return 'loginKey.err.unsupported';
    default: return 'loginKey.err.generic';
  }
}

/** The browser-side ceremony errors from @simplewebauthn/browser, folded to the two the operator can act on. */
export function ceremonyErrorCode(e: unknown): 'CEREMONY_CANCELLED' | 'UNSUPPORTED' | 'GENERIC' {
  const name = (e as { name?: unknown })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return 'CEREMONY_CANCELLED';
  if (name === 'NotSupportedError' || (e as { code?: unknown })?.code === 'ERROR_INVALID_DOMAIN') return 'UNSUPPORTED';
  return 'GENERIC';
}

/** The ceremony endpoints a route handler may forward to — an allow-list, so no handler becomes an open proxy. */
export const FORWARDABLE = {
  keyOptions: 'auth/webauthn/options',
  keyEnroll: 'auth/webauthn/enroll',
  keyLogin: 'auth/webauthn/login',
  stepUpOptions: 'auth/step-up/options',
  stepUp: 'auth/step-up',
  addKeyOptions: 'auth/keys/options',
  addKey: 'auth/keys',
  issueCode: 'auth/enrollment-codes',
  signOut: 'auth/sign-out',
} as const;
export type Forwardable = keyof typeof FORWARDABLE;

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; cache?: 'no-store' }) =>
  Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Forwarded { status: number; body: Record<string, unknown> }

/** POST to admin-api server-to-server with a timeout. Never throws: a network failure is a 502 with a generic code. */
export async function forwardToAdminApi(
  fetchImpl: FetchLike, serverAdminApiUrl: string, what: Forwardable, body: unknown,
  opts: { bearer?: string; requestId?: string; timeoutMs?: number } = {},
): Promise<Forwarded> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(`${serverAdminApiUrl.replace(/\/+$/, '')}/v1/${FORWARDABLE[what]}`, {
      method: 'POST', cache: 'no-store', signal: ctl.signal,
      headers: {
        accept: 'application/json', 'content-type': 'application/json',
        ...(opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {}),
        ...(opts.requestId ? { 'x-request-id': opts.requestId } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
    return { status: res.status, body: json };
  } catch {
    return { status: 502, body: { code: 'ADMIN_API_UNREACHABLE' } };
  } finally { clearTimeout(timer); }
}

/** The minted session from a successful login / step-up response, or null. */
export function sessionFrom(f: Forwarded): { token: string; maxAgeSec: number } | null {
  if (f.status !== 200) return null;
  const d = (f.body.data ?? null) as { token?: unknown; maxAgeSec?: unknown } | null;
  if (!d || typeof d.token !== 'string' || d.token.split('.').length !== 3) return null;
  if (typeof d.maxAgeSec !== 'number' || !Number.isFinite(d.maxAgeSec) || d.maxAgeSec <= 0) return null;
  return { token: d.token, maxAgeSec: Math.min(Math.floor(d.maxAgeSec), 43_200) };
}

/** What the browser may see of an admin-api answer: `data` (options, a key id, a one-time code) or `{ code }` — never a
 *  token and never admin-api's message text (the screens translate the code). */
export function browserBody(f: Forwarded): Record<string, unknown> {
  if (f.status >= 200 && f.status < 300) {
    const data = (f.body.data ?? {}) as Record<string, unknown>;
    const { token: _t, ...rest } = data;
    return { data: rest };
  }
  return { code: typeof f.body.code === 'string' ? f.body.code : 'AUTH_REFUSED' };
}

/** Same-origin check for the JSON route handlers (defence in depth; SameSite=Strict already keeps the session cookie home). */
export function sameOrigin(originHeader: string | null, requestUrl: string): boolean {
  if (!originHeader) return true;   // non-browser callers and same-origin GET-less fetches in some engines omit it
  try { return new URL(originHeader).origin === new URL(requestUrl).origin; } catch { return false; }
}

/** Where a 403 elevation refusal sends the operator: the step-up screen, which returns them to the page they were on. */
export function stepUpHref(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete('error');
  const qs = params.toString();
  const next = safeNext(`${pathname}${qs ? `?${qs}` : ''}`);
  return `/step-up?next=${encodeURIComponent(next)}`;
}

/** The key list as the security screen shows it. */
export interface KeyView { id: string; label: string; enrolledVia: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null; revokeReason: string | null }
export function activeKeys(keys: readonly KeyView[]): KeyView[] { return keys.filter((k) => !k.revokedAt); }
export function canRevokeOwnKey(keys: readonly KeyView[], id: string): boolean {
  const active = activeKeys(keys);
  return active.length > 1 && active.some((k) => k.id === id);
}
export function enrolledViaKey(v: string): string {
  return v === 'bootstrap' ? 'keys.via.bootstrap' : v === 'enrollment_code' ? 'keys.via.code' : 'keys.via.self';
}

/** The state of an issued enrollment code, for the list. */
export function codeStateKey(c: { consumedAt: string | null; revokedAt: string | null; expiresAt: string }, now = Date.now()): string {
  if (c.consumedAt) return 'keys.code.used';
  if (c.revokedAt) return 'keys.code.revoked';
  if (new Date(c.expiresAt).getTime() <= now) return 'keys.code.expired';
  return 'keys.code.open';
}

/** Validation of the enrollment-code form before anything is sent. */
export function enrollFormProblem(code: string, label: string): string | null {
  if (code.replace(/[\s-]/g, '').length < 8) return 'loginKey.err.codeFormat';
  if (!label.trim() || label.trim().length > 60) return 'loginKey.err.label';
  return null;
}

/** Every catalogue key the client ceremony components read — resolved on the server and passed down as props (the console's
 *  i18n is server-side; a client component holds no literals). test/adminauth1-sign-in.spec.ts checks each exists in en.ts. */
export const AUTH_COPY_KEYS = [
  'loginKey.loading', 'loginKey.touch', 'loginKey.authLead', 'loginKey.authCta', 'loginKey.enrolled', 'loginKey.enrollLead',
  'loginKey.enrollPin', 'loginKey.codeLabel', 'loginKey.codeHint', 'loginKey.labelLabel', 'loginKey.labelPlaceholder',
  'loginKey.enrollCta', 'loginKey.startAgain',
  'loginKey.err.ticket', 'loginKey.err.key', 'loginKey.err.code', 'loginKey.err.rate', 'loginKey.err.cancelled',
  'loginKey.err.unsupported', 'loginKey.err.generic', 'loginKey.err.codeFormat', 'loginKey.err.label',
  'stepUp.cta', 'stepUp.err.session',
  'keys.add.cta', 'keys.add.needsStepUp',
  'keys.code.email', 'keys.code.reason', 'keys.code.cta', 'keys.code.issuedFor', 'keys.code.issuedOnce',
  'keys.code.err.reason', 'keys.code.err.elevation', 'keys.code.err.refused', 'keys.code.err.invalid',
] as const;
export function authCopy(t: (k: string) => string): Record<string, string> {
  return Object.fromEntries(AUTH_COPY_KEYS.map((k) => [k, t(k)]));
}
