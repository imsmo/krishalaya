// apps/web-storefront/src/lib/owner-marker.ts · PC-56 HOTFIX-8 · D1 (c) — the request-scoped half of features/offline/owner.ts (the rule and
// its reasons live there). Server-only: reads and writes the owner marker, its httpOnly binding and the one-shot Clear-Site-Data arm.
import 'server-only';
import { cookies } from 'next/headers';
import {
  OWNER_COOKIE, OWNER_TAG_COOKIE, CLEAR_SITE_COOKIE, OWNER_MAX_AGE_SEC, CLEAR_ARM_MAX_AGE_SEC,
  ownerChanged, ownerTag, mintOwnerMarker, tokenSubject,
} from '../features/offline/owner';

const secure = process.env.NODE_ENV === 'production';

/** Arm the next pass through `/api/session/clear` to send `Clear-Site-Data` (sign-out; a different person's sign-in). */
export function armClearSiteData(): void {
  cookies().set(CLEAR_SITE_COOKIE, '1', { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: CLEAR_ARM_MAX_AGE_SEC });
}

/**
 * At a successful sign-in: is this a different person from the one this device last knew? Yes → a fresh marker (JS-readable) + its
 * binding (httpOnly), the arm set, and `true` (the caller redirects through the clear route). Same person → nothing changes, `false`.
 */
export function settleOwnerAtSignIn(accessToken: string): boolean {
  const c = cookies();
  const sub = tokenSubject(accessToken);
  if (!ownerChanged({ marker: c.get(OWNER_COOKIE)?.value, tag: c.get(OWNER_TAG_COOKIE)?.value }, sub)) return false;
  const marker = mintOwnerMarker();
  c.set(OWNER_COOKIE, marker, { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: OWNER_MAX_AGE_SEC });
  c.set(OWNER_TAG_COOKIE, ownerTag(marker, sub ?? ''), { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: OWNER_MAX_AGE_SEC });
  armClearSiteData();
  return true;
}
