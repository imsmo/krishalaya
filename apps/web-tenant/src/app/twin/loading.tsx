// apps/web-tenant/src/app/twin/loading.tsx · the twin area's Loading state (W420 / W421 / W422 — PC-56 TENANT-12).
import { getTranslator } from '../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('twin.loading')}</div>;
}
