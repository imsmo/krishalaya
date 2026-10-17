// apps/web-storefront/src/components/offline/TenantShellHeader.tsx · PC-56 STORE-6a · D6 — an ORGANISATION's session-free header, for its offline
// page (`/<slug>/offline`; `/offline` on its own host — the page the worker pre-caches there, with the page's cookies). HOTFIX-8's law carried to
// the store: it reads NO session and NO cookie — no cart count, no sign-in state, no Account / Orders / Messages link, no flags read, no form.
// What it prints is the same for every person on the phone: the organisation's published name and logo (the public brand read the layout
// already made) → its store home, and "Powered by" under the 13d rule.
import { getTranslator } from '../../lib/i18n';
import { PLATFORM_BRAND } from '../../features/branding/brand-theme';

export function TenantShellHeader({ slug, name, logoSrc, showPoweredBy }: { slug: string; name: string; logoSrc: string | null; showPoweredBy: boolean }) {
  const t = getTranslator();
  return (
    <header className="kv-header" data-kv-header="tenant" data-kv-shell="offline">
      <div className="kv-container kv-header__bar">
        {/* a plain link (no client router): this page is served from the cache when there is no network */}
        <a href={`/${slug}`} className="kv-tenant-header__mark" aria-label={t.t('tenant.homeLabel', { org: name })}>
          {logoSrc && <img className="kv-tenant-header__logo" src={logoSrc} alt="" loading="eager" decoding="async" />}
          <span className="kv-header__brandname">
            <span data-kv-mark="tenant">{name}</span>
            {showPoweredBy && <small className="kv-header__subline kv-powered-by--header" data-kv-mark="platform">{PLATFORM_BRAND.poweredByMark}</small>}
          </span>
        </a>
      </div>
    </header>
  );
}
