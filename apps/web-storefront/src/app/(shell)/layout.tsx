// apps/web-storefront/src/app/(shell)/layout.tsx · PC-56 HOTFIX-8 · D1 (a) — the SESSION-FREE shell. The service worker pre-caches `/offline`
// at install (with the page's cookies — `cache.addAll` is a same-origin fetch), so whatever this layout prints is kept on the phone. Under
// `(platform)/layout.tsx` it printed SiteHeader: "Account", "Notifications", the cart count and the session store's `/<slug>/messages` link
// (survey STORE-6 C-3 / F-1) — the signed-in person's header, cached for whoever picks the phone up next. This layout reads NO session and
// NO session cookie: the platform's name from packages/tokens and one keyed label. The route group adds no URL segment (`/offline` as before).
// The language still follows the device's `kv_lang` preference (lib/i18n — vernacular first; a device setting, not a person's data).
import { getTranslator } from '../../lib/i18n';
import { PLATFORM_BRAND } from '../../features/branding/brand-theme';

export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const t = getTranslator();
  const store = PLATFORM_BRAND.platformStoreName;
  return (
    <>
      <header className="kv-header" data-kv-shell="offline">
        <div className="kv-container kv-header__bar">
          {/* a plain link (no client router): the shell is served from the cache when there is no network */}
          <a href="/" className="kv-header__brand" aria-label={t.t('offline.shell.home', { store })}>
            <span className="kv-header__brandname"><span data-kv-mark="platform-store">{store}</span></span>
          </a>
        </div>
      </header>
      <main className="kv-container" id="main">{children}</main>
    </>
  );
}
