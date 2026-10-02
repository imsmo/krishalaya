// apps/web-tenant/src/app/marketplace/group-lots/loading.tsx · W135 / W136's Loading state (PC-56 TENANT-11c).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('gl.loading')}</div>;
}
