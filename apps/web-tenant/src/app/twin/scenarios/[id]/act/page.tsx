// apps/web-tenant/src/app/twin/scenarios/[id]/act/page.tsx · THE SCENARIO MUTATE CHAIN — W2804 confirm → W2805 success → W2806 failure ·
// PC-56 TENANT-12. The canon's dominant act here is "Run scenario"; Retry is a page load back to confirm (`retryIsMutation` false).
//
// RUN — the confirm states BEFORE anything is pressed that the gate will refuse it (no scenario model is registered under twin.scenario)
// and that confirming RECORDS the attempt (who, when, the fingerprint of the cited inputs) and computes nothing. The API answers
// 409 TWIN_NO_MODEL_REGISTERED; the failure screen says "No run happened — and why", and reads the recorded refusal back from the audit
// trail. There is no success screen a run can reach today, no band, no run hash, no model badge.
// ARCHIVE — a reason (3–300), final; success reads the audit entry back. Back links return to W421 (the originating screen — F-18).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { TwinActPreview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { MAX_REASON, mutateStep, mutateStepKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { SCENARIOS_HREF, actBase, isAct, isUuid, refusalKey, resultsHref, scenarioHref, statusKey, twinState } from '../../../../../features/twin/twin';
import { scenarioActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('twin.act.title'), robots: { index: false, follow: false } };
}

export default async function ScenarioActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = actBase(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const act = isAct(searchParams.act) ? searchParams.act : 'run';
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const rid = isUuid(searchParams.rid) ? searchParams.rid : null;
  const backTo = isUuid(params.id) ? scenarioHref(params.id) : SCENARIOS_HREF;

  let p: TwinActPreview | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { p = await tenantClient().twin.previewAct(params.id, act, reason || undefined); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status, true); }
  }
  const gateRefusal = failed.includes('TWIN_NO_MODEL_REGISTERED') || failed.includes('TWIN_NO_RUNNER');
  const reasonOk = act !== 'archive' || (p !== null && !p.refusals.some((r) => r.startsWith('REASON_')));

  return (
    <section>
      <nav aria-label={t.t('twin.breadcrumb.label')} className="kv-field__hint">{t.t('twin.breadcrumb.area')} › <Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('twin.scenarios.crumb')}</Link> › {t.t(`twin.act.${act}.title`)}</nav>
      <h1>{t.t(`twin.act.${act}.title`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('twin.chain.module')}</p>
      <p className="kv-field__hint"><Link href={backTo} className="kv-btn--link">{t.t('twin.chain.backToScenarios')}</Link></p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.title' : `twin.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.body' : `twin.state.${state}.body`)}</p></div>}

      {step === 'confirm' && p && (
        <div className="kv-card">
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('twin.act.scenario')}</dt><dd>{p.scenario.name}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('twin.scenarios.col.status')}</dt><dd>{t.t(statusKey(p.scenario.status))}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('twin.act.assumptions')}</dt><dd>{p.assumptions}</dd></div>
          </dl>
          {act === 'run' && p.gate && (
            <div className="kv-card kv-card--notice" role="note">
              <strong>{t.t('twin.act.run.gateTitle')}</strong>
              <p>{t.t(p.gate.code ? refusalKey(p.gate.code) : 'twin.refusal.unknown')}</p>
              <p className="kv-field__hint">{t.t('twin.act.run.records')}</p>
            </div>
          )}
          {p.refusals.filter((r) => !r.startsWith('REASON_')).map((r) => <p key={r} className="kv-error" role="alert">{t.t(refusalKey(r))}</p>)}
          {act === 'archive' && (
            <form action={base} method="get" className="kv-form">
              <input type="hidden" name="step" value="confirm" /><input type="hidden" name="act" value="archive" />
              <label className="kv-field" htmlFor="tw-reason"><span>{t.t('twin.act.archive.reason')}</span>
                <textarea id="tw-reason" name="reason" className="kv-textarea" rows={2} defaultValue={reason} maxLength={MAX_REASON} required /></label>
              {reason && p.refusals.filter((r) => r.startsWith('REASON_')).map((r) => <p key={r} className="kv-error">{t.t(refusalKey(r))}</p>)}
              <button type="submit" className="kv-btn--link">{t.t('twin.act.checkReason')}</button>
            </form>
          )}
          <p className="kv-field__hint">{t.t('twin.act.confirmNote')}</p>
          {p.allowed && reasonOk ? (
            <form action={scenarioActAction}>
              <input type="hidden" name="id" value={p.scenario.id} /><input type="hidden" name="act" value={act} />
              {act === 'archive' && <input type="hidden" name="reason" value={reason} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t(`twin.act.${act}.proceed`)}</button>{' '}
              <Link href={backTo} className="kv-btn--link">{t.t('twin.chain.cancel')}</Link>
            </form>
          ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
        </div>
      )}

      {step === 'success' && act === 'archive' && isUuid(params.id) && (
        <>
          <div className="kv-card kv-success" role="status"><strong>{t.t('twin.act.archive.done')}</strong><p><Link href={backTo} className="kv-btn kv-btn--primary">{t.t('twin.chain.backToScenarios')}</Link></p></div>
          <AuditEntryCard t={t} lang={lang} entityType="twin_scenario" entityId={params.id} action="twin.scenario.archived" />
        </>
      )}
      {step === 'success' && act === 'run' && (
        <div className="kv-error" role="alert"><strong>{t.t('twin.act.run.noSuccess')}</strong><p><Link href={backTo} className="kv-btn--link">{t.t('twin.chain.backToScenarios')}</Link></p></div>
      )}

      {step === 'failure' && (
        <>
          <div className="kv-error" role="alert">
            <strong>{t.t(gateRefusal ? 'twin.act.run.refusedTitle' : 'twin.chain.failedTitle')}</strong>
            <ul className="kv-list">{(failed.length ? failed : ['unknown']).map((c) => <li key={c}>{t.t(refusalKey(c))}</li>)}</ul>
            <p>{t.t(gateRefusal ? 'twin.act.run.recorded' : 'twin.chain.untouched')}</p>
            {!gateRefusal && <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>}
            <p>
              <Link href={`${base}?step=confirm&act=${act}`} className="kv-btn--link">{t.t('twin.chain.retry')}</Link>{' · '}
              <Link href={backTo} className="kv-btn--link">{t.t('twin.chain.backToScenarios')}</Link>
              {gateRefusal && isUuid(params.id) && <>{' · '}<Link href={resultsHref(params.id)} className="kv-btn--link">{t.t('twin.scenarios.results')}</Link></>}
            </p>
          </div>
          {gateRefusal && rid && <AuditEntryCard t={t} lang={lang} entityType="twin_run" entityId={rid} action="twin.run.refused" />}
        </>
      )}
    </section>
  );
}
