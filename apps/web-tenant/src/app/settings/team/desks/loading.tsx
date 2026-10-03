// apps/web-tenant/src/app/settings/team/desks/loading.tsx · W185's Loading state — PC-56 TENANT-13b.
import { getTranslator } from '../../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('dk.loading')}</div>;
}
