// apps/web-storefront/src/lib/env.ts · the ONLY place env is read in the storefront. PUBLIC site → NO secrets
// in the client bundle: only NEXT_PUBLIC_* values (the API origin) are exposed to the browser; a server-only
// internal API URL (for SSR fetches that stay inside the cluster) is read on the server and never shipped.
// Fails closed: a missing API origin throws at module load rather than rendering a broken site.
import { PLATFORM_BRAND } from '@krishalaya/tokens';
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!publicApiUrl) throw new Error('web-storefront: NEXT_PUBLIC_API_URL is required');

export const env = {
  /** Browser-visible API origin (used by client components). */
  publicApiUrl,
  /** Server-side API origin for SSR (internal DNS if set, else the public one). Never sent to the browser. */
  serverApiUrl: process.env.API_URL_INTERNAL || publicApiUrl,
  /** PC-56 STORE-1a · C4 (founder D1): the PLATFORM bazaar's tenant — the organisation a buyer signs in to from a platform page (`/login`).
   *  A tenant store's page signs in to ITS tenant (the `/[tenantSlug]` path, or a verified storefront host). Public (a slug, not a secret).
   *  Null when unset → the platform sign-in states that it is not configured (never a guessed tenant). The build-time
   *  NEXT_PUBLIC_TENANT_ID this replaces is retired. */
  platformTenantSlug: process.env.NEXT_PUBLIC_PLATFORM_TENANT_SLUG?.trim() || null,
  /** PC-56 STORE-1c · C1/C4 (founder D2): the PLATFORM's own country (ISO 3166-1 alpha-2) — the country `/pricing` lists plans for when no
   *  `?country=` is given, the digit rule the organisation-signup form applies to a bare national number, and the country a self-serve
   *  organisation is created in. Default `IN` (Phase 1); a two-letter code only (anything else reads as unset → the pages say pricing is
   *  not set up rather than guess). Ops owed: set it per deployment. The tenant's OWN country on a tenant store is a definer read still
   *  owed (STORE-1a), so this is the platform's, never a tenant's. */
  platformCountry: (() => {
    const c = (process.env.NEXT_PUBLIC_PLATFORM_COUNTRY ?? 'IN').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(c) ? c : null;
  })(),
  /** Origin of the seller/tenant console (web-tenant); the "Sell on Krishalaya" CTA links here. An origin,
   *  not a secret — safe to expose. Null when unset → the CTA falls back to in-app sign-in. */
  tenantAppUrl: process.env.NEXT_PUBLIC_TENANT_APP_URL || null,
  /** Razorpay PUBLISHABLE key id (rzp_*) — public by design (it's shown in the browser checkout). Null when
   *  unset → the pay step fails closed with a friendly "online payments unavailable" message (never a fake pay). */
  razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null,
  // PC-56 STORE-3c · C1 (founder D4): `featureAuctions` (NEXT_PUBLIC_FEATURE_AUCTIONS) is DELETED — the store's DB `auctions` flag decides,
  // through the storefront flags allow-list (the header, the list, my bids and the auction page each read it).
  /** The storefront's OWN public origin (e.g. https://krishalaya.example) — used for metadataBase (absolute
   *  canonical/OpenGraph URLs), robots.txt sitemap pointer, and sitemap.xml entries. Public, not a secret. Empty
   *  when unset → metadata stays relative and robots omits the sitemap line (still valid; set this in prod). */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || '',
  /** The PLATFORM's name — for the platform's own pages only (PC-56 TENANT-13d: from PLATFORM_BRAND, the one brand-mark list; a tenant's
   *  storefront uses its own published name — [tenantSlug]/layout.tsx). */
  appName: PLATFORM_BRAND.name,
} as const;
