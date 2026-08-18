// apps/web-admin/src/app/support/replies/stuck/page.tsx · REPLIES THAT NEVER ARRIVED (PC-56 ADMIN-2d).
//
// WHY THIS PAGE EXISTS AT ALL. The reply rail is asynchronous by design — admin-api records the intent, apps/api delivers
// it — and the honest consequence of that design is a class of failure nobody would otherwise see: an operator writes an
// answer, walks away, and the delivery refuses. On the ticket they would see it; nobody re-opens a ticket they consider
// answered.
//
// So this is the queue's own conscience. It lists ONLY rows that will not arrive without a human: `refused` (terminal by
// nature) and `failed` (the executor gave up after its bounded retries). A `queued` row is WAITING, not stuck, and
// including it would make this page cry wolf every minute until people stopped opening it — which would defeat the
// purpose more thoroughly than not building it.
//
// An empty list is stated as a positive fact rather than rendered as blank space, because "no undelivered replies" and
// "this page is broken" must not look the same.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { stateTone, stateKey, type ReplyRow } from '../../../../features/support/reply';

import { EmptyState, StatusPill } from '@krishalaya/ui';
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('prep.stuckTitle'), robots: { index: false, follow: false } };
}

export default async function StuckRepliesPage() {
  requireAdmin();
  const t = getTranslator();

  let rows: ReplyRow[] = []; let notice: string | undefined;
  try {
    const res = await adminGet<{ items: ReplyRow[] }>('support/replies/stuck');
    rows = res.data?.items ?? [];
  } catch (e) { notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`); }

  return (
    <section>
      <p className="kv-backlink"><Link href="/support">{t.t('support.back')}</Link></p>
      <h1>{t.t('prep.stuckTitle')}</h1>
      <p className="kv-muted">{t.t('prep.stuckLead')}</p>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : rows.length === 0 ? (
        // a positive statement: an empty list here is good news and must not look like a broken page
        <EmptyState title={t.t('prep.stuckNone')} />
      ) : (
        <table className="kv-table">
          <thead><tr>
            <th scope="col">{t.t('prep.ticket')}</th>
            <th scope="col">{t.t('prep.tenant')}</th>
            <th scope="col">{t.t('prep.state')}</th>
            <th scope="col">{t.t('prep.reason')}</th>
            <th scope="col">{t.t('prep.attempts')}</th>
            <th scope="col">{t.t('prep.when')}</th>
            <th scope="col">{t.t('prep.author')}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.ticketId
                    ? <Link href={`/support/tickets/${encodeURIComponent(r.ticketId)}`}>{r.ticketNo ?? r.ticketId.slice(0, 8)}</Link>
                    : (r.ticketNo ?? t.t('common.dash'))}
                </td>
                <td>{r.tenantSlug ?? t.t('common.dash')}</td>
                <td><StatusPill tone={stateTone(r.status)} label={t.t(`prep.state.${stateKey(r.status)}`)} /></td>
                {/* the reason is the whole value of this page — never a blank cell */}
                <td>{r.detail ?? <span className="kv-detail__muted">{t.t('common.dash')}</span>}</td>
                <td>{String(r.attempts ?? 0)}</td>
                <td>{r.queuedAt}</td>
                <td><code>{String(r.authorAdminId ?? '').slice(0, 8) || t.t('common.dash')}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="kv-field__hint">{t.t('prep.smsNote')}</p>
    </section>
  );
}
