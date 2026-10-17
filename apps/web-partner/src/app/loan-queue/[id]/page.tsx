// apps/web-partner/src/app/loan-queue/[id]/page.tsx · PC-56 PARTNER-0 · founder D2 / D3 / D8 — one application, over the PARTNER read
// (`/v1/partner/applications/:id`: admitted only with the applicant's live consent to THIS partner for THIS application, else 404 →
// notFound). It prints what D2 allows: the product, the purpose CATEGORY, the amounts, the status, the timestamps, the organisation (FPO) —
// the applicant's own words and a MASKED phone only once approved; never an applicant id or name. The decisions are Server Actions over the
// partner decision routes, each with an Idempotency-Key MINTED HERE AT RENDER (a hidden field — a double submit replays the same key, F-12);
// the API's state machine and the person's role decide (a maker reviews, a checker approves / rejects). DISBURSAL IS REFUSED BY NAME: no
// button — a sentence saying the FPO, the lender of record, disburses from its own console. All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError, type PartnerApplication } from '@krishalaya/sdk-js';
import { canReview, canApprove, canReject, isTerminal, statusKey, statusTone, isAppStatus, type AppStatus } from '../../../features/lending/application';
import { reviewAction, approveAction, rejectAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('loan.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['review', 'approve', 'reject']);
const ERR = new Set(['badAmount', 'reason', 'illegal', 'forbidden', 'notFound', 'generic', 'permission']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function LoanApplicationPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  const persona = await requirePartner();
  const t = getTranslator(); const lang = getLang();

  let a: PartnerApplication | undefined;
  let notice: string | undefined;
  try {
    a = await partnerClient().partner.applications.get(params.id);
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
  const may = (p: string) => persona.perms.includes(p);   // persona only — the API decides
  const key = randomUUID();   // ONE key per rendered form set (F-12)

  return (
    <section>
      <p className="kv-backlink"><Link href="/loan-queue">{t.t('loan.back')}</Link></p>
      <h1>{t.t('loan.detailTitle')} {a.applicantRef.slice(0, 8)}…</h1>
      <p><span className={`kv-status kv-status--${statusTone(a.status)}`}>{t.t(statusKey(a.status))}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`loan.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(errKey === 'permission' ? 'partner.loan.err.permission' : `loan.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('partner.loan.product')} value={a.product.name} />
        <Field label={t.t('partner.loan.category')} value={a.purposeCategory ?? t.t('common.dash')} />
        <Field label={t.t('loan.requested')} value={formatMoneyMinor(a.amountRequestedMinor, 'INR', lang)} />
        <Field label={t.t('loan.approvedAmount')} value={a.amountApprovedMinor ? formatMoneyMinor(a.amountApprovedMinor, 'INR', lang) : t.t('common.dash')} />
        <Field label={t.t('loan.purpose')} value={a.purposeText ?? t.t('partner.loan.purposeAfterApproval')} />
        <Field label={t.t('partner.loan.phone')} value={a.applicantPhoneMasked ?? t.t('partner.loan.purposeAfterApproval')} />
        <Field label={t.t('loan.applied')} value={a.createdAt ? formatDate(a.createdAt, lang) : t.t('common.dash')} />
        {a.decisionAt && <Field label={t.t('loan.decided')} value={formatDate(a.decisionAt, lang)} />}
        {a.coolingOffUntil && <Field label={t.t('loan.coolingOff')} value={formatDate(a.coolingOffUntil, lang)} />}
      </dl>

      {canReview(status) && may('partner.applications.review') && (
        <form action={reviewAction} className="kv-inline-form">
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="idempotencyKey" value={`${key}-review`} />
          <button className="kv-btn" type="submit">{t.t('loan.beginReview')}</button>
        </form>
      )}

      {(canApprove(status) || canReject(status)) && may('partner.applications.decide') && (
        <div className="kv-card-grid">
          <form action={approveAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('loan.approveHeading')}</h2>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="idempotencyKey" value={`${key}-approve`} />
            <label htmlFor="rupees" className="kv-field__label">{t.t('loan.approveAmount')}</label>
            <input id="rupees" className="kv-input" name="rupees" inputMode="numeric" required />
            <label htmlFor="coolingOffHours" className="kv-field__label">{t.t('loan.approveCooling')}</label>
            <input id="coolingOffHours" className="kv-input" name="coolingOffHours" inputMode="numeric" defaultValue="24" />
            <button className="kv-btn" type="submit">{t.t('loan.approveSubmit')}</button>
          </form>
          <form action={rejectAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('loan.rejectHeading')}</h2>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="idempotencyKey" value={`${key}-reject`} />
            <label htmlFor="note" className="kv-field__label">{t.t('loan.rejectReason')}</label>
            <textarea id="note" className="kv-input" name="note" rows={3} maxLength={500} />
            <button className="kv-btn kv-btn--danger" type="submit">{t.t('loan.rejectSubmit')}</button>
          </form>
        </div>
      )}

      {status === 'approved' && <p className="kv-muted" role="note">{t.t('partner.loan.disburseRefused')}</p>}
      {isTerminal(status) && <p className="kv-muted">{t.t('loan.terminal')}</p>}
    </section>
  );
}
