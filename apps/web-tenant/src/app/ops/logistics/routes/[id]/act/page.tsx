// apps/web-tenant/src/app/ops/logistics/routes/[id]/act/page.tsx · W2818 confirm → W2819 success → W2820 failure (retry) — the Village
// Run acts · PC-56 TENANT-SW-e. "Confirm" is not offered to the person who drafted the run (and the database refuses them if they try);
// cancel and a drop point's deactivation need a reason (≥ 10). The audit entry is read back on success.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DropPointRow, RunDetail } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../../../features/mutate/chain';
import { failedCodes, isRouteAct, isUuid, routeHref, swePageState, sweCodeKey } from '../../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { routeActAction } from './actions';
import { SEEN_FIELD, seenToken, isStaleFailure, readDiff } from '../../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../../features/mutate/verify-fields';
import { StaleDiffChip } from '../../../../../../components/StaleDiffChip';
import { staleLabels } from '../../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.run.title'), robots: { index: false, follow: false } }; }
const AUDIT: Record<string, string> = { confirm: 'logistics.run_confirmed', start_loading: 'logistics.run_loading', depart: 'logistics.run_in_transit', complete: 'logistics.run_completed', cancel: 'logistics.run_cancelled', deactivate_drop_point: 'logistics.drop_point_deactivated' };

export default async function RouteActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const routeId = isUuid(params.id) ? params.id : '';
  const back = routeHref(params.id); const base = `${back}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const act = isRouteAct(searchParams.act) ? searchParams.act : 'confirm';
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, 500);
  const onDropPoint = act === 'deactivate_drop_point';
  let run: RunDetail | null = null; let dp: DropPointRow | null = null; let state: string | null = id && routeId ? null : 'notFound';
  if (id && routeId && step === 'confirm') {
    try {
      if (onDropPoint) { dp = (await tenantClient().villageRun.route(routeId)).dropPoints.find((x) => x.id === id) ?? null; if (!dp) state = 'notFound'; }
      else run = await tenantClient().villageRun.run(id);
    } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  const needsReason = act === 'cancel' || onDropPoint;
  const reasonOk = !needsReason || reason.length >= 10;
  const offered = onDropPoint ? !!dp?.active : !!run && run.acts.includes(act as RunDetail['acts'][number]);
  const carry: Record<string, string> = { act, ...(id ? { id } : {}) };
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.run.title')}><Link href={back}>{t.t('swe.run.title')}</Link> / <span aria-current="page">{t.t(`swe.run.act.${act}`)}</span></nav>
      <h1>{t.t(`swe.run.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p></div>
      ) : (
        <>
          <div className="kv-card">
            {run && <p><strong>{run.runDate}</strong> · {t.t(`swe.run.status.${run.status}`)} · {t.t('swe.run.form.summary', { date: run.runDate, n: String(run.parcels) })}</p>}
            {dp && <p><strong>{dp.sequence}. {dp.name}</strong> · {dp.keeper.name ?? ''}</p>}
            <p>{t.t(`swe.run.act.rule.${act}`)}</p><p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          </div>
          {!offered && <div className="kv-error" role="alert"><p>{t.t(run?.youDrafted && act === 'confirm' ? 'swe.run.needsSecond' : 'swe.run.act.notOffered')}</p></div>}
          {offered && (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <label className="kv-field" htmlFor="r-why"><span>{t.t(needsReason ? 'swe.reason' : 'swe.noteOptional')}</span>
                <textarea id="r-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={reason} /></label>
              {needsReason && reason !== '' && !reasonOk && <p className="kv-field__hint">{t.t('swe.reasonMin10')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && reasonOk ? (
            <form action={routeActAction} className="kv-actions">
              {/* PC-56 TENANT-SW-f · W318 §3: what this confirm step showed — re-read before the write (verify-before-write) */}
              <input type="hidden" name={SEEN_FIELD} value={seenToken((onDropPoint ? dp : run) as never, onDropPoint ? VERIFY_FIELDS.dropPoint : VERIFY_FIELDS.routeRun)} />
              <input type="hidden" name="routeId" value={routeId} />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {reason && <input type="hidden" name="reason" value={reason} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={back} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && id && (
        <><div className="kv-card kv-card--notice" role="status"><p>{t.t(`swe.run.act.done.${act}`)}</p></div>
          <AuditEntryCard t={t} lang={lang} entityType={onDropPoint ? 'route_drop_point' : 'route_run'} entityId={id} action={AUDIT[act]} />
          <p><Link href={back} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p></>
      )}
      {step === 'failure' && isStaleFailure(searchParams.error) && <StaleDiffChip code={String(searchParams.error)} diffs={readDiff(searchParams.kv_diff)} labels={staleLabels(t)} recheckHref={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(reason ? { reason } : {}) }).toString()}`} />}
      {step === 'failure' && !isStaleFailure(searchParams.error) && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((x) => <li key={x}>{t.t(sweCodeKey(x))} <code>{x}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(reason ? { reason } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={back} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
