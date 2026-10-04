// apps/web-tenant/src/app/ops/logistics/routes/[id]/plan/page.tsx · W2814 form-error / W2815 review → W2816 success → W2817 failure —
// "Draft loading plan" · PC-56 TENANT-SW-e. Pick the parcels bound for the route's villages, give each a drop point (only the route's
// active drop points are offered), the carrier, the run date (the route's run weekday; suggested, never written until review) and a reason.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { CarrierRow, VillageRunPage } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { tenantHasPerm } from '../../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../../../features/forms/chain';
import { failedCodes, isUuid, istToday, nextRunDate, planCarry, planRefusals, readPlanDraft, routeHref, swePageState, sweCodeKey, weekdayKey } from '../../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { draftRunAction } from './actions';
import { AsOf } from '../../../../../../components/AsOf';
import { asOfLabels } from '../../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.run.planTitle'), robots: { index: false, follow: false } }; }

export default async function PlanRunPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const routeId = isUuid(params.id) ? params.id : '';
  const back = routeHref(params.id); const base = `${back}/plan`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const step = chainStep(searchParams.step);
  let page: VillageRunPage | null = null; let cands: Array<{ shipmentId: string; awb: string | null; regionId: string; status: string; createdAt: string }> = []; let carriers: CarrierRow[] = [];
  let state: string | null = routeId ? null : 'notFound';
  if (routeId && (step === 'edit' || step === 'review')) {
    try {
      page = await tenantClient().villageRun.route(routeId);
      const [c, p] = await Promise.allSettled([tenantClient().villageRun.candidates(routeId), tenantClient().carriers.list({ activeOnly: true, limit: 100 })]);
      cands = c.status === 'fulfilled' ? c.value.items : []; carriers = p.status === 'fulfilled' ? p.value.items : [];
    } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  const today = istToday();
  const d = readPlanDraft({ ...searchParams, runDate: searchParams.runDate ?? (page ? nextRunDate(today, page.route.runWeekday) ?? '' : '') });
  const dps = (page?.dropPoints ?? []).filter((x) => x.active);
  const refusals = page ? planRefusals(d, page.route.runWeekday, today, dps.map((x) => x.id)) : [];
  const err = (f: string) => refusals.filter((r) => r.field === f).map((r) => t.t(`swe.run.form.err.${r.code}`)).join(' ');
  const carried = planCarry(d);
  const runId = isUuid(searchParams.runId) ? searchParams.runId : null;
  if (!tenantHasPerm('logistics.manage')) return <section><h1>{t.t('swe.run.planTitle')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swe.state.restricted.title')}</strong><p>{t.t('swe.state.restricted.body')}</p></div></section>;
  const dpFor = (regionId: string) => dps.filter((x) => x.regionId === regionId);
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.run.title')}><Link href={back}>{page?.route.name ?? t.t('swe.run.title')}</Link> / <span aria-current="page">{t.t('swe.run.planTitle')}</span></nav>
      <h1>{t.t('swe.run.planTitle')}</h1>
      {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
      <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      <p className="kv-field__hint">{t.t(chainStepKey(step, refusals.length > 0))}</p>
      {state && <div className="kv-error" role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p></div>}
      {page && (step === 'edit' || step === 'review') && (
        <form method="get" action={base} className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="r-date"><span>{t.t('swe.run.col.date')}</span>
            <input id="r-date" type="date" name="runDate" className="kv-input" defaultValue={d.runDate} />
            <span className="kv-field__hint">{page.route.runWeekday == null ? t.t('swe.run.noRunDay') : t.t('swe.run.form.dateHint', { day: t.t(weekdayKey(page.route.runWeekday)) })}</span>
            {step === 'review' && err('runDate') && <span className="kv-error">{err('runDate')}</span>}</label>
          <label className="kv-field" htmlFor="r-partner"><span>{t.t('swe.run.form.carrier')}</span>
            <select id="r-partner" name="partnerId" className="kv-select" defaultValue={d.partnerId}>
              <option value="">{t.t('swe.run.form.noCarrier')}</option>{carriers.map((c) => <option key={c.id} value={c.id}>{c.defaultName} · {t.t(`swe.carriers.kind.${c.partnerKind}`)}</option>)}
            </select></label>
          <fieldset className="kv-fieldset"><legend>{t.t('swe.run.form.parcels', { n: String(cands.length) })}</legend>
            {cands.length === 0 ? <p className="kv-field__hint">{t.t('swe.run.form.noCandidates')}</p> : cands.map((c) => (
              <label key={c.shipmentId} className="kv-field" htmlFor={`p-${c.shipmentId}`}><span><code>{c.awb ?? c.shipmentId.slice(0, 8)}</code> · {t.t(`swe.run.parcelStatus`, { status: c.status })}</span>
                <select id={`p-${c.shipmentId}`} name={`p_${c.shipmentId}`} className="kv-select" defaultValue={d.assignments.find((a) => a.shipmentId === c.shipmentId)?.dropPointId ?? ''}>
                  <option value="">{t.t('swe.run.form.notOnRun')}</option>{dpFor(c.regionId).map((x) => <option key={x.id} value={x.id}>{x.sequence}. {x.name}</option>)}
                </select></label>
            ))}
            {step === 'review' && err('plan') && <p className="kv-error">{err('plan')}</p>}
          </fieldset>
          <label className="kv-field" htmlFor="r-why"><span>{t.t('swe.reason')}</span>
            <textarea id="r-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={d.reason} />{step === 'review' && err('reason') && <span className="kv-error">{err('reason')}</span>}</label>
          <button type="submit" className="kv-btn">{t.t('swe.review')}</button>
        </form>
      )}
      {page && step === 'review' && refusals.length === 0 && (
        <div className="kv-card">
          <h2>{t.t('swe.reviewTitle')}</h2>
          <p>{t.t('swe.run.form.summary', { date: d.runDate, n: String(d.assignments.length) })}</p>
          <ul className="kv-list">{dps.map((x) => { const n = d.assignments.filter((a) => a.dropPointId === x.id).length; return n ? <li key={x.id}>{x.sequence}. {x.name}: {n}</li> : null; })}</ul>
          <p className="kv-field__hint">{t.t('swe.run.form.wall')}</p>
          <form action={draftRunAction} className="kv-actions">
            <input type="hidden" name="routeId" value={routeId} />
            {Object.entries(carried).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swe.run.form.submit')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'success' && (
        <><div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.run.form.done')}</p></div>
          {runId && <AuditEntryCard t={t} lang={lang} entityType="route_run" entityId={runId} action="logistics.run_drafted" />}
          <p><Link href={back} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p></>
      )}
      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((c) => <li key={c}>{t.t(sweCodeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t('form.failure.untouched')}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'review', ...carried }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
