// apps/web-admin/src/app/recon/corrections/page.tsx · the correction queue (PC-56 ADMIN-5e, W068's list side).
//
// W068 has no list screen of its own — it is reached from an investigation. This queue exists because the CHECKER
// needs one: `ledger.correct` is held by somebody who did not draft any of these and has no case open in front of
// them, and without a queue they would have to be sent a link. A control that depends on somebody remembering to
// send a link is a control that lapses on a busy day.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin, adminUserId } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { adminNoticeKey } from '../../../features/nav/nav-model';
import { statusClass, balanceClass, balanceText, approveBlockedKey, type BalanceView, type DraftStatus, type ApproveState } from '../../../features/audit/audit-console';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cor.queueTitle'), robots: { index: false, follow: false } };
}

interface Row {
  id: string; investigationId: string; status: DraftStatus; makerId: string; checkerId: string | null;
  submittedAt: string | null; balance: BalanceView; approveState: ApproveState; approveOfferable: boolean;
  aboveFounderThreshold: boolean;
}

const STATUSES: DraftStatus[] = ['awaiting_checker', 'drafting', 'posted', 'rejected', 'withdrawn'];

export default async function CorrectionQueuePage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  requireAdmin();
  const t = getTranslator();
  const viewer = adminUserId();
  const status = searchParams.status && (STATUSES as string[]).includes(searchParams.status) ? searchParams.status : undefined;

  let rows: Row[] = []; let next: string | null = null; let notice: string | undefined;
  try {
    const r = await adminGet<Row[]>('ledger/corrections', { status, cursor: searchParams.cursor });
    rows = r.data; next = (r.meta as { nextCursor?: string | null } | undefined)?.nextCursor ?? null;
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  return (
    <section>
      <p className="kv-backlink"><Link href="/recon/investigations">{t.t('cor.backInvestigations')}</Link></p>
      <h1>{t.t('cor.queueHeading')}</h1>
      <p className="kv-muted">{t.t('cor.queueLead')}</p>
      {notice && <p className="kv-error" role="alert">{notice}</p>}

      <nav className="kv-filters">
        <Link href="/recon/corrections" className={!status ? 'kv-chip is-active' : 'kv-chip'}>{t.t('cor.filter.all')}</Link>
        {STATUSES.map((s) => (
          <Link key={s} href={`/recon/corrections?status=${s}`} className={status === s ? 'kv-chip is-active' : 'kv-chip'}>{t.t(`cor.state.${s}`)}</Link>
        ))}
      </nav>

      <table className="kv-table">
        <thead><tr>
          <th>{t.t('cor.col.case')}</th><th>{t.t('cor.col.size')}</th><th>{t.t('cor.col.balance')}</th>
          <th>{t.t('cor.col.status')}</th><th>{t.t('cor.col.maker')}</th><th>{t.t('cor.col.action')}</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            const blocked = approveBlockedKey(r.approveState, r.makerId, viewer);
            return (
              <tr key={r.id}>
                <td><Link href={`/recon/corrections/${r.id}`}>{r.investigationId}</Link></td>
                <td>
                  {r.balance.grossText}
                  {/* Flagged in the QUEUE, not only on the detail page — a checker triaging a list should see which
                      one needs the founder told before they open it. */}
                  {r.aboveFounderThreshold && <span className="kv-status kv-status--warn">{t.t('cor.aboveThreshold')}</span>}
                </td>
                <td><span className={balanceClass(r.balance)}>{balanceText(r.balance)}</span></td>
                <td><span className={statusClass(r.status)}>{t.t(`cor.state.${r.status}`)}</span></td>
                <td>{r.makerId}</td>
                <td>
                  {r.status === 'awaiting_checker' && (
                    blocked === null
                      ? <Link href={`/recon/corrections/${r.id}`} className="kv-btn kv-btn--link">{t.t('cor.review')}</Link>
                      : <span className="kv-detail__muted">{t.t(`cor.approveBlocked.${blocked}`)}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && !notice && <p className="kv-empty">{t.t('cor.queueEmpty')}</p>}
      {next && <p className="kv-pager"><Link href={`/recon/corrections?${new URLSearchParams({ ...(status ? { status } : {}), cursor: next }).toString()}`}>{t.t('common.next')}</Link></p>}
    </section>
  );
}
