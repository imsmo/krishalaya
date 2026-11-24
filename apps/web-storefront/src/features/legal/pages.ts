// apps/web-storefront/src/features/legal/pages.ts · PC-56 LEGAL-1 — THE FOUR POLICY PAGES, AND WHOSE THEY ARE. PURE (no React, no IO, no Node
// API — the middleware's host rule imports it on the Edge runtime).
//
// Terms, Privacy, Refunds and Shipping are BOTH chromes: `/terms` is the platform's page; `/<slug>/terms` is a store's (the API answers that
// store's own published policy, or the platform's — `source`). On a store's OWN host `/terms` etc. are rewritten to the store's page
// (brand-theme.ts `hostRewritePath`, features/sweep/paths.ts STORE_HOST_REWRITES). The four segment names are reserved tenant slugs (the API's
// reserved list). No flag: migration 0223's named Law 10 exception — legal / info pages have no kill-switch.
import type { PolicySlug } from '@krishalaya/sdk-js';
import type { AccountChrome } from '../store4a/account';

export const POLICY_SLUGS: readonly PolicySlug[] = Object.freeze(['terms', 'privacy', 'refunds', 'shipping'] as PolicySlug[]);
/** The platform-host paths (`/terms` …) — the sitemap's entries and the store host's rewrites. */
export const POLICY_PATHS: readonly string[] = Object.freeze(POLICY_SLUGS.map((s) => `/${s}`));

/** A policy page under a chrome: `/terms` or `/<slug>/terms`. */
export function policyHref(c: AccountChrome, slug: PolicySlug): string {
  return c.kind === 'tenant' ? `/${encodeURIComponent(c.slug)}/${slug}` : `/${slug}`;
}
