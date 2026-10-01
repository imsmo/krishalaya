// apps/web-tenant/src/app/content/banners/loading.tsx · W173/W174's "Loading" state — PC-56 TENANT-8d.
import { getTranslator } from '../../../lib/i18n';

export default function Loading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
