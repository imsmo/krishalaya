// apps/web-storefront/src/lib/env.ts · the ONLY place env is read in the storefront. PUBLIC site → NO secrets
// in the client bundle: only NEXT_PUBLIC_* values (the API origin) are exposed to the browser; a server-only
// internal API URL (for SSR fetches that stay inside the cluster) is read on the server and never shipped.
// Fails closed: a missing API origin throws at module load rather than rendering a broken site.
const publicApiUrl = process.env.NEXT_PUBLIC_API_URL;
if (!publicApiUrl) throw new Error('web-storefront: NEXT_PUBLIC_API_URL is required');

export const env = {
  /** Browser-visible API origin (used by client components). */
  publicApiUrl,
  /** Server-side API origin for SSR (internal DNS if set, else the public one). Never sent to the browser. */
  serverApiUrl: process.env.API_URL_INTERNAL || publicApiUrl,
  /** The tenant a buyer signs into from this storefront. The API scopes OTP verify/refresh to a tenant, so it must
   *  be sent. Locally set via NEXT_PUBLIC_TENANT_ID (demo-fpo); in prod derive from the storefront's host/slug. */
  tenantId: process.env.NEXT_PUBLIC_TENANT_ID,
  /** Origin of the seller/tenant console (web-tenant); the "Sell on Krishalaya" CTA links here. An origin,
   *  not a secret — safe to expose. Null when unset → the CTA falls back to in-app sign-in. */
  tenantAppUrl: process.env.NEXT_PUBLIC_TENANT_APP_URL || null,
  /** Razorpay PUBLISHABLE key id (rzp_*) — public by design (it's shown in the browser checkout). Null when
   *  unset → the pay step fails closed with a friendly "online payments unavailable" message (never a fake pay). */
  razorpayKeyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || null,
  /** Client visibility switch for the auctions surface (hidden when 'false'). Enabled by default; the API's own
   *  `auctions` flag is the authoritative gate (if it's off, the public reads simply degrade to an empty state). */
  featureAuctions: process.env.NEXT_PUBLIC_FEATURE_AUCTIONS !== 'false',
  /** The storefront's OWN public origin (e.g. https://krishalaya.example) — used for metadataBase (absolute
   *  canonical/OpenGraph URLs), robots.txt sitemap pointer, and sitemap.xml entries. Public, not a secret. Empty
   *  when unset → metadata stays relative and robots omits the sitemap line (still valid; set this in prod). */
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || '',
  appName: 'Krishalaya',
} as const;
