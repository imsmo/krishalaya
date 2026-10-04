// apps/web-tenant/src/app/ops/logistics/routes/[id]/drop-point/page.tsx · "Add drop point" (form chain: edit → review → success /
// failure) · PC-56 TENANT-SW-e. Sequence, the village (only the route's villages are offered), a name, the keeper (a user with the
// ambassador role — the database checks) and an optional collection window.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { VillageRunPage } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { tenantHasPerm } from '../../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../../lib/i18n';
import { chainStep, chainStepKey } from '../../../../../../features/forms/chain';
import { failedCodes, isUuid, routeHref, swePageState, sweCodeKey } from '../../../../../../features/swe/console';
import { dropPointRefusals, readDropPointDraft } from '../../../../../../features/swe/drop-point';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { addDropPointAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.run.addDropPoint'), robots: { index: false, follow: false } }; }

export default async function AddDropPointPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const routeId = isUuid(params.id) ? params.id : '';
  const back = routeHref(params.id); const base = `${back}/drop-point`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const step = chainStep(searchParams.step);
  let page: VillageRunPage | null = null; let state: string | null = routeId ? null : 'notFound';
  if (routeId && (step === 'edit' || step === 'review')) { try { page = await tenantClient().villageRun.route(routeId); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); } }
  const d = readDropPointDraft(searchParams);
  const refusals = page ? dropPointRefusals(d, page.route.villages.map((v) => v.id)) : [];
  const err = (f: string) => refusals.filter((r) => r.field === f).map((r) => t.t(`swe.dp.err.${r.code}`)).join(' ');
  const carried = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== ''));
  const dropPointId = isUuid(searchParams.dropPointId) ? searchParams.dropPointId : null;
  if (!tenantHasPerm('logistics.manage')) return <section><h1>{t.t('swe.run.addDropPoint')}</h1><div className="kv-card kv-card--notice" role="alert"><strong>{t.t('swe.state.restricted.title')}</strong><p>{t.t('swe.state.restricted.body')}</p></div></section>;
  const f = (name: string, label: string, input: JSX.Element) => <label className="kv-field" htmlFor={`d-${name}`}><span>{label}</span>{input}{step === 'review' && err(name) && <span className="kv-error">{err(name)}</span>}</label>;
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.run.title')}><Link href={back}>{page?.route.name ?? t.t('swe.run.title')}</Link> / <span aria-current="page">{t.t('swe.run.addDropPoint')}</span></nav>
      <h1>{t.t('swe.run.addDropPoint')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, refusals.length > 0))}</p>
      {state && <div className="kv-error" role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p></div>}
      {page && (step === 'edit' || step === 'review') && (
        <form method="get" action={base} className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          {f('sequence', t.t('swe.dp.sequence'), <input id="d-sequence" name="sequence" className="kv-input" inputMode="numeric" maxLength={3} defaultValue={d.sequence || String(page.dropPoints.length + 1)} />)}
          {f('regionId', t.t('swe.dp.village'), <select id="d-regionId" name="regionId" className="kv-select" defaultValue={d.regionId}><option value="">{t.t('swe.pick')}</option>{page.route.villages.map((v) => <option key={v.id} value={v.id}>{v.name ?? v.id.slice(0, 8)}</option>)}</select>)}
          {f('name', t.t('swe.dp.name'), <input id="d-name" name="name" className="kv-input" maxLength={120} defaultValue={d.name} />)}
          {f('ambassadorUserId', t.t('swe.dp.keeper'), <input id="d-ambassadorUserId" name="ambassadorUserId" className="kv-input" maxLength={36} defaultValue={d.ambassadorUserId} />)}
          <p className="kv-field__hint">{t.t('swe.dp.keeperHint')}</p>
          {f('windowStart', t.t('swe.dp.from'), <input id="d-windowStart" type="time" name="windowStart" className="kv-input" defaultValue={d.windowStart} />)}
          {f('windowEnd', t.t('swe.dp.to'), <input id="d-windowEnd" type="time" name="windowEnd" className="kv-input" defaultValue={d.windowEnd} />)}
          <button type="submit" className="kv-btn">{t.t('swe.review')}</button>
        </form>
      )}
      {page && step === 'review' && refusals.length === 0 && (
        <div className="kv-card">
          <h2>{t.t('swe.reviewTitle')}</h2>
          <p>{d.sequence}. {d.name} · {page.route.villages.find((v) => v.id === d.regionId)?.name ?? ''}{d.windowStart ? ` · ${d.windowStart}–${d.windowEnd}` : ''}</p>
          <form action={addDropPointAction} className="kv-actions">
            <input type="hidden" name="routeId" value={routeId} />
            {Object.entries(carried).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('swe.dp.submit')}</button>{' '}<Link href={back} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
          </form>
        </div>
      )}
      {step === 'success' && (
        <><div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.dp.done')}</p></div>
          {dropPointId && <AuditEntryCard t={t} lang={lang} entityType="route_drop_point" entityId={dropPointId} action="logistics.drop_point_added" />}
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
