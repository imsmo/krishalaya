// apps/web-storefront/src/components/TenantHeader.tsx · PC-56 STORE-1b · C1 — A TENANT STORE'S OWN HEADER (canon W274), replacing the platform
// SiteHeader on every /[tenantSlug] route (survey F-6: the platform's name no longer sits above a white-label store).
//   • the organisation's mark: its published logo (13d, version-pinned) or its name → the store's own home (/<slug>);
//   • "Powered by Krishalaya" IN THE HEADER, as canon W274 places it ("'powered by Krishalaya' stays in the header") — under the 13d rule
//     (`poweredByVisible('storefront', brand)`: hidden only when the tenant chose to AND its plan allows it right now);
//   • language switcher, the cart link with its count in the accessible name (PC-56 STORE-2b: → THIS store's cart, /<slug>/cart), and Sign in →
//     THIS store's sign-in (/<slug>/login);
//   • PC-56 STORE-2a · C2: the search box → THIS store's /<slug>/search (the tenant feed), not the platform's;
//   • the breadcrumb back to the platform store (founder D1 allows it: "Tenant stores MAY link back to the bazaar").
// Server component: the only client JS is the locale switcher.
import Link from 'next/link';
import { getTranslator, getLang } from '../lib/i18n';
import { hasSessionCookie } from '../lib/auth';
import { LocaleSwitcher } from './LocaleSwitcher';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';
import { getCartItemCount } from '../features/cart/summary';

export interface TenantHeaderProps {
  slug: string;
  name: string;
  logoSrc: string | null;
  showPoweredBy: boolean;
  /** the page's own trail after the store name (none on the store home) */
  crumbs?: { label: string; href?: string }[];
}

export async function TenantHeader({ slug, name, logoSrc, showPoweredBy, crumbs = [] }: TenantHeaderProps) {
  const t = getTranslator();
  const lang = getLang();
  const signedIn = hasSessionCookie();
  const cartCount = await getCartItemCount();
  const home = `/${slug}`;
  return (
    <header className="kv-header" data-kv-header="tenant">
      <div className="kv-container kv-header__bar">
        <Link href={home} className="kv-tenant-header__mark" aria-label={t.t('tenant.homeLabel', { org: name })}>
          {/* Plain <img>: arbitrary tenant-CDN origin (see next.config.js img-src). The name is the alt text — never the platform's mark. */}
          {logoSrc && <img className="kv-tenant-header__logo" src={logoSrc} alt="" loading="eager" decoding="async" />}
          <span className="kv-header__brandname">
            <span data-kv-mark="tenant">{name}</span>
            {/* the mark inline (a <p> may not sit inside a link) — same words, same data-kv-mark as PoweredByMark */}
            {showPoweredBy && <small className="kv-header__subline kv-powered-by--header" data-kv-mark="platform">{PLATFORM_BRAND.poweredByMark}</small>}
          </span>
        </Link>
        {/* PC-56 STORE-2a · C2: a tenant store's search searches THIS store (/<slug>/search — canon W276 over the tenant feed) */}
        <form method="get" action={`${home}/search`} role="search" className="kv-header__search" aria-label={t.t('header.search.label')}>
          <input id="kv-tenant-q" name="q" type="search" className="kv-field__input" aria-label={t.t('header.search.label')} placeholder={t.t('header.search.placeholder')} />
          <button type="submit" className="kv-btn">{t.t('header.search.submit')}</button>
        </form>
        <div className="kv-header__actions">
          <LocaleSwitcher active={lang} label={t.t('lang.label')} comingSoonLabel={t.t('lang.comingSoon')} />
          {/* PC-56 STORE-2b · D3: THIS store's cart (/<slug>/cart), under this header */}
          <Link href={`${home}/cart`} className="kv-header__cart" aria-label={cartCount > 0 ? t.t('nav.cartCount', { count: cartCount }) : t.t('nav.cart')}>
            {t.t('nav.cart')}{cartCount > 0 && <span className="kv-header__badge" aria-hidden="true">{cartCount}</span>}
          </Link>
          {!signedIn && <Link href={`${home}/login`} className="kv-header__login">{t.t('nav.login')}</Link>}
        </div>
      </div>
      <nav className="kv-container" aria-label={t.t('tenant.crumbLabel')}>
        <ol className="kv-crumb">
          <li><Link href="/">{PLATFORM_BRAND.platformStoreName}</Link></li>
          <li {...(crumbs.length === 0 ? { 'aria-current': 'page' as const } : {})}>{crumbs.length === 0 ? name : <Link href={home}>{name}</Link>}</li>
          {crumbs.map((c, i) => <li key={i} {...(i === crumbs.length - 1 ? { 'aria-current': 'page' as const } : {})}>{c.href ? <Link href={c.href}>{c.label}</Link> : c.label}</li>)}
        </ol>
      </nav>
    </header>
  );
}
