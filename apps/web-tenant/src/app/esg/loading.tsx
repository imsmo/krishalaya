// apps/web-tenant/src/app/esg/loading.tsx · W423's Loading state (PC-56 TENANT-9d).
import { getTranslator } from '../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('esg.loading')}</div>;
}
