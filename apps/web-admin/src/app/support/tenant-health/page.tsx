// apps/web-admin/src/app/support/tenant-health/page.tsx · god-mode per-tenant support-health rollup. Server
// component: requireAdmin gates, adminGet hits GET /v1/support/tenant-health (top tenants by open SLA breaches:
// open count, SLA-breached count, P0-open count, oldest-open age). Cross-tenant (Law 11). Money-free. Each tenant
// links into the ticket queue filtered to that tenant. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { ageParts, type TenantHealthRow } from '../../../features/support/ticket';
import { StatusPill } from '@krishalaya/ui';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('support.healthTitle'), robots: { index: false, follow: false } };
}

function ageLabel(t: ReturnType<typeof getTranslator>, sec: number | null): string {
  const a = ageParts(sec);
  if (!a) return t.t('common.dash');
  return t.t('support.ageFmt').replace('{d}', String(a.days)).replace('{h}', String(a.hours)).replace('{m}', String(a.minutes));
}

export default async function TenantHealthPage() {
  requireAdmin();
  const t = getTranslator();

  let rows: TenantHealthRow[] = []; let notice: string | undefined;
  try { rows = (await adminGet<TenantHealthRow[]>('support/tenant-health', { limit: 20 })).data ?? []; }
  catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<TenantHealthRow>[] = [
    { header: t.t('support.tenant'), cell: (r) => <Link href={`/support?tenantId=${encodeURIComponent(r.tenantId)}`}>{r.tenantId}</Link> },
    { header: t.t('support.openCount'), cell: (r) => r.openCount.toLocaleString() },
    { header: t.t('support.breachedCount'), cell: (r) => r.breachedCount > 0 ? <StatusPill tone="danger" label={r.breachedCount.toLocaleString()} /> : r.breachedCount.toLocaleString() },
    { header: t.t('support.p0Open'), cell: (r) => r.p0Open > 0 ? <StatusPill tone="danger" label={r.p0Open.toLocaleString()} /> : r.p0Open.toLocaleString() },
    { header: t.t('support.oldestOpen'), cell: (r) => ageLabel(t, r.oldestOpenAgeSec) },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('support.healthTitle')}</h1>
      <p className="kv-muted">{t.t('support.healthLead')}</p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <DataTable columns={cols} rows={rows} empty={t.t('support.healthEmpty')} />
      )}
    </section>
  );
}
