// apps/web-admin/src/app/recon/page.tsx · god-mode money-safety overview. Server component: requireAdmin gates,
// adminGet hits GET /v1/recon/overview (latest reconciliation run per type + the platform ledger zero-sum health).
// The ledger is double-entry, so SUM(all entries) must be 0 — balanced=false is a money-safety ALARM. Degrade-
// never-die: failures map (features/nav adminNoticeKey) to a localized notice (403 → re-auth). No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../lib/admin-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { adminNoticeKey } from '../../features/nav/nav-model';
import { formatMoneyMinor } from '@krishalaya/i18n';
import type { ReconOverview } from '../../features/recon/recon';

import { Chip, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('recon.title'), robots: { index: false, follow: false } };
}

export default async function ReconOverviewPage() {
  requireAdmin();
  const t = getTranslator();

  let data: ReconOverview | undefined;
  let notice: string | undefined;
  try { data = (await adminGet<ReconOverview>('recon/overview')).data; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<ReconOverview['latestByType'][number]>[] = [
    { header: t.t('recon.runType'), cell: (r) => r.runType },
    { header: t.t('recon.runStatus'), cell: (r) => r.status },
    { header: t.t('recon.checked'), cell: (r) => r.checkedCount.toLocaleString() },
    { header: t.t('recon.mismatches'), cell: (r) => r.mismatchCount > 0 ? <StatusPill tone="danger" label={r.mismatchCount.toLocaleString()} /> : r.mismatchCount.toLocaleString() },
  ];

  return (
    <section>
      <h1>{t.t('recon.title')}</h1>
      <p className="kv-muted">{t.t('recon.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('recon.nav')}>
        <Chip as={Link} href="/recon/runs">{t.t('recon.runs')}</Chip>
        <Chip as={Link} href="/recon/investigations">{t.t('recon.investigations')}</Chip>
      </nav>

      {notice || !data ? <p className="kv-error" role="alert">{notice ?? t.t('notice.unavailable')}</p> : (
        <>
          <h2>{t.t('recon.zeroSum')}</h2>
          <div className="kv-stat-row">
            <div className="kv-card kv-stat">
              <div className="kv-stat__label">{t.t('recon.ledgerSum')}</div>
              <div className="kv-stat__value">{formatMoneyMinor(data.ledgerZeroSum.sumMinor, 'INR')}</div>
            </div>
            <div className="kv-card kv-stat">
              <div className="kv-stat__label">{t.t('recon.balanced')}</div>
              <div className="kv-stat__value">
                <StatusPill tone={data.ledgerZeroSum.balanced ? 'success' : 'danger'} label={data.ledgerZeroSum.balanced ? t.t('recon.balancedYes') : t.t('recon.balancedNo')} />
              </div>
            </div>
          </div>

          <h2>{t.t('recon.latestRuns')}</h2>
          <DataTable columns={cols} rows={data.latestByType} empty={t.t('recon.noRuns')} />
        </>
      )}
    </section>
  );
}
