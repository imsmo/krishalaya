// apps/web-tenant/src/app/marketplace/auctions/[id]/act/page.tsx · THE AUCTION MUTATE CHAIN — W2345 / W2352 confirm → W2346 /
// W2353 success → W2347 / W2354 failure · PC-56 TENANT-11a.
//
// The canon's acts on these chains: "Approve — create order" (W139), "Cancel auction" (W138's emergency stop), "Pause entry
// (new bidders)" (W138), and "Retry" — a PAGE LOAD (refused by name: `retryIsMutation`). Each is confirmed against the
// auction AS IT STANDS (GET /auctions/:id) and offered only when the API's `viewerCan` says so; the server re-decides on the
// act (the confirm step is not an authorisation token).
//   • approve — the seller, or the desk WITH the seller's recorded consent for this decision (channel + evidence); the
//     IDEMPOTENCY KEY is minted here, so a double click creates one order (W139 "idempotent (double-click safe)");
//   • cancel — a REASON (3–300 characters), recorded word for word and sent to every bidder; every EMD comes back;
//   • pause / resume — tenant_admin, a reason; existing bidders continue, new bidders are refused.
// The success screen shows the audit entry the act wrote, read back from the trail.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AuctionDetail } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { AUCTIONS_HREF, CONSENT_CHANNELS, codeKey, consentRefusal, consoleState, isAct, isUuid, liveHref, monitorActs, qtyText, settleHref, statusKey } from '../../../../../features/auctions/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { auctionActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('auc.actTitle'), robots: { index: false, follow: false } };
}
const AUDIT_ACTION = { approve: 'auction.approved', cancel: 'auction.cancelled', pause: 'auction.entry_paused', resume: 'auction.entry_resumed' } as const;

export default async function AuctionActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${AUCTIONS_HREF}/${encodeURIComponent(params.id)}/act`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const act = isAct(searchParams.act) ? searchParams.act : 'cancel';
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const consent = { consentChannel: searchParams.consentChannel ?? '', consentMediaId: (searchParams.consentMediaId ?? '').trim(), consentNote: (searchParams.consentNote ?? '').trim().slice(0, 500) };
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const backTo = act === 'approve' ? settleHref(params.id) : liveHref(params.id);
  if (!env.featureAuctions) {
    return <section><h1>{t.t('auc.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('auc.state.flaggedOff.title')}</strong><p>{t.t('auc.state.flaggedOff.body')}</p></div></section>;
  }

  let a: AuctionDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { a = await tenantClient().auctions.get(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true, err?.details); }
  }
  const offered = a ? (act === 'approve' ? a.status === 'awaiting_approval' && !!a.viewerCan?.decide : monitorActs(a.status, a.viewerCan, !!a.entryPaused).includes(act)) : false;
  const needsConsent = act === 'approve' && !!a?.viewerCan?.decideNeedsConsent;
  const needsReason = act !== 'approve';
  const consentProblem = needsConsent ? consentRefusal(consent) : null;
  const canGo = offered && (!needsReason || rs === 'ok') && !consentProblem;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('auc.breadcrumb')}><Link href={AUCTIONS_HREF}>{t.t('auc.breadcrumb.auctions')}</Link> / <span aria-current="page">{t.t(`auc.act.${act}`)}</span></nav>
      <h1>{t.t(`auc.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('auc.chain.auction')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`auc.live.state.${state}.title`)}</strong><p>{t.t(`auc.live.state.${state}.body`)}</p></div>}
          {a && (
            <>
              <div className="kv-card">
                <p><strong>{a.auctionNo}</strong> · {t.t('auc.lot', { title: a.listingTitle ?? t.t('auc.listingGone'), qty: qtyText(a.quantity), unit: a.unitCode ?? '' })} · {t.t(statusKey(a.status))}</p>
                {act === 'approve' && a.settlementPreview && (
                  <p>{t.t('auc.act.approveFacts', { value: money(a.settlementPreview.orderValueMinor), emd: money(a.settlementPreview.emdAppliedMinor), balance: money(a.settlementPreview.balanceDueMinor) })}</p>
                )}
                {act === 'approve' && a.decisionDueAt && <p className="kv-field__hint">{t.t('auc.settle.decideBy', { at: when(a.decisionDueAt) })}</p>}
                {act === 'cancel' && <p>{t.t('auc.act.cancelFacts', { n: String(a.bidderCount ?? 0) })}</p>}
                <p>{t.t(`auc.act.rule.${act}`)}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!offered && <div className="kv-error" role="alert"><p>{t.t(`auc.act.notOffered.${act}`)}</p></div>}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                {needsReason && (
                  <label className="kv-field" htmlFor="a-reason"><span>{t.t(act === 'cancel' ? 'auc.act.reasonToBidders' : 'auc.act.reason')}</span>
                    <textarea id="a-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
                )}
                {needsReason && reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                {needsConsent && (
                  <fieldset className="kv-fieldset">
                    <legend>{t.t('auc.consent.legend')}</legend>
                    <label className="kv-field" htmlFor="a-cc"><span>{t.t('auc.field.consentChannel')}</span>
                      <select id="a-cc" name="consentChannel" className="kv-select" defaultValue={consent.consentChannel}>
                        <option value="">{t.t('auc.consent.choose')}</option>
                        {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`auc.consent.${c}`)}</option>)}
                      </select></label>
                    <label className="kv-field" htmlFor="a-cm"><span>{t.t('auc.field.consentMediaId')}</span>
                      <input id="a-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={consent.consentMediaId} />
                      <span className="kv-field__hint">{t.t('auc.consent.evidenceHint')}</span></label>
                    <label className="kv-field" htmlFor="a-cn"><span>{t.t('auc.consent.note')}</span>
                      <input id="a-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={consent.consentNote} /></label>
                    {consentProblem && <p className="kv-field__hint">{t.t(codeKey(consentProblem))}</p>}
                    <p className="kv-field__hint">{t.t('auc.consent.staffNever')}</p>
                  </fieldset>
                )}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {canGo ? (
                <form action={auctionActAction} className="kv-actions">
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="act" value={act} />
                  {needsReason && <input type="hidden" name="reason" value={reason} />}
                  {needsConsent && <><input type="hidden" name="consentChannel" value={consent.consentChannel} /><input type="hidden" name="consentMediaId" value={consent.consentMediaId} /><input type="hidden" name="consentNote" value={consent.consentNote} /></>}
                  {act === 'approve' && <input type="hidden" name="idempotencyKey" value={randomUUID()} />}
                  <button type="submit" className={act === 'cancel' ? 'kv-btn kv-btn--danger' : 'kv-btn kv-btn--primary'}>{t.t('mutate.confirm')}</button>{' '}
                  <Link href={backTo} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={backTo} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
              <p className="kv-field__hint">{t.t(`auc.act.foot.${act}`)}</p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`auc.act.done.${act}`)}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="auction" entityId={params.id} action={AUDIT_ACTION[act]} />}
          <p><Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=${act}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
