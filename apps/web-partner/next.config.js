// apps/web-partner/next.config.js · partner portal. The workspace packages it imports (@krishalaya/*) ship
// PRE-COMPILED CommonJS in their dist/, so Next consumes them directly. transpilePackages is intentionally NOT set:
// listing a pre-compiled CJS package there makes Next apply Fast-Refresh (injecting `import.meta.webpackHot`) to a
// module webpack treats as CommonJS → "Cannot use 'import.meta' outside a module".
// Security headers are conservative; the portal is never indexed (also enforced per-page via metadata.robots).
//
// ZAP-hardening CSP notes (S5): repo audit found no external scripts/fonts/CDNs and no direct-to-S3 browser
// uploads in this app. script-src/style-src still need 'unsafe-inline' because Next's App Router streams RSC
// payloads via inline `self.__next_f.push(...)` scripts on every navigation (no nonce middleware wired yet —
// TODO-tighten once that plumbing exists platform-wide); 'unsafe-eval' is DEV-ONLY (webpack HMR). Enforced
// (not report-only) — no unknown third-party surface to risk breaking.
/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'none'",
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
  // symlinks:false keeps the node_modules identity so they're consumed as ordinary (pre-built) deps.
  webpack: (config) => { config.resolve.symlinks = false; return config; },
  // PC-56 PARTNER-2a (survey E3): the four DEV-24 insurance routes moved to the canon's own `insurer/*` paths — a real HTTP 307
  // (permanent: false) answered before any page runs (a page-level redirect would stream behind app/loading.tsx as a 200). Mirrors
  // src/features/partner2/refusals.ts INSURANCE_REDIRECTS + LENDER_REDIRECTS (pinned equal by test-render/not-yet.render.test.tsx). PC-56 PARTNER-3a: the claims pair too (CLAIMS_REDIRECTS); PARTNER-4a: the lender's book (LENDER_BOOK_REDIRECTS).
  async redirects() {
    return [
      { source: '/insurance-products', destination: '/insurer/products', permanent: false },
      { source: '/insurance-policies', destination: '/insurer/policies', permanent: false },
      { source: '/insurance-policies/:id', destination: '/insurer/policies/:id', permanent: false },
      { source: '/insurance-book', destination: '/insurer/dashboard', permanent: false },
      // PC-56 PARTNER-2c: the PARTNER-0 not-yet `/products` pair → the canon's `lender/products` (mirrors LENDER_REDIRECTS in src/features/partner2/refusals.ts)
      { source: '/products', destination: '/lender/products', permanent: false },
      { source: '/products/:id', destination: '/lender/products/:id', permanent: false },
      // PC-56 PARTNER-3a: the DEV-24 claims pair (not-yet since PARTNER-0) → the canon's `insurer/claims` (mirrors CLAIMS_REDIRECTS in src/features/partner3/refusals.ts)
      { source: '/insurance-claims', destination: '/insurer/claims', permanent: false },
      { source: '/insurance-claims/:id', destination: '/insurer/claims/:id', permanent: false },
      // PC-56 PARTNER-4a (survey F-15): the PARTNER-0 loan queue and the two not-yet portfolio pages → the canon's `lender/queue` and
      // `lender/portfolio`; and `/servicing`, whose dead console is deleted, → the lender's own book (mirrors LENDER_BOOK_REDIRECTS in
      // src/features/partner4/refusals.ts)
      { source: '/loan-queue', destination: '/lender/queue', permanent: false },
      { source: '/loan-queue/:id', destination: '/lender/queue/:id', permanent: false },
      { source: '/portfolio', destination: '/lender/portfolio', permanent: false },
      { source: '/portfolio/:id', destination: '/lender/portfolio/:id', permanent: false },
      { source: '/servicing', destination: '/lender/portfolio', permanent: false },
    ];
  },
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
