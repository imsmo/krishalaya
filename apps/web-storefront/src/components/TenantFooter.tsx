// apps/web-storefront/src/components/TenantFooter.tsx · PC-56 STORE-1b · C1 — a tenant store's own footer: the organisation's name, Help,
// and the "Powered by Krishalaya" mark under the 13d rule. NOT the platform footer the canon draws on W274 (that is a DELTA: a white-label
// store does not advertise the platform's own columns; the way back to the platform store is the header breadcrumb).
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';
import { PoweredByMark } from './PoweredByMark';
import { PLATFORM_BRAND } from '../features/branding/brand-theme';

export function TenantFooter({ name, showPoweredBy }: { name: string; showPoweredBy: boolean }) {
  const t = getTranslator();
  return (
    <footer className="kv-footer" data-kv-footer="tenant">
      <div className="kv-container">
        <div className="kv-footer__cols">
          <section className="kv-footer__col">
            <h2 className="kv-footer__heading">{name}</h2>
          </section>
          <nav className="kv-footer__col" aria-label={t.t('footer.col.help')}>
            <Link href="/help" className="kv-footer__link">{t.t('footer.help')}</Link>
          </nav>
        </div>
        {showPoweredBy && <PoweredByMark label={PLATFORM_BRAND.poweredByMark} />}
      </div>
    </footer>
  );
}
