// apps/web-storefront/next.config.js · public marketplace. The workspace packages it imports (@krishalaya/*)
// ship PRE-COMPILED CommonJS in their dist/, so Next consumes them directly. transpilePackages is intentionally
// NOT set: listing a pre-compiled CJS package there makes Next apply its Fast-Refresh transform (injecting
// `import.meta.webpackHot`) to a module webpack treats as CommonJS → "Cannot use 'import.meta' outside a module".
// Indexable (per-page metadata controls crawl); conservative security headers.
//
// ZAP-hardening CSP notes (S5): this app was the lightest of the 4 (no X-Frame-Options) — brought to parity
// plus CSP/HSTS. Repo audit found exactly ONE external script dependency (src/components/PayButton.tsx loads
// https://checkout.razorpay.com/v1/checkout.js for the payment sheet — the ONLY client-side step of the money
// path, see that file's header comment) and no other third-party origins. script-src/style-src need
// 'unsafe-inline' regardless because Next's App Router streams RSC payloads via inline
// `self.__next_f.push(...)` scripts on every navigation (no nonce middleware wired yet — TODO-tighten once
// that plumbing exists platform-wide); 'unsafe-eval' is DEV-ONLY (webpack HMR). img-src allows any https
// origin: ListingGallery.tsx and tenant branding render arbitrary listing-photo/logo URLs from an
// env/deploy-configurable S3/CDN origin not fixed at build time (TODO-tighten to the exact media origin once
// pinned); img-src is not a code-execution vector so this is a low-risk relaxation. Enforced (not
// report-only) — the Razorpay allowlist below is Razorpay's own documented CSP requirement, not a guess.
/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://checkout.razorpay.com${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:", // see TODO-tighten above (arbitrary tenant/listing media origin, not fixed)
  "font-src 'self'",
  "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
  "frame-src https://api.razorpay.com https://checkout.razorpay.com", // Razorpay's checkout sheet embeds an iframe
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // pnpm symlinks workspace packages into node_modules; without this, webpack canonicalizes them to their real
  // path under packages/, classifies them as app SOURCE, and applies dev Fast-Refresh (injecting
  // `import.meta.webpackHot`) to their pre-compiled CJS dist → "Cannot use 'import.meta' outside a module".
  // symlinks:false keeps the node_modules identity so they're consumed as ordinary (pre-built) deps, which
  // Fast-Refresh skips.
  webpack: (config) => { config.resolve.symlinks = false; return config; },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
        { key: 'Content-Security-Policy', value: csp },
      ],
    }];
  },
};
module.exports = nextConfig;
