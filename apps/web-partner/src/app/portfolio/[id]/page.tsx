// apps/web-partner/src/app/portfolio/[id]/page.tsx · disbursed-loan detail (GET fintech/loans/:id; 404 → notFound)
// + repayment schedule (GET :id/repayments; degrades independently). Read-only. Money via formatMoneyMinor + the
// pure BigInt repaid/balance helpers (Law 2, float-free); APR from integer bps; overdue flagged by date-string
// compare. Degrade-never-die. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import { formatAprBps } from '../../../features/lending/product';
import {
  loanStatusKey, loanStatusTone, repaidMinor, repaymentBalanceMinor, isRepaymentSettled, isRepaymentOverdue,
  type LoanRow, type RepaymentRow,
} from '../../../features/lending/loan';
import { DataTable, Column } from '../../../components/DataTable';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('pf.detailTitle'), robots: { index: false, follow: false } };
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function LoanDetailPage({ params }: { params: { id: string } }) {
  await requirePartner();
  const t = getTranslator();
  const today = new Date().toISOString().slice(0, 10);

  let loan: LoanRow | undefined;
  let notice: string | undefined;
  try {
    loan = (await partnerClient().request<LoanRow>('GET', `fintech/loans/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!loan) {
    return <section><p className="kv-backlink"><Link href="/portfolio">{t.t('pf.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  let repayments: RepaymentRow[] = [];
  try { repayments = (await partnerClient().request<RepaymentRow[]>('GET', `fintech/loans/${params.id}/repayments`)).data ?? []; } catch { /* degrade: schedule unavailable */ }

  const repaymentStatus = (r: RepaymentRow) => {
    if (isRepaymentSettled(r.amountDueMinor, r.amountPaidMinor, r.paidAt)) return { key: 'repay.settled', tone: 'ok' as const };
    if (isRepaymentOverdue(r, today)) return { key: 'repay.overdue', tone: 'danger' as const };
    return { key: 'repay.pending', tone: 'muted' as const };
  };
  const cols: Column<RepaymentRow>[] = [
    { header: t.t('repay.colDue'), cell: (r) => (r.dueDate ? formatDate(r.dueDate, 'en') : t.t('common.dash')) },
    { header: t.t('repay.colAmount'), cell: (r) => formatMoneyMinor(r.amountDueMinor, 'INR', 'en') },
    { header: t.t('repay.colPaid'), cell: (r) => formatMoneyMinor(r.amountPaidMinor, 'INR', 'en') },
    { header: t.t('repay.colBalance'), cell: (r) => formatMoneyMinor(repaymentBalanceMinor(r.amountDueMinor, r.amountPaidMinor), 'INR', 'en') },
    { header: t.t('repay.colStatus'), cell: (r) => { const s = repaymentStatus(r); return <span className={`kv-status kv-status--${s.tone}`}>{t.t(s.key)}</span>; } },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/portfolio">{t.t('pf.back')}</Link></p>
      <h1>{t.t('pf.detailTitle')} {loan.id.slice(0, 8)}…</h1>
      <p><span className={`kv-status kv-status--${loanStatusTone(loan.status)}`}>{t.t(loanStatusKey(loan.status))}</span></p>

      <dl className="kv-facts">
        <Field label={t.t('pf.principal')} value={formatMoneyMinor(loan.principalMinor, 'INR', 'en')} />
        <Field label={t.t('pf.outstanding')} value={formatMoneyMinor(loan.outstandingMinor, 'INR', 'en')} />
        <Field label={t.t('pf.repaid')} value={formatMoneyMinor(repaidMinor(loan.principalMinor, loan.outstandingMinor), 'INR', 'en')} />
        <Field label={t.t('pf.apr')} value={formatAprBps(loan.interestAprBps) ?? t.t('common.dash')} />
        <Field label={t.t('pf.disbursed')} value={loan.disbursedAt ? formatDate(loan.disbursedAt, 'en') : t.t('common.dash')} />
        <Field label={t.t('pf.maturity')} value={loan.maturityDate ? formatDate(loan.maturityDate, 'en') : t.t('common.dash')} />
        <Field label={t.t('pf.nextDue')} value={loan.nextDueDate ? formatDate(loan.nextDueDate, 'en') : t.t('common.dash')} />
        <Field label={t.t('pf.application')} value={<Link href={`/loan-queue/${encodeURIComponent(loan.applicationId)}`}>{loan.applicationId.slice(0, 8)}…</Link>} />
      </dl>

      <h2>{t.t('pf.scheduleHeading')}</h2>
      <DataTable columns={cols} rows={repayments} empty={t.t('repay.empty')} />
    </section>
  );
}
