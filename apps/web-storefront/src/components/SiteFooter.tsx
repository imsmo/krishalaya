// apps/web-storefront/src/components/SiteFooter.tsx · the PLATFORM footer (server component). PC-56 STORE-1b · C1: it closes ONLY the
// platform's own pages; a tenant store wears TenantFooter (the canon put this platform footer on W274 too — a DELTA, not copied).
// Canon W273's three columns, built only where a route exists:
//   • the platform store (name from packages/tokens, founder D2) + a sentence that claims nothing it cannot back;
//   • Help — "Help centre" → /help; "Returns & quality promise" and "Contact" are STORE-5 routes (W309 / W312), ANNOUNCED as coming,
//     not dead links; the canon's phone / missed-call / USSD line is refused (the IVR/USSD gateway is unimplemented — STORE-1a C-2);
//   • For farmers & organisations — "Open your organisation's storefront" → /tenants-signup, "How farm-to-fork trace works" → /trace.
// Company links (about / blog / press / pricing) stay as they were.
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';

export function SiteFooter() {
  const t = getTranslator();
  return (
    <footer className="kv-footer">
      <div className="kv-container">
        <div className="kv-footer__cols">
          <section className="kv-footer__col" aria-labelledby="kv-foot-store">
            <h2 id="kv-foot-store" className="kv-footer__heading">{PLATFORM_BRAND.platformStoreName}</h2>
            <p className="kv-footer__tagline">{t.t('footer.about')}</p>
          </section>
          <nav className="kv-footer__col" aria-label={t.t('footer.col.help')}>
            <h2 className="kv-footer__heading">{t.t('footer.col.help')}</h2>
            <Link href="/help" className="kv-footer__link">{t.t('footer.help')}</Link>
            <span className="kv-footer__link" data-kv-soon="STORE-5">{t.t('footer.returns')} · <small>{t.t('footer.soon')}</small></span>
            <span className="kv-footer__link" data-kv-soon="STORE-5">{t.t('footer.contact')} · <small>{t.t('footer.soon')}</small></span>
          </nav>
          <nav className="kv-footer__col" aria-label={t.t('footer.col.farmers')}>
            <h2 className="kv-footer__heading">{t.t('footer.col.farmers')}</h2>
            <Link href="/tenants-signup" className="kv-footer__link">{t.t('footer.openStorefront')}</Link>
            <Link href="/trace" className="kv-footer__link">{t.t('footer.traceHow')}</Link>
          </nav>
          <nav className="kv-footer__col" aria-label={t.t('footer.col.company')}>
            <h2 className="kv-footer__heading">{t.t('footer.col.company')}</h2>
            <Link href="/about" className="kv-footer__link">{t.t('nav.about')}</Link>
            <Link href="/blog" className="kv-footer__link">{t.t('nav.blog')}</Link>
            <Link href="/press" className="kv-footer__link">{t.t('nav.press')}</Link>
            <Link href="/pricing" className="kv-footer__link">{t.t('nav.pricing')}</Link>
          </nav>
        </div>
        <p className="kv-footer__rights">{t.t('footer.rights', { year: new Date().getFullYear(), app: PLATFORM_BRAND.platformStoreName })}</p>
      </div>
    </footer>
  );
}
