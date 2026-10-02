// apps/web-tenant/src/app/marketplace/auctions/[id]/decline/page.tsx · THE SELLER-DECISION FORM CHAIN — W2341 form-error ·
// W2342 review · W2343 success · W2344 failure · PC-56 TENANT-11a.
//
// The canon's acts on this chain: "Record decline (reason to bidders)" and "Record seller decision". The APPROVE side of the
// seller's decision is the mutate chain (it creates an order and is idempotent — W2345); THIS chain records a DECLINE:
// edit (the reason — sent to every bidder — and, when the desk records it, the seller's consent) → review (everything shown
// read-only, with what declining will do: every EMD back, the listing on sale again, the order NOT created, and the value
// the seller is leaving on the table — the server's own figure) → success (the audit entry) | failure. Values in the URL.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuctionDetail } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref } from '../../../../../features/forms/chain';
import { MAX_REASON, MIN_REASON, reasonState, reasonStateKey } from '../../../../../features/mutate/chain';
import { AUCTIONS_HREF, CONSENT_CHANNELS, codeKey, consentRefusal, consoleState, isUuid, qtyText, settleHref, statusKey } from '../../../../../features/auctions/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { declineAuctionAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auc.decline.title'), robots: { index: false, follow: false } };
}

export default async function AuctionDeclinePage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${AUCTIONS_HREF}/${encodeURIComponent(params.id)}/decline`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const step = chainStep(searchParams.step);
  const values: Record<string, string> = {};
  for (const k of ['reason', 'consentChannel', 'consentMediaId', 'consentNote']) { const v = (searchParams[k] ?? '').trim(); if (v) values[k] = v.slice(0, k === 'reason' ? MAX_REASON + 50 : 500); }
  const rs = reasonState(values.reason);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const back = `${base}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;
  if (!env.featureAuctions) {
    return <section><h1>{t.t('auc.decline.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('auc.state.flaggedOff.title')}</strong><p>{t.t('auc.state.flaggedOff.body')}</p></div></section>;
  }

  let a: AuctionDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && (step === 'edit' || step === 'review')) {
    try { a = await tenantClient().auctions.get(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true, err?.details); }
  }
  const offered = !!a && a.status === 'awaiting_approval' && !!a.viewerCan?.decide;
  const needsConsent = !!a?.viewerCan?.decideNeedsConsent;
  const consentProblem = needsConsent ? consentRefusal(values) : null;
  const problems = [...(rs === 'ok' ? [] : ['REASON_REQUIRED']), ...(consentProblem ? [consentProblem] : [])];

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('auc.breadcrumb')}><Link href={AUCTIONS_HREF}>{t.t('auc.breadcrumb.auctions')}</Link> / <span aria-current="page">{t.t('auc.decline.title')}</span></nav>
      <h1>{t.t('auc.decline.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && problems.length > 0))} · {t.t('auc.chain.auction')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`auc.live.state.${state}.title`)}</strong><p>{t.t(`auc.live.state.${state}.body`)}</p></div>}
      {a && (step === 'edit' || step === 'review') && (
        <div className="kv-card">
          <p><strong>{a.auctionNo}</strong> · {t.t('auc.lot', { title: a.listingTitle ?? t.t('auc.listingGone'), qty: qtyText(a.quantity), unit: a.unitCode ?? '' })} · {t.t(statusKey(a.status))}</p>
          {a.decisionDueAt && <p className="kv-field__hint">{t.t('auc.settle.decideBy', { at: when(a.decisionDueAt) })}</p>}
          <p>{t.t('auc.settle.declineBody', { value: a.settlementPreview ? money(a.settlementPreview.orderValueMinor) : t.t('auc.live.kpi.emdPrivate') })}</p>
          {!offered && <p className="kv-error" role="alert">{t.t('auc.act.notOffered.decline')}</p>}
        </div>
      )}

      {step === 'edit' && a && offered && (
        <form action={base} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="d-reason"><span>{t.t('auc.act.reasonToBidders')}</span>
            <textarea id="d-reason" name="reason" className="kv-textarea" rows={3} defaultValue={values.reason ?? ''} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
          {needsConsent && (
            <fieldset className="kv-fieldset">
              <legend>{t.t('auc.consent.legend')}</legend>
              <label className="kv-field" htmlFor="d-cc"><span>{t.t('auc.field.consentChannel')}</span>
                <select id="d-cc" name="consentChannel" className="kv-select" defaultValue={values.consentChannel ?? ''}>
                  <option value="">{t.t('auc.consent.choose')}</option>
                  {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`auc.consent.${c}`)}</option>)}
                </select></label>
              <label className="kv-field" htmlFor="d-cm"><span>{t.t('auc.field.consentMediaId')}</span>
                <input id="d-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={values.consentMediaId ?? ''} />
                <span className="kv-field__hint">{t.t('auc.consent.evidenceHint')}</span></label>
              <label className="kv-field" htmlFor="d-cn"><span>{t.t('auc.consent.note')}</span>
                <input id="d-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={values.consentNote ?? ''} /></label>
              <p className="kv-field__hint">{t.t('auc.consent.staffNever')}</p>
            </fieldset>
          )}
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && a && (
        <>
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              <tr><th scope="row">{t.t('auc.act.reasonToBidders')}</th><td>{values.reason ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                {rs !== 'ok' && reasonStateKey(rs) && <p className="kv-error" role="alert">{t.t(reasonStateKey(rs)!)}</p>}</td></tr>
              {needsConsent && <tr><th scope="row">{t.t('auc.field.consentChannel')}</th><td>{values.consentChannel ? t.t(`auc.consent.${values.consentChannel}`) : <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}
                {consentProblem && <p className="kv-error" role="alert">{t.t(codeKey(consentProblem))}</p>}</td></tr>}
              {needsConsent && <tr><th scope="row">{t.t('auc.field.consentMediaId')}</th><td>{values.consentMediaId ?? <span className="kv-field__hint">{t.t('form.nothingStored')}</span>}</td></tr>}
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p>
          <p className="kv-card kv-card--notice">{t.t('auc.decline.effects')}</p>
          {offered && problems.length === 0 ? (
            <form action={declineAuctionAction} className="kv-actions">
              <input type="hidden" name="id" value={params.id} />
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <button type="submit" className="kv-btn kv-btn--danger">{t.t('form.submit')}</button>{' '}
              <Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('auc.decline.done')}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="auction" entityId={params.id} action="auction.declined" />}
          <p><Link href={settleHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(base, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={settleHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
