// apps/web-tenant/src/app/marketplace/auctions/loading.tsx · W137 / W138 / W139's Loading state (PC-56 TENANT-11a).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('auc.loading')}</div>;
}
