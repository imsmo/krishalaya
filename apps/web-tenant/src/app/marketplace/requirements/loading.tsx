// apps/web-tenant/src/app/marketplace/requirements/loading.tsx · W131 / W132's Loading state (PC-56 TENANT-11d).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('rq.loading')}</div>;
}
