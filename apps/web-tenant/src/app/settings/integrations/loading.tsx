// apps/web-tenant/src/app/settings/integrations/loading.tsx · the integrations area's Loading state (W187 — PC-56 TENANT-13c).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('int.loading')}</div>;
}
