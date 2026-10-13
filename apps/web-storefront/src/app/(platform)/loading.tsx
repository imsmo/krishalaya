// apps/web-storefront/src/app/(platform)/loading.tsx · the route-segment loading boundary (Suspense fallback) — canon W273 "Loading". Server
// component; localized. Covers every platform page (PC-56 STORE-1b: inside the platform chrome, so the header stays) while its data resolves.
import { getTranslator } from '../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
