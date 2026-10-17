// apps/web-storefront/src/features/auth/redirect.ts · PC-56 STORE-1a · C7 — where a sign-in may send a person, and which sign-in page a
// protected page sends them to. Pure (lib/session re-exports `safeNext`; the rule is tested here).

/** A `next` destination is honoured only if it is a same-origin PATH (open-redirect guard): "/x" yes; "//evil", "/\evil", "http:" no. */
export function safeNext(next: string | undefined | null): string {
  const n = String(next ?? '');
  if (!n.startsWith('/') || n.startsWith('//') || n.includes('\\') || /[\u0000-\u001f]/.test(n) || n.length > 512) return '/';
  return n;
}

/**
 * The storefront's own top-level routes — every directory directly under `src/app` (or under a route group such as `(platform)`, which adds
 * no URL segment — PC-56 STORE-1b) that is not `[tenantSlug]` (a test compares this list with the directory, so a new route cannot be
 * forgotten). A first path segment NOT in this list is a tenant store's slug.
 */
export const STATIC_TOP_SEGMENTS: readonly string[] = Object.freeze([
  'about', 'account', 'api', 'auctions', 'blog', 'cart', 'checkout', 'help', 'login', 'messages', 'notifications', 'offers', 'offline',
  'orders', 'press', 'pricing', 'tenants-signup', 'trace',
  // PC-56 STORE-1b: the platform home's discovery feed and organisation directory (both reserved as tenant slugs in migration 0204)
  'discover', 'organisations',
  // PC-56 STORE-1c: canon W307's route (reserved as a tenant slug in migration 0205); `tenants-signup` above now redirects to it
  'for-organisations',
  // PC-56 STORE-2a: canon W276's platform search (reserved as a tenant slug in migration 0204)
  'search',
  // PC-56 STORE-3c: the platform door to a group lot (`/g/[id]`, canon W279 — reserved as a tenant slug in migration 0212)
  'g',
  // PC-56 STORE-5b: canon W305's platform certificate page (`/certificates`, `/certificates/[id]` — reserved as a tenant slug in migration 0219)
  'certificates',
  // PC-56 HOTFIX-8 · D1 (b): the service worker is served by the route `app/sw.js/route.ts` (it was `public/sw.js`); never a slug (a dot)
  'sw.js',
  // PC-56 STORE-6a · C3: canon W319's install page and W314's queued-actions list (`/app`, `/queued` — reserved as tenant slugs in migration 0204)
  'app', 'queued',
  // PC-56 STORE-6a · D6: the host-root manifest is a ROUTE now (`(platform)/manifest.webmanifest`, reserved as a tenant slug in migration 0204)
  'manifest.webmanifest',
  // PC-56 STORE-6b · C3: canon W315's "On this phone" (`/sync` — reserved as a tenant slug in migration 0204:150)
  'sync',
]);
const SLUG = /^[a-z0-9][a-z0-9-]{0,49}$/;

/** The tenant slug a storefront path belongs to (`/anand-fpo/listings/1` → `anand-fpo`), or null for a platform path. */
export function tenantSlugOfPath(path: string): string | null {
  const seg = safeNext(path).split(/[/?#]/)[1] ?? '';
  return seg && SLUG.test(seg) && !STATIC_TOP_SEGMENTS.includes(seg) ? seg : null;
}

/** C4: a protected tenant page sends an anonymous visitor to THAT store's sign-in (`/<slug>/login`), a platform page to `/login`. */
export function loginPathFor(returnTo: string): string {
  const next = safeNext(returnTo);
  const slug = tenantSlugOfPath(next);
  return `${slug ? `/${slug}` : ''}/login?next=${encodeURIComponent(next)}`;
}

/** C4: which tenant slug a sign-in page belongs to — the `/[tenantSlug]` route param, then the host-routing header, then the platform's. */
export function pickTenantSlug(routeSlug: string | null | undefined, hostHeaderSlug: string | null | undefined, platformSlug: string | null | undefined): string | null {
  for (const c of [routeSlug, hostHeaderSlug, platformSlug]) {
    const s = String(c ?? '').trim().toLowerCase();
    if (s && SLUG.test(s)) return s;
  }
  return null;
}
