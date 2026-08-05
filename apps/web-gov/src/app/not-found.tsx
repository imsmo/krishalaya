// apps/web-gov/src/app/not-found.tsx · localized 404 for the console (server component).
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';

export default function NotFound() {
  const t = getTranslator();
  return (
    <section className="kv-empty-state">
      <h1>{t.t('common.notFoundTitle')}</h1>
      <p>{t.t('common.notFoundBody')}</p>
      <Link href="/dashboard" className="kv-btn">{t.t('common.backToDashboard')}</Link>
    </section>
  );
}
