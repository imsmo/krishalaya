// apps/web-tenant/src/app/governance/resolutions/loading.tsx · W198's Loading state (PC-56 TENANT-9b).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('res.loading')}</div>;
}
