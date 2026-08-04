// apps/web-partner/src/app/insurance-claims/[id]/page.tsx · claim detail + INSURER decision actions (KV-BL-056,
// DEV-24; canon W255-264 — screen 291's status tracker + document/survey steps, screen 292's assessment record,
// screen 293's settlement math). Server-gated; the API scopes the read to this tenant (404 if not found ->
// notFound). Every action below is a Server Action (./actions.ts) hitting the real DEV-22/23 endpoints; the
// API/state-machine is the authority (it rejects illegal transitions and re-enforces `insurance.manage` RBAC) — this
// UI only offers the actions legal for the CURRENT status (pure gates from features/insurance/insurance.ts, mirrored
// byte-for-byte from the entity's own assertTransition calls). Money is bigint-minor (formatMoneyMinor display;
// the approved amount input -> paise via BigInt in the Server Action). All copy via i18n; no inline styles; noindex.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePartner } from '../../../lib/session';
import { partnerClient } from '../../../lib/api-client';
import { getTranslator } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import {
  canRequestDocuments, canScheduleSurvey, canRecordSurvey, canDecideAfterSurvey, canRejectEarly, canSettle, canClose,
  isClaimTerminal, claimStatusKey, claimStatusTone, isClaimStatus, type ClaimStatus, type ClaimDetail,
} from '../../../features/insurance/insurance';
import { requestDocumentsAction, scheduleSurveyAction, recordSurveyAction, decideAction, settleAction, closeAction } from '../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('claim.detailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['requestDocuments', 'scheduleSurvey', 'recordSurvey', 'decide', 'settle', 'close']);
const ERR = new Set(['badAmount', 'decision', 'note', 'surveyorUserId', 'damagePercent', 'notes', 'illegal', 'forbidden', 'notFound', 'generic']);

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="kv-facts__row"><dt>{label}</dt><dd>{value}</dd></div>;
}

export default async function InsuranceClaimPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requirePartner();
  const t = getTranslator();

  let c: ClaimDetail | undefined;
  let notice: string | undefined;
  try {
    c = (await partnerClient().request<ClaimDetail>('GET', `insurance/claims/${params.id}`)).data;
  } catch (e) {
    if (e instanceof SdkError && e.status === 404) notFound();
    notice = t.t('dash.unavailable');
  }

  if (!c) {
    return <section><p className="kv-backlink"><Link href="/insurance-claims">{t.t('claim.back')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const status = (isClaimStatus(c.status) ? c.status : 'intimated') as ClaimStatus;
  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const survey = c.surveyReport as { damagePercent?: number; notes?: string; surveyedAt?: string } | null;

  return (
    <section>
      <p className="kv-backlink"><Link href="/insurance-claims">{t.t('claim.back')}</Link></p>
      <h1>{t.t('claim.detailTitle')} {c.id.slice(0, 8)}…</h1>
      <p><span className={`kv-status kv-status--${claimStatusTone(c.status)}`}>{t.t(claimStatusKey(c.status))}</span></p>
      {okKey && <p className="kv-success" role="status">{t.t(`claim.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`claim.err.${errKey}`)}</p>}

      <dl className="kv-facts">
        <Field label={t.t('claim.policy')} value={<Link href={`/insurance-policies/${c.policyId}`}>{c.policyId.slice(0, 8)}…</Link>} />
        <Field label={t.t('claim.eventDate')} value={formatDate(c.eventDate, 'en')} />
        <Field label={t.t('claim.within72h')} value={t.t(c.intimatedWithin72h ? 'common.yes' : 'common.no')} />
        <Field label={t.t('claim.description')} value={c.description ?? t.t('common.dash')} />
        <Field label={t.t('claim.approvedAmount')} value={c.approvedMinor ? formatMoneyMinor(c.approvedMinor, 'INR', 'en') : t.t('common.dash')} />
        <Field label={t.t('claim.surveyor')} value={c.surveyorUserId ?? t.t('common.dash')} />
        {survey && (
          <Field
            label={t.t('claim.surveyReport')}
            value={`${t.t('claim.damagePercent')}: ${survey.damagePercent ?? t.t('common.dash')}%${survey.notes ? ` — ${survey.notes}` : ''}`}
          />
        )}
        <Field label={t.t('claim.created')} value={c.createdAt ? formatDate(c.createdAt, 'en') : t.t('common.dash')} />
        {c.closedAt && <Field label={t.t('claim.closedAt')} value={formatDate(c.closedAt, 'en')} />}
      </dl>

      <div className="kv-card-grid">
        {canRequestDocuments(status) && (
          <form action={requestDocumentsAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('claim.requestDocsHeading')}</h2>
            <input type="hidden" name="id" value={c.id} />
            <button className="kv-btn" type="submit">{t.t('claim.requestDocsSubmit')}</button>
          </form>
        )}

        {canScheduleSurvey(status) && (
          <form action={scheduleSurveyAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('claim.scheduleSurveyHeading')}</h2>
            <input type="hidden" name="id" value={c.id} />
            <label htmlFor="surveyorUserId" className="kv-field__label">{t.t('claim.surveyorUserId')}</label>
            <input id="surveyorUserId" className="kv-input" name="surveyorUserId" required />
            <button className="kv-btn" type="submit">{t.t('claim.scheduleSurveySubmit')}</button>
          </form>
        )}

        {canRecordSurvey(status) && (
          <form action={recordSurveyAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('claim.recordSurveyHeading')}</h2>
            <input type="hidden" name="id" value={c.id} />
            <label htmlFor="damagePercent" className="kv-field__label">{t.t('claim.damagePercent')}</label>
            <input id="damagePercent" className="kv-input" name="damagePercent" inputMode="decimal" required />
            <label htmlFor="notes" className="kv-field__label">{t.t('claim.surveyNotes')}</label>
            <textarea id="notes" className="kv-input" name="notes" rows={3} maxLength={2000} />
            <button className="kv-btn" type="submit">{t.t('claim.recordSurveySubmit')}</button>
          </form>
        )}

        {canDecideAfterSurvey(status) && (
          <form action={decideAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('claim.decideApproveHeading')}</h2>
            <input type="hidden" name="id" value={c.id} />
            <label htmlFor="decision" className="kv-field__label">{t.t('claim.decision')}</label>
            <select id="decision" className="kv-input" name="decision" defaultValue="approved">
              <option value="approved">{t.t(claimStatusKey('approved'))}</option>
              <option value="partially_approved">{t.t(claimStatusKey('partially_approved'))}</option>
            </select>
            <label htmlFor="rupees" className="kv-field__label">{t.t('claim.approveAmount')}</label>
            <input id="rupees" className="kv-input" name="rupees" inputMode="numeric" required />
            <label htmlFor="note" className="kv-field__label">{t.t('claim.decisionNoteLabel')}</label>
            <textarea id="note" className="kv-input" name="note" rows={2} maxLength={2000} />
            <button className="kv-btn" type="submit">{t.t('claim.decideApproveSubmit')}</button>
          </form>
        )}

        {(canDecideAfterSurvey(status) || canRejectEarly(status)) && (
          <form action={decideAction} className="kv-card kv-form">
            <h2 className="kv-card__title">{t.t('claim.decideRejectHeading')}</h2>
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="decision" value="rejected" />
            <label htmlFor="rejectNote" className="kv-field__label">{t.t('claim.decisionNoteLabel')}</label>
            <textarea id="rejectNote" className="kv-input" name="note" rows={2} maxLength={2000} />
            <button className="kv-btn kv-btn--danger" type="submit">{t.t('claim.decideRejectSubmit')}</button>
          </form>
        )}

        {canSettle(status) && (
          <form action={settleAction} className="kv-form">
            <input type="hidden" name="id" value={c.id} />
            <button className="kv-btn" type="submit">{t.t('claim.settleSubmit')}</button>
            <p className="kv-field__hint">{t.t('claim.settleHint')}</p>
          </form>
        )}

        {canClose(status) && (
          <form action={closeAction} className="kv-form">
            <input type="hidden" name="id" value={c.id} />
            <button className="kv-btn kv-btn--muted" type="submit">{t.t('claim.closeSubmit')}</button>
          </form>
        )}
      </div>

      {isClaimTerminal(status) && <p className="kv-muted">{t.t('claim.terminal')}</p>}
    </section>
  );
}
