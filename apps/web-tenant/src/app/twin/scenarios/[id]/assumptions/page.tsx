// apps/web-tenant/src/app/twin/scenarios/[id]/assumptions/page.tsx · THE ASSUMPTIONS FORM CHAIN — W2800 form-error · W2801 review ·
// W2802 success · W2803 failure ("Save assumptions") · PC-56 TENANT-12.
//
// For every key the scenario's template names (or every key, for a scenario with no template): the value in that key's unit, WHERE IT
// CAME FROM (a citation, 10–500 characters) and the date the source is as of (not in the future). There are no "source defaults"
// pre-filled — the platform records no IMD series and no input-cost index, so a blank is the honest start. The review is the API's:
// every refusal against its field, before → after per key. Success reads the audit entry back. Back / Retry return to W421 (F-18).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { TwinAssumptionReview, TwinCatalogue, TwinScenarioDetail } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../../lib/i18n';
import { carryValues, chainHref, chainStep, chainStepKey, failureKey, isFormError, repeatedFailuresGapKey, valuesLostKey } from '../../../../../features/forms/chain';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import {
  KEY_CODES, MAX_CARRIED_ASSUMPTIONS, MAX_CITATION, MIN_CITATION, SCENARIOS_HREF, assumptionCarry, assumptionInput, assumptionValues, assumptionsBase, isUuid,
  keyLabel, refusalKey, scenarioHref, statusKey, twinState, unitKey,
} from '../../../../../features/twin/twin';
import { saveAssumptionsAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('twin.assume.title'), robots: { index: false, follow: false } };
}

export default async function AssumptionsPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const base = assumptionsBase(params.id);
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const failed = typeof searchParams.error === 'string' ? searchParams.error.split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)) : [];
  const c = tenantClient();

  let d: TwinScenarioDetail | null = null; let cat: TwinCatalogue | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) {
    try { [d, cat] = await Promise.all([c.twin.scenario(params.id), c.twin.catalogue()]); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status, true); }
  }
  const keys = d ? (d.templateKeys.length ? d.templateKeys : [...KEY_CODES]) : [];
  let values = assumptionValues(searchParams, keys);
  const touched = Object.values(values).some((x) => x.value || x.citation || x.asOf);
  if (d && step === 'edit' && !touched) {
    for (const a of d.assumptions) if (values[a.key]) values = { ...values, [a.key]: { value: a.value, citation: a.citation, asOf: a.asOf } };
  }
  let review: TwinAssumptionReview | null = null;
  if (step === 'review' && d) {
    try { review = await c.twin.previewAssumptions(params.id, assumptionInput(values)); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status, true); }
  }
  const carried = assumptionCarry(values);
  const reviewQuery = carryValues('review', carried, MAX_CARRIED_ASSUMPTIONS);
  const unitOf = (k: string) => cat?.keys.find((x) => x.code === k)?.unit ?? null;
  const boundsOf = (k: string) => cat?.keys.find((x) => x.code === k);

  return (
    <section>
      <nav aria-label={t.t('twin.breadcrumb.label')} className="kv-field__hint">{t.t('twin.breadcrumb.area')} › <Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('twin.scenarios.crumb')}</Link> › {t.t('twin.assume.title')}</nav>
      <h1>{t.t('twin.assume.title')}{d ? ` — ${d.scenario.name}` : ''}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review as never)))} · {t.t('twin.chain.module')}</p>
      <p className="kv-field__hint"><Link href={d ? scenarioHref(d.scenario.id) : SCENARIOS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.title' : `twin.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.body' : `twin.state.${state}.body`)}</p></div>}
      {d && !d.canRun && <div className="kv-card kv-card--notice" role="note"><strong>{t.t('twin.state.runRestricted.title')}</strong><p>{t.t('twin.state.runRestricted.body')}</p></div>}

      {step === 'edit' && d && (
        <form action={base} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <p className="kv-field__hint">{t.t('twin.assume.rule', { min: String(MIN_CITATION), max: String(MAX_CITATION) })}</p>
          {keys.map((k) => { const b = boundsOf(k); const x = values[k]; return (
            <fieldset key={k} className="kv-fieldset">
              <legend>{t.t(keyLabel(k))}</legend>
              <label className="kv-field" htmlFor={`v_${k}`}><span>{t.t('twin.assume.value', { unit: t.t(unitKey(unitOf(k))) })}</span>
                <input id={`v_${k}`} name={`v_${k}`} className="kv-input" defaultValue={x?.value ?? ''} inputMode="decimal" maxLength={20} /></label>
              {b && <p className="kv-field__hint">{t.t('twin.assume.bounds', { min: b.min, max: b.max })}</p>}
              <label className="kv-field" htmlFor={`c_${k}`}><span>{t.t('twin.assume.citation')}</span>
                <textarea id={`c_${k}`} name={`c_${k}`} className="kv-textarea" rows={2} defaultValue={x?.citation ?? ''} maxLength={MAX_CITATION} /></label>
              <label className="kv-field" htmlFor={`a_${k}`}><span>{t.t('twin.assume.asOf')}</span>
                <input id={`a_${k}`} name={`a_${k}`} type="date" className="kv-input" defaultValue={x?.asOf ?? ''} /></label>
            </fieldset>
          ); })}
          <p className="kv-field__hint">{t.t('twin.sheet.noDefaults')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && review && d && (
        <div className="kv-card">
          {!reviewQuery.preserved && <p className="kv-error" role="alert">{t.t(valuesLostKey())}</p>}
          {review.refusals.filter((r) => r.field === null).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(refusalKey(r.code))}</p>)}
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('twin.sheet.col.key')}</th><th scope="col">{t.t('twin.sheet.col.value')}</th><th scope="col">{t.t('twin.sheet.col.source')}</th></tr></thead>
            <tbody>{review.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{t.t(keyLabel(r.key))}</th>
                <td>{r.value ?? t.t('common.dash')} {t.t(unitKey(r.unit))}{review!.refusals.filter((x) => x.field === `${r.key}.value` || x.field === `${r.key}.unit` || x.field === `${r.key}.key`).map((x) => <div key={x.code} className="kv-error">{t.t(refusalKey(x.code))}</div>)}</td>
                <td>{r.citation ?? t.t('common.dash')}<div className="kv-field__hint">{r.asOf ? t.t('twin.sheet.asOf', { day: r.asOf }) : t.t('common.dash')}</div>
                  {review!.refusals.filter((x) => x.field === `${r.key}.citation` || x.field === `${r.key}.asOf`).map((x) => <div key={x.code} className="kv-error">{t.t(refusalKey(x.code))}</div>)}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="kv-field__hint">{t.t('form.diff.heading')}</p>
          {review.diff.length > 0 && (
            <table className="kv-table">
              <thead><tr><th scope="col">{t.t('twin.sheet.col.key')}</th><th scope="col">{t.t('form.col.before')}</th><th scope="col">{t.t('form.col.after')}</th></tr></thead>
              <tbody>{review.diff.map((x) => (
                <tr key={x.key}><th scope="row">{t.t(keyLabel(x.key))}</th>
                  <td>{x.before ? `${x.before.value} · ${x.before.citation} · ${x.before.asOf}` : t.t('twin.sheet.notSet')}</td>
                  <td><strong>{x.after.value}</strong> · {x.after.citation} · {x.after.asOf}</td></tr>
              ))}</tbody>
            </table>
          )}
          <p className="kv-field__hint">{t.t('twin.assume.statusAfter', { status: t.t(statusKey(review.statusAfter)) })}</p>
          {review.ready && reviewQuery.preserved ? (
            <form action={saveAssumptionsAction}>
              <input type="hidden" name="id" value={d.scenario.id} />
              <input type="hidden" name="keys" value={keys.join(',')} />
              {Object.entries(carried).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('twin.sheet.save')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
          <p><Link href={chainHref(base, 'edit', carried, MAX_CARRIED_ASSUMPTIONS)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
        </div>
      )}

      {step === 'success' && isUuid(params.id) && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t('twin.assume.done', { status: t.t(statusKey(typeof searchParams.status === 'string' ? searchParams.status : '')) })}</strong>
            <p className="kv-field__hint">{t.t('form.auditNote')}</p>
            <p><Link href={scenarioHref(params.id)} className="kv-btn kv-btn--primary">{t.t('form.backToScreen')}</Link></p>
          </div>
          <AuditEntryCard t={t} lang={lang} entityType="twin_scenario" entityId={params.id} action="twin.assumptions.saved" />
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{(failed.length ? failed : ['unknown']).map((code) => <li key={code}>{t.t(refusalKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={chainHref(base, 'review', carried, MAX_CARRIED_ASSUMPTIONS)} className="kv-btn--link">{t.t('form.retry')}</Link> · <Link href={isUuid(params.id) ? scenarioHref(params.id) : SCENARIOS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
