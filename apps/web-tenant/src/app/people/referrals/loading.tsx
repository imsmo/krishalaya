// apps/web-tenant/src/app/people/referrals/loading.tsx · W162's Loading state (PC-56 TENANT-10a).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('ref.loading')}</div>;
}
