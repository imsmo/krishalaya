// apps/web-admin/src/app/reports/page.tsx · god-mode exec dashboards. Server component: requireAdmin gates, three
// READ-ONLY panels fetched in parallel via admin-client, each degrading INDEPENDENTLY (one failing panel never
// blanks the others, Law 12). Money totals are minor-unit strings → formatMoneyMinor (never floated); the login-
// success ratio is integer basis points → bpsToPercent (integer math). The regulator export is a downloadable
// PII-free snapshot served by the sibling route handler. No inline styles.
import type { Metadata } from 'next';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { bpsToPercent, type OverviewReport, type GmvReport, type TenantGrowthReport } from '../../features/reports/report';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { DataTable, Column } from '../../components/DataTable';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('reports.title'), robots: { index: false, follow: false } };
}

async function load<T>(path: string): Promise<{ data?: T; notice?: string }> {
  try { return { data: (await adminGet<T>(path)).data }; }
  catch (e) { return { notice: `notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}` }; }
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-card kv-stat"><div className="kv-stat__label">{label}</div><div className="kv-stat__value">{value}</div></div>;
}

export default async function ReportsPage() {
  requireAdmin();
  const t = getTranslator();

  const [overview, gmv, growth] = await Promise.all([
    load<OverviewReport>('reports/overview'),
    load<GmvReport>('reports/gmv'),
    load<TenantGrowthReport>('reports/tenant-growth'),
  ]);

  const growthCols: Column<{ period: string; newTenants: number }>[] = [
    { header: t.t('reports.growthMonth'), cell: (r) => r.period },
    { header: t.t('reports.growthNew'), cell: (r) => r.newTenants.toLocaleString() },
  ];

  return (
    <section>
      <h1>{t.t('reports.title')}</h1>
      <p className="kv-muted">{t.t('reports.lead')}</p>

      <h2>{t.t('reports.overview')}</h2>
      {overview.notice || !overview.data ? <p className="kv-error" role="alert">{t.t(overview.notice ?? 'notice.unavailable')}</p> : (
        <div className="kv-stat-row">
          <Stat label={t.t('reports.mrr')} value={formatMoneyMinor(overview.data.revenue.mrrMinor, overview.data.currency)} />
          <Stat label={t.t('reports.arr')} value={formatMoneyMinor(overview.data.revenue.arrMinor, overview.data.currency)} />
          <Stat label={t.t('reports.activeSubs')} value={overview.data.revenue.activeSubscriptions.toLocaleString()} />
          <Stat label={t.t('reports.activeTenants')} value={`${overview.data.tenants.activeTotal.toLocaleString()} / ${overview.data.tenants.total.toLocaleString()}`} />
          <Stat label={t.t('reports.activeUsers')} value={overview.data.activity.activeUsers.toLocaleString()} />
          <Stat label={t.t('reports.loginSuccess')} value={bpsToPercent(overview.data.activity.loginSuccessBps)} />
        </div>
      )}

      <h2>{t.t('reports.gmvHeading')}</h2>
      {gmv.notice || !gmv.data ? <p className="kv-error" role="alert">{t.t(gmv.notice ?? 'notice.unavailable')}</p> : (
        <div className="kv-stat-row">
          <Stat label={t.t('reports.gmv')} value={formatMoneyMinor(gmv.data.gmvMinor, gmv.data.currency)} />
          <Stat label={t.t('reports.platformFee')} value={formatMoneyMinor(gmv.data.platformFeeMinor, gmv.data.currency)} />
          <Stat label={t.t('reports.commission')} value={formatMoneyMinor(gmv.data.commissionMinor, gmv.data.currency)} />
          <Stat label={t.t('reports.orders')} value={gmv.data.orders.toLocaleString()} />
          <Stat label={t.t('reports.aov')} value={formatMoneyMinor(gmv.data.avgOrderValueMinor, gmv.data.currency)} />
        </div>
      )}

      <h2>{t.t('reports.growthHeading')}</h2>
      {growth.notice || !growth.data ? <p className="kv-error" role="alert">{t.t(growth.notice ?? 'notice.unavailable')}</p> : (
        <>
          <p className="kv-muted">{t.t('reports.growthTotal', { total: growth.data.totalNewTenants.toLocaleString() })}</p>
          <DataTable columns={growthCols} rows={growth.data.buckets} empty={t.t('reports.growthEmpty')} />
        </>
      )}

      <h2>{t.t('reports.regulatorHeading')}</h2>
      <p className="kv-muted kv-note">{t.t('reports.regulatorNote')}</p>
      <p className="kv-pager"><a className="kv-btn" href="/reports/regulator-export" download>{t.t('reports.regulatorDownload')}</a></p>
    </section>
  );
}
