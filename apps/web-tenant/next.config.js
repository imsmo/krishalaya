// apps/web-tenant/next.config.js · seller/tenant console. The workspace packages it imports (@krishalaya/*) ship
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
  async headers() {
    // PC-56 TENANT-13a (F-5): the developer pages can hold a signing secret on screen (shown once, in memory). They are never cached
    // (no browser back-cache, no shared cache) and never send a Referer. Listed AFTER the catch-all so these values win for these
    // paths; pinned by src/test/tenant13a-webhooks.spec.ts.
    // PC-56 TENANT-13c: the whole developer area (an API key is shown once there) and the integrations pages (a provider credential is typed
    // there) carry the same pair.
    const secretBearing = ['/settings/developers/webhooks', '/settings/developers/webhooks/:path*', '/settings/developers', '/settings/developers/:path*',
      '/settings/integrations', '/settings/integrations/:path*'].map((source) => ({
      source,
      headers: [
        { key: 'Cache-Control', value: 'no-store, max-age=0' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
      ],
    }));
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
    }, ...secretBearing];
  },
};
module.exports = nextConfig;
