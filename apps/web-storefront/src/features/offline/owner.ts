// apps/web-storefront/src/features/offline/owner.ts · PC-56 HOTFIX-8 · D1 (c) — "nothing personal in the cache" on a SHARED phone. Pure (no
// Next, no cookies() — lib/owner-marker.ts is the request-scoped half), so the rule is unit-tested (src/test/hotfix8-owner.spec.ts).
//
//   • `Clear-Site-Data: "cache", "storage"` is sent on SIGN-OUT and on a SIGN-IN whose person differs from the previous one on this device.
//     "cache" drops the HTTP cache; "storage" drops Cache Storage (the service worker's caches), local/session storage, IndexedDB and the
//     service-worker registration itself (the root layout registers it again on the next page). It never touches cookies — the new
//     session survives it. Browsers: Chrome / Edge / Opera honour it; Firefox honours it; Safari's support is PARTIAL (older Safari
//     ignores the header). Where it is ignored, the worker's cache NAME is the build id (the `/sw.js` route), so a cached shell lives at
//     most until the next deploy, and the shell itself carries nothing personal (the `(shell)` layout).
//   • THE OWNER MARKER (survey E1): `kvs_owner` — a RANDOM, non-secret value minted at a sign-in whose person is new to this device, in a
//     JavaScript-readable cookie (STORE-6b's device drafts will key on it). Never a token, never a user id. Because a random value cannot
//     by itself say WHO it was minted for, a second, httpOnly cookie `kvs_owner_tag` binds it: sha256 over (marker, user id) — a salted
//     digest the browser's scripts never see and that cannot be reversed to a user id. `ownerChanged` compares the previous pair with the
//     new session's user (the access token's `sub`): no previous marker, a malformed one, a missing tag or a tag for someone else → CHANGED
//     (fail closed — a needless clear costs a re-download of the shell; a missed clear could show one person's traces to another).
//   • THE ONE-SHOT ARM: a Server Action cannot set an arbitrary response header (Next 14), so the action sets the httpOnly one-shot cookie
//     `kvs_csd` and redirects THROUGH the route handler `/api/session/clear?next=…`, which sends the header on its 303 (only when armed —
//     a link from elsewhere clears nothing) and drops the arm.
import { createHash, randomBytes } from 'node:crypto';
import { safeNext } from '../auth/redirect';

/** The JS-readable, random, non-secret owner marker (E1). */
export const OWNER_COOKIE = 'kvs_owner';
/** httpOnly: sha256(marker, user id) — which person the marker was minted for. */
export const OWNER_TAG_COOKIE = 'kvs_owner_tag';
/** httpOnly one-shot: "the next pass through the clear route sends Clear-Site-Data". */
export const CLEAR_SITE_COOKIE = 'kvs_csd';
/** The route handler that sends the header (under /api/: the service worker never touches it; the middleware skips it). */
export const CLEAR_SITE_PATH = '/api/session/clear';
/** A marker lives a year (it is not a session: it outlives sign-out on purpose, so the NEXT sign-in can tell whether the person changed). */
export const OWNER_MAX_AGE_SEC = 60 * 60 * 24 * 365;
/** The arm lives two minutes — long enough for the redirect, never a standing instruction. */
export const CLEAR_ARM_MAX_AGE_SEC = 120;

const MARKER = /^[A-Za-z0-9_-]{22}$/;
const TAG = /^[0-9a-f]{32}$/;

/** The header value: the HTTP cache and every storage the origin holds (Cache Storage, IndexedDB, local storage, the worker). */
export function clearSiteDataHeader(): string { return '"cache", "storage"'; }

/** A fresh marker: 16 random bytes, base64url (22 characters). */
export function mintOwnerMarker(bytes: (n: number) => Buffer = randomBytes): string { return bytes(16).toString('base64url'); }

export function isOwnerMarker(v: unknown): v is string { return typeof v === 'string' && MARKER.test(v); }

/** The binding of a marker to a person: a salted digest (the marker is the salt), 32 hex characters. */
export function ownerTag(marker: string, userId: string): string {
  return createHash('sha256').update(`kvs-owner|${marker}|${userId}`).digest('hex').slice(0, 32);
}

/** Did the person change? `prev` = the cookies this device holds; `nextUserId` = the new session's user. Unknown → changed (fail closed). */
export function ownerChanged(prev: { marker?: string | null; tag?: string | null } | null | undefined, nextUserId: string | null | undefined): boolean {
  if (!nextUserId) return true;
  const marker = prev?.marker; const tag = prev?.tag;
  if (!isOwnerMarker(marker) || typeof tag !== 'string' || !TAG.test(tag)) return true;
  return ownerTag(marker, nextUserId) !== tag;
}

/** The `sub` claim (the user id) of an access token — read, never verified: it came straight from the API in this same action. */
export function tokenSubject(accessToken: string | null | undefined): string | null {
  try {
    const seg = String(accessToken ?? '').split('.')[1] ?? '';
    const sub = (JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub.length > 0 && sub.length <= 64 ? sub : null;
  } catch { return null; }
}

/** Where an armed action redirects: through the clear route, then on to `next` (same-origin paths only). */
export function clearSiteHref(next: string): string { return `${CLEAR_SITE_PATH}?next=${encodeURIComponent(safeNext(next))}`; }

/** One cookie's value from a raw Cookie header (the route handler reads the request as a plain Request). */
export function cookieFrom(header: string | null | undefined, name: string): string | null {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * The clear route's answer, as data (the route builds a Response from it). An `rsc` request is Next's own in-process prefetch of an action's
 * redirect target (it would follow our 303 and stream the next page, so the BROWSER would never pass here): answer 204, untouched — the
 * client then navigates here itself. Otherwise 303 to `next`; armed → the header + the arm dropped.
 */
export function clearRouteAnswer(input: { next: string | null; cookie: string | null; rsc: boolean }): { status: 204 | 303; headers: Array<[string, string]> } {
  const headers: Array<[string, string]> = [['Cache-Control', 'no-store']];
  if (input.rsc) return { status: 204, headers };
  headers.push(['Location', safeNext(input.next)]);
  if (cookieFrom(input.cookie, CLEAR_SITE_COOKIE) === '1') {
    headers.push(['Clear-Site-Data', clearSiteDataHeader()]);
    headers.push(['Set-Cookie', `${CLEAR_SITE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`]);
  }
  return { status: 303, headers };
}
