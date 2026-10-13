// apps/web-storefront/src/app/[tenantSlug]/loading.tsx · PC-56 STORE-1b · C3 — the tenant home's LOADING state (canon W274 "Loading"), inside
// the tenant's own chrome (the layout's header stays while the page's reads resolve). Server component; localized.
import { getTranslator } from '../../lib/i18n';

export default function TenantLoading() {
  const t = getTranslator();
  return <div className="kv-loading" role="status" aria-live="polite">{t.t('common.loading')}</div>;
}
