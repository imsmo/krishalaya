// apps/web-tenant/src/app/settings/developers/webhooks/loading.tsx · the webhooks area's Loading state (W188 / W189 — PC-56 TENANT-13a).
import { getTranslator } from '../../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('wh.loading')}</div>;
}
