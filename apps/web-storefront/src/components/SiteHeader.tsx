// apps/web-storefront/src/components/SiteHeader.tsx · the global storefront header (server component — no client
// JS beyond the locale switcher + the logout form's submit). Brand, primary nav, the language picker, a cart
// link with a count badge, and — depending on session — either a sign-in link (anonymous) or a logout button
// (signed in). The signed-in check is a cheap cookie-presence read (hasSessionCookie, no network). All copy via
// the i18n translator; the cart count is passed in (0 until the cart lands in SF-W3). The `/cart` target is a
// real route built in a later wave; until then the shared not-found boundary renders a friendly localized 404.
import Link from 'next/link';
import { getTranslator, getLang } from '../lib/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { env } from '../lib/env';
import { hasSessionCookie } from '../lib/auth';
import { getCartItemCount } from '../features/cart/summary';
import { logoutAction } from '../app/login/actions';

export async function SiteHeader() {
  const t = getTranslator();
  const lang = getLang();
  const signedIn = hasSessionCookie();
  const cartCount = await getCartItemCount(); // 0 for anonymous / on failure (degrade)
  const nav = [
    { href: '/', label: t.t('nav.home') },
    ...(env.featureAuctions ? [{ href: '/auctions', label: t.t('nav.auctions') }] : []),
    { href: '/pricing', label: t.t('nav.pricing') },
    { href: '/about', label: t.t('nav.about') },
    { href: '/help', label: t.t('nav.help') },
  ];
  return (
    <header className="kv-header">
      <div className="kv-container kv-header__bar">
        <Link href="/" className="kv-header__brand">{env.appName}</Link>
        <nav className="kv-header__nav" aria-label={t.t('nav.primary')}>
          {nav.map((n) => <Link key={n.href} href={n.href} className="kv-header__link">{n.label}</Link>)}
        </nav>
        <div className="kv-header__actions">
          <LocaleSwitcher active={lang} label={t.t('lang.label')} />
          {signedIn && <Link href="/offers" className="kv-header__link">{t.t('nav.offers')}</Link>}
          {signedIn && <Link href="/messages" className="kv-header__link">{t.t('nav.messages')}</Link>}
          {signedIn && <Link href="/notifications" className="kv-header__link">{t.t('nav.notifications')}</Link>}
          {signedIn && <Link href="/account" className="kv-header__link">{t.t('nav.account')}</Link>}
          <Link href="/cart" className="kv-header__cart" aria-label={t.t('nav.cart')}>
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
    </header>
  );
}
