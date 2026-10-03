// apps/web-tenant/src/app/twin/scenarios/new/page.tsx · THE SCENARIO FORM CHAIN — W2800 form-error · W2801 review · W2802 success ·
// W2803 failure ("New scenario from template" / "Start from template") · PC-56 TENANT-12.
//
// A scenario is a name, an optional template (its keys — and NO values: the canon's "source defaults" have no recorded source here)
// and an optional crop (so the results page can print that crop's measured yield). The review is the API's; every refusal is listed
// against its field; values travel in the URL; the Idempotency-Key is minted on the review page. Success reads the audit entry back
// and leads to the assumptions form. Back / Retry return to W421 (the originating screen — F-18).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ProductCard, TwinCatalogue, TwinScenarioReview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { carryValues, chainHref, chainStep, chainStepKey, failureKey, isFormError, repeatedFailuresGapKey, valuesLostKey } from '../../../../features/forms/chain';
import { AuditEntryCard } from '../../../people/ambassadors/AuditEntryCard';
import {
  NEW_SCENARIO_HREF, SCENARIOS_HREF, TEMPLATE_CODES, assumptionsHref, isUuid, keyLabel, refusalKey, scenarioValues, templateKey, twinState,
} from '../../../../features/twin/twin';
import { createScenarioAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('twin.new.title'), robots: { index: false, follow: false } };
}

export default async function NewScenarioPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_SCENARIO_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const v = scenarioValues(searchParams);
  const failed = typeof searchParams.error === 'string' ? searchParams.error.split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)) : [];
  const savedId = isUuid(searchParams.saved) ? (searchParams.saved as string) : null;
  const c = tenantClient();

  let cat: TwinCatalogue | null = null; let state: string | null = null;
  try { cat = await c.twin.catalogue(); } catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status); }
  let products: ProductCard[] = [];
  if (step === 'edit' && cat) { try { products = (await c.catalogue.browseProducts({ q: v.productQ || undefined, limit: 12 })).items; } catch { products = []; } }
  let productName: string | null = null;
  if (v.productId && step !== 'edit') { try { productName = (await c.catalogue.browseProducts({ limit: 100 })).items.find((p) => p.id === v.productId)?.name ?? null; } catch { productName = null; } }
  let review: TwinScenarioReview | null = null;
  if (step === 'review' && cat) {
    try { review = await c.twin.previewScenario({ name: v.name, templateCode: v.templateCode || null, productId: v.productId || null }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = twinState(err?.code, err?.status); }
  }
  const carried = { name: v.name, templateCode: v.templateCode, productId: v.productId };
  const reviewQuery = carryValues('review', carried);
  const refusalsFor = (f: string) => (review?.refusals ?? []).filter((r) => r.field === f);

  return (
    <section>
      <nav aria-label={t.t('twin.breadcrumb.label')} className="kv-field__hint">{t.t('twin.breadcrumb.area')} › <Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('twin.scenarios.crumb')}</Link> › {t.t('twin.new.title')}</nav>
      <h1>{t.t('twin.new.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review as never)))} · {t.t('twin.chain.module')}</p>
      <p className="kv-field__hint"><Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.title' : `twin.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'twin.state.scenariosOff.body' : `twin.state.${state}.body`)}</p></div>}
      {cat && !cat.canRun && <div className="kv-card kv-card--notice" role="note"><strong>{t.t('twin.state.runRestricted.title')}</strong><p>{t.t('twin.state.runRestricted.body')}</p></div>}

      {step === 'edit' && cat && (
        <>
          <form action={NEW_SCENARIO_HREF} method="get" className="kv-card kv-form" role="search" aria-label={t.t('twin.new.findCrop')}>
            <input type="hidden" name="step" value="edit" />
            {v.name && <input type="hidden" name="name" value={v.name} />}
            {v.templateCode && <input type="hidden" name="templateCode" value={v.templateCode} />}
            <label className="kv-field" htmlFor="tw-q"><span>{t.t('twin.new.findCrop')}</span><input id="tw-q" name="productQ" className="kv-input" defaultValue={v.productQ} maxLength={60} /></label>
            <button type="submit" className="kv-btn--link">{t.t('twin.new.search')}</button>
          </form>
          <form action={NEW_SCENARIO_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            <label className="kv-field" htmlFor="tw-name"><span>{t.t('twin.new.field.name')}</span>
              <input id="tw-name" name="name" className="kv-input" defaultValue={v.name} maxLength={120} required /></label>
            <label className="kv-field" htmlFor="tw-tpl"><span>{t.t('twin.new.field.template')}</span>
              <select id="tw-tpl" name="templateCode" className="kv-select" defaultValue={v.templateCode}>
                <option value="">{t.t('twin.template.none')}</option>
                {TEMPLATE_CODES.map((x) => <option key={x} value={x}>{t.t(templateKey(x))}</option>)}
              </select></label>
            <ul className="kv-list">{cat.templates.map((x) => <li key={x.code} className="kv-field__hint">{t.t(templateKey(x.code))}: {x.keys.map((k) => t.t(keyLabel(k))).join(' · ')}</li>)}</ul>
            <p className="kv-field__hint">{t.t('twin.new.noDefaults')}</p>
            <label className="kv-field" htmlFor="tw-crop"><span>{t.t('twin.new.field.crop')}</span>
              <select id="tw-crop" name="productId" className="kv-select" defaultValue={v.productId}>
                <option value="">{t.t('twin.new.noCrop')}</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
            <p className="kv-field__hint">{t.t('twin.new.cropHint')}</p>
            <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
          </form>
        </>
      )}

      {step === 'review' && review && (
        <div className="kv-card">
          {!reviewQuery.preserved && <p className="kv-error" role="alert">{t.t(valuesLostKey())}</p>}
          {review.refusals.filter((r) => r.field === null).map((r) => <p key={r.code} className="kv-error" role="alert">{t.t(refusalKey(r.code))}</p>)}
          <table className="kv-table">
            <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
            <tbody>
              <tr><th scope="row">{t.t('twin.new.field.name')}</th><td><strong>{review.name || t.t('common.dash')}</strong>{refusalsFor('name').map((r) => <div key={r.code} className="kv-error">{t.t(refusalKey(r.code))}</div>)}</td></tr>
              <tr><th scope="row">{t.t('twin.new.field.template')}</th><td>{t.t(templateKey(review.templateCode))}{review.keys.length > 0 && <div className="kv-field__hint">{review.keys.map((k) => t.t(keyLabel(k))).join(' · ')}</div>}{refusalsFor('templateCode').map((r) => <div key={r.code} className="kv-error">{t.t(refusalKey(r.code))}</div>)}</td></tr>
              <tr><th scope="row">{t.t('twin.new.field.crop')}</th><td>{productName ?? (review.productId ? review.productId : t.t('twin.new.noCrop'))}{refusalsFor('productId').map((r) => <div key={r.code} className="kv-error">{t.t(refusalKey(r.code))}</div>)}</td></tr>
            </tbody>
          </table>
          <p className="kv-field__hint">{t.t('form.diff.notApplicable')}</p>
          {review.ready && reviewQuery.preserved ? (
            <form action={createScenarioAction}>
              <input type="hidden" name="name" value={v.name} />
              {v.templateCode && <input type="hidden" name="templateCode" value={v.templateCode} />}
              {v.productId && <input type="hidden" name="productId" value={v.productId} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('twin.new.submit')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
          <p><Link href={chainHref(NEW_SCENARIO_HREF, 'edit', carried)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
        </div>
      )}

      {step === 'success' && savedId && (
        <>
          <div className="kv-card kv-success" role="status">
            <strong>{t.t('twin.new.done')}</strong>
            <p className="kv-field__hint">{t.t('form.auditNote')}</p>
            <p><Link href={assumptionsHref(savedId)} className="kv-btn kv-btn--primary">{t.t('twin.new.toAssumptions')}</Link>{' · '}<Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
          </div>
          <AuditEntryCard t={t} lang={lang} entityType="twin_scenario" entityId={savedId} action="twin.scenario.created" />
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{(failed.length ? failed : ['unknown']).map((code) => <li key={code}>{t.t(refusalKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={chainHref(NEW_SCENARIO_HREF, 'review', carried)} className="kv-btn--link">{t.t('form.retry')}</Link> · <Link href={SCENARIOS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
