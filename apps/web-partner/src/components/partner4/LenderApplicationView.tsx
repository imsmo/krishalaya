// apps/web-partner/src/components/partner4/LenderApplicationView.tsx · PC-56 PARTNER-4a · W207 ONE LOAN APPLICATION — THE DECISION IS REAL,
// THE CREDIT SCORE IS REFUSED BY NAME (founder 4a-2 / 4a-3 / 4a-4 / 4a-6), presentational.
//
// What `GET /v1/partner/applications/:id` answered: the product, the purpose CATEGORY, the amounts, the status, the timestamps, and the
// applicant's own words plus a MASKED phone ONLY once approved (0225's definer decides, not this view). Never an applicant id or name.
//
// The three halves of the canon screen, as they are built:
//   1. THE DECISION — REAL. Approve and Reject are server actions over the partner decision routes, each carrying an Idempotency-Key the PAGE
//      minted at render (a hidden field: a double submit replays one key, never two). A maker reviews; a checker decides; the API's state
//      machine, the cooling-off window and `approved ≤ requested` are the authority. Disbursal has no button and never will: a sentence says
//      the cooperative is the lender of record and disburses from its own console.
//   2. THE CONSENT BLOCK — kept almost verbatim, because it is the WALL in the designer's own words: the oracle requires a live consent from
//      this applicant, to THIS lender, for THIS application, and when it lapses the page genuinely goes dark. What is added is the truth
//      founder 4a-3 asked for: nothing in the product writes that consent row, so the page says no consent has been recorded for this
//      application YET rather than showing an empty panel as if it were news.
//   3. THE CREDIT-SCORE HALF — ONE refusal. No score, band, model version, factor, weight or "verified platform income" figure exists in any
//      table or line of code on this platform (founder 4a-4, refused by name in Phase 1).
// The terms are the PRODUCT's TODAY, in integer basis points, and the page says so — a filed application stores no rate (founder 4a-6).
import Link from 'next/link';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import type { PartnerApplication } from '@krishalaya/sdk-js';
import type { Tr } from '../NotYet';
import { LenderRefusals, LenderSwitchedOff } from './LenderChain';
import { canApprove, canReject, canReview, isAppStatus, isTerminal, statusKey, statusTone, type AppStatus } from '../../features/lending/application';
import { applicationRef, type LenderFailure } from '../../features/partner4/figures';

const OK = new Set(['review', 'approve', 'reject']);
const ERR = new Set(['badAmount', 'reason', 'illegal', 'forbidden', 'notFound', 'generic', 'permission']);

function Field({ id, label, value }: { id: string; label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row" data-kv-fact={id}><dt>{label}</dt><dd>{value}</dd></div>;
}

export function LenderApplicationView({ t, lang, a, failure, notFound, perms, idemKey, ok, error, actions }: {
  t: Tr; lang: string; a: PartnerApplication | null; failure: LenderFailure | null; notFound: boolean;
  perms: readonly string[]; idemKey: string; ok?: string; error?: string;
  actions: { review: (fd: FormData) => Promise<void>; approve: (fd: FormData) => Promise<void>; reject: (fd: FormData) => Promise<void> };
}) {
  if (failure === 'off') return <LenderSwitchedOff t={t} page="application" />;
  const back = <p className="kv-backlink"><Link href="/lender/queue" data-kv-back="/lender/queue">{t.t('partner4.application.back')}</Link></p>;
  if (notFound) {
    return (
      <section data-kv-lender="application" data-kv-state="not_found">
        {back}
        <h1>{t.t('partner4.application.notFound.title')}</h1>
        <p>{t.t('partner4.application.notFound.body')}</p>
        <p className="kv-statement" data-kv-statement="partner4.application.consentGate">{t.t('partner4.application.consentGate')}</p>
        <LenderRefusals t={t} surface="application" />
      </section>
    );
  }
  if (!a) {
    return (
      <section data-kv-lender="application" data-kv-state="error">
        {back}
        <div className="kv-card" role="alert">
          <h2 className="kv-card__title">{t.t('partner4.application.error.title')}</h2>
          <p>{t.t('partner4.application.error.body')}</p>
          <p className="kv-pager"><Link className="kv-btn" href="/lender/queue?act=confirm">{t.t('partner4.retry')}</Link></p>
        </div>
        <LenderRefusals t={t} surface="application" />
      </section>
    );
  }
  const money = (m: string) => formatMoneyMinor(m, 'INR', lang);
  const status = (isAppStatus(a.status) ? a.status : 'draft') as AppStatus;
  const okKey = ok && OK.has(ok) ? ok : null;
  const errKey = error && ERR.has(error) ? error : null;
  const may = (p: string) => perms.includes(p);
  const approved = !!a.purposeText;      // 0225's definer returns the words only once the application is approved
  return (
    <section data-kv-lender="application" data-kv-state="ok">
      {back}
      <h1>{t.t('partner4.application.title')} {applicationRef(a.applicantRef)}</h1>
      <p><span className={`kv-status kv-status--${statusTone(a.status)}`}>{t.t(statusKey(a.status))}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`partner4.application.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`partner4.application.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field id="product" label={t.t('partner4.application.product')} value={a.product.name} />
        <Field id="kind" label={t.t('partner4.application.kind')} value={a.purposeCategory ?? t.t('partner4.kind.notRecorded')} />
        <Field id="requested" label={t.t('partner4.application.requested')} value={money(a.amountRequestedMinor)} />
        <Field id="approved" label={t.t('partner4.application.approved')} value={a.amountApprovedMinor ? money(a.amountApprovedMinor) : t.t('common.dash')} />
        <Field id="purpose" label={t.t('partner4.application.purpose')} value={a.purposeText ?? t.t('partner4.application.purposeAfterApproval')} />
        <Field id="phone" label={t.t('partner4.application.contact')} value={a.applicantPhoneMasked ?? t.t('partner4.application.purposeAfterApproval')} />
        <Field id="applied" label={t.t('partner4.application.applied')} value={a.createdAt ? formatDate(a.createdAt, lang) : t.t('common.dash')} />
        {a.decisionAt && <Field id="decided" label={t.t('partner4.application.decided')} value={formatDate(a.decisionAt, lang)} />}
        {a.coolingOffUntil && <Field id="cooling" label={t.t('partner4.application.coolingOff')} value={formatDate(a.coolingOffUntil, lang)} />}
      </dl>
      <p className="kv-muted" data-kv-cooling-note="true">{t.t('partner4.application.coolingNote')}</p>
      <p className="kv-muted" data-kv-terms-note="true">{t.t('partner4.application.termsToday')}</p>

      {/* the consent block — the wall, in the designer's own words, plus the truth founder 4a-3 asked for */}
      <section className="kv-card" data-kv-consent="true" aria-labelledby="kv-consent-title">
        <h2 id="kv-consent-title" className="kv-card__title">{t.t('partner4.application.consentTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner4.application.consentNone">{t.t('partner4.application.consentNone')}</p>
        <p data-kv-consent-bound="true">{t.t('partner4.application.consentBound')}</p>
        <p data-kv-consent-gate="true">{t.t('partner4.application.consentGate')}</p>
        <p data-kv-consent-notshared="true">{t.t('partner4.application.consentNotShared')}</p>
      </section>

      {/* the credit-score half of the canon screen: ONE refusal, not a placeholder */}
      <section className="kv-card" data-kv-score="refused" aria-labelledby="kv-score-title">
        <h2 id="kv-score-title" className="kv-card__title">{t.t('partner4.application.scoreTitle')}</h2>
        <p className="kv-statement" data-kv-statement="partner4.refusal.creditScore">{t.t('partner4.refusal.creditScore')}</p>
      </section>

      {canReview(status) && may('partner.applications.review') && (
        <form action={actions.review} className="kv-inline-form" data-kv-act="review">
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="idempotencyKey" value={`${idemKey}-review`} />
          <button className="kv-btn" type="submit">{t.t('partner4.application.beginReview')}</button>
        </form>
      )}

      {(canApprove(status) || canReject(status)) && may('partner.applications.decide') && (
        <div className="kv-card-grid">
          <form action={actions.approve} className="kv-card kv-form" data-kv-act="approve">
            <h2 className="kv-card__title">{t.t('partner4.application.approveHeading')}</h2>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="idempotencyKey" value={`${idemKey}-approve`} />
            <label htmlFor="rupees" className="kv-field__label">{t.t('partner4.application.approveAmount')}</label>
            <input id="rupees" className="kv-input" name="rupees" inputMode="numeric" required />
            <label htmlFor="coolingOffHours" className="kv-field__label">{t.t('partner4.application.approveCooling')}</label>
            <input id="coolingOffHours" className="kv-input" name="coolingOffHours" inputMode="numeric" defaultValue="24" />
            <button className="kv-btn" type="submit">{t.t('partner4.application.approveSubmit')}</button>
          </form>
          <form action={actions.reject} className="kv-card kv-form" data-kv-act="reject">
            <h2 className="kv-card__title">{t.t('partner4.application.rejectHeading')}</h2>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="idempotencyKey" value={`${idemKey}-reject`} />
            <label htmlFor="note" className="kv-field__label">{t.t('partner4.application.rejectReason')}</label>
            <textarea id="note" className="kv-input" name="note" rows={3} maxLength={500} />
            <p className="kv-field__hint" data-kv-note-optional="true">{t.t('partner4.application.rejectReasonOptional')}</p>
            <button className="kv-btn kv-btn--danger" type="submit">{t.t('partner4.application.rejectSubmit')}</button>
          </form>
        </div>
      )}

      {status === 'approved' && <p className="kv-statement" role="note" data-kv-statement="partner4.application.disburseStatement">{t.t('partner4.application.disburseStatement')}</p>}
      {isTerminal(status) && <p className="kv-muted" data-kv-terminal="true">{t.t('partner4.application.terminal')}</p>}
      {!approved && <p className="kv-muted" data-kv-after-approval="true">{t.t('partner4.application.afterApproval')}</p>}
      <LenderRefusals t={t} surface="application" />
    </section>
  );
}
