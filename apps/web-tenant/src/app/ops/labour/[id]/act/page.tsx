// apps/web-tenant/src/app/ops/labour/[id]/act/page.tsx · THE JOB MUTATE CHAIN — W2654 / W2661 confirm → W2655 / W2662 success →
// W2656 / W2663 failure · PC-56 TENANT-11b.
//
// The acts: "Confirm roster" (A3 — the wages + fee are set aside, the employer always co-confirms: the desk records the
// employer's consent here), start, complete, "pay" (A2 / A4 — the pay run over confirmed attendance; it had NO confirm step
// before this wave), "confirm a day" (the employer's dual-confirm that unlocks that day's wage) and "assign a worker". "Retry"
// on W2661–W2663 is a page load (`retryIsMutation`). "Broadcast to crews" is refused by name (no crew object). Each act is
// confirmed against the job AS IT STANDS and offered only when the API's `viewerCan` says so; the server re-decides.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { LabourAssignment, LabourBooking, WorkerCard } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { AUDIT_ACTION, CONSENT_CHANNELS, LABOUR_HREF, codeKey, consentRefusal, consoleState, isAct, isUuid, isYmd, jobHref, statusKey } from '../../../../../features/labour/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { jobActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('lab.actTitle'), robots: { index: false, follow: false } };
}
const MONEY_ACTS = new Set(['confirmRoster', 'pay', 'assign', 'confirmDay']);

export default async function JobActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${LABOUR_HREF}/${encodeURIComponent(params.id)}/act`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m ?? '0', 'INR', lang);
  const day = (ymd: string) => formatDate(`${ymd}T00:00:00+05:30`, lang, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const act = isAct(searchParams.act) ? searchParams.act : 'start';
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const consent = { consentChannel: searchParams.consentChannel ?? '', consentMediaId: (searchParams.consentMediaId ?? '').trim(), consentNote: (searchParams.consentNote ?? '').trim().slice(0, 500) };
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const short = /^\d+$/.test(searchParams.short ?? '') ? searchParams.short! : null;
  const assignmentId = isUuid(searchParams.assignmentId) ? searchParams.assignmentId : null;
  const workDate = isYmd(searchParams.workDate) ? searchParams.workDate : null;
  const workerId = isUuid(searchParams.workerId) ? searchParams.workerId : null;
  const back = jobHref(params.id);
  const carry = { act, ...(assignmentId ? { assignmentId } : {}), ...(workDate ? { workDate } : {}), ...(workerId ? { workerId } : {}) };
  if (!env.featureLabour) {
    return <section><h1>{t.t('lab.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('lab.state.flaggedOff.title')}</strong><p>{t.t('lab.state.flaggedOff.body')}</p></div></section>;
  }

  let b: LabourBooking | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  let roster: LabourAssignment[] = []; let worker: WorkerCard | null = null;
  if (!state && step === 'confirm') {
    try { b = await tenantClient().labour.getBooking(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true, err?.details); }
    if (b && (act === 'confirmRoster' || act === 'pay')) { try { roster = (await tenantClient().labour.bookingAssignments(params.id, { limit: 100 })).items; } catch { roster = []; } }
    if (b && act === 'assign' && workerId) { try { worker = await tenantClient().labour.getWorker(workerId); } catch { worker = null; } }
  }
  const vc = b?.viewerCan ?? null;
  const offered = !!vc && (act === 'assign' ? vc.assign && !!workerId : act === 'confirmRoster' ? vc.confirmRoster : act === 'start' ? vc.start : act === 'complete' ? vc.complete
    : act === 'pay' ? vc.pay : vc.confirmAttendance && !!assignmentId && !!workDate);
  const needsConsent = (act === 'confirmRoster' || act === 'assign') && !!vc?.needsConsent;
  const consentProblem = needsConsent ? consentRefusal(consent) : null;
  const reasonOk = reason === '' || rs === 'ok';
  const canGo = offered && reasonOk && !consentProblem;
  // The escrow the roster confirm will set aside: the ACCEPTED workers' planned wages + the fee (the API's own figures).
  const acceptedRows = roster.filter((a) => a.status === 'accepted');
  const wages = acceptedRows.reduce((s, a) => s + BigInt(a.plannedMinor && /^\d+$/.test(a.plannedMinor) ? a.plannedMinor : '0'), 0n);
  const fee = b?.costPreview?.platformFeeMinor && /^\d+$/.test(b.costPreview.platformFeeMinor) ? BigInt(b.costPreview.platformFeeMinor) : 0n;
  const auditEntity = act === 'confirmDay' ? null : { type: 'labour_booking', id: params.id };

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('lab.breadcrumb')}><Link href={LABOUR_HREF}>{t.t('lab.breadcrumb.labour')}</Link> / <Link href={back}>{b?.bookingNo ?? t.t('lab.detail.title')}</Link> / <span aria-current="page">{t.t(`lab.act.${act}`)}</span></nav>
      <h1>{t.t(`lab.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t(MONEY_ACTS.has(act) ? 'lab.chain.job' : 'lab.chain.labourAct')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`lab.detail.state.${state}.title`)}</strong><p>{t.t(`lab.detail.state.${state}.body`)}</p></div>}
          {b && (
            <>
              <div className="kv-card">
                <p><strong>{b.bookingNo}</strong> · {b.taskName ?? t.t('lab.taskUnnamed')} · {b.employerName ?? t.t('lab.employerUnnamed')} · {t.t(statusKey(b.status))}</p>
                {act === 'confirmRoster' && (
                  <>
                    <p>{t.t('lab.act.rosterFacts', { workers: String(acceptedRows.length), wages: money(wages.toString()), fee: money(fee.toString()), total: money((wages + fee).toString()) })}</p>
                    <p className="kv-field__hint">{t.t('lab.act.rosterPending', { n: String(roster.filter((a) => a.status === 'pending_worker' || a.status === 'applied').length) })}</p>
                  </>
                )}
                {act === 'pay' && <p>{t.t('lab.act.payFacts', { held: money(b.escrow?.heldMinor ?? '0'), days: String(roster.reduce((s, a) => s + (a.confirmedDays ?? 0) - (a.paidDays ?? 0), 0)) })}</p>}
                {act === 'pay' && b.status === 'completed' && <p className="kv-field__hint">{t.t('lab.act.payReleases')}</p>}
                {act === 'confirmDay' && workDate && <p>{t.t('lab.act.dayFacts', { date: day(workDate) })}</p>}
                {act === 'assign' && <p>{worker ? t.t('lab.act.assignFacts', { worker: worker.displayName ?? t.t('lab.assign.anon', { ref: worker.id.slice(0, 6).toUpperCase() }), wage: money(b.wageOfferedMinor) }) : t.t('lab.act.assignNoWorker')}</p>}
                {act === 'assign' && b.womenOnly && <p className="kv-field__hint">{t.t('lab.act.womenOnlyCheck')}</p>}
                <p>{t.t(`lab.act.rule.${act}`)}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!offered && <div className="kv-error" role="alert"><p>{t.t(`lab.act.notOffered.${act}`)}</p></div>}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                {Object.entries(carry).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                {act !== 'confirmDay' && act !== 'assign' && (
                  <label className="kv-field" htmlFor="j-reason"><span>{t.t('lab.act.reason')}</span>
                    <textarea id="j-reason" name="reason" className="kv-textarea" rows={2} defaultValue={reason} maxLength={MAX_REASON} /></label>
                )}
                {reason !== '' && reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                {needsConsent && (
                  <fieldset className="kv-fieldset">
                    <legend>{t.t('lab.consent.legend')}</legend>
                    <label className="kv-field" htmlFor="j-cc"><span>{t.t('lab.field.consentChannel')}</span>
                      <select id="j-cc" name="consentChannel" className="kv-select" defaultValue={consent.consentChannel}>
                        <option value="">{t.t('lab.form.choose')}</option>
                        {CONSENT_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`lab.consent.${c}`)}</option>)}
                      </select></label>
                    <label className="kv-field" htmlFor="j-cm"><span>{t.t('lab.field.consentMediaId')}</span>
                      <input id="j-cm" name="consentMediaId" className="kv-input" maxLength={36} defaultValue={consent.consentMediaId} />
                      <span className="kv-field__hint">{t.t('lab.consent.evidenceHint')}</span></label>
                    <label className="kv-field" htmlFor="j-cn"><span>{t.t('lab.consent.note')}</span>
                      <input id="j-cn" name="consentNote" className="kv-input" maxLength={500} defaultValue={consent.consentNote} /></label>
                    {consentProblem && <p className="kv-field__hint">{t.t(codeKey(consentProblem))}</p>}
                    <p className="kv-field__hint">{t.t('lab.consent.employerCoConfirms')}</p>
                  </fieldset>
                )}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {canGo ? (
                <form action={jobActAction} className="kv-actions">
                  <input type="hidden" name="id" value={params.id} />
                  {Object.entries(carry).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
                  {reason && <input type="hidden" name="reason" value={reason} />}
                  {needsConsent && <><input type="hidden" name="consentChannel" value={consent.consentChannel} /><input type="hidden" name="consentMediaId" value={consent.consentMediaId} /><input type="hidden" name="consentNote" value={consent.consentNote} /></>}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={back} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={back} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
              <p className="kv-field__hint">{t.t(`lab.act.foot.${act}`)}</p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`lab.act.done.${act}`)}</p>{MONEY_ACTS.has(act) && <p className="kv-field__hint">{t.t('lab.act.zeroSum')}</p>}</div>
          {auditEntity && isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType={auditEntity.type} entityId={auditEntity.id} action={AUDIT_ACTION[act]} />}
          {act === 'confirmDay' && <p className="kv-field__hint">{t.t('lab.act.dayAudit')}</p>}
          <p><Link href={back} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          {short && <p><strong>{t.t('lab.act.short', { amount: money(short) })}</strong></p>}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...carry }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={back} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
