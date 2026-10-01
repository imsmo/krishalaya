// apps/web-tenant/src/app/content/pages/loading.tsx · W175/W176's "Loading" state — PC-56 TENANT-8c.
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
