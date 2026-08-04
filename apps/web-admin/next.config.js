// apps/web-admin/next.config.js · god-mode console. The workspace package(s) it imports (@krishalaya/tokens) ship
// PRE-COMPILED CommonJS in their dist/, so Next consumes them directly. transpilePackages is intentionally NOT set:
// listing a pre-compiled CJS package there makes Next apply Fast-Refresh (injecting `import.meta.webpackHot`) to a
// module webpack treats as CommonJS → "Cannot use 'import.meta' outside a module".
// Strict security headers; never indexed (also enforced per-page via metadata.robots).
//
// ZAP-hardening CSP notes (S5): this is the tightest of the 4 apps — no external scripts/fonts/CDNs, no
// direct-to-S3 browser uploads found (repo audit). script-src/style-src still need 'unsafe-inline' because
// Next's App Router streams RSC payloads via inline `self.__next_f.push(...)` scripts on every navigation
// (no nonce middleware wired yet — TODO-tighten once that plumbing exists platform-wide); 'unsafe-eval' is
// DEV-ONLY (webpack HMR). Enforced (not report-only) — no unknown third-party surface to risk breaking.
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
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        ...(isProd ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=()' },
        { key: 'Content-Security-Policy', value: csp },
        // Realm-wide noindex (defence-in-depth alongside per-page metadata.robots + public/robots.txt).
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ],
    }];
  },
};
module.exports = nextConfig;
