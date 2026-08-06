// apps/web-admin/src/app/billing/page.tsx · god-mode SaaS-billing revenue overview. Server component: requireAdmin
// gates, adminGet hits GET /v1/billing/revenue (MRR/ARR + outstanding/collected + invoice status counts). Money is
// minor-unit strings → formatMoneyMinor (never floated). Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { RevenueOverview } from '../../features/billing/billing';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.title'), robots: { index: false, follow: false } };
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-card kv-stat"><div className="kv-stat__label">{label}</div><div className="kv-stat__value">{value}</div></div>;
}

export default async function BillingPage() {
  requireAdmin();
  const t = getTranslator();

  let data: RevenueOverview | undefined; let notice: string | undefined;
  try { data = (await adminGet<RevenueOverview>('billing/revenue')).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  return (
    <section>
      <h1>{t.t('billing.title')}</h1>
      <p className="kv-muted">{t.t('billing.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('billing.nav')}>
        <Link href="/billing/invoices" className="kv-chip">{t.t('billing.invoices')}</Link>
        <Link href="/billing/adjustments" className="kv-chip">{t.t('billing.adjustments')}</Link>
        <Link href="/billing/dunning" className="kv-chip">{t.t('billing.dunningQueue')}</Link>
      </nav>

      {notice || !data ? <p className="kv-error" role="alert">{notice ?? t.t('notice.unavailable')}</p> : (
        <>
          <div className="kv-stat-row">
            <Stat label={t.t('billing.mrr')} value={formatMoneyMinor(data.mrrMinor, data.currency)} />
            <Stat label={t.t('billing.arr')} value={formatMoneyMinor(data.arrMinor, data.currency)} />
            <Stat label={t.t('billing.activeSubs')} value={data.activeSubscriptions.toLocaleString()} />
            <Stat label={t.t('billing.outstanding')} value={formatMoneyMinor(data.outstandingMinor, data.currency)} />
            <Stat label={t.t('billing.collected')} value={formatMoneyMinor(data.collectedMinor, data.currency)} />
          </div>

          <h2>{t.t('billing.byStatus')}</h2>
          <table className="kv-table">
            <thead><tr><th>{t.t('billing.invStatus')}</th><th>{t.t('billing.count')}</th></tr></thead>
            <tbody>
              {Object.entries(data.invoiceStatusCounts).map(([s, n]) => (
                <tr key={s}><td>{t.t(`billing.status.${s}`)}</td><td>{n.toLocaleString()}</td></tr>
              ))}
              {Object.keys(data.invoiceStatusCounts).length === 0 && <tr><td colSpan={2} className="kv-muted">{t.t('billing.noInvoices')}</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
