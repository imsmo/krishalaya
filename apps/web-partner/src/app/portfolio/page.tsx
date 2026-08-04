// apps/web-partner/src/app/portfolio/page.tsx · the lender's disbursed-loan book (GET fintech/loans, box=all —
// RLS scopes it to this partner). Server-gated; status chips + keyset. Money via formatMoneyMinor (bigint minor
// units, Law 2). Degrade-never-die. All copy via i18n; status tone via the pure loan helper; no inline styles;
// noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePartner } from '../../lib/session';
import { partnerClient } from '../../lib/api-client';
import { DataTable, Column } from '../../components/DataTable';
import { getTranslator } from '../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { LOAN_STATUSES, loanStatusKey, loanStatusTone, buildLoanListQuery, portfolioHref, type LoanRow } from '../../features/lending/loan';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('pf.title'), robots: { index: false, follow: false } };
}

export default async function PortfolioPage({ searchParams }: { searchParams: { status?: string; cursor?: string } }) {
  await requirePartner();
  const t = getTranslator();
  const q = buildLoanListQuery(searchParams);

  let rows: LoanRow[] = [];
  let nextCursor: string | undefined;
  let notice: string | undefined;
  try {
    const res = await partnerClient().request<LoanRow[]>('GET', 'fintech/loans', { query: { box: q.box, status: q.status, cursor: q.cursor, limit: q.limit } });
    rows = res.data ?? [];
    nextCursor = (res.meta?.nextCursor as string | undefined) ?? undefined;
  } catch { notice = t.t('dash.unavailable'); }

  const columns: Column<LoanRow>[] = [
    { header: t.t('pf.colId'), cell: (r) => <Link href={`/portfolio/${r.id}`}>{r.id.slice(0, 8)}…</Link> },
    { header: t.t('pf.colPrincipal'), cell: (r) => formatMoneyMinor(r.principalMinor, 'INR', 'en') },
    { header: t.t('pf.colOutstanding'), cell: (r) => formatMoneyMinor(r.outstandingMinor, 'INR', 'en') },
    { header: t.t('pf.colStatus'), cell: (r) => <span className={`kv-status kv-status--${loanStatusTone(r.status)}`}>{t.t(loanStatusKey(r.status))}</span> },
    { header: t.t('pf.colNextDue'), cell: (r) => (r.nextDueDate ? formatDate(r.nextDueDate, 'en') : t.t('common.dash')) },
  ];

  return (
    <section>
      <h1>{t.t('pf.title')}</h1>
      <p className="kv-muted">{t.t('pf.lead')}</p>
      <nav className="kv-filters" aria-label={t.t('pf.colStatus')}>
        <Link href={portfolioHref()} className={`kv-chip${!q.status ? ' is-active' : ''}`} aria-current={!q.status ? 'true' : undefined}>{t.t('pf.filterAll')}</Link>
        {LOAN_STATUSES.map((s) => (
          <Link key={s} href={portfolioHref(s)} className={`kv-chip${q.status === s ? ' is-active' : ''}`} aria-current={q.status === s ? 'true' : undefined}>{t.t(loanStatusKey(s))}</Link>
        ))}
      </nav>
      {notice ? <p className="kv-error" role="alert">{notice}</p> : (
        <>
          <DataTable columns={columns} rows={rows} empty={t.t('pf.empty')} />
          {nextCursor && <p className="kv-pager"><Link className="kv-btn" href={portfolioHref(q.status, nextCursor)}>{t.t('common.nextPage')}</Link></p>}
        </>
      )}
    </section>
  );
}
