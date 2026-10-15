// apps/web-storefront/src/components/SiteHeader.tsx · the PLATFORM header (server component — no client JS beyond the locale switcher +
// the logout form's submit). PC-56 STORE-1b · C1: it wraps ONLY the platform's own pages (`app/(platform)/layout.tsx`); a tenant store
// wears its own header (TenantHeader — survey F-6: the platform name no longer sits above a white-label store).
//   • brand = the platform store name from packages/tokens (founder D2) + the catalogue's vernacular sub-line;
//   • search = a plain GET form to /search?q= (PC-56 STORE-2a: canon W276 — it was /discover; works with no client JS);
//   • language switcher, cart link with its count IN the accessible name, Sign in / Sign out;
//   • the category strip = top-level categories from lookups (master data, never a baked list) → /discover?category=<id>; a lookup
//     failure hides the strip (degrade), it never invents categories.
//   • PC-56 STORE-3b · C1 (survey F-11): "Offers" shows ONLY for a signed-in buyer whose session store has its `offers` flag ON (the store's
//     public flags read, as the session's store — one store per session); OFF or unreadable → no link (the pages say the honest OFF state).
import Link from 'next/link';
import type { CategoryNode } from '@krishalaya/sdk-js';
import { getTranslator, getLang } from '../lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { env } from '../lib/env';
import { hasSessionCookie } from '../lib/auth';
import { publicClient, sessionTenantClient } from '../lib/api-client';
import { getCartItemCount } from '../features/cart/summary';
import { flattenCategoryNav } from '../features/discovery/categories';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';
import { logoutAction } from '../app/(platform)/login/actions';

/** At most this many top-level categories in the strip (the rest are one click away in /discover). */
const STRIP_MAX = 8;

export async function SiteHeader() {
  const t = getTranslator();
  const lang = getLang();
  const signedIn = hasSessionCookie();
  const cartCount = await getCartItemCount(); // 0 for anonymous / on failure (degrade)
  let cats: ReturnType<typeof flattenCategoryNav> = [];
  try { cats = flattenCategoryNav((await publicClient().lookups.categories()) as CategoryNode[]).filter((c) => c.depth === 0).slice(0, STRIP_MAX); }
  catch { cats = []; }
  let offersOn = false;
  if (signedIn) { try { offersOn = (await sessionTenantClient().storefront.flags()).offers === true; } catch { offersOn = false; } }
  const nav = [
    ...(env.featureAuctions ? [{ href: '/auctions', label: t.t('nav.auctions') }] : []),
    { href: '/organisations', label: t.t('home.orgs.cta') },
    { href: '/help', label: t.t('nav.help') },
  ];
  return (
    <header className="kv-header">
      <div className="kv-container kv-header__bar">
        <Link href="/" className="kv-header__brand">
          <span className="kv-header__brandname">
            <span data-kv-mark="platform-store">{PLATFORM_BRAND.platformStoreName}</span>
            <small className="kv-header__subline">{t.t('header.subline')}</small>
          </span>
        </Link>
        {/* PC-56 STORE-2a · C2: the header search targets the platform's /search (canon W276) — the cross-tenant feed's title prefix +
            the organisations whose name starts with the words; the honest matching sentence is printed there */}
        <form method="get" action="/search" role="search" className="kv-header__search" aria-label={t.t('header.search.label')}>
          <input id="kv-header-q" name="q" type="search" className="kv-field__input" aria-label={t.t('header.search.label')} placeholder={t.t('header.search.placeholder')} />
          <button type="submit" className="kv-btn">{t.t('header.search.submit')}</button>
        </form>
        <nav className="kv-header__nav" aria-label={t.t('nav.primary')}>
          {nav.map((n) => <Link key={n.href} href={n.href} className="kv-header__link">{n.label}</Link>)}
        </nav>
        <div className="kv-header__actions">
          <LocaleSwitcher active={lang} label={t.t('lang.label')} comingSoonLabel={t.t('lang.comingSoon')} />
          {signedIn && offersOn && <Link href="/offers" className="kv-header__link" data-kv-nav="offers">{t.t('nav.offers')}</Link>}
          {signedIn && <Link href="/messages" className="kv-header__link">{t.t('nav.messages')}</Link>}
          {signedIn && <Link href="/notifications" className="kv-header__link">{t.t('nav.notifications')}</Link>}
          {signedIn && <Link href="/account" className="kv-header__link">{t.t('nav.account')}</Link>}
          {/* PC-56 STORE-1a (survey F-19): the count is IN the accessible name ("Cart, 3 items"), not a hidden badge only sighted people see. */}
          <Link href="/cart" className="kv-header__cart" aria-label={cartCount > 0 ? t.t('nav.cartCount', { count: cartCount }) : t.t('nav.cart')}>
            {t.t('nav.cart')}{cartCount > 0 && <span className="kv-header__badge" aria-hidden="true">{cartCount}</span>}
          </Link>
          {signedIn ? (
            <form action={logoutAction}>
              <button type="submit" className="kv-header__login kv-btn--link">{t.t('nav.logout')}</button>
            </form>
          ) : (
            <Link href="/login" className="kv-header__login">{t.t('nav.login')}</Link>
          )}
        </div>
      </div>
      {cats.length > 0 && (
        <nav className="kv-catnav" aria-label={t.t('header.categories')}>
          <ul className="kv-container">
            {cats.map((c) => <li key={c.id}><Link href={`/discover?category=${encodeURIComponent(c.id)}`}>{c.label}</Link></li>)}
          </ul>
        </nav>
      )}
    </header>
  );
}
