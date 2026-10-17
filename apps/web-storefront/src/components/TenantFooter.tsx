// apps/web-storefront/src/components/TenantFooter.tsx · PC-56 STORE-1b · C1 — a tenant store's own footer: the organisation's name, Help,
// and the "Powered by Krishalaya" mark under the 13d rule. NOT the platform footer the canon draws on W274 (that is a DELTA: a white-label
// store does not advertise the platform's own columns; the way back to the platform store is the header breadcrumb).
// PC-56 STORE-SWEEP-a · D3 / D4 (founders Q4 / Q5; survey F-5 — the store's links led into the platform's chrome):
//   • Help, the quality promise and Contact are THIS store's pages (`/<slug>/help`, `/<slug>/quality-promise`, `/<slug>/contact` — on its own host
//     the same paths work, and `/help`, `/quality-promise`, `/contact` are rewritten there too);
//   • "Grievances" → the PLATFORM's trust page on EVERY store (trust is not re-brandable — the TRUST_SURFACES precedent; never hidden with the mark):
//     `/trust-data#grievances` on a path store, `<platform origin>/trust-data#grievances` on a store host (`platformOrigin`, set by the layout
//     only for a host-routed request — NEXT_PUBLIC_SITE_URL);
//   • "Powered by" is a LINK to the platform's About page the same way (PoweredByMark `href`), under the 13d visibility rule unchanged.
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';
import { PoweredByMark } from './PoweredByMark';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';
import { tenantChrome } from '../features/store4a/account';
import { grievancesHref, platformAboutHref, sweepHref } from '../features/sweep/paths';

export function TenantFooter({ name, slug, showPoweredBy, platformOrigin = '' }: { name: string; slug: string; showPoweredBy: boolean; platformOrigin?: string }) {
  const t = getTranslator();
  const chrome = tenantChrome(slug);
  return (
    <footer className="kv-footer" data-kv-footer="tenant">
      <div className="kv-container">
        <div className="kv-footer__cols">
          <section className="kv-footer__col">
            <h2 className="kv-footer__heading">{name}</h2>
          </section>
          <nav className="kv-footer__col" aria-label={t.t('footer.col.help')}>
            <Link href={sweepHref(chrome, 'help')} className="kv-footer__link" data-kv-foot="help">{t.t('footer.help')}</Link>
            <Link href={sweepHref(chrome, 'quality-promise')} className="kv-footer__link" data-kv-foot="quality">{t.t('footer.returns')}</Link>
            <Link href={sweepHref(chrome, 'contact')} className="kv-footer__link" data-kv-foot="contact">{t.t('footer.contact')}</Link>
            <a href={grievancesHref(chrome, platformOrigin)} className="kv-footer__link" data-kv-foot="grievances">{t.t('sweep.footer.grievances')}</a>
          </nav>
        </div>
        {showPoweredBy && <PoweredByMark label={PLATFORM_BRAND.poweredByMark} href={platformAboutHref(chrome, platformOrigin)} />}
      </div>
    </footer>
  );
}
