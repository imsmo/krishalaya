// apps/web-tenant/src/app/people/verification/loading.tsx · W157's Loading state while the verification desk resolves (PC-56 TENANT-SW-c;
// the desk moved here from /kyc — the canon path).
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
