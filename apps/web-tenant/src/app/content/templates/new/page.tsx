// apps/web-tenant/src/app/content/templates/new/page.tsx · the override FORM chain — W2786–W2789 (*New override*, the
// `templates` module) and, with `?from=<templateId>`, W2779–W2782 (*Save (re-verifies DLT)*, the `template` module) ·
// PC-56 TENANT-8a.
//
// The canon's shared form pattern (B2), 6d-4's shape: one page, four states (edit · review/form-error · success ·
// failure), values in the URL, and a review THE API COMPUTES (`notifications.previewTemplate`) from the facts the writer
// uses — the catalogue, the event's declared variables, this tenant's languages, what members receive today. The review
// shows what the form never asked: the version this becomes and that it is born a DRAFT, the words RENDERED by the
// platform's own `render()` over the declared samples, the SMS segment count of that rendered text, and whether the
// words will serve once a second person approves them (never on SMS / WhatsApp — the provider's).
//
// THE KEY IS MINTED ON THE REVIEW PAGE AND TRAVELS IN THE FORM (F-17's lesson): a double-submit of one review sends one
// key, so the API writes one draft. `/comms` minted its key inside the server action — a fresh key per click.
//
// W2779's second act, *"New experiment"* (W182), is refused by name: no experiment table exists (DELTA-029).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { TemplateCatalogueEvent, TemplateLanguage, TemplateOverrideReview, TemplateView } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, carryValues, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey,
  normalisedKey, readCarried, refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey,
} from '../../../../features/forms/chain';
import {
  CHANNEL_VALUES, MAX_CARRIED_LENGTH_OVERRIDE, NEW_OVERRIDE_HREF, OVERRIDE_FIELDS, OVERRIDE_FORM, TEMPLATES_HREF, chainKind, channelKey, defaultChannelFor, editValues,
  formTitleKey, lifecycleKey, overridableEvents, providerKey, refusedKey, segmentFacts, sourceKey, templateActHref, templateHref,
} from '../../../../features/templates/override';
import { saveOverrideDraftAction } from './actions';

export const dynamic = 'force-dynamic';

const PATH = NEW_OVERRIDE_HREF;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.override.title'), robots: { index: false, follow: false } };
}

export default async function OverrideFormPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const from = typeof searchParams.from === 'string' && searchParams.from.length > 0 ? searchParams.from : null;
  const kind = chainKind(from);
  let values = readCarried(searchParams, OVERRIDE_FIELDS);
  const withFrom = (v: Record<string, string | undefined | null>) => ({ ...v, from: from ?? undefined });
  const carried = carryValues(step, withFrom(values), MAX_CARRIED_LENGTH_OVERRIDE);
  const createdId = typeof searchParams.created === 'string' ? searchParams.created : null;
  const createdVersion = typeof searchParams.version === 'string' ? searchParams.version : null;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const c = tenantClient().notifications;

  // The template chain (W2779): the next version of an override that exists, starting from its words.
  let source: TemplateView | null = null;
  if (from) {
    try { source = await c.templateView(from); } catch { source = null; }
    if (step === 'edit' && source && Object.keys(values).length === 0) values = editValues(source);
  }

  let events: TemplateCatalogueEvent[] = []; let languages: TemplateLanguage[] = [];
  let loadError: string | null = null;
  if (step === 'edit') {
    try { [events, languages] = await Promise.all([c.templateCatalogue(), c.templateLanguages()]); }
    catch (e) { loadError = e instanceof SdkError ? (e.code || 'load') : 'load'; }
  }
  const chosen = events.find((e) => e.code === values.eventCode) ?? null;
  const channelDefault = values.channel ?? defaultChannelFor(chosen) ?? '';

  let review: TemplateOverrideReview | null = null;
  let reviewError: string | null = null;
  if (step === 'review') {
    try { review = await c.previewTemplate(values); }
    catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const seg = segmentFacts(review?.preview.segments ?? null, review?.preview.segmentBudget ?? 2);
  const backHref = from ? templateHref(from) : TEMPLATES_HREF;

  return (
    <section>
      <h1>{t.t(formTitleKey(kind))}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))} · {t.t(kind === 'template' ? 'form.override.moduleTemplate' : 'form.override.moduleTemplates')}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}

      {step === 'edit' && (
        <>
          {loadError && <div className="kv-error" role="alert"><p>{t.t('form.override.loadFailed')} {loadError}</p></div>}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="review" />
            {from && <input type="hidden" name="from" value={from} />}
            <label className="kv-field" htmlFor="o-event">
              <span>{t.t(fieldLabelKey(OVERRIDE_FORM, 'eventCode'))}</span>
              {kind === 'template' ? (
                <><input id="o-event" name="eventCode" value={values.eventCode ?? ''} readOnly /></>
              ) : (
                <select id="o-event" name="eventCode" defaultValue={values.eventCode ?? ''} required>
                  <option value="">{t.t('form.override.eventChoose')}</option>
                  {overridableEvents(events).map((e) => <option key={e.code} value={e.code}>{e.code} · {e.defaultName}</option>)}
                </select>
              )}
            </label>
            <p className="kv-field__hint">{t.t('form.override.lockedHint', { n: formatNumber(events.filter((e) => e.locked).length, lang) })}</p>
            {chosen && <p className="kv-field__hint">{t.t('form.override.sentOn', { channels: chosen.defaultChannels.map((x) => t.t(channelKey(x))).join(' · ') })}</p>}
            <label className="kv-field" htmlFor="o-channel">
              <span>{t.t(fieldLabelKey(OVERRIDE_FORM, 'channel'))}</span>
              {kind === 'template' ? <input id="o-channel" name="channel" value={values.channel ?? ''} readOnly /> : (
                <select id="o-channel" name="channel" defaultValue={channelDefault}>
                  <option value="">{t.t('form.override.channelChoose')}</option>
                  {CHANNEL_VALUES.map((ch) => <option key={ch} value={ch}>{t.t(channelKey(ch))}</option>)}
                </select>
              )}
            </label>
            <label className="kv-field" htmlFor="o-lang">
              <span>{t.t(fieldLabelKey(OVERRIDE_FORM, 'languageCode'))}</span>
              {kind === 'template' ? <input id="o-lang" name="languageCode" value={values.languageCode ?? ''} readOnly /> : (
                <select id="o-lang" name="languageCode" defaultValue={values.languageCode ?? languages[0]?.code ?? ''}>
                  {languages.map((l) => <option key={l.code} value={l.code}>{l.code} · {l.nameNative} ({l.nameEnglish})</option>)}
                </select>
              )}
            </label>
            {languages.length > 0 && <p className="kv-field__hint">{t.t(languages[0].tenantDeclared ? 'form.override.langsTenant' : 'form.override.langsRegistry')}</p>}
            <label className="kv-field" htmlFor="o-subject">
              <span>{t.t(fieldLabelKey(OVERRIDE_FORM, 'subject'))}</span>
              <input id="o-subject" name="subject" defaultValue={values.subject ?? ''} maxLength={250} />
            </label>
            <label className="kv-field" htmlFor="o-body">
              <span>{t.t(fieldLabelKey(OVERRIDE_FORM, 'body'))}</span>
              <textarea id="o-body" name="body" defaultValue={values.body ?? ''} rows={5} maxLength={4000} required lang={values.languageCode} />
            </label>
            <p className="kv-field__hint">{t.t('form.override.bodyHint')}</p>
            <label className="kv-field" htmlFor="o-reason">
              <span>{t.t(fieldLabelKey(OVERRIDE_FORM, 'reason'))}</span>
              <input id="o-reason" name="reason" defaultValue={values.reason ?? ''} maxLength={300} required />
            </label>
            <p className="kv-field__hint">{t.t('form.override.reasonHint')}</p>
            <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
          </form>
          <p className="kv-field__hint">{t.t(refusedKey('experiment'))}</p>
        </>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(OVERRIDE_FORM, r.code))}</p></div>)}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(OVERRIDE_FORM, f.name))}</td>
                      <td className="kv-template-body">{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>
                          : <strong className="kv-template-body">{f.name === 'lifecycle' ? t.t(lifecycleKey(storedText(f).text)) : storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(OVERRIDE_FORM, r.code))}</div>)}
                        {f.name === 'body' && review!.preview.unknownTokens.length > 0 && <div className="kv-field__hint">{t.t('form.override.unknown', { names: review!.preview.unknownTokens.join(', ') })}</div>}
                        {f.name === 'body' && review!.preview.missingRequired.length > 0 && <div className="kv-field__hint">{t.t('form.override.missing', { names: review!.preview.missingRequired.join(', ') })}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ---- what a member will receive ---- */}
              <h2>{t.t('form.override.previewHeading')}</h2>
              {review.preview.rendered ? (
                <>
                  {review.preview.rendered.subject && <p><strong>{review.preview.rendered.subject}</strong></p>}
                  <p className="kv-template-body kv-template-body--mine" lang={values.languageCode}>{review.preview.rendered.body}</p>
                </>
              ) : <p className="kv-field__hint">{t.t('common.dash')}</p>}
              {seg && <p className="kv-field__hint">{t.t('templates.segments', { chars: formatNumber(seg.characters, lang), segs: formatNumber(seg.segments, lang), per: formatNumber(seg.perSegment, lang), enc: t.t(seg.encodingKey) })} · {t.t(seg.withinBudget ? 'templates.segments.within' : 'templates.segments.over')}</p>}
              <p className="kv-field__hint">{t.t(review.preview.variablesDeclared ? 'form.override.variablesChecked' : 'templates.editor.variablesUndeclared')}</p>
              {review.preview.variables.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('templates.col.variable')}</th><th>{t.t('templates.col.sample')}</th><th>{t.t('templates.col.required')}</th><th>{t.t('templates.col.used')}</th></tr></thead>
                  <tbody>
                    {review.preview.variables.map((x) => (
                      <tr key={x.name}><td><code>{`{{${x.name}}}`}</code></td><td>{x.sampleValue}</td><td>{t.t(x.isRequired ? 'templates.required.yes' : 'templates.required.no')}</td><td>{t.t(x.used ? 'templates.required.yes' : 'templates.required.no')}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="kv-card kv-card--notice" role="status">
                <p>{t.t(review.preview.servesAfterApproval ? 'form.override.servesAfterApproval' : providerKey(review.preview.provider))}</p>
                <p className="kv-field__hint">{t.t('form.override.draftNote')}</p>
              </div>

              {/* W2780: the diff against what members receive TODAY (your serving version, else the platform default). */}
              <p className="kv-field__hint">{t.t(diffKey(review))}{review.diff !== null && <> · {t.t(sourceKey(review.preview.servingToday.source))}</>}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>
                    {review.diff.map((d) => (
                      <tr key={d.field}><td>{t.t(fieldLabelKey(OVERRIDE_FORM, d.field))}</td><td className="kv-template-body">{d.before ?? t.t('common.dash')}</td><td className="kv-template-body"><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {review.diff && review.diff.length === 0 && <p className="kv-field__hint">{t.t('form.diff.unchanged')}</p>}

              {review.ready ? (
                <form action={saveOverrideDraftAction}>
                  {from && <input type="hidden" name="from" value={from} />}
                  {OVERRIDE_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  {/* F-17: the key is the REVIEW's, so a double-submit of this review writes one draft. */}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn">{t.t('form.override.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(PATH, 'edit', withFrom(values), MAX_CARRIED_LENGTH_OVERRIDE)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('form.override.done', { v: createdVersion ?? '' })}</p>
          <p className="kv-field__hint">{t.t('form.override.doneNext')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('notification_template', createdId) && <p><Link href={auditHref('notification_template', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          {createdId && <p><Link href={templateActHref(createdId, 'submit')} className="kv-btn--link">{t.t('templates.act.submit')}</Link></p>}
          {createdId && <p><Link href={templateHref(createdId)} className="kv-btn--link">{t.t('form.override.open')}</Link></p>}
          <p><Link href={TEMPLATES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, withFrom(values), MAX_CARRIED_LENGTH_OVERRIDE)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
