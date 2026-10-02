// apps/web-tenant/src/app/ops/labour/loading.tsx · W163 / W164's Loading state (PC-56 TENANT-11b).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('lab.loading')}</div>;
}
