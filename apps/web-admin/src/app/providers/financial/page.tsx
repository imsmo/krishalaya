// apps/web-admin/src/app/providers/financial/page.tsx · god-mode FINANCIAL-partner lens. Server component:
// requireAdmin gates, adminGet hits GET /v1/providers/financial — the money-path providers only (payment gateways
// + KYC: Razorpay/RazorpayX/PFMS/…). The finance ops team watches these specifically: an outage here halts
// settlements / onboarding, so a DEGRADED row (disabled but still referenced) is a finance ALARM. Counts only,
// never secret material. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { categoryKey, providerHealthKey, type ProviderHealthRow } from '../../../features/providers/provider';
import { StatusPill, type StatusTone } from '@krishalaya/ui';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('providers.financialTitle'), robots: { index: false, follow: false } };
}

const HEALTH_TONE: Record<string, StatusTone> = { active: 'success', degraded: 'danger', disabled: 'neutral' };

export default async function FinancialPartnersPage() {
  requireAdmin();
  const t = getTranslator();

  let rows: ProviderHealthRow[] = []; let notice: string | undefined;
  try { rows = (await adminGet<ProviderHealthRow[]>('providers/financial')).data ?? []; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const degradedCount = rows.filter((r) => r.degraded).length;

  const cols: Column<ProviderHealthRow>[] = [
    { header: t.t('providers.code'), cell: (r) => <Link href={`/providers/${encodeURIComponent(r.code)}`}>{r.code}</Link> },
    { header: t.t('providers.name'), cell: (r) => r.defaultName },
    { header: t.t('providers.category'), cell: (r) => t.t(`providers.cat.${categoryKey(r.category)}`) },
    { header: t.t('providers.health'), cell: (r) => { const k = providerHealthKey(r); return <StatusPill tone={HEALTH_TONE[k]} label={t.t(`providers.healthState.${k}`)} />; } },
    { header: t.t('providers.configuredTenants'), cell: (r) => r.health.configuredTenants.toLocaleString() },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/providers">{t.t('providers.back')}</Link></p>
      <h1>{t.t('providers.financialTitle')}</h1>
      <p className="kv-muted">{t.t('providers.financialLead')}</p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {degradedCount > 0
            ? <p className="kv-error" role="alert">{t.t('providers.degradedAlarm').replace('{count}', String(degradedCount))}</p>
            : <p className="kv-success" role="status">{t.t('providers.allHealthy')}</p>}
          <DataTable columns={cols} rows={rows} empty={t.t('providers.financialEmpty')} />
        </>
      )}
    </section>
  );
}
