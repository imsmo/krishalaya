// apps/web-admin/src/components/TenantTabs.tsx · the per-tenant tab strip (PC-56 ADMIN-1c, canon W003).
// A server component: these are plain links to the console routes that OWN each concern, pre-filtered to this tenant
// where the route supports it. Tabs whose destination cannot be narrowed to one tenant are marked, because a
// platform-wide flag screen sitting under a tenant's name would be read as that tenant's configuration.
import Link from 'next/link';
import { getTranslator } from '../lib/i18n';
import { tenantTabs, unscopedTabs, type TenantTab } from '../features/tenants/tabs';

export function TenantTabs({ tenantId, active }: { tenantId: string; active: TenantTab }) {
  const t = getTranslator();
  const tabs = tenantTabs(tenantId);
  const unscoped = unscopedTabs(tenantId);
  return (
    <>
      <nav className="kv-tabs" aria-label={t.t('tenantTabs.label')}>
        {tabs.map((tab) => (
          <Link key={tab.key} href={tab.href}
            className={`kv-tab${tab.key === active ? ' kv-tab--active' : ''}`}
            aria-current={tab.key === active ? 'page' : undefined}>
            {t.t(`tenantTabs.${tab.key}`)}
            {!tab.scoped && <span className="kv-status kv-status--muted">{t.t('tenantTabs.platformWide')}</span>}
          </Link>
        ))}
      </nav>
      {unscoped.length > 0 && (
        <p className="kv-field__hint">
          {t.t('tenantTabs.unscopedNote', { tabs: unscoped.map((k) => t.t(`tenantTabs.${k}`)).join(', ') })}
        </p>
      )}
    </>
  );
}
