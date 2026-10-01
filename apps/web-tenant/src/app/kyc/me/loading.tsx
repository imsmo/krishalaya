// apps/web-tenant/src/app/kyc/me/loading.tsx · loading boundary while the KYC docs + profile resolve.
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
