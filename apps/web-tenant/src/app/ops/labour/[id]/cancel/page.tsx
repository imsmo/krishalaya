// apps/web-tenant/src/app/ops/labour/[id]/cancel/page.tsx · THE CANCEL-JOB FORM CHAIN — W2650 form-error · W2651 review ·
// W2652 success · W2653 failure · PC-56 TENANT-11b.
//
// Canon W164: "Cancel job · Reason * (Rain forecast — rescheduling · Work no longer needed · Filled offline) · Cancel (workers
// notified with reason) · This action is recorded · same-day cancels pay a fairness fee to accepted workers". The reason is the
// API's lookup (the canon's three + `other`, which needs the employer's words); the workers are told it; any escrow comes back
// and the ₹20 PLATFORM FEE IS KEPT (said here, before the act). The same-day fairness fee is REFUSED BY NAME: the founder has
// not set its rule, so a same-day cancel pays no fairness fee today. The desk cancelling FOR an employer records the
// employer's consent. edit → review → success | failure, values in the URL.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { LabourBooking, LabourLookups } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../../features/forms/chain';
import { CANCEL_KEYS, CONSENT_CHANNELS, LABOUR_HREF, cancelHref, carried, codeKey, consoleState, fieldKey, isUuid, jobHref, reviewCancel, statusKey } from '../../../../../features/labour/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { cancelJobAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lab.cancel.title'), robots: { index: false, follow: false } };
}

export default async function CancelJobPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const base = cancelHref(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(CANCEL_KEYS, (k) => searchParams[k]);
  const v = (k: string) => values[k] ?? '';
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const back = `${base}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;
  if (!env.featureLabour) {
    return <section><h1>{t.t('lab.cancel.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  }

  let b: LabourBooking | null = null; let lookups: LabourLookups | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && (step === 'edit' || step === 'review')) {
    try { [b, lookups] = await Promise.all([tenantClient().labour.getBooking(params.id), tenantClient().labour.lookups()]); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true, err?.details); }
  }
  const reasons = lookups?.cancelReasons ?? [];
  const needsConsent = !!b?.viewerCan?.needsConsent;
  const refusals = step === 'review' ? reviewCancel(values, reasons, needsConsent, values) : [];
  const offered = !!b?.viewerCan?.cancel;
  const held = b?.escrow?.status === 'held' ? b.escrow.heldMinor : '0';
  const reasonWords = (code: string) => reasons.find((r) => r.code === code)?.name ?? code;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}><Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <Link href={jobHref(params.id)}>{b?.bookingNo ?? t.t('lab.detail.title')}</Link> / <span aria-current="page">{t.t('lab.cancel.title')}</span></nav>
      <h1>{t.t('lab.cancel.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && refusals.length > 0))} · {t.t('lab.chain.job')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`lab.detail.state.${state}.title`)}</strong><p>{t.t(`lab.detail.state.${state}.body`)}</p></div>}
      {b && !offered && (step === 'edit' || step === 'review') && <div className="kv-error" role="alert"><p>{t.t('lab.cancel.notOffered', { status: t.t(statusKey(b.status)) })}</p></div>}

      {step === 'edit' && b && offered && (
        <form action={base} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <fieldset className="kv-fieldset">
            <legend>{t.t(fieldKey('reasonCode'))}</legend>
            {reasons.map((r) => (
              <label key={r.code} className="kv-field" htmlFor={`c-${r.code}`}><input id={`c-${r.code}`} type="radio" name="reasonCode" value={r.code} defaultChecked={v('reasonCode') === r.code} required /> <span>{r.name}</span></label>
            ))}
          </fieldset>
          <label className="kv-field" htmlFor="c-text"><span>{t.t(fieldKey('reasonText'))}</span>
            <textarea id="c-text" name="reasonText" className="kv-textarea" rows={2} maxLength={300} defaultValue={v('reasonText')} />
            <span className="kv-field__hint">{t.t('lab.cancel.textHint')}</span></label>
          {needsConsent && (
            <fieldset className="kv-fieldset">
              <legend>{t.t('lab.consent.legend')}</legend>
              <label className="kv-field" htmlFor="c-cc"><span>{t.t(fieldKey('consentChannel'))}</span>
                <select id="c-cc" name="consentChannel" className="kv-select" defaultValue={v('consentChannel')}>
                  <option value="">{t.t('lab.form.choose')}</option>
                  {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`lab.consent.${c}`)}</option>)}
                </select></label>
              <label className="kv-field" htmlFor="c-cm"><span>{t.t(fieldKey('consentMediaId'))}</span>
                <input id="c-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={v('consentMediaId')} /></label>
              <label className="kv-field" htmlFor="c-cn"><span>{t.t('lab.consent.note')}</span>
                <input id="c-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={v('consentNote')} /></label>
            </fieldset>
          )}
          <p className="kv-field__hint">{t.t('lab.cancel.effects', { held: money(held) })}</p>
          <p className="kv-field__hint">{t.t('lab.fairnessFee.refused')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && b && (
        <>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              {([['reasonCode', v('reasonCode') ? reasonWords(v('reasonCode')) : null], ['reasonText', v('reasonText') || null],
                ...(needsConsent ? [['consentChannel', v('consentChannel') ? t.t(`lab.consent.${v('consentChannel')}`) : null], ['consentMediaId', v('consentMediaId') || null]] : [])] as Array<[string, string | null]>).map(([name, shown]) => (
                <tr key={name}><th scope="row">{t.t(fieldKey(name))}</th>
                  <td>{shown ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                    {refusals.filter((r) => r.field === name).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(codeKey(r.code))}</p>)}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="kv-card">
            <p>{t.t('lab.cancel.reviewFacts', { no: b.bookingNo, held: money(held), fee: money(b.escrow?.feeMinor ?? '0') })}</p>
            <p className="kv-field__hint">{t.t('lab.cancel.workersTold')}</p>
            <p className="kv-field__hint">{t.t('lab.fairnessFee.refused')}</p>
          </div>
          {refusals.length === 0 && offered ? (
            <form action={cancelJobAction} className="kv-actions">
              <input type="hidden" name="id" value={params.id} />
              <input type="hidden" name="needsConsent" value={needsConsent ? '1' : '0'} />
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('lab.cancel.submit')}</button>{' '}
              <Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('lab.cancel.done')}</p><p className="kv-field__hint">{t.t('lab.cancel.doneFee')}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="labour_booking" entityId={params.id} action="labour.booking.cancelled" />}
          <p><Link href={jobHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(base, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={jobHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
