// apps/web-partner/src/app/dashboard/page.tsx · partner home. Pipeline KPIs rolled up from the lender review queue
// (fintech/loan-applications?box=review). Server-gated (requirePartner); the API only returns applications routed
// to this partner. Degrade-never-die: an SDK failure shows zeroes + a notice, never a 500. Money is summed as
// bigint minor units and shown via formatMoneyMinor (Law 2 — no float). All copy via i18n; no inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { AppRow } from '../../features/lending/application';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dash.title'), robots: { index: false, follow: false } };
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="kv-card kv-stat">
      <div className="kv-stat__label">{label}</div>
      <div className="kv-stat__value">{value}</div>
    </div>
  );
}

export default async function PartnerDashboard() {
  await requirePartner();
  const t = getTranslator();

  let rows: AppRow[] = [];
  let notice: string | undefined;
  try {
    const res = await partnerClient().request<AppRow[]>('GET', 'fintech/loan-applications', { query: { box: 'review', limit: 100 } });
    rows = res.data ?? [];
  } catch { notice = t.t('dash.unavailable'); }

  const awaiting = rows.filter((r) => r.status === 'submitted' || r.status === 'under_review').length;
  const approved = rows.filter((r) => r.status === 'approved').length;
  const pendingExposureMinor = rows
    .filter((r) => r.status === 'submitted' || r.status === 'under_review')
    .reduce((sum, r) => sum + BigInt(r.amountRequestedMinor || '0'), 0n);

  return (
    <section>
      <h1>{t.t('dash.title')}</h1>
      <p className="kv-muted">{t.t('dash.lead')}</p>
      {notice && <p className="kv-error" role="alert">{notice}</p>}
      <div className="kv-stat-row">
        <Stat label={t.t('dash.awaiting')} value={awaiting} />
        <Stat label={t.t('dash.approved')} value={approved} />
        <Stat label={t.t('dash.pendingExposure')} value={formatMoneyMinor(pendingExposureMinor.toString(), 'INR', 'en')} />
      </div>
      <p className="kv-pager"><Link className="kv-btn" href="/loan-queue">{t.t('dash.openQueue')}</Link></p>
    </section>
  );
}
