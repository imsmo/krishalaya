// apps/web-admin/src/app/compliance/audit/page.tsx · read-only god-mode audit-log explorer. Server component:
// requireAdmin gates, adminGet hits GET /v1/compliance/audit (actor / entity / action / tenant / time-window
// filters, partition-pruned keyset). A plain GET <form> sets the filters (no client JS). Audit payloads are
// PII-free by writer contract — this shows actor, action, entity ref, reason and IP only. Degrade-never-die.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { DataTable, Column } from '../../../components/DataTable';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import type { AuditRow } from '../../../features/compliance/compliance';
import { SAVED_VIEWS, isSavedView, isActiveView, windowTooWide } from '../../../features/audit/audit-console';

import { Button, Chip } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('compliance.auditTitle'), robots: { index: false, follow: false } };
}

export default async function AuditExplorerPage({ searchParams }: { searchParams: { cursor?: string; actorUserId?: string; entityType?: string; entityId?: string; action?: string; tenantId?: string; from?: string; to?: string; view?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const f = {
    actorUserId: searchParams.actorUserId?.trim() || undefined,
    entityType: searchParams.entityType?.trim() || undefined,
    entityId: searchParams.entityId?.trim() || undefined,
    action: searchParams.action?.trim() || undefined,
    tenantId: searchParams.tenantId?.trim() || undefined,
    from: searchParams.from?.trim() || undefined,
    to: searchParams.to?.trim() || undefined,
  };
  // ADMIN-5e — W039's one-tap saved views. Applied SERVER-SIDE: filtering a keyset page after fetching it returns
  // short pages and eventually an empty one that reads as "no matches".
  const view = isSavedView(searchParams.view) ? searchParams.view : 'all';
  // W039: "wide scans require an export job instead of a live query". Checked here so the operator is told at the
  // form rather than after a partition scan they then have to wait out.
  const tooWide = windowTooWide(f.from, f.to, new Date());

  let rows: AuditRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    // The query is not SENT when the window is too wide — the point of the rule is to avoid the scan, so asking
    // the server to refuse it would still have cost the round trip and taught nobody anything.
    const res = tooWide
      ? { data: [] as AuditRow[], meta: {} as Record<string, unknown> }
      : await adminGet<AuditRow[]>('compliance/audit', { cursor: searchParams.cursor, ...f, view, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const cols: Column<AuditRow>[] = [
    { header: t.t('compliance.auditWhen'), cell: (r) => r.createdAt ?? t.t('common.dash') },
    { header: t.t('compliance.auditAction'), cell: (r) => r.action },
    { header: t.t('compliance.auditActor'), cell: (r) => r.actorUserId ?? t.t('common.dash') },
    { header: t.t('compliance.auditEntity'), cell: (r) => `${r.entityType ?? t.t('common.dash')}${r.entityId ? ` · ${r.entityId}` : ''}` },
    { header: t.t('compliance.auditReason'), cell: (r) => r.reason ?? t.t('common.dash') },
  ];

  const nextHref = () => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(f)) if (v) sp.append(k, v);
    if (nextCursor) sp.append('cursor', nextCursor);
    return `/compliance/audit?${sp.toString()}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p>
      <h1>{t.t('compliance.auditTitle')}</h1>
      <p className="kv-muted">{t.t('compliance.auditLead')}</p>

      <nav className="kv-filters" aria-label={t.t('aud.views')}>
        {SAVED_VIEWS.map((v) => {
          const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, x]) => !!x) as [string, string][]), ...(v === 'all' ? {} : { view: v }) });
          return <Chip key={v} as={Link} href={`/compliance/audit${qs.toString() ? `?${qs}` : ''}`} active={isActiveView(view, v)}>{t.t(`aud.view.${v}`)}</Chip>;
        })}
        {/* W040's drill, reachable from the explorer rather than only by typing a URL. */}
        <Chip as={Link} href="/compliance/audit/entity">{t.t('aud.entityLink')}</Chip>
      </nav>
      {tooWide && <p className="kv-error" role="alert">{t.t('aud.windowTooWide')}</p>}
      <p className="kv-detail__muted">{t.t('aud.immutableNote')}</p>

      <form method="get" className="kv-form kv-filters" aria-label={t.t('compliance.auditFilters')}>
        <input type="hidden" name="view" value={view} />
        <input name="action" className="kv-input kv-input--sm" defaultValue={f.action ?? ''} placeholder={t.t('compliance.auditFAction')} />
        <input name="entityType" className="kv-input kv-input--sm" defaultValue={f.entityType ?? ''} placeholder={t.t('compliance.auditFEntityType')} />
        <input name="actorUserId" className="kv-input kv-input--sm" defaultValue={f.actorUserId ?? ''} placeholder={t.t('compliance.auditFActor')} />
        <input name="tenantId" className="kv-input kv-input--sm" defaultValue={f.tenantId ?? ''} placeholder={t.t('compliance.auditFTenant')} />
        <input name="from" className="kv-input kv-input--sm" defaultValue={f.from ?? ''} placeholder={t.t('compliance.auditFFrom')} />
        <input name="to" className="kv-input kv-input--sm" defaultValue={f.to ?? ''} placeholder={t.t('compliance.auditFTo')} />
        <Button type="submit">{t.t('compliance.auditApply')}</Button>
      </form>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={cols} rows={rows} empty={t.t('compliance.auditEmpty')} />
          {nextCursor && <p className="kv-pager"><Button as={Link} href={nextHref()}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}
    </section>
  );
}
