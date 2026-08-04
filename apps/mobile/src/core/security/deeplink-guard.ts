// apps/mobile/src/core/security/deeplink-guard.ts · INBOUND deep-link validation (guide §4). A deep link (from an
// SMS, notification, or another app) can carry any path + params — we NEVER auto-execute an action from a link.
// This guard: (1) only accepts our own `krishalaya://` scheme (or https app-links to our host), (2) allowlists
// the route prefixes a link may land on, (3) rejects traversal / absolute / protocol-relative / whitespace junk,
// and (4) treats ids in params as UNTRUSTED — the destination screen still re-reads ownership from the server
// (IDOR defence). Sensitive actions (pay/withdraw/delete) are NEVER reachable directly by a link; they require
// the in-app flow + auth + confirm. PURE + unit-tested.

export const APP_SCHEME = 'krishalaya';
/** Route prefixes a deep link may open. Note: NO pay/withdraw/checkout/account-delete — those need the in-app flow. */
export const DEEPLINK_ALLOWLIST = [
  'listing', 'order', 'orders', 'mandi', 'weather', 'tips', 'schemes', 'notifications', 'auctions', 'profile',
] as const;

/** A param value is safe to forward to a screen iff it's a bounded, plain token (no traversal/scheme/whitespace).
 * The screen still re-checks ownership server-side — this only blocks obviously hostile input. */
const SAFE_PARAM_RE = /^[A-Za-z0-9._-]{1,128}$/;
export function isSafeParamValue(v: string): boolean { return SAFE_PARAM_RE.test(v ?? ''); }

export interface ParsedLink { ok: boolean; path?: string; reason?: 'scheme' | 'route' | 'malformed' }

/** Validate an inbound deep-link URL and return its (allowlisted) path, or a typed rejection. */
export function parseDeepLink(url: string, allowedHosts: string[] = []): ParsedLink {
  const raw = (url ?? '').trim();
  if (!raw) return { ok: false, reason: 'malformed' };

  let path: string | null = null;
  const scheme = `${APP_SCHEME}://`;
  if (raw.toLowerCase().startsWith(scheme)) {
    path = raw.slice(scheme.length);
  } else if (/^https:\/\//i.test(raw)) {
    const m = /^https:\/\/([^/:?#]+)(\/[^?#]*)?/i.exec(raw);
    const host = m?.[1]?.toLowerCase();
    if (!host || !allowedHosts.map((h) => h.toLowerCase()).includes(host)) return { ok: false, reason: 'scheme' };
    path = (m?.[2] ?? '').replace(/^\/+/, '');
  } else {
    return { ok: false, reason: 'scheme' };
  }

  path = (path ?? '').split('?')[0].split('#')[0].replace(/^\/+/, '');
  if (!path) return { ok: false, reason: 'route' };
  // Reject traversal / protocol-relative / whitespace.
  if (path.includes('..') || path.includes('//') || /\s/.test(path)) return { ok: false, reason: 'malformed' };
  const head = path.split('/')[0].toLowerCase();
  if (!(DEEPLINK_ALLOWLIST as readonly string[]).includes(head)) return { ok: false, reason: 'route' };
  return { ok: true, path };
}
