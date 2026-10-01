// apps/web-tenant/src/app/auditor/loading.tsx · the auditor realm's Loading state (W200/W201/W436/W437) — PC-56 TENANT-9c.
import { getTranslator } from '../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
