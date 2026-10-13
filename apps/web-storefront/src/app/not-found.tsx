// apps/web-storefront/src/app/not-found.tsx · the global 404 boundary. Server component; localized. Rendered by
// notFound() (e.g. a missing listing/tenant) AND by any not-yet-built route (e.g. /login, /cart before their
// wave) — a friendly localized page, never a crash (degrade, never die).
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';

export default function NotFound() {
  const t = getTranslator();
  return (
    // PC-56 STORE-1b: the root layout no longer wraps pages in <main> (each route group does), so the 404 carries its own landmark — it is
    // also what an unknown, non-live or (to an anonymous visitor) trial organisation's /<slug> renders (the tenant layout's notFound()).
    <main className="kv-container" id="main">
      <section className="kv-empty-state">
        <h1>{t.t('common.notFoundTitle')}</h1>
        <p>{t.t('common.notFoundBody')}</p>
        <Link href="/" className="kv-btn">{t.t('common.backHome')}</Link>
      </section>
    </main>
  );
}
