// apps/web-gov/next.config.js · the GOVERNMENT console (PC-56 GOV-1a; the header used to say "seller/tenant console" — copy residue, C-8). The workspace packages it imports (@krishalaya/*) ship
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
  // PC-56 GOV-1a (brief §E, survey GOV1_DELTAS `old_pages`): the pre-canon GW-1…GW-5 pages read ONE ORGANISATION through the tenant sign-in;
  // under a government authority's session they cannot work. Their pages, actions and the evidence route are deleted; their addresses answer
  // a TEMPORARY redirect (307, permanent: false) to /dashboard (since GOV-1b: the authority's overview, counts only — W325). PC-56 GOV-2b builds
  // /schemes for the AUTHORITY (W326–W329), so its redirect is removed; the other three stay until their waves. PC-56 GOV-4a builds
  // /verification for the AUTHORITY (W335–W338: field visits are not done through this platform — it says so), so its redirect is removed too.
  // PC-56 GOV-5a builds /mgnrega for the AUTHORITY (W345–W348, W440: MGNREGA's register is NREGASoft; this console records nothing for it — it says
  // so), so its redirect is removed as well; /mgnrega/* other than the page has no route and answers not found.
  // PC-56 GOV-6b (survey_gov6 F-9, C-3): the last one, /registers (the deleted GW-3 "regulator" page), loses its redirect too and answers not
  // found — no regulator or outside body has any page on this console (GOV-6 Q3-A). No redirect remains.
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
