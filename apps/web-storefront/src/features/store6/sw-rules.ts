// apps/web-storefront/src/features/store6/sw-rules.ts · PC-56 STORE-6a · D2 / D3 / D4 (survey E3) — THE OFFLINE RULES, PURE, IN ONE PLACE.
//
// Two halves:
//   1. The SERVER's rule (Edge-safe — the middleware imports it): which response may be marked `X-KV-Cacheable: public`. ONLY a public page
//      (a listing, an organisation's page, a trace / verify page, a certificate page, the browse list), ONLY when the request carries NO session
//      cookie (the worker cannot see cookies, so the server decides — a signed-in person's page may hold a cart count, and is never kept), ONLY
//      when the organisation's `storefront_offline_reads` flag is ON (fail closed). NEVER account, orders, messages, cart, checkout, auctions,
//      offers, the inbox, sign-in, the shell.
//   2. The WORKER's rules (`swRoute`, `swStorable`, `evictPlan`, `swFallback`): each is a SELF-CONTAINED function (no import, no reference to
//      anything outside its own body, no syntax newer than the worker's floor) so features/offline/sw-source.ts embeds its exact text into
//      `/sw.js` (`String(fn)`) and the specs below pin the very code the phone runs (test/store6-sw-rules.spec.ts runs the built worker source
//      in a sandbox — jsdom is not installed in this repo; node's `vm` stands in).
//
// The cache bound (founder D2): 20 pages, 7 days, least-recently-STORED out first. No prefetch (founder D3): a page is kept only when the
// person opened it. Photos never (`/media/`, image requests are never touched).
import { STATIC_TOP_SEGMENTS } from '../auth/redirect';

// ─────────────────────────────── 1 · the server's rule ───────────────────────────────

/** The session cookies (lib/auth.ts — kept literal here: lib/auth is server-only, this module runs in the Edge middleware). Any of them present
 *  = a session: never cacheable. The refresh cookie alone counts (a refreshable session renders the signed-in header). */
export const SESSION_COOKIES: readonly string[] = Object.freeze(['kv_session', 'kv_refresh', 'kv_tid']);
/** The response header the worker reads (never the HTML body), and the request header the layouts read to stamp the page. */
export const CACHEABLE_HEADER = 'x-kv-cacheable';
/** The request header that tells the organisation's layout to render its SESSION-FREE shell chrome (the offline page). */
export const SHELL_HEADER = 'x-kv-shell';
/** The page limit and age the worker keeps (founder D2) — the copy interpolates these; `evictPlan`'s own defaults must equal them (spec). */
export const PAGE_LIMIT = 20;
export const PAGE_DAYS = 7;

const SLUG = /^[a-z0-9][a-z0-9-]{0,49}$/;
const isSlug = (s: string | undefined): s is string => !!s && SLUG.test(s) && !STATIC_TOP_SEGMENTS.includes(s);

/** Whose flag decides whether this (internal, post-rewrite) path may be kept: an organisation's (`/<slug>/…`), the platform's own (the host-root
 *  trace / certificate / browse pages on the platform host), or null — never cacheable. */
export type CacheScope = { kind: 'tenant'; slug: string } | { kind: 'platform' };
export function cacheableScope(pathname: string): CacheScope | null {
  const p = String(pathname || '').split('?')[0].split('#')[0];
  const s = p.split('/');                      // ['', a, b, c, d]
  if (s[0] !== '' || s.some((x, i) => i > 0 && x === '')) return null;
  const n = s.length - 1;
  // the platform host's own public pages (no organisation in the path)
  if (s[1] === 'trace' && n === 2) return { kind: 'platform' };
  if (s[1] === 'trace' && n === 3 && s[3] === 'verify') return { kind: 'platform' };
  if (s[1] === 'certificates' && n === 2) return { kind: 'platform' };
  if (s[1] === 'search' && n === 1) return { kind: 'platform' };
  if (!isSlug(s[1])) return null;
  const slug = s[1];
  if (n === 1) return { kind: 'tenant', slug };                                          // the organisation's page
  if (n === 3 && s[2] === 'listings') return { kind: 'tenant', slug };                   // a listing
  if (n === 3 && s[2] === 'trace') return { kind: 'tenant', slug };                      // a trace page
  if (n === 4 && s[2] === 'trace' && s[4] === 'verify') return { kind: 'tenant', slug }; // its verify page
  if (n === 3 && s[2] === 'certificates') return { kind: 'tenant', slug };               // a certificate
  if (n === 2 && s[2] === 'search') return { kind: 'tenant', slug };                     // the browse list
  return null;
}

/** THE rule: a page may be marked cacheable only when it is a public page, NO session cookie is present, and the deciding flag is ON. */
export function cacheableRule(pathname: string, hasSession: boolean, flagOn: boolean): boolean {
  if (hasSession) return false;
  if (!flagOn) return false;
  return cacheableScope(pathname) !== null;
}

/** Is this (internal) path an organisation's offline page — the one its layout renders session-free (the worker pre-caches it on a store host)? */
export function isTenantOfflinePath(pathname: string): boolean {
  const s = String(pathname || '').split('?')[0].split('/');
  return s.length === 3 && s[0] === '' && isSlug(s[1]) && s[2] === 'offline';
}

/** Any of the session cookies present? (`has` — a cookie jar's own method) */
export function hasSessionCookie(has: (name: string) => boolean): boolean {
  return SESSION_COOKIES.some((n) => has(n));
}

// ─────────────────────────────── 2 · the worker's rules (embedded into /sw.js) ───────────────────────────────
// Self-contained on purpose — see the header. ES2017, `var` and plain loops: the text is the worker's text.

/** What the worker does with a request: 'pass' (never touched), 'navigate' (network-first, a kept public page or the shell offline), 'static'. */
export function swRoute(method: string, url: string, origin: string, hasAuth: boolean, mode: string, destination: string, shell: string[]): 'pass' | 'navigate' | 'static' {
  if (method !== 'GET') return 'pass';                                  // never a mutation
  var u = new URL(url);
  if (u.origin !== origin) return 'pass';                               // never cross-origin (API, payments, photos on the media host)
  var p = u.pathname;
  if (p.indexOf('/v1/') === 0 || p.indexOf('/api/') === 0) return 'pass';   // never an API path
  if (p.indexOf('/media/') === 0) return 'pass';                        // photos are never kept
  if (hasAuth) return 'pass';                                           // never an authorised request
  if (mode === 'navigate') return 'navigate';
  if (shell.indexOf(p) >= 0) return 'static';
  if (destination === 'image') return 'pass';                           // no image beyond the shell's own icons
  if (p.indexOf('/_next/static/') === 0) return 'static';
  return 'pass';
}

/** May this navigation's RESPONSE be kept? Only a plain 200 HTML page the server marked `X-KV-Cacheable: public` (never the body). */
export function swStorable(status: number, type: string, redirected: boolean, cacheable: string | null, contentType: string | null): boolean {
  if (status !== 200 || type !== 'basic' || redirected) return false;
  if (cacheable !== 'public') return false;
  return /^text\/html/i.test(contentType || '');
}

/** The URLs to delete from the page cache: anything older than 7 days (or with no readable stamp), then all but the 20 most recently stored. */
export function evictPlan(entries: Array<{ url: string; storedAt: number }>, now: number, max?: number, maxAgeMs?: number): string[] {
  var keep = typeof max === 'number' ? max : 20;
  var age = typeof maxAgeMs === 'number' ? maxAgeMs : 7 * 24 * 60 * 60 * 1000;
  var out: string[] = [];
  var live: Array<{ url: string; storedAt: number }> = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (!isFinite(e.storedAt) || e.storedAt <= 0 || now - e.storedAt > age) out.push(e.url); else live.push(e);
  }
  live.sort(function (a, b) { return b.storedAt - a.storedAt; });
  for (var j = keep; j < live.length; j++) out.push(live[j].url);
  return out;
}

/** The shell a failed navigation falls back to. One worker per ORIGIN, and it cannot know a path store's slug: the host-root `/offline` — on a
 *  store HOST that is the organisation's own page (the middleware rewrites it); on a PATH store (`/<slug>` on the platform host) it is the
 *  platform's session-free shell. The honest limit, named (report §6). */
export function swFallback(_pathname: string): string {
  return '/offline';
}

// ─────────────────────────────── 3 · the polite update (founder D4) ───────────────────────────────

/** The minimal DOM `formsDirty` needs (so the rule is tested without a browser). */
export interface DirtyField { type?: string; value?: string; defaultValue?: string; checked?: boolean; defaultChecked?: boolean }
export interface DirtyDoc { querySelectorAll(sel: string): ArrayLike<DirtyField> }

/** Does any form on the page hold content the person typed (a value differing from its default)? Hidden fields never count. */
export function formsDirty(doc: DirtyDoc): boolean {
  const fields = doc.querySelectorAll('form input, form textarea, form select');
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const type = String(f.type || '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') continue;
    if (type === 'checkbox' || type === 'radio') { if (Boolean(f.checked) !== Boolean(f.defaultChecked)) return true; continue; }
    if (f.defaultValue !== undefined && (f.value ?? '') !== (f.defaultValue ?? '')) return true;
  }
  return false;
}

/** "A new version is ready" may show only when no form on the page has content (W319 "never mid-task"). */
export function updateNoticeAllowed(formsAreDirty: boolean): boolean {
  if (formsAreDirty) return false;
  return true;
}
