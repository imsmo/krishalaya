// apps/web-tenant/src/app/settings/branding/domains/loading.tsx · W192's Loading state — PC-56 TENANT-13d.
import { getTranslator } from '../../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('dom.loading')}</div>;
}
