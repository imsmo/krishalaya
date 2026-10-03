// apps/web-tenant/src/app/settings/branding/loading.tsx · W191's Loading state — PC-56 TENANT-13d.
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('br.loading')}</div>;
}
