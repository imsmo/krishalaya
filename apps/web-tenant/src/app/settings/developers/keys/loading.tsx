// apps/web-tenant/src/app/settings/developers/keys/loading.tsx · the API key area's Loading state (W190 — PC-56 TENANT-13c).
import { getTranslator } from '../../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('ak.loading')}</div>;
}
