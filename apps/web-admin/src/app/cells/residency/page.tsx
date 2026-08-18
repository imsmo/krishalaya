// apps/web-admin/src/app/cells/residency/page.tsx · read-only DATA-RESIDENCY report — per-country DPDP posture.
// Server component: requireAdmin gates, GET /v1/cells/residency-report. Each row shows how many cells serve a
// country, how many are active, whether EVERY serving cell is residency-locked, and how many tenants are placed. A
// country with placed tenants but not all cells locked is flagged "at risk" (residencyAtRisk). No mutations here.
// Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { residencyAtRisk, type ResidencyRow } from '../../../features/cells/cell';

import { Chip, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cells.residencyTitle'), robots: { index: false, follow: false } };
}

export default async function ResidencyPage() {
  requireAdmin();
  const t = getTranslator();

  let rows: ResidencyRow[] = []; let notice: string | undefined;
  try { rows = (await adminGet<ResidencyRow[]>('cells/residency-report')).data ?? []; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const atRisk = rows.filter(residencyAtRisk).length;
  const cols: Column<ResidencyRow>[] = [
    { header: t.t('cells.country'), cell: (r) => r.countryCode },
    { header: t.t('cells.resCells'), cell: (r) => String(r.cells) },
    { header: t.t('cells.resActive'), cell: (r) => String(r.activeCells) },
    { header: t.t('cells.resLocked'), cell: (r) => r.allResidencyLocked ? t.t('cells.locked') : <StatusPill tone="warning" label={t.t('cells.partial')} /> },
    { header: t.t('cells.placed'), cell: (r) => String(r.placedTenants) },
    { header: t.t('cells.resPosture'), cell: (r) => residencyAtRisk(r) ? <StatusPill tone="danger" label={t.t('cells.atRisk')} /> : <StatusPill tone="success" label={t.t('cells.compliant')} /> },
  ];

  return (
    <section>
      <h1>{t.t('cells.residencyTitle')}</h1>
      <p className="kv-muted">{t.t('cells.residencyLead')}</p>
      <nav className="kv-filters" aria-label={t.t('cells.nav')}>
        <Chip as={Link} href="/cells">{t.t('cells.navCells')}</Chip>
        <Chip as={Link} href="/cells/shards">{t.t('cells.navShards')}</Chip>
        <Chip as={Link} href="/cells/placements">{t.t('cells.navPlacements')}</Chip>
        <Chip as={Link} href="/cells/residency" aria-current="true" active>{t.t('cells.navResidency')}</Chip>
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          {atRisk > 0 && <p className="kv-error" role="alert">{t.t('cells.atRiskBanner')}</p>}
          <DataTable columns={cols} rows={rows} empty={t.t('cells.residencyEmpty')} />
        </>
      )}
    </section>
  );
}
