// apps/web-tenant/src/components/PageFormScreen.tsx · PC-56 TENANT-8c · the page FORM chain, one screen for the canon's
// three chains that write a page:
//   • pages-form W2703–W2706 — *"New page"* (W175) at `/content/pages/new`;
//   • page-form W2696–W2699 — *"Choose kind"* (W176's new-page state; the editor's chain on a slug) at
//     `/content/pages/[slug]/edit` — the open draft if one waits, else the slug's next version;
//   • faq-form W2605–W2608 — *"New FAQ entry · New entry"* (W177) at `/content/faq/new`, the kind fixed to `faq`.
//
// The canon's shared form pattern (B2), 6d-4's shape: four states (edit · review/form-error · success · failure), values
// in the URL, and a review THE API COMPUTES (`cms.pages.preview`) from the facts the writer uses — the slug's own versions
// and the platform's, the kinds, the FAQ topics, this cooperative's languages. The review shows what the form never
// asked: which write this is (a new page, version N, or an edit of draft N), that it is born a DRAFT, the platform
// version it will replace, whether a second person must publish it (a POLICY page), and the raw HTML tags it refused by
// name. THE KEY IS MINTED ON THE REVIEW PAGE AND TRAVELS IN THE FORM (F-17's lesson) with the review's `expect` token, so
// a colleague who wrote first makes the submit a typed 409 rather than a second version.
//
// A server component; no client JS beyond the house pattern (a GET form, a server action, a hidden key).
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { tenantClient } from '../lib/api-client';
import { getTranslator } from '../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsPageReview, CmsSlugView, CmsVocabulary } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, carryValues, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey, normalisedKey,
  readCarried, refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey,
} from '../features/forms/chain';
import {
  MAX_CARRIED_LENGTH_PAGE, PAGE_FIELDS, PAGE_FORM, PAGE_KIND_VALUES, chainBackHref, chainIntent, chainModuleKey, chainPath, chainTitleKey, editValues, isKnownTopic, kindKey, pageActHref,
  pageHref, refusedKey, servingKey, statusKey, topicKey, type PageChain,
} from '../features/pages/pages';
import { savePageAction } from '../app/content/pages/new/actions';

export async function PageFormScreen({ chain, slug, searchParams }: { chain: PageChain; slug?: string | null; searchParams: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const PATH = chainPath(chain, slug);
  const backHref = chainBackHref(chain, slug);
  let values = readCarried(searchParams, PAGE_FIELDS);
  if (chain === 'faq') values = { ...values, pageKind: 'faq' };
  if (chain === 'page' && slug) values = { ...values, slug };
  const carried = carryValues(step, values, MAX_CARRIED_LENGTH_PAGE);
  const createdId = typeof searchParams.created === 'string' ? searchParams.created : null;
  const createdVersion = typeof searchParams.version === 'string' ? searchParams.version : null;
  const createdSlug = typeof searchParams.createdSlug === 'string' ? searchParams.createdSlug : null;
  const needsChecker = searchParams.checker === '1';
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const c = tenantClient().cms.pages;

  // The editor's chain starts from the slug's words: the open draft, else the latest version, else the platform's.
  let source: CmsSlugView | null = null;
  if (chain === 'page' && slug && step === 'edit') {
    try { source = await c.view(slug); } catch { source = null; }
    if (source && Object.keys(readCarried(searchParams, PAGE_FIELDS)).length === 0) values = editValues(source);
  }
  let vocab: CmsVocabulary | null = null; let loadError: string | null = null;
  if (step === 'edit') {
    try { vocab = await c.vocabulary(); } catch (e) { loadError = e instanceof SdkError ? (e.code || 'load') : 'load'; }
  }
  let review: CmsPageReview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    try { review = await c.preview({ ...values, intent: chainIntent(chain) }); }
    catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }
  const kindFixed = chain === 'faq' || (source !== null && source.versions.length > 0);

  return (
    <section>
      <h1>{t.t(chainTitleKey(chain))}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))} · {t.t(chainModuleKey(chain))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}

      {step === 'edit' && (
        <>
          {loadError && <div className="kv-error" role="alert"><p>{t.t('form.page.loadFailed')} {loadError}</p></div>}
          {source?.draft && <p className="kv-field__hint">{t.t('form.page.editingDraft', { v: String(source.draft.version) })}</p>}
          {source && !source.draft && source.latest && <p className="kv-field__hint">{t.t('form.page.startingVersion', { v: String(source.latest.version + 1), from: String(source.latest.version) })}</p>}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="review" />
            <label className="kv-field" htmlFor="p-slug">
              <span>{t.t(fieldLabelKey(PAGE_FORM, 'slug'))}</span>
              <input id="p-slug" name="slug" defaultValue={values.slug ?? ''} maxLength={150} required readOnly={chain === 'page'} />
            </label>
            <p className="kv-field__hint">{t.t('form.page.slugHint')}</p>
            <label className="kv-field" htmlFor="p-kind">
              <span>{t.t(fieldLabelKey(PAGE_FORM, 'pageKind'))}</span>
              {kindFixed ? <input id="p-kind" name="pageKind" value={values.pageKind ?? ''} readOnly /> : (
                <select id="p-kind" name="pageKind" defaultValue={values.pageKind ?? ''} required>
                  <option value="">{t.t('form.page.kindChoose')}</option>
                  {(vocab?.kinds ?? [...PAGE_KIND_VALUES]).map((k) => <option key={k} value={k}>{t.t(kindKey(k))}</option>)}
                </select>
              )}
            </label>
            <p className="kv-field__hint">{t.t('form.page.kindHint')}</p>
            {(values.pageKind === 'faq' || chain === 'faq') && (
              <label className="kv-field" htmlFor="p-topic">
                <span>{t.t(fieldLabelKey(PAGE_FORM, 'topic'))}</span>
                <select id="p-topic" name="topic" defaultValue={values.topic ?? ''} required>
                  <option value="">{t.t('form.page.topicChoose')}</option>
                  {(vocab?.topics ?? []).map((x) => <option key={x.code} value={x.code}>{isKnownTopic(x.code) ? t.t(topicKey(x.code)) : x.name}</option>)}
                </select>
              </label>
            )}
            <label className="kv-field" htmlFor="p-lang">
              <span>{t.t(fieldLabelKey(PAGE_FORM, 'languageCode'))}</span>
              <select id="p-lang" name="languageCode" defaultValue={values.languageCode ?? vocab?.languages[0]?.code ?? ''}>
                {(vocab?.languages ?? []).map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.code} · {l.nameNative} ({l.nameEnglish})</option>)}
              </select>
            </label>
            {vocab && vocab.languages.length > 0 && <p className="kv-field__hint">{t.t(vocab.languages[0].tenantDeclared ? 'form.page.langsTenant' : 'form.page.langsRegistry')}</p>}
            <label className="kv-field" htmlFor="p-title">
              <span>{t.t(fieldLabelKey(PAGE_FORM, chain === 'faq' ? 'question' : 'defaultTitle'))}</span>
              <input id="p-title" name="defaultTitle" defaultValue={values.defaultTitle ?? ''} maxLength={250} required lang={values.languageCode} />
            </label>
            <label className="kv-field" htmlFor="p-body">
              <span>{t.t(fieldLabelKey(PAGE_FORM, chain === 'faq' ? 'answer' : 'body'))}</span>
              <textarea id="p-body" name="body" defaultValue={values.body ?? ''} rows={12} required lang={values.languageCode} />
            </label>
            <p className="kv-field__hint">{t.t(chain === 'faq' ? 'form.page.answerHint' : 'form.page.bodyHint')}</p>
            <label className="kv-field" htmlFor="p-reason">
              <span>{t.t(fieldLabelKey(PAGE_FORM, 'reason'))}</span>
              <input id="p-reason" name="reason" defaultValue={values.reason ?? ''} maxLength={300} required />
            </label>
            <p className="kv-field__hint">{t.t('form.page.reasonHint')}</p>
            <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
          </form>
          <p className="kv-field__hint">{t.t(refusedKey('voiceToDraft'))}</p>
        </>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(PAGE_FORM, r.code))}</p></div>)}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(PAGE_FORM, f.name))}</td>
                      <td className="kv-page-body">{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>
                          : <strong className="kv-page-body">{f.name === 'pageKind' ? t.t(kindKey(storedText(f).text)) : f.name === 'status' ? t.t(statusKey(storedText(f).text)) : f.name === 'topic' && isKnownTopic(storedText(f).text) ? t.t(topicKey(storedText(f).text)) : storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(PAGE_FORM, r.code))}</div>)}
                        {f.name === 'body' && review!.preview.rawHtmlTags.length > 0 && <div className="kv-field__hint">{t.t('form.page.tagsFound', { tags: review!.preview.rawHtmlTags.map((x) => `<${x}>`).join(' ') })}</div>}
                        {f.name === 'body' && review!.preview.unsafeLinkSchemes.length > 0 && <div className="kv-field__hint">{t.t('form.page.schemesFound', { schemes: review!.preview.unsafeLinkSchemes.join(', ') })}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ---- what this write IS ---- */}
              <div className="kv-card kv-card--notice" role="status">
                {review.preview.mode && <p>{t.t(`form.page.mode.${review.preview.mode}`, { v: String(review.preview.version ?? '') })}</p>}
                {review.preview.historyVersions.length > 0 && <p className="kv-field__hint">{t.t('form.page.historyKept', { versions: review.preview.historyVersions.map((x) => `v${x}`).join(', ') })}</p>}
                <p className="kv-field__hint">{t.t(servingKey(review.preview.servingToday), { v: String(review.preview.servingToday.version ?? '') })}</p>
                {review.preview.replacesPlatformVersion !== null && <p className="kv-field__hint">{t.t('form.page.replacesPlatform', { v: String(review.preview.replacesPlatformVersion) })}</p>}
                {review.preview.needsChecker && <p><strong>{t.t('form.page.needsChecker')}</strong></p>}
                {review.preview.faqPlace !== null && <p className="kv-field__hint">{t.t('form.page.faqPlace', { n: String(review.preview.faqPlace) })}</p>}
                <p className="kv-field__hint">{t.t('form.page.draftNote')}</p>
              </div>

              <p className="kv-field__hint">{t.t(diffKey(review))}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>
                    {review.diff.map((d) => (
                      <tr key={d.field}><td>{t.t(fieldLabelKey(PAGE_FORM, d.field))}</td><td className="kv-page-body">{d.before ?? t.t('common.dash')}</td><td className="kv-page-body"><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              )}

              {review.ready ? (
                <form action={savePageAction}>
                  <input type="hidden" name="chain" value={chain} />
                  {slug && <input type="hidden" name="routeSlug" value={slug} />}
                  {PAGE_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  {/* F-20 + F-17: the review's own token and the REVIEW's key — a colleague who wrote first is a 409; a double-submit one write. */}
                  <input type="hidden" name="expect" value={review.preview.expect ?? ''} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn">{t.t('form.page.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(PATH, 'edit', values, MAX_CARRIED_LENGTH_PAGE)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('form.page.done', { v: createdVersion ?? '' })}</p>
          <p className="kv-field__hint">{t.t(needsChecker ? 'form.page.doneChecker' : 'form.page.doneNext')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('cms_page', createdId) && <p><Link href={auditHref('cms_page', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          {createdId && createdSlug && <p><Link href={pageActHref(createdSlug, createdId, 'publish')} className="kv-btn--link">{t.t('pages.act.publish', { v: createdVersion ?? '' })}</Link></p>}
          {createdSlug && <p><Link href={pageHref(createdSlug)} className="kv-btn--link">{t.t('form.page.open')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          {failed === 'CMS_PAGE_CHANGED' && <p>{t.t('form.page.changed')}</p>}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, values, MAX_CARRIED_LENGTH_PAGE)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
