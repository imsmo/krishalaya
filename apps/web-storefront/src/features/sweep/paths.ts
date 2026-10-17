// apps/web-storefront/src/features/sweep/paths.ts · PC-56 STORE-SWEEP-a · C1 (founder D3 / D4) — WHICH PAGES ARE WHOSE. PURE (no React, no IO, no
// Node API — the middleware imports it on the Edge runtime).
//
//   • BOTH CHROMES, organisation-neutral words, no platform plug: Help (`/help`, `/<slug>/help`), the quality promise (`/quality-promise`,
//     `/<slug>/quality-promise`), and Contact — which is TWO pages: the platform's (`/contact`) and a store's own (`/<slug>/contact`, "Message
//     the organisation").
//   • PLATFORM-ONLY: About, Press, Pricing, Blog, Trust & your data, and the platform's Contact.
//
// THE HOST RULE, exactly: on a store's OWN host the middleware
//   – REWRITES `/help`, `/quality-promise`, `/contact` to the store's pages (brand-theme.ts `hostRewritePath`) — so `/contact` on a store host is
//     the STORE's contact page, never redirected;
//   – REDIRECTS (307) `/about`, `/press`, `/pricing`, `/blog`, `/trust-data` (and any path under them) to the SAME path on the platform's
//     origin (`NEXT_PUBLIC_SITE_URL`) — `platformOnlyRedirect`. With no usable platform origin configured it answers null (no redirect: the
//     request falls through exactly as before — a redirect to nowhere would loop; ops owed: set the origin);
//   – the Grievances link on every store is the PLATFORM's trust page (trust is not re-brandable): `/trust-data#grievances` on the same origin
//     for a path store, `<platform origin>/trust-data#grievances` on a store host; "Powered by" links the platform's `/about` the same way.
import type { AccountChrome } from '../store4a/account';

export type SweepPage = 'help' | 'quality-promise' | 'contact';
/** The pages a store renders under ITS OWN chrome (and the platform under its). */
export const SWEEP_BOTH_CHROMES: readonly SweepPage[] = Object.freeze(['help', 'quality-promise', 'contact'] as SweepPage[]);
/** The PLATFORM's pages. `/contact` is here AND a store's own page: on a store host it is rewritten (see STORE_HOST_REWRITES), never redirected. */
export const PLATFORM_ONLY_PATHS: readonly string[] = Object.freeze(['/about', '/press', '/pricing', '/blog', '/trust-data', '/contact']);
/** What a store host serves as the store's own page (brand-theme.ts `hostRewritePath` maps each to `/<slug><path>`). */
export const STORE_HOST_REWRITES: readonly string[] = Object.freeze(['/help', '/quality-promise', '/contact']);

/** A platform origin as `https://host[:port]` (http(s) only, no path), or null when unset / not a URL. */
export function platformOriginOf(raw: string | null | undefined): string | null {
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch {
    return null;
  }
}

/** On a store's own host: the platform URL a platform-only path answers with (a 307), or null — the store's own pages, every other path,
 *  and any request when no platform origin is configured. The caller appends the query string. */
export function platformOnlyRedirect(pathname: string, platformOrigin: string | null | undefined): string | null {
  const p = String(pathname ?? '');
  const bare = p.length > 1 ? p.replace(/\/+$/, '') : p;
  if (STORE_HOST_REWRITES.includes(bare)) return null;
  const hit = PLATFORM_ONLY_PATHS.some((x) => !STORE_HOST_REWRITES.includes(x) && (bare === x || bare.startsWith(`${x}/`)));
  if (!hit) return null;
  const origin = platformOriginOf(platformOrigin);
  return origin ? `${origin}${p}` : null;
}

/** A both-chromes page under a chrome: `/help` or `/<slug>/help`. */
export function sweepHref(c: AccountChrome, page: SweepPage): string {
  return c.kind === 'tenant' ? `/${encodeURIComponent(c.slug)}/${page}` : `/${page}`;
}

/** The prefix for a PLATFORM page seen from a chrome: '' on the platform and on a path store (same origin); the platform origin on a store's
 *  own host (`platformOrigin` is passed only there — the layout knows whether the middleware host-routed the request). */
function platformPrefix(c: AccountChrome, platformOrigin: string | null | undefined): string {
  return c.kind === 'tenant' ? platformOriginOf(platformOrigin) ?? '' : '';
}
/** D3: the Grievances link — ALWAYS the platform's trust page, from every chrome. */
export function grievancesHref(c: AccountChrome, platformOrigin: string | null | undefined): string {
  return `${platformPrefix(c, platformOrigin)}/trust-data#grievances`;
}
/** D4: "Powered by <platform>" links the platform's About page. */
export function platformAboutHref(c: AccountChrome, platformOrigin: string | null | undefined): string {
  return `${platformPrefix(c, platformOrigin)}/about`;
}
