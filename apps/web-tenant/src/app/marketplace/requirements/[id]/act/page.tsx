// apps/web-tenant/src/app/marketplace/requirements/[id]/act/page.tsx · THE REQUIREMENT MUTATE CHAIN — W2368 confirm → W2369 success →
// W2370 failure · PC-56 TENANT-11d.
//
// The canon's sharing actions on this chain are "Send quote (after member consent)" and "Retry". Retry is a PAGE LOAD back to
// confirm (`retryIsMutation` = false). The buyer's decisions (shortlist · accept, by quantity · reject · accept / decline a pooled
// quote), the close (a moderator's needs a reason) and the desk's withdraw / remove-a-line are confirmed here too, each against the
// requirement AS IT STANDS; the API re-decides on the act (the confirm step is not an authorisation token):
//   • send is refused by name while a member has not consented (CONSENT_MISSING names them); success says "sent as N linked
//     responses" and reads the audit entry back;
//   • a decision the DESK makes for the buyer needs the buyer's recorded consent for THAT act (channel + evidence) on this page;
//   • accept takes the quantity (all of the quote by default, or part of it) — the requirement fills by quantity.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { Requirement, RequirementResponse, ResponseGroup } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { MAX_REASON, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import {
  AUDIT, BUYER_DECISIONS, CONSENT_CHANNELS, REQUIREMENTS_HREF, actBase, codeKey, consoleState, isAct, isQty, isUuid, qtyMilli, qtyText, reasonRule, reqHref,
} from '../../../../../features/requirements/console';
import { requirementActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rq.actTitle'), robots: { index: false, follow: false } };
}

export default async function RequirementActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = actBase(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const act = isAct(searchParams.act) ? searchParams.act : 'send';
  const step = mutateStep(searchParams.step);
  const gid = isUuid(searchParams.gid) ? searchParams.gid : '';
  const rid = isUuid(searchParams.rid) ? searchParams.rid : '';
  const lid = isUuid(searchParams.lid) ? searchParams.lid : '';
  const e = {
    reason: (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50), quantity: (searchParams.quantity ?? '').trim().slice(0, 16),
    consentChannel: (searchParams.consentChannel ?? '').trim().slice(0, 10), consentMediaId: (searchParams.consentMediaId ?? '').trim().slice(0, 36),
  };
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const names = (searchParams.names ?? '').split('|').filter(Boolean).slice(0, 10);
  const backTo = reqHref(params.id, act === 'send' || act === 'withdraw' || act === 'removeLine' ? { respond: '1' } : {});

  let req: Requirement | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  let group: ResponseGroup | null = null; let resp: RequirementResponse | null = null;
  if (!state && step === 'confirm') {
    try {
      req = await tenantClient().requirements.get(params.id);
      if (gid) group = await tenantClient().requirements.group(params.id, gid);
      if (rid) resp = await tenantClient().responses.get(rid);
    } catch (err) { const se = err instanceof SdkError ? err : null; state = consoleState(se?.code, se?.status, true, se?.details); }
  }
  const viewer = req?.viewer ?? null;
  const onBehalf = BUYER_DECISIONS.includes(act) && !!viewer && !viewer.isBuyer;
  const rule = reasonRule(act, !!viewer && !viewer.isBuyer);
  const unit = req?.unitCode ?? '';
  const q = (x: string | null | undefined) => `${qtyText(x)} ${unit}`;
  const touched = Object.values(e).some((x) => x.length > 0) || searchParams.check === '1';
  const problems: string[] = [];
  if (rule === 'required' && e.reason.length < 3) problems.push('REASON_REQUIRED');
  if (act === 'accept' && e.quantity && (!isQty(e.quantity) || (resp && qtyMilli(e.quantity) > qtyMilli(resp.quantity)))) problems.push('QUANTITY_INVALID');
  if (onBehalf) {
    if (!(CONSENT_CHANNELS as readonly string[]).includes(e.consentChannel)) problems.push('CONSENT_CHANNEL_REQUIRED');
    else if (e.consentChannel !== 'otp' && !isUuid(e.consentMediaId)) problems.push('CONSENT_EVIDENCE_REQUIRED');
  }
  const targetOk = (act === 'send' || act === 'withdraw' || act === 'acceptGroup' || act === 'rejectGroup' || act === 'removeLine') ? !!group : (act === 'close' ? true : !!resp);
  const offered = !!req && targetOk && (act === 'close' ? !!viewer?.canClose : (BUYER_DECISIONS.includes(act) ? !!(viewer?.decidesAsBuyer || viewer?.decidesForBuyerWithConsent) : !!viewer?.canDesk));
  const consentBlocked = act === 'send' && !!group && group.consentMissing.length > 0;
  const canGo = offered && problems.length === 0 && (touched || (rule !== 'required' && !onBehalf)) && !consentBlocked;
  const line = group?.lines.find((l) => l.id === lid) ?? null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('rq.breadcrumb')}><Link href={REQUIREMENTS_HREF}>{t.t('rq.breadcrumb.requirements')}</Link> / <Link href={backTo}>{req?.reqNo ?? t.t('rq.detailTitle')}</Link> / <span aria-current="page">{t.t(`rq.act.${act}`)}</span></nav>
      <h1>{t.t(`rq.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('rq.chain.mutate')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`rq.detailState.${state}.title`)}</strong><p>{t.t(`rq.detailState.${state}.body`)}</p></div>}
          {req && (
            <>
              <div className="kv-card">
                <p><strong>{req.reqNo}</strong> · {req.title} · {t.t('rq.actFacts.requirement', { filled: q(req.fulfilledQuantity ?? '0'), asked: q(req.quantity), status: t.t(`rq.status.${req.status}`) })}</p>
                {group && (act === 'send' || act === 'acceptGroup' || act === 'rejectGroup' || act === 'withdraw') && (
                  <>
                    <ul>{group.lines.map((l) => <li key={l.id}>{l.sellerShortName ?? t.t('rq.nameNotRecorded')} · {q(l.quantity)} @ {money(l.priceMinor)} · {l.consent ? t.t('rq.consent.recorded') : <strong>{t.t('rq.consent.missing')}</strong>}</li>)}</ul>
                    <p>{t.t('rq.actFacts.group', { n: n(group.lineCount), qty: q(group.totalQuantity), blended: money(group.blendedPriceMinor), unit, rem: money(group.blendedRemainderMinor) })}</p>
                    {group.aboveCeiling && <p className="kv-field__hint">{t.t('rq.aboveCeiling')}</p>}
                  </>
                )}
                {act === 'removeLine' && line && <p>{t.t('rq.actFacts.removeLine', { member: line.sellerShortName ?? t.t('rq.nameNotRecorded'), qty: q(line.quantity) })}</p>}
                {resp && <p>{t.t('rq.actFacts.response', { seller: resp.sellerShortName ?? t.t('rq.nameNotRecorded'), qty: q(resp.quantity), price: money(resp.quotedPriceMinor), unit })}</p>}
                <p>{t.t(`rq.actRule.${act}`)}</p>
                {onBehalf && <p className="kv-card kv-card--notice">{t.t('rq.decideWithConsent')}</p>}
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {consentBlocked && group && (
                <div className="kv-error" role="alert"><strong>{t.t('rq.consentGate.title')}</strong><p>{t.t('rq.consentMissingNames', { names: group.consentMissing.map((m) => m.sellerShortName ?? t.t('rq.nameNotRecorded')).join(', ') })}</p></div>
              )}
              {!offered && <div className="kv-error" role="alert"><p>{t.t(`rq.notOffered.${BUYER_DECISIONS.includes(act) ? 'decision' : act === 'close' ? 'close' : 'desk'}`)}</p></div>}
              <form action={base} method="get" className="kv-card kv-form">
                {([['step', 'confirm'], ['act', act], ['check', '1'], ['gid', gid], ['rid', rid], ['lid', lid]] as const).filter(([, val]) => val).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                {act === 'accept' && resp && (
                  <label className="kv-field" htmlFor="a-qty"><span>{t.t('rq.field.acceptQuantity', { unit })}</span>
                    <input id="a-qty" name="quantity" className="kv-input" inputMode="decimal" maxLength={15} defaultValue={e.quantity || qtyText(resp.quantity)} />
                    <span className="kv-field__hint">{t.t('rq.accept.byQuantity', { max: q(resp.quantity) })}</span></label>
                )}
                {onBehalf && (
                  <>
                    <label className="kv-field" htmlFor="a-cc"><span>{t.t('rq.field.buyerConsentChannel')}</span>
                      <select id="a-cc" name="consentChannel" className="kv-select" defaultValue={e.consentChannel}>
                        <option value="">{t.t('rq.consent.choose')}</option>
                        {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`rq.consent.${c}`)}</option>)}
                      </select></label>
                    <label className="kv-field" htmlFor="a-cm"><span>{t.t('rq.field.consentMediaId')}</span>
                      <input id="a-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={e.consentMediaId} />
                      <span className="kv-field__hint">{t.t('rq.consent.evidenceHint')}</span></label>
                  </>
                )}
                {rule !== 'none' && (
                  <label className="kv-field" htmlFor="a-reason"><span>{t.t(rule === 'required' ? 'rq.field.reasonRequired' : 'rq.field.reasonOptional')}</span>
                    <textarea id="a-reason" name="reason" className="kv-textarea" rows={3} defaultValue={e.reason} maxLength={MAX_REASON} /></label>
                )}
                {touched && problems.map((p) => <p key={p} className="kv-field__hint">{t.t(codeKey(p))}</p>)}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {canGo ? (
                <form action={requirementActAction} className="kv-actions">
                  {([['id', params.id], ['act', act], ['gid', gid], ['rid', rid], ['lid', lid]] as const).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                  {Object.entries(e).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                  <button type="submit" className={act === 'reject' || act === 'rejectGroup' || act === 'close' || act === 'withdraw' || act === 'removeLine' ? 'kv-btn kv-btn--danger' : 'kv-btn kv-btn--primary'}>{t.t('mutate.confirm')}</button>{' '}
                  <Link href={backTo} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={backTo} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
              <p className="kv-field__hint">{t.t(`rq.actFoot.${act}`)}</p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t(`rq.done.${act}`)}</p>
            {act === 'send' && searchParams.sent && /^\d{1,3}$/.test(searchParams.sent) && <p>{t.t('rq.done.sentLinked', { n: n(Number(searchParams.sent)) })}</p>}
            {(act === 'accept' || act === 'acceptGroup') && searchParams.status && /^[a-z_]{3,20}$/.test(searchParams.status) && <p>{t.t('rq.done.requirementNow', { status: t.t(`rq.status.${searchParams.status}`) })}</p>}
          </div>
          {(() => {
            const entityId = AUDIT[act].entityType === 'requirement' ? params.id : AUDIT[act].entityType === 'requirement_response' ? rid : gid;
            return isUuid(entityId) ? <AuditEntryCard t={t} lang={lang} entityType={AUDIT[act].entityType} entityId={entityId} action={AUDIT[act].action} /> : null;
          })()}
          <p><Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('rq.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          {names.length > 0 && <p>{t.t('rq.consentMissingNames', { names: names.join(', ') })}</p>}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', act, ...(gid ? { gid } : {}), ...(rid ? { rid } : {}), ...(lid ? { lid } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
