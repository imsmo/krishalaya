// apps/web-tenant/src/app/kyc/loading.tsx · W121's Loading state while the desk resolves (PC-56 TENANT-9a).
import { getTranslator } from '../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
