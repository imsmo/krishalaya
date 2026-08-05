// apps/web-gov/src/app/loading.tsx · route-segment loading boundary (Suspense fallback). Server component;
// localized. Covers every console page under the root layout while its data resolves.
import { getTranslator } from '../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
