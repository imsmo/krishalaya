// apps/web-tenant/src/app/esg/disclosures/new/page.tsx · THE ESG FORM CHAIN — W2598 form-error → W2599 review → W2600 success →
// W2601 failure · PC-56 TENANT-9d.
//
// The canon's act on this chain is *Generate report* (W424). The report needs no form — its guard IS its review, on W424 —
// so this chain carries the one thing a cooperative may write about ESG: ITS OWN DISCLOSURE about one metric, in the
// platform's active languages, AS WORDS. 6d-4's shape: one page, four states, values in the URL, and a review THE API
// COMPUTES (`POST esg/disclosures/preview`): the metric exists; every language is active; 20–2,000 characters; no markup;
// and NO NUMBER in any script (`NUMBER_IN_DISCLOSURE`) — the platform never accepts a self-reported metric value as a fact,
// and a figure typed into a narrative is one. On an edit (`?id=`, a draft only) the diff against the draft as it stands. THE
// KEY IS MINTED ON THE REVIEW PAGE. A new disclosure is a DRAFT; publishing is the mutate chain's act (W2602).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { EsgDisclosureCatalogue, EsgDisclosureReview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { auditHref, chainHref, chainStep, chainStepKey, failureKey, nothingStoredKey, normalisedKey, repeatedFailuresGapKey, valuesLostKey, carryValues } from '../../../../features/forms/chain';
import {
  ESG_HREF, MAX_CARRIED_DISCLOSURE, MAX_TEXT, MIN_TEXT, NEW_DISCLOSURE_HREF, actHref, carriedFrom, disclosureValues, esgState, fieldKey, pick, refusalKey,
} from '../../../../features/esg/esg';
import { submitDisclosureAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('esg.form.title'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EsgDisclosureFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  if (!env.featureEsg) notFound();
  await requireSession(NEW_DISCLOSURE_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const id = typeof searchParams.id === 'string' && UUID.test(searchParams.id) ? searchParams.id : null;
  const failed = typeof searchParams.error === 'string' ? searchParams.error.split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)) : [];
  const savedId = typeof searchParams.saved === 'string' && UUID.test(searchParams.saved) ? searchParams.saved : null;
  const esg = tenantClient().esg;

  let cat: EsgDisclosureCatalogue | null = null; let state: string | null = null;
  try { cat = await esg.disclosureCatalogue(); } catch (e) { const err = e instanceof SdkError ? e : null; state = esgState(err?.code, err?.status, true); }
  const languages = cat?.languages ?? ['en'];
  let values = disclosureValues(searchParams, languages);
  if (step === 'edit' && id && Object.keys(values.texts).length === 0 && !state) {
    try { const d = await esg.disclosure(id); values = { metricCode: d.metricCode, texts: d.texts }; }
    catch (e) { const err = e instanceof SdkError ? e : null; state = esgState(err?.code, err?.status); }
  }
  let review: EsgDisclosureReview | null = null; let reviewError: string | null = null;
  if (step === 'review' && !state) {
    try { review = await esg.previewDisclosure({ ...(values.metricCode ? { metricCode: values.metricCode } : {}), texts: values.texts }, id ?? undefined); }
    catch (e) { const err = e instanceof SdkError ? e : null; reviewError = err?.code || 'review'; if (err?.status === 403) state = 'restricted'; }
  }
  const carried = { ...carriedFrom(values), ...(id ? { id } : {}) };
  const reviewQuery = carryValues('review', carried, MAX_CARRIED_DISCLOSURE);
  const metricName = (code: string) => pick(cat?.metrics.find((m) => m.code === code)?.name ?? null, lang) ?? code;
  const fieldLabel = (name: string) => (name === 'metricCode' ? t.t(fieldKey(name)) : t.t(fieldKey(name), { lang: name.split('.')[1] ?? '' }));

  return (
    <section>
      <h1>{t.t(id ? 'esg.form.editTitle' : 'esg.form.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, step === 'review' && review !== null && !review.ready))} · {t.t('esg.form.module')}</p>
      <p className="kv-field__hint"><Link href={ESG_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t('esg.form.wordsOnly')}</p></div>

      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`esg.state.${state}.title`)}</strong><p>{t.t(`esg.state.${state}.body`)}</p></div>}
      {cat && !cat.canDisclose && step === 'edit' && <div className="kv-card kv-card--notice" role="note"><strong>{t.t('esg.state.readOnly.title')}</strong><p>{t.t('esg.state.readOnly.body')}</p></div>}

      {step === 'edit' && !state && cat && (
        <form action={NEW_DISCLOSURE_HREF} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          {id && <input type="hidden" name="id" value={id} />}
          <label className="kv-field" htmlFor="d-metric"><span>{t.t(fieldKey('metricCode'))}</span>
            <select id="d-metric" name="metricCode" className="kv-select" defaultValue={values.metricCode} disabled={id !== null} required>
              <option value="">{t.t('esg.form.chooseMetric')}</option>
              {cat.metrics.map((m) => <option key={m.code} value={m.code}>{pick(m.name, lang)}</option>)}
            </select></label>
          {id && <input type="hidden" name="metricCode" value={values.metricCode} />}
          {id && <p className="kv-field__hint">{t.t('esg.form.metricFixed')}</p>}
          {languages.map((l) => (
            <label key={l} className="kv-field" htmlFor={`d-text-${l}`}><span>{t.t(fieldKey(`text.${l}`), { lang: l })}</span>
              <textarea id={`d-text-${l}`} name={`text_${l}`} className="kv-textarea" rows={4} lang={l} defaultValue={values.texts[l] ?? ''} maxLength={MAX_TEXT} /></label>
          ))}
          <p className="kv-field__hint">{t.t('esg.form.textHint', { min: String(MIN_TEXT), max: String(MAX_TEXT) })}</p>
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {!reviewQuery.preserved && <p className="kv-notice" role="note">{t.t(valuesLostKey())}</p>}
          {reviewError && !review && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} <code>{reviewError}</code></p></div>}
          {review && (
            <>
              {review.refusals.filter((r) => r.field === null).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(r.code))}</p></div>)}
              <table className="kv-table">
                <caption className="kv-sr-only">{t.t('form.step.review')}</caption>
                <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.entered')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
                <tbody>{review.fields.map((f) => (
                  <tr key={f.name}>
                    <th scope="row">{fieldLabel(f.name)}</th>
                    <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                    <td>
                      {f.stored === null ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{f.name === 'metricCode' ? metricName(f.stored) : f.stored}</strong>}
                      {f.normalised && f.stored !== null && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                      {review!.refusals.filter((r) => r.field === f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(r.code))}</div>)}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              <p className="kv-field__hint">{t.t(review.diff === null ? 'form.diff.notApplicable' : 'form.diff.heading')}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.before')}</th><th scope="col">{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((x) => <tr key={x.field}><th scope="row">{fieldLabel(x.field)}</th><td>{x.before ?? t.t('common.dash')}</td><td><strong>{x.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}
              <p className="kv-field__hint">{t.t('esg.form.draftNote')}</p>
              {review.ready && reviewQuery.preserved ? (
                <form action={submitDisclosureAction}>
                  {values.metricCode && <input type="hidden" name="metricCode" value={values.metricCode} />}
                  {Object.entries(values.texts).map(([l, v]) => <input type="hidden" key={l} name={`text_${l}`} value={v} />)}
                  <input type="hidden" name="languages" value={languages.join(',')} />
                  {id && <input type="hidden" name="id" value={id} />}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t(id ? 'esg.form.saveEdit' : 'esg.form.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(NEW_DISCLOSURE_HREF, 'edit', carried, MAX_CARRIED_DISCLOSURE)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('esg.form.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {savedId && <p><Link href={actHref(savedId, 'publish')} className="kv-btn kv-btn--primary">{t.t('esg.form.toPublish')}</Link>{' · '}<Link href={auditHref('esg_disclosure', savedId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          <p><Link href={ESG_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(refusalKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={chainHref(NEW_DISCLOSURE_HREF, 'review', carried, MAX_CARRIED_DISCLOSURE)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={ESG_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
