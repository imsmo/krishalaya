// apps/web-admin/src/app/recon/runs/page.tsx · reconciliation-run list. Server component: requireAdmin gates,
// adminGet hits GET /v1/recon/runs (keyset). Run id links to detail. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import type { ReconRunRow } from '../../../features/recon/recon';

import { Button, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('recon.runsTitle'), robots: { index: false, follow: false } };
}

export default async function ReconRunsPage({ searchParams }: { searchParams: { cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: ReconRunRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<ReconRunRow[]>('recon/runs', { cursor: searchParams.cursor, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<ReconRunRow>[] = [
    { header: t.t('recon.runType'), cell: (r) => <Link href={`/recon/runs/${r.id}`}>{r.runType}</Link> },
    { header: t.t('recon.runStatus'), cell: (r) => r.status },
    { header: t.t('recon.checked'), cell: (r) => r.checkedCount.toLocaleString() },
    { header: t.t('recon.mismatches'), cell: (r) => r.mismatchCount > 0 ? <StatusPill tone="danger" label={r.mismatchCount.toLocaleString()} /> : r.mismatchCount.toLocaleString() },
    { header: t.t('recon.finishedAt'), cell: (r) => r.finishedAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon">{t.t('recon.back')}</Link></p>
      <h1>{t.t('recon.runsTitle')}</h1>
      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('recon.noRuns')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={`/recon/runs?cursor=${encodeURIComponent(nextCursor)}`}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}
    </section>
  );
}
