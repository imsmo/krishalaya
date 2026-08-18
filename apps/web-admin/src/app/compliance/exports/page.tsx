// apps/web-admin/src/app/compliance/exports/page.tsx · data-export approval queue. Server component: requireAdmin
// gates, adminGet hits GET /v1/compliance/exports (approval-status + job-kind filter, keyset). A tenant
// full-export / DPDP portability bundle is a major data-egress, so it stays pending until platform compliance
// approves it. Each PENDING row carries an inline approve/reject Server-Action form (POST exports/:id/decision)
// with a mandatory audit reason. Degrade-never-die. No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { EXPORT_APPROVAL_STATUSES, exportApprovalKey, canDecideExport, type ExportRow } from '../../../features/compliance/compliance';
import { decideExportAction } from '../actions';

import { Button, Chip, StatusPill, type StatusTone } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('compliance.exportsTitle'), robots: { index: false, follow: false } };
}

const AP_TONE: Record<string, StatusTone> = { pending: 'warning', approved: 'success', rejected: 'neutral' };
const OK = new Set(['approve', 'reject']);
const ERR = new Set(['decision', 'reason', 'elevation', 'conflict', 'invalid', 'notFound', 'generic']);

export default async function ExportApprovalsPage({ searchParams }: { searchParams: { cursor?: string; approvalStatus?: string; ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const approvalStatus = (EXPORT_APPROVAL_STATUSES as readonly string[]).includes(searchParams.approvalStatus ?? '') ? searchParams.approvalStatus : undefined;

  let rows: ExportRow[] = []; let nextCursor: string | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<ExportRow[]>('compliance/exports', { cursor: searchParams.cursor, approvalStatus, limit: 50 });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const qp = (extra: Record<string, string | undefined>) => {
    const sp = new URLSearchParams();
    const merged = { approvalStatus, ...extra };
    for (const [k, v] of Object.entries(merged)) if (v) sp.append(k, v);
    const s = sp.toString();
    return `/compliance/exports${s ? `?${s}` : ''}`;
  };

  return (
    <section>
      <p className="kv-backlink"><Link href="/compliance">{t.t('compliance.back')}</Link></p>
      <h1>{t.t('compliance.exportsTitle')}</h1>
      <p className="kv-muted">{t.t('compliance.exportsLead')}</p>
      {okKey && <p className="kv-success" role="status">{t.t(`compliance.exportOk.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`compliance.error.${errKey}`)}</p>}

      <nav className="kv-filters" aria-label={t.t('compliance.filterApproval')}>
        <Chip as={Link} href={qp({ approvalStatus: undefined, cursor: undefined })} aria-current={!approvalStatus ? 'true' : undefined} active={!approvalStatus}>{t.t('compliance.filterAll')}</Chip>
        {EXPORT_APPROVAL_STATUSES.map((s) => (
          <Chip as={Link} key={s} href={qp({ approvalStatus: s, cursor: undefined })} aria-current={approvalStatus === s ? 'true' : undefined} active={approvalStatus === s}>{t.t(`compliance.approval.${s}`)}</Chip>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? <p className="kv-muted">{t.t('compliance.exportsEmpty')}</p> : (
        <>
          <table className="kv-table">
            <thead><tr><th>{t.t('compliance.exportJob')}</th><th>{t.t('compliance.jobKind')}</th><th>{t.t('compliance.tenant')}</th><th>{t.t('compliance.approvalStatus')}</th><th>{t.t('compliance.decide')}</th></tr></thead>
            <tbody>{rows.map((r) => {
              const ak = exportApprovalKey(r.approvalStatus);
              return (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.jobKind}</td>
                  <td>{r.tenantId ?? t.t('common.dash')}</td>
                  <td><StatusPill tone={AP_TONE[ak]} label={t.t(`compliance.approval.${ak}`)} /></td>
                  <td>
                    {canDecideExport(r.approvalStatus) ? (
                      <div className="kv-action-cards">
                        <form action={decideExportAction} className="kv-inline-form">
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" />
                          <input name="reason" className="kv-input kv-input--sm" required minLength={3} maxLength={2000} placeholder={t.t('compliance.reason')} />
                          <Button type="submit" variant="tertiary">{t.t('compliance.approve')}</Button>
                        </form>
                        <form action={decideExportAction} className="kv-inline-form">
                          <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" />
                          <input name="reason" className="kv-input kv-input--sm" required minLength={3} maxLength={2000} placeholder={t.t('compliance.reason')} />
                          <Button type="submit" variant="tertiary">{t.t('compliance.reject')}</Button>
                        </form>
                      </div>
                    ) : t.t('common.dash')}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          {nextCursor && <p className="kv-pager"><Button as={Link} href={qp({ cursor: nextCursor })}>{t.t('common.nextPage')}</Button></p>}
        </>
      )}
    </section>
  );
}
