// apps/web-storefront/src/app/layout.tsx · root layout. Sets the document language + direction from the active
// locale (kv_lang cookie → Accept-Language), applies the design-token font/colors via globals.css. Server component.
// PC-56 STORE-1b · C1 (survey F-6): the root no longer renders a header or footer — the PLATFORM's own pages get SiteHeader/SiteFooter
// from `app/(platform)/layout.tsx`, a TENANT store gets its own TenantHeader/TenantFooter from `app/[tenantSlug]/layout.tsx`. So the
// platform's name never sits above a white-label store. The default metadata is keyed (F-16: no English literal) and names the platform
// store from packages/tokens (founder D2).
import type { Metadata } from 'next';
import '../styles/globals.css';
import { env } from '../lib/env';
import { getLanguageDef, getTranslator } from '../lib/i18n';
import { getThemeHtmlAttrs, getSeniorMode } from '../lib/mechanism';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';

export function generateMetadata(): Metadata {
  const t = getTranslator();
  const store = PLATFORM_BRAND.platformStoreName;
  return {
    // Absolute base for canonical/OpenGraph URLs (the per-page metadata uses relative paths) when the site origin
    // is configured; left unset (relative) otherwise.
    metadataBase: env.siteUrl ? new URL(env.siteUrl) : undefined,
    title: { default: t.t('meta.platformTitle', { store }), template: `%s · ${store}` },
    description: t.t('meta.platformDescription', { platform: t.t('brand.platform') }),
    robots: { index: true, follow: true },
    // PC-24c: installability (manifest served by app/manifest.ts; iOS uses the apple-touch icon).
    icons: { icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192' }], apple: '/apple-touch-icon.png' },
    // PC-56 TENANT-13d: the platform's own name from PLATFORM_BRAND (never a literal); a tenant's routes override all of this from their
    // published brand ([tenantSlug]/layout.tsx — title, manifest, icon, theme colour).
    appleWebApp: { capable: true, statusBarStyle: 'default', title: env.appName },
  };
}

export const viewport = { themeColor: '#15803d' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = getLanguageDef();
  const t = getTranslator();
  // DEV-19: theme + senior-mode attrs, resolved server-side from cookies (see lib/mechanism.ts) — same
  // SSR-safe, zero-client-JS convention as web-tenant's own wiring. Density (DELTA-001) deliberately NOT
  // applied here — see lib/mechanism.ts's own header comment (storefront is not an ops/B2B console realm).
  const themeAttrs = getThemeHtmlAttrs();
  const senior = getSeniorMode();
  return (
    <html lang={lang.code} dir={lang.dir} data-theme={themeAttrs['data-theme']} className={themeAttrs.className} data-senior={senior ? 'true' : undefined}>
      <body>
        <a href="#main" className="kv-skip">{t.t('common.skipToContent')}</a>
        {children}
        {/* PC-24c: register the conservative offline shell (public/sw.js — never caches authed/API responses).
            Progressive enhancement: no SW support (or JS off) → the site works exactly as before. */}
        <script
          dangerouslySetInnerHTML={{
            __html: "if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}",
          }}
        />
      </body>
    </html>
  );
}
