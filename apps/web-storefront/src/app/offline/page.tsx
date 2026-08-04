// apps/web-storefront/src/app/offline/page.tsx · the offline fallback (PC-24c). Pre-cached by the service
// worker at install and served when a navigation fails with no network. Static, no data reads (it must render
// from cache alone), localized server-side at build/request time, noindex.
import type { Metadata } from 'next';
import { getTranslator } from '../../lib/i18n';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('offline.title'), robots: { index: false, follow: false } };
}

export default function OfflinePage() {
  const t = getTranslator();
  return (
    <section className="kv-offline" style={{ textAlign: 'center', padding: '48px 16px' }}>
      <h1>{t.t('offline.heading')}</h1>
      <p>{t.t('offline.body')}</p>
      <p className="kv-detail__muted">{t.t('offline.hint')}</p>
      <a href="/" className="kv-btn">{t.t('offline.retry')}</a>
    </section>
  );
}
