// apps/web-tenant/src/app/marketplace/offers/loading.tsx · W129's Loading state (PC-56 TENANT-10b).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('promo.loading')}</div>;
}
