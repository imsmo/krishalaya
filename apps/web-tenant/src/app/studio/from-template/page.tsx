// apps/web-tenant/src/app/studio/from-template/page.tsx · the studio form chain — W2775–W2778 · PC-56 TENANT-7d.
//
// The canon's studio module names ONE action on this chain: *"Start from template"* (W410's empty state: *"outline, quiz
// and publish checklist already scaffolded"*). 7a named the button as refused because no template table existed; 0173's
// `course_templates` is a registry (Law 6), and this page offers what it holds. One page, four states, values in the URL
// (6d-4's ruling), and a review the API computes: the template's topic (refused if the `course_topic` registry lost it),
// its level, the tenant's currency (refused, never guessed), and THE OUTLINE AS IT WILL BE WRITTEN — module · lesson ·
// kind — with the count of quiz lessons that will have no questions yet. The publish checklist is W416's gate, which every
// course already has; a title left blank takes the template's own and is shown as normalised.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CourseTemplate, FormReview } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey, normalisedKey,
  readCarried, refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey, carryValues,
} from '../../../features/forms/chain';
import { TEMPLATE_FIELDS, TEMPLATE_FORM, TEMPLATE_FORM_PATH, refusedKey, studioHref } from '../../../features/studio/instructor';
import { startFromTemplateAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.template.title'), robots: { index: false, follow: false } };
}

export default async function StudioTemplateFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = TEMPLATE_FORM_PATH;
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, TEMPLATE_FIELDS);
  const carried = carryValues(step, values);
  const createdId = typeof searchParams.created === 'string' ? searchParams.created : null;
  const lessonsMade = typeof searchParams.lessons === 'string' && /^\d+$/.test(searchParams.lessons) ? Number(searchParams.lessons) : null;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;

  let templates: CourseTemplate[] = []; let templatesError = false;
  if (step === 'edit') { try { templates = await tenantClient().courses.templates(); } catch { templatesError = true; } }
  let review: FormReview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    try { review = await tenantClient().courses.previewFromTemplate(Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f, values[f]]))); }
    catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const backHref = studioHref();

  return (
    <section>
      <h1>{t.t('form.template.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}

      {step === 'edit' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          <p className="kv-field__hint">{t.t('form.template.lead')}</p>
          {templatesError && <div className="kv-error" role="alert"><p>{t.t('form.template.registryUnavailable')}</p></div>}
          {!templatesError && templates.length === 0 && <div className="kv-card kv-card--notice" role="status"><p>{t.t('studio.noTemplates')}</p></div>}
          <fieldset className="kv-field">
            <legend>{t.t(fieldLabelKey(TEMPLATE_FORM, 'templateCode'))}</legend>
            {templates.map((tp) => (
              <label key={tp.code} htmlFor={`tpl-${tp.code}`} className="kv-field">
                <input id={`tpl-${tp.code}`} type="radio" name="templateCode" value={tp.code} defaultChecked={values.templateCode === tp.code} required />
                <span>{tp.title} <span className="kv-field__hint">· {tp.topicCode} · {t.t(`studio.level.${tp.level}`) || tp.level}{tp.platform ? '' : ` · ${t.t('form.template.tenantOwn')}`}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="kv-field" htmlFor="tpl-title">
            <span>{t.t(fieldLabelKey(TEMPLATE_FORM, 'title'))}</span>
            <input id="tpl-title" name="title" defaultValue={values.title ?? ''} maxLength={250} />
          </label>
          <p className="kv-field__hint">{t.t('form.template.titleHint')}</p>
          <p className="kv-field__hint">{t.t(refusedKey('tenantTemplates'))}</p>
          <button type="submit" className="kv-btn" disabled={templates.length === 0}>{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(TEMPLATE_FORM, r.code))}</p></div>)}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(TEMPLATE_FORM, f.name))}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td style={{ whiteSpace: 'pre-line' }}>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(TEMPLATE_FORM, r.code))}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="kv-field__hint">{t.t('form.template.countsHint')}</p>
              <p className="kv-field__hint">{t.t(diffKey(review))}</p>
              {review.ready ? (
                <form action={startFromTemplateAction}>
                  {TEMPLATE_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t('form.template.create')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(PATH, 'edit', values)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('form.template.done', { n: formatNumber(lessonsMade ?? 0, lang) })}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('course', createdId) && <p><Link href={auditHref('course', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          {createdId && <p><Link href={`/studio/${encodeURIComponent(createdId)}`} className="kv-btn">{t.t('studio.openBuilder')}</Link> <Link href={`/courses/${encodeURIComponent(createdId)}`} className="kv-btn--link">{t.t('form.template.openRecord')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, values)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
