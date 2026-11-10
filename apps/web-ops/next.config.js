// apps/web-ops/next.config.js · seller/tenant console. The workspace packages it imports (@krishalaya/*) ship
// PRE-COMPILED CommonJS in their dist/, so Next consumes them directly. transpilePackages is intentionally NOT set:
// listing a pre-compiled CJS package there makes Next apply Fast-Refresh (injecting `import.meta.webpackHot`) to a
// module webpack treats as CommonJS → "Cannot use 'import.meta' outside a module".
// Strict security headers; never indexed (also enforced per-page via metadata.robots).
//
// ZAP-hardening CSP notes (S5):
//  - script-src/style-src need 'unsafe-inline': Next's App Router streams RSC payloads via inline
//    `<script>self.__next_f.push(...)</script>` tags on every navigation — without 'unsafe-inline' (or a
//    per-request nonce wired through middleware, which this app doesn't have yet) hydration breaks outright.
//    TODO-tighten: adopt a nonce-based CSP via middleware.ts once that plumbing exists platform-wide.
//  - 'unsafe-eval' is DEV-ONLY (webpack HMR eval'd modules); never shipped to a built/production bundle.
//  - connect-src includes `https:` (not narrowed to a single origin): src/components/MediaUploader.tsx PUTs
//    the raw file bytes DIRECTLY from the browser to a presigned S3 URL (bypassing our API — see its header
//    comment) whose exact host is env/deploy-configurable (real S3 in prod, MinIO/LocalStack in dev) and not
//    knowable at next.config build time. Narrowing this wrongly would silently break listing-photo uploads
//    (a core seller flow) with no client-visible error beyond a CSP console warning. TODO-tighten: pin to the
//    exact media/CDN origin (e.g. via a build-time NEXT_PUBLIC_MEDIA_ORIGIN) once that's fixed infra-side.
//  - Enforced (not report-only): the app has no other unknown third-party script/embed surface, so shipping
//    it enforced now closes the ZAP "CSP Header Not Set" finding immediately; the two `unsafe-*`/`https:`
//    relaxations above are the documented, deliberate exceptions.
/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === 'production';
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https:", // see TODO-tighten above (direct-to-S3 presigned upload, origin not fixed)
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
  // PC-56 OPS-1b (survey E2): the OW-5 AePS addresses moved to the canon's own `aeps/*` paths — a real HTTP 307 (permanent: false) answered
  // before any page runs. Mirrors OPS1B_REDIRECTS in src/features/ops1/aeps.ts (pinned equal by src/test/ops1b-pages.spec.ts).
  async redirects() {
    return [
      { source: '/money', destination: '/aeps/withdrawal', permanent: false },
      { source: '/money/oversight', destination: '/aeps/exceptions?view=all', permanent: false },
      // PC-56 OPS-1c (survey E2): the OW-1 kiosk address → the canon's `kiosk/home` (W380). Mirrors OPS1C_REDIRECTS in src/features/ops1/kiosk.ts
      // (pinned equal by src/test/ops1c-pages.spec.ts).
      { source: '/kiosk', destination: '/kiosk/home', permanent: false },
      // PC-56 OPS-2a (survey E2): the OW-2 warehouse address → the canon's `warehouse/dashboard` (W370). Mirrors OPS2A_REDIRECTS in
      // src/features/ops2/intake.ts (pinned equal by src/test/ops2a-pages.spec.ts). `/warehouse/[id]` and the other `/warehouse/*` pages are untouched.
      { source: '/warehouse', destination: '/warehouse/dashboard', permanent: false },
      // PC-56 OPS-4a (survey E2): the OW-3 hire addresses → the canon's `chc/*` (W405, W407). Mirrors OPS4A_REDIRECTS in src/features/ops4/chc.ts
      // (pinned equal by src/test/ops4a-pages.spec.ts). The OW-3 pages and their money actions are deleted (founder Q3-A).
      { source: '/equipment', destination: '/chc/dashboard', permanent: false },
      { source: '/equipment/:id', destination: '/chc/bookings', permanent: false },
      // PC-56 OPS-4c (survey E2): the OW-7 sensor fleet (built on typed `device_ref`s — survey C-12) → the canon's `iot/dashboard` (W400). Mirrors
      // OPS4C_REDIRECTS in src/features/ops4/iot.ts (pinned equal by src/test/ops4c-pages.spec.ts). `/devices/rules` and `/devices/alerts` stay (OPS-5).
      { source: '/devices', destination: '/iot/dashboard', permanent: false },
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
