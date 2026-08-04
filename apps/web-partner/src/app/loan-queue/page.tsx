// apps/web-partner/src/app/loan-queue/page.tsx · the lender loan pipeline (fintech/loan-applications). Server-gated;
// keyset pagination (?cursor=). Box chips (review = decision queue [default] / all = everything routed here) +
// status chips drive the API's box/status filter; the API scopes the list to this partner — RLS + partner RBAC mean
// you can never page into another lender's book. Money rendered from bigint-minor strings (Law 2). A failed call
// degrades to a notice, never a 500. All copy via i18n; status chip tone + filters via the pure lending helper; no
// inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import {
  APP_STATUSES, statusKey, statusTone, buildListQuery, queueHref, boxKey, LENDER_BOXES, type AppRow,
} from '../../features/lending/application';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('loan.queueTitle'), robots: { index: false, follow: false } };
}

export default async function LoanQueuePage({ searchParams }: { searchParams: { box?: string; status?: string; cursor?: string } }) {
  await requirePartner();
  const t = getTranslator();
  const q = buildListQuery(searchParams);

  let rows: AppRow[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await partnerClient().request<AppRow[]>('GET', 'fintech/loan-applications', { query: { box: q.box, status: q.status, cursor: q.cursor, limit: q.limit } });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch { notice = t.t('dash.unavailable'); }

  const columns: Column<AppRow>[] = [
    { header: t.t('loan.colApp'), cell: (r) => <Link href={`/loan-queue/${r.id}`}>{r.id.slice(0, 8)}…</Link> },
    { header: t.t('loan.colRequested'), cell: (r) => formatMoneyMinor(r.amountRequestedMinor, 'INR', 'en') },
    { header: t.t('loan.colPurpose'), cell: (r) => r.purposeText ?? t.t('common.dash') },
    { header: t.t('loan.colStatus'), cell: (r) => <span className={`kv-status kv-status--${statusTone(r.status)}`}>{t.t(statusKey(r.status))}</span> },
    { header: t.t('loan.colApplied'), cell: (r) => (r.createdAt ? formatDate(r.createdAt, 'en') : t.t('common.dash')) },
  ];

  return (
    <section>
      <h1>{t.t('loan.queueTitle')}</h1>
      <p className="kv-muted">{t.t('loan.queueLead')}</p>

      <nav className="kv-filters" aria-label={t.t('loan.filterBox')}>
        {LENDER_BOXES.map((b) => (
          <Link key={b} href={queueHref(b, q.status)} className={`kv-chip${q.box === b ? ' is-active' : ''}`} aria-current={q.box === b ? 'true' : undefined}>{t.t(boxKey(b))}</Link>
        ))}
      </nav>
      <nav className="kv-filters" aria-label={t.t('loan.filterStatus')}>
        <Link href={queueHref(q.box)} className={`kv-chip${!q.status ? ' is-active' : ''}`} aria-current={!q.status ? 'true' : undefined}>{t.t('loan.filterAll')}</Link>
        {APP_STATUSES.map((s) => (
          <Link key={s} href={queueHref(q.box, s)} className={`kv-chip${q.status === s ? ' is-active' : ''}`} aria-current={q.status === s ? 'true' : undefined}>{t.t(statusKey(s))}</Link>
        ))}
      </nav>

      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('loan.empty')} />
          {nextCursor && (
            <p className="kv-pager">
              <Link className="kv-btn" href={queueHref(q.box, q.status, nextCursor)}>{t.t('common.nextPage')}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
