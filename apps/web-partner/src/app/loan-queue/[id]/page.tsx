// apps/web-partner/src/app/loan-queue/[id]/page.tsx · application detail + lender decision. Server-gated; the API
// scopes the read to this partner (404 if not theirs → notFound). Decisions are Server Actions (./actions.ts)
// hitting the real endpoints: review → under_review, approve (amount + cooling-off), reject (note), disburse
// (Idempotency-Key, Law 3). The API/state-machine is the authority — it rejects illegal transitions and re-enforces
// partner RBAC; this UI only offers the actions legal for the current status (pure lending gates). Money is
// bigint-minor (formatMoneyMinor display; approve input → paise via BigInt in the action). All copy via i18n; no
// inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import {
  canReview, canApprove, canReject, canDisburse, isTerminal, statusKey, statusTone, isAppStatus,
  type AppStatus, type AppDetail,
} from '../../../features/lending/application';
import { reviewAction, approveAction, rejectAction, disburseAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('loan.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['review', 'approve', 'reject', 'disburse']);
const ERR = new Set(['badAmount', 'reason', 'illegal', 'forbidden', 'notFound', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function LoanApplicationPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let a: AppDetail | undefined;
  let notice: string | undefined;
  try {
    a = (await partnerClient().request<AppDetail>('GET', `fintech/loan-applications/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!a) {
    return <section><p className="kv-backlink"><Link href="/loan-queue">{t.t('loan.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const status = (isAppStatus(a.status) ? a.status : 'draft') as AppStatus;
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/loan-queue">{t.t('loan.back')}</Link></p>
      <h1>{t.t('loan.detailTitle')} {a.id.slice(0, 8)}…</h1>
      <p><span className={`kv-status kv-status--${statusTone(a.status)}`}>{t.t(statusKey(a.status))}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`loan.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`loan.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('loan.requested')} value={formatMoneyMinor(a.amountRequestedMinor, 'INR', 'en')} />
        <Field label={t.t('loan.approvedAmount')} value={a.amountApprovedMinor ? formatMoneyMinor(a.amountApprovedMinor, 'INR', 'en') : t.t('common.dash')} />
        <Field label={t.t('loan.purpose')} value={a.purposeText ?? t.t('common.dash')} />
        <Field label={t.t('loan.collateral')} value={a.nwrId ?? t.t('common.dash')} />
        <Field label={t.t('loan.applied')} value={a.createdAt ? formatDate(a.createdAt, 'en') : t.t('common.dash')} />
        {a.decisionAt && <Field label={t.t('loan.decided')} value={formatDate(a.decisionAt, 'en')} />}
        {a.coolingOffUntil && <Field label={t.t('loan.coolingOff')} value={formatDate(a.coolingOffUntil, 'en')} />}
        {a.decisionNote && <Field label={t.t('loan.decisionNote')} value={a.decisionNote} />}
      </dl>

      {canReview(status) && (
        <form action={reviewAction} className="kv-inline-form">
          <input type="hidden" name="id" value={a.id} />
          <button className="kv-btn" type="submit">{t.t('loan.beginReview')}</button>
        </form>
      )}

      {(canApprove(status) || canReject(status)) && (
        <div className="kv-card-grid">
          <form action={approveAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('loan.approveHeading')}</h2>
            <input type="hidden" name="id" value={a.id} />
            <label htmlFor="rupees" className="kv-field__label">{t.t('loan.approveAmount')}</label>
            <input id="rupees" className="kv-input" name="rupees" inputMode="numeric" required />
            <label htmlFor="coolingOffHours" className="kv-field__label">{t.t('loan.approveCooling')}</label>
            <input id="coolingOffHours" className="kv-input" name="coolingOffHours" inputMode="numeric" defaultValue="24" />
            <button className="kv-btn" type="submit">{t.t('loan.approveSubmit')}</button>
          </form>
          <form action={rejectAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('loan.rejectHeading')}</h2>
            <input type="hidden" name="id" value={a.id} />
            <label htmlFor="note" className="kv-field__label">{t.t('loan.rejectReason')}</label>
            <textarea id="note" className="kv-input" name="note" rows={3} maxLength={500} />
            <button className="kv-btn kv-btn--danger" type="submit">{t.t('loan.rejectSubmit')}</button>
          </form>
        </div>
      )}

      {canDisburse(status) && (
        <form action={disburseAction} className="kv-form">
          <input type="hidden" name="id" value={a.id} />
          <button className="kv-btn" type="submit">{t.t('loan.disburseSubmit')}</button>
          <p className="kv-field__hint">{t.t('loan.disburseHint')}</p>
        </form>
      )}

      {isTerminal(status) && <p className="kv-muted">{t.t('loan.terminal')}</p>}
    </section>
  );
}
