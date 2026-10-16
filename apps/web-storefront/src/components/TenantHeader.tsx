// apps/web-storefront/src/components/TenantHeader.tsx · PC-56 STORE-1b · C1 — A TENANT STORE'S OWN HEADER (canon W274), replacing the platform
// SiteHeader on every /[tenantSlug] route (survey F-6: the platform's name no longer sits above a white-label store).
//   • the organisation's mark: its published logo (13d, version-pinned) or its name → the store's own home (/<slug>);
//   • "Powered by Krishalaya" IN THE HEADER, as canon W274 places it ("'powered by Krishalaya' stays in the header") — under the 13d rule
//     (`poweredByVisible('storefront', brand)`: hidden only when the tenant chose to AND its plan allows it right now);
//   • language switcher, the cart link with its count in the accessible name (PC-56 STORE-2b: → THIS store's cart, /<slug>/cart), and Sign in →
//     THIS store's sign-in (/<slug>/login);
//   • PC-56 STORE-2a · C2: the search box → THIS store's /<slug>/search (the tenant feed), not the platform's;
//   • the breadcrumb back to the platform store (founder D1 allows it: "Tenant stores MAY link back to the bazaar").
//   • PC-56 STORE-3b · C1 (survey F-11): "Offers" → THIS store's /<slug>/offers, ONLY for a signed-in buyer and ONLY when this store's `offers`
//     flag is ON (its public flags read); OFF or unreadable → no link.
//   • PC-56 STORE-3c · C1 (founder D4): "Auctions" → /<slug>/auctions (and "My bids" → /<slug>/auctions/bids for a signed-in buyer) ONLY when
//     this store's `auctions` flag is ON; "Group lots" → THIS store's search with the group-lot facet ONLY when `group_lots` is ON. The flags
//     are read once for every visitor; unreadable → no links.
//   • PC-56 STORE-4c · C1 (survey F-8): a signed-in buyer is never stranded under the organisation's mark — "Orders" (/<slug>/orders),
//     "Notifications" (/<slug>/notifications — the organisation's inbox, never switched off, founder Q12), "Messages" ONLY when this store's
//     `communication` flag is ON (chat stays behind it; the platform /messages page — 4b rebuilds it), and "Sign out" (the existing logout action).
//   • PC-56 STORE-4b · C5: "Messages" → THIS store's /<slug>/messages (W297, the organisation's threads). No "n unread" beside it: there is no
//     bounded unread-count endpoint (a list of one is not a count) — refused by name on the messages page (`store4b.refusal.unreadBadge`).
// Server component: the only client JS is the locale switcher.
import Link from 'next/link';
import { getTranslator, getLang } from '../lib/i18n';
import { hasSessionCookie } from '../lib/auth';
import { LocaleSwitcher } from './LocaleSwitcher';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';
import { getCartItemCount } from '../features/cart/summary';
import { publicClient } from '../lib/api-client';
import { logoutAction } from '../app/(platform)/login/actions';

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
  let offersOn = false; let auctionsOn = false; let groupLotsOn = false; let messagesOn = false;
  try {
    const f = await publicClient(slug).storefront.flags();
    offersOn = signedIn && f.offers === true; auctionsOn = f.auctions === true; groupLotsOn = f.group_lots === true;
    messagesOn = signedIn && f.communication === true;   // STORE-4c: tenant-scoped, fail-closed (unreadable → no link)
  } catch { offersOn = false; auctionsOn = false; groupLotsOn = false; messagesOn = false; }
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
          {signedIn && offersOn && <Link href={`${home}/offers`} className="kv-header__link" data-kv-nav="offers">{t.t('nav.offers')}</Link>}
          {auctionsOn && <Link href={`${home}/auctions`} className="kv-header__link" data-kv-nav="auctions">{t.t('nav.auctions')}</Link>}
          {auctionsOn && signedIn && <Link href={`${home}/auctions/bids`} className="kv-header__link" data-kv-nav="my-bids">{t.t('nav.myBids')}</Link>}
          {groupLotsOn && <Link href={`${home}/search?saleType=group_lot`} className="kv-header__link" data-kv-nav="group-lots">{t.t('nav.groupLots')}</Link>}
          {/* PC-56 STORE-2b · D3: THIS store's cart (/<slug>/cart), under this header */}
          <Link href={`${home}/cart`} className="kv-header__cart" aria-label={cartCount > 0 ? t.t('nav.cartCount', { count: cartCount }) : t.t('nav.cart')}>
            {t.t('nav.cart')}{cartCount > 0 && <span className="kv-header__badge" aria-hidden="true">{cartCount}</span>}
          </Link>
          {/* PC-56 STORE-4c · C1 (survey F-8): Orders · Messages (flag ON only) · Notifications — signed in only */}
          {signedIn && <Link href={`${home}/orders`} className="kv-header__link" data-kv-nav="orders">{t.t('nav.orders')}</Link>}
          {messagesOn && <Link href={`${home}/messages`} className="kv-header__link" data-kv-nav="messages">{t.t('nav.messages')}</Link>}
          {signedIn && <Link href={`${home}/notifications`} className="kv-header__link" data-kv-nav="notifications">{t.t('nav.notifications')}</Link>}
          {/* PC-56 STORE-4a · C1 (founder Q13): the person's account under THIS organisation's chrome — signed in only */}
          {signedIn && <Link href={`${home}/account`} className="kv-header__link" data-kv-nav="account">{t.t('nav.account')}</Link>}
          {signedIn ? (
            <form action={logoutAction} data-kv-nav="logout">
              <button type="submit" className="kv-header__login kv-btn--link">{t.t('nav.logout')}</button>
            </form>
          ) : (
            <Link href={`${home}/login`} className="kv-header__login">{t.t('nav.login')}</Link>
          )}
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
