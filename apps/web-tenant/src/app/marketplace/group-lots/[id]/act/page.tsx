// apps/web-tenant/src/app/marketplace/group-lots/[id]/act/page.tsx · THE GROUP-LOT MUTATE CHAIN — W2633 confirm → W2634 success →
// W2635 failure · PC-56 TENANT-11c.
//
// The canon's sharing actions on this chain are "Extend deadline (once)" and "Nudge non-pledgers"; "Retry" is a PAGE LOAD back
// to confirm (`retryIsMutation` = false). The coordinator options (ready · list at the pledged quantity · cancel with a reason),
// the member's withdrawal, and the settlement's three acts (prepare · confirm · refuse) are confirmed here too, each against the
// lot AS IT STANDS (GET /group-lots/:id) and offered only when the API's `viewerCan` says so; the server re-decides on the act
// (the confirm step is not an authorisation token).
//   • list and confirm mint their IDEMPOTENCY KEY on this page (a double click lists once / pays once);
//   • extend and refuse need a reason; ready needs one below the target; the others take an optional one — recorded word for word
//     on the audit row, which the success screen reads back;
//   • confirm names who prepared the settlement: the preparer and the coordinator cannot confirm (the DB refuses them as well).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { GroupLotCancelReason, GroupLotDetail } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, failureKey, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import {
  AUDIT_ACTION, GROUP_LOTS_HREF, actBase, bpsPct, codeKey, consoleState, isAct, isUuid, isoToLocal, lotHref, offered, progressPct, qtyText, reasonRule, reviewAct, statusKey,
} from '../../../../../features/group-lots/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { groupLotActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('gl.actTitle'), robots: { index: false, follow: false } };
}

export default async function GroupLotActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = actBase(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const n = (v: number) => formatNumber(v, lang);
  const when = (iso: string) => formatDate(iso, lang, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  const act = isAct(searchParams.act) ? searchParams.act : 'nudge';
  const step = mutateStep(searchParams.step);
  const e = {
    reason: (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50), price: (searchParams.price ?? '').trim().slice(0, 20), deadline: (searchParams.deadline ?? '').trim().slice(0, 20),
    reasonCode: (searchParams.reasonCode ?? '').trim().slice(0, 40), reasonText: (searchParams.reasonText ?? '').trim().slice(0, MAX_REASON + 50),
  };
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const backTo = lotHref(params.id);
  if (!env.featureGroupLots) {
    return <section><h1>{t.t('gl.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('gl.state.flaggedOff.title')}</strong><p>{t.t('gl.state.flaggedOff.body')}</p></div></section>;
  }

  let lot: GroupLotDetail | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  let reasons: GroupLotCancelReason[] = [];
  if (!state && step === 'confirm') {
    try { lot = await tenantClient().groupLots.get(params.id); }
    catch (err) { const se = err instanceof SdkError ? err : null; state = consoleState(se?.code, se?.status, true, se?.details); }
    if (act === 'cancel') { try { reasons = (await tenantClient().groupLots.lookups()).cancelReasons; } catch { reasons = []; } }
  }
  const below = lot ? lot.progressBps < 10000 : false;
  const textRequired = (code: string) => !!reasons.find((r) => r.code === code)?.textRequired;
  const isOffered = lot ? offered(act, lot.viewerCan as unknown as Record<string, unknown>) : false;
  const touched = Object.values(e).some((x) => x.length > 0) || searchParams.check === '1';
  const problems = lot ? reviewAct(act, e, { belowTarget: below, textRequired }) : [];
  const canGo = isOffered && problems.length === 0 && (touched || reasonRule(act, below) === 'optional');
  const unit = lot?.unitCode ?? '';
  const q = (x: string | null | undefined) => `${qtyText(x)} ${unit}`;
  const maxDeadline = lot ? isoToLocal(new Date(new Date(lot.pledgeDeadline).getTime() + 48 * 3600_000).toISOString()) : '';

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('gl.breadcrumb')}><Link href={GROUP_LOTS_HREF}>{t.t('gl.breadcrumb.groupLots')}</Link> / <Link href={backTo}>{lot?.lotNo ?? t.t('gl.detailTitle')}</Link> / <span aria-current="page">{t.t(`gl.act.${act}`)}</span></nav>
      <h1>{t.t(`gl.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('gl.chain.mutate')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`gl.detailState.${state}.title`)}</strong><p>{t.t(`gl.detailState.${state}.body`)}</p></div>}
          {lot && (
            <>
              <div className="kv-card">
                <p><strong>{lot.lotNo}</strong> · {lot.productName ?? t.t('gl.productUnknown')} · {t.t(statusKey(lot.status))} · {t.t('gl.pledgedOfTarget', { pledged: qtyText(lot.pledgedQuantity), target: qtyText(lot.targetQuantity), unit, pct: progressPct(lot.progressBps) })}</p>
                {act === 'extend' && <p>{t.t('gl.actFacts.extend', { now: when(lot.pledgeDeadline), max: when(new Date(new Date(lot.pledgeDeadline).getTime() + 48 * 3600_000).toISOString()), n: n(lot.memberCount ?? 0) })}</p>}
                {act === 'nudge' && <p>{t.t('gl.actFacts.nudge')} {t.t('gl.nudge.voiceRefused')}</p>}
                {act === 'ready' && <p>{t.t(below ? 'gl.actFacts.readyBelow' : 'gl.actFacts.ready', { qty: q(lot.pledgedQuantity), target: q(lot.targetQuantity) })}</p>}
                {act === 'list' && <p>{t.t('gl.actFacts.list', { qty: q(lot.pledgedQuantity), coordinator: lot.coordinatorShortName ?? t.t('gl.nameNotRecorded') })}</p>}
                {act === 'cancel' && <p>{t.t('gl.actFacts.cancel', { n: n(lot.memberCount ?? 0) })}{lot.status === 'listed' && <> {t.t('gl.actFacts.cancelListed')}</>}</p>}
                {act === 'withdraw' && lot.myPledge && <p>{t.t('gl.actFacts.withdraw', { qty: q(lot.myPledge.quantity) })}</p>}
                {act === 'prepare' && <p>{t.t('gl.actFacts.prepare', { gross: money(lot.grossProceedsMinor), pct: bpsPct(lot.coordinationFeeBps), n: n(lot.memberCount ?? 0) })}</p>}
                {(act === 'confirm' || act === 'refuse') && lot.settlement && (
                  <>
                    <p>{t.t('gl.actFacts.settlement', { gross: money(lot.settlement.grossMinor), fee: money(lot.settlement.feeMinor), net: money(lot.settlement.netMinor), at: when(lot.settlement.preparedAt) })}</p>
                    <ul>{lot.settlement.lines.map((l) => <li key={l.pledgeId}>{l.memberShortName ?? t.t('gl.nameNotRecorded')} · {q(l.quantity)} · {money(l.shareMinor)}</li>)}</ul>
                    {act === 'confirm' && <p>{t.t('gl.actFacts.confirm')}</p>}
                    {lot.viewerCan.confirmBlocked && <p className="kv-error" role="alert">{t.t(`gl.settle.blocked.${lot.viewerCan.confirmBlocked}`)}</p>}
                  </>
                )}
                <p>{t.t(`gl.actRule.${act}`)}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!isOffered && <div className="kv-error" role="alert"><p>{t.t(`gl.notOffered.${act}`)}</p></div>}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                <input type="hidden" name="check" value="1" />
                {act === 'list' && (
                  <label className="kv-field" htmlFor="a-price"><span>{t.t('gl.field.pricePerUnit', { unit })}</span>
                    <input id="a-price" name="price" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={e.price} required />
                    <span className="kv-field__hint">{t.t('gl.form.priceHint')}</span></label>
                )}
                {act === 'extend' && (
                  <label className="kv-field" htmlFor="a-dl"><span>{t.t('gl.field.newDeadline')}</span>
                    <input id="a-dl" name="deadline" type="datetime-local" className="kv-input" defaultValue={e.deadline || maxDeadline} max={maxDeadline} required /></label>
                )}
                {act === 'cancel' && (
                  <>
                    <label className="kv-field" htmlFor="a-rc"><span>{t.t('gl.field.cancelReason')}</span>
                      <select id="a-rc" name="reasonCode" className="kv-select" defaultValue={e.reasonCode} required>
                        <option value="">{t.t('gl.consent.choose')}</option>
                        {reasons.map((r) => <option key={r.code} value={r.code}>{t.t(`gl.cancelReason.${r.code}`)}</option>)}
                      </select></label>
                    <label className="kv-field" htmlFor="a-rt"><span>{t.t('gl.field.cancelText')}</span>
                      <textarea id="a-rt" name="reasonText" className="kv-textarea" rows={2} maxLength={MAX_REASON} defaultValue={e.reasonText} />
                      <span className="kv-field__hint">{t.t('gl.form.cancelTextHint')}</span></label>
                  </>
                )}
                {act !== 'cancel' && (
                  <label className="kv-field" htmlFor="a-reason"><span>{t.t(reasonRule(act, below) === 'required' ? 'gl.field.reasonRequired' : 'gl.field.reasonOptional')}</span>
                    <textarea id="a-reason" name="reason" className="kv-textarea" rows={3} defaultValue={e.reason} maxLength={MAX_REASON} /></label>
                )}
                {touched && problems.map((p) => <p key={p} className="kv-field__hint">{t.t(codeKey(p))}</p>)}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {canGo ? (
                <form action={groupLotActAction} className="kv-actions">
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="act" value={act} />
                  {Object.entries(e).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                  {(act === 'list' || act === 'confirm') && <input type="hidden" name="idempotencyKey" value={randomUUID()} />}
                  <button type="submit" className={act === 'cancel' || act === 'refuse' ? 'kv-btn kv-btn--danger' : 'kv-btn kv-btn--primary'}>{t.t('mutate.confirm')}</button>{' '}
                  <Link href={backTo} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={backTo} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
              <p className="kv-field__hint">{t.t(`gl.actFoot.${act}`)}</p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t(`gl.done.${act}`)}</p>
            {act === 'nudge' && searchParams.sent && /^\d{1,6}$/.test(searchParams.sent) && <p>{t.t(searchParams.sent === '0' ? 'gl.done.nudgeNobody' : 'gl.done.nudgeSent', { n: n(Number(searchParams.sent)) })}</p>}
            {act === 'confirm' && searchParams.moved && /^\d{1,19}$/.test(searchParams.moved) && <p>{t.t(searchParams.moved === '0' ? 'gl.done.confirmNothing' : 'gl.done.confirmMoved', { amount: money(searchParams.moved) })}</p>}
          </div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="group_lot" entityId={params.id} action={AUDIT_ACTION[act]} />}
          <p><Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('gl.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=${act}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={backTo} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
