// apps/web-tenant/src/components/BannerFormScreen.tsx · PC-56 TENANT-8d · the banner FORM chain, one screen for the
// canon's two chains that write a banner:
//   • banners-form W2510–W2513 — *"New banner"* (W173) at `/content/banners/new` — born a DRAFT;
//   • banner-form W2503–W2506 — *"Add gu variant · Save changes"* (W174) at `/content/banners/[id]/edit` — the banner as it
//     stands, every field editable (PC-27 could not edit a banner at all after create).
//
// The canon's shared form pattern (B2), 6d-4's shape: four states (edit · review/form-error · success · failure), values
// in the URL, and a review THE API COMPUTES (`cms.banners.preview`) from the facts the writer uses — the placement
// vocabulary, the cooperative's own clean images (F-8), the roles and regions registries, the window resolved in the
// cooperative's zone, the required languages. The review shows what the form never asked: the state it will have, its
// place in the slot, the zone the window was read in, which required languages still have no words (so it "cannot be
// activated yet"), that an ACTIVE banner's change reaches members at once, and who it reaches today by language. THE
// KEY IS MINTED ON THE REVIEW PAGE AND TRAVELS IN THE FORM (F-17's lesson) with the review's content token (`expect`),
// so a colleague who saved first makes the submit a typed 409 rather than a silent overwrite.
//
// A server component; no client JS beyond the house pattern (a GET form, a server action, a hidden key). Roles and regions
// are checkboxes (one URL key, many values — `readBannerValues` joins them).
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { tenantClient } from '../lib/api-client';
import { getTranslator, getLang } from '../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsBannerReview, CmsBannerView, CmsBannerVocabulary } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, carryValues, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey, generalRefusals, isFormError, nothingStoredKey, normalisedKey,
  refusalKey, refusalsFor, repeatedFailuresGapKey, retryHref, storedText, valuesLostKey,
} from '../features/forms/chain';
import {
  BANNER_FORM, BANNER_TEXT_PARTS, MAX_CARRIED_LENGTH_BANNER, bannerActHref, bannerFieldNames, bannerHref, chainBackHref, chainModuleKey, chainPath, chainTitleKey, editValues, formLanguages,
  isKnownPlacement, listHas, phaseKey, placementKey, readBannerValues, refusedKey, stateKey, textFieldName, type BannerChain,
} from '../features/banners/banners';
import { saveBannerAction } from '../app/content/banners/new/actions';

/** A review row's label: a text field names its part and its language. */
function rowLabel(t: ReturnType<typeof getTranslator>, name: string): string {
  const m = /^(headline|body|cta)_([a-z]{2,3})$/.exec(name);
  return m ? t.t(fieldLabelKey(BANNER_FORM, m[1]), { lang: m[2] }) : t.t(fieldLabelKey(BANNER_FORM, name));
}

export async function BannerFormScreen({ chain, id, searchParams }: { chain: BannerChain; id?: string | null; searchParams: Record<string, string | string[] | undefined> }) {
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const PATH = chainPath(chain, id);
  const backHref = chainBackHref(chain, id);
  const c = tenantClient().cms.banners;
  const createdId = typeof searchParams.created === 'string' ? searchParams.created : null;
  const createdMissing = typeof searchParams.missing === 'string' ? searchParams.missing : '';
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;

  let vocab: CmsBannerVocabulary | null = null; let loadError: string | null = null;
  try { vocab = await c.vocabulary(); } catch (e) { loadError = e instanceof SdkError ? (e.code || 'load') : 'load'; }
  const languages = formLanguages(vocab?.languages.map((l) => l.code) ?? []);
  const names = bannerFieldNames(languages);
  let values = readBannerValues(searchParams, names);

  // The edit chain starts from the banner as it stands.
  let current: CmsBannerView | null = null;
  if (chain === 'banner' && id && (step === 'edit' || step === 'review')) {
    try { current = await c.get(id); } catch { current = null; }
    if (current && step === 'edit' && Object.keys(values).length === 0) values = editValues(current);
  }
  const carried = carryValues(step, values, MAX_CARRIED_LENGTH_BANNER);

  let review: CmsBannerReview | null = null; let reviewError: string | null = null;
  if (step === 'review') {
    try { review = await c.preview({ ...values, intent: chain === 'banner' ? 'edit' : 'new' }, chain === 'banner' && id ? id : undefined); }
    catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }

  return (
    <section>
      <h1>{t.t(chainTitleKey(chain))}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))} · {t.t(chainModuleKey(chain))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}

      {step === 'edit' && (
        <>
          {loadError && <div className="kv-error" role="alert"><p>{t.t('form.banner.loadFailed')} {loadError}</p></div>}
          {current && <p className="kv-field__hint">{t.t('form.banner.editing', { state: t.t(stateKey(current.state)), phase: t.t(phaseKey(current.phase)) })}</p>}
          {current?.state === 'active' && <p className="kv-field__hint"><strong>{t.t('form.banner.liveNow')}</strong></p>}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="review" />
            <fieldset>
              <legend>{t.t('form.banner.where')}</legend>
              <label className="kv-field" htmlFor="b-placement">
                <span>{t.t(fieldLabelKey(BANNER_FORM, 'placement'))}</span>
                <select id="b-placement" name="placement" defaultValue={values.placement ?? ''} required>
                  <option value="">{t.t('form.banner.placementChoose')}</option>
                  {(vocab?.placements ?? []).filter((p) => p.chosen || p.code === values.placement).map((p) => (
                    <option key={p.code} value={p.code}>{isKnownPlacement(p.code) ? t.t(placementKey(p.code)) : p.name}</option>
                  ))}
                </select>
              </label>
              <label className="kv-field" htmlFor="b-media">
                <span>{t.t(fieldLabelKey(BANNER_FORM, 'mediaId'))}</span>
                <select id="b-media" name="mediaId" defaultValue={values.mediaId ?? ''} required>
                  <option value="">{t.t('form.banner.mediaChoose')}</option>
                  {values.mediaId && !(vocab?.images ?? []).some((m) => m.id === values.mediaId) && <option value={values.mediaId}>{values.mediaId}</option>}
                  {(vocab?.images ?? []).map((m) => <option key={m.id} value={m.id}>{m.s3Key.split('/').pop()}</option>)}
                </select>
              </label>
              <p className="kv-field__hint">{t.t('form.banner.mediaHint')}</p>
              <label className="kv-field" htmlFor="b-group">
                <span>{t.t(fieldLabelKey(BANNER_FORM, 'groupKey'))}</span>
                <input id="b-group" name="groupKey" defaultValue={values.groupKey ?? ''} maxLength={60} />
              </label>
              <p className="kv-field__hint">{t.t('form.banner.groupHint')}</p>
              <label className="kv-field" htmlFor="b-target">
                <span>{t.t(fieldLabelKey(BANNER_FORM, 'targetUrl'))}</span>
                <input id="b-target" name="targetUrl" type="url" defaultValue={values.targetUrl ?? ''} maxLength={400} inputMode="url" />
              </label>
              <p className="kv-field__hint">{t.t(refusedKey('deepLink'))}</p>
            </fieldset>

            <fieldset>
              <legend>{t.t('form.banner.when', { zone: vocab?.timezone ?? '' })}</legend>
              <label className="kv-field" htmlFor="b-sd"><span>{t.t(fieldLabelKey(BANNER_FORM, 'startsDate'))}</span>
                <input id="b-sd" name="startsDate" type="date" defaultValue={values.startsDate ?? ''} required /></label>
              <label className="kv-field" htmlFor="b-st"><span>{t.t(fieldLabelKey(BANNER_FORM, 'startsTime'))}</span>
                <input id="b-st" name="startsTime" type="time" defaultValue={values.startsTime ?? ''} required /></label>
              <label className="kv-field" htmlFor="b-ed"><span>{t.t(fieldLabelKey(BANNER_FORM, 'endsDate'))}</span>
                <input id="b-ed" name="endsDate" type="date" defaultValue={values.endsDate ?? ''} required /></label>
              <label className="kv-field" htmlFor="b-et"><span>{t.t(fieldLabelKey(BANNER_FORM, 'endsTime'))}</span>
                <input id="b-et" name="endsTime" type="time" defaultValue={values.endsTime ?? ''} required /></label>
              <p className="kv-field__hint">{t.t('form.banner.windowHint')}</p>
            </fieldset>

            <fieldset>
              <legend>{t.t('form.banner.who')}</legend>
              <p className="kv-field__hint">{t.t('form.banner.whoHint')}</p>
              <div role="group" aria-labelledby="b-roles-label">
                <p id="b-roles-label"><strong>{t.t(fieldLabelKey(BANNER_FORM, 'roles'))}</strong></p>
                {(vocab?.roles ?? []).map((r) => (
                  <label key={r.code} className="kv-check" htmlFor={`b-role-${r.code}`}>
                    <input id={`b-role-${r.code}`} type="checkbox" name="roles" value={r.code} defaultChecked={listHas(values.roles, r.code)} /> {r.name} <code>{r.code}</code>
                  </label>
                ))}
              </div>
              <div role="group" aria-labelledby="b-regions-label">
                <p id="b-regions-label"><strong>{t.t(fieldLabelKey(BANNER_FORM, 'regions'))}</strong></p>
                {(vocab?.regions ?? []).map((g) => (
                  <label key={g.id} className="kv-check" htmlFor={`b-region-${g.id}`}>
                    <input id={`b-region-${g.id}`} type="checkbox" name="regions" value={g.id} defaultChecked={listHas(values.regions, g.id)} /> {g.name}
                  </label>
                ))}
              </div>
              <p className="kv-field__hint">{t.t(refusedKey('minOrders'))} {t.t(refusedKey('kyc'))} {t.t(refusedKey('clusters'))}</p>
            </fieldset>

            <fieldset>
              <legend>{t.t('form.banner.words')}</legend>
              <p className="kv-field__hint">{t.t('form.banner.wordsHint', { langs: (vocab?.requiredLanguages ?? []).join(' · ') })}</p>
              {languages.map((l) => {
                const meta = vocab?.languages.find((x) => x.code === l);
                return (
                  <div key={l} className="kv-banner-words" lang={l}>
                    <p><strong>{meta ? `${meta.nameNative} (${meta.nameEnglish})` : l}</strong>{meta?.required && <span className="kv-field__hint"> · {t.t('form.banner.required')}</span>}</p>
                    {BANNER_TEXT_PARTS.map((p) => (
                      <label key={p} className="kv-field" htmlFor={`b-${p}-${l}`}>
                        <span>{t.t(fieldLabelKey(BANNER_FORM, p), { lang: l })}</span>
                        <input id={`b-${p}-${l}`} name={textFieldName(p, l)} defaultValue={values[textFieldName(p, l)] ?? ''} maxLength={p === 'headline' ? 120 : p === 'body' ? 300 : 40} lang={l} />
                      </label>
                    ))}
                  </div>
                );
              })}
            </fieldset>

            <label className="kv-field" htmlFor="b-reason">
              <span>{t.t(fieldLabelKey(BANNER_FORM, 'reason'))}</span>
              <input id="b-reason" name="reason" defaultValue={values.reason ?? ''} maxLength={300} required />
            </label>
            <p className="kv-field__hint">{t.t('form.banner.reasonHint')}</p>
            <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
          </form>
        </>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(BANNER_FORM, r.code))}</p></div>)}
              <table className="kv-table">
                <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.entered')}</th><th>{t.t('form.col.stored')}</th></tr></thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{rowLabel(t, f.name)}</td>
                      <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>
                          : <strong>{f.name === 'placement' && isKnownPlacement(storedText(f).text) ? t.t(placementKey(storedText(f).text)) : f.name === 'state' ? t.t(stateKey(storedText(f).text)) : storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                        {refusalsFor(review, f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(BANNER_FORM, r.code))}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* ---- what this write IS ---- */}
              <div className="kv-card kv-card--notice" role="status">
                <p>{t.t(review.preview.mode === 'update' ? 'form.banner.mode.update' : 'form.banner.mode.create', { state: t.t(stateKey(review.preview.state)) })}</p>
                {review.preview.liveNow && <p><strong>{t.t('form.banner.liveNow')}</strong></p>}
                {review.preview.missingLanguages.length > 0
                  ? <p>{t.t('form.banner.cannotActivate', { langs: review.preview.missingLanguages.join(' · ') })}</p>
                  : review.preview.activatable && <p className="kv-field__hint">{t.t('form.banner.canActivate')}</p>}
                {review.preview.placementChanged && <p className="kv-field__hint">{t.t('form.banner.placementChanged')}</p>}
                {review.preview.everyone && <p className="kv-field__hint">{t.t('banners.audience.everyone')}</p>}
                {review.reach && (
                  <p className="kv-field__hint">
                    {t.t('form.banner.reach', { n: formatNumber(review.reach.matched, lang), hidden: formatNumber(review.reach.hiddenNoText, lang) })}
                  </p>
                )}
                {review.preview.groupKey && <p className="kv-field__hint">{t.t(refusedKey('abAllocation'))}</p>}
                <p className="kv-field__hint">{t.t('banners.reader.none')}</p>
              </div>

              <p className="kv-field__hint">{t.t(diffKey(review))}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th>{t.t('form.col.field')}</th><th>{t.t('form.col.before')}</th><th>{t.t('form.col.after')}</th></tr></thead>
                  <tbody>
                    {review.diff.map((d) => (
                      <tr key={d.field}><td>{rowLabel(t, d.field)}</td><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>
                    ))}
                  </tbody>
                </table>
              )}

              {review.ready ? (
                <form action={saveBannerAction}>
                  <input type="hidden" name="chain" value={chain} />
                  {id && <input type="hidden" name="routeId" value={id} />}
                  {Object.entries(values).map(([k, val]) => <input type="hidden" name={k} value={val} key={k} />)}
                  {/* The review's content token and the REVIEW's key — a colleague who saved first is a 409; a double-submit one write. */}
                  {review.preview.expect && <input type="hidden" name="expect" value={review.preview.expect} />}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn">{t.t(chain === 'banner' ? 'form.banner.submitEdit' : 'form.banner.submitNew')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(PATH, 'edit', values, MAX_CARRIED_LENGTH_BANNER)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t(chain === 'banner' ? 'form.banner.doneEdit' : 'form.banner.doneNew')}</p>
          {createdMissing && <p className="kv-field__hint">{t.t('form.banner.cannotActivate', { langs: createdMissing.split(',').join(' · ') })}</p>}
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('banner', createdId) && <p><Link href={auditHref('banner', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          {createdId && !createdMissing && chain === 'banners' && <p><Link href={bannerActHref(createdId, 'activate')} className="kv-btn--link">{t.t('banners.act.activate')}</Link></p>}
          {createdId && <p><Link href={bannerHref(createdId)} className="kv-btn--link">{t.t('form.banner.open')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          {failed === 'CMS_BANNER_CHANGED' && <p>{t.t('form.banner.changed')}</p>}
          {failed === 'CMS_BANNER_MEDIA_REFUSED' && <p>{t.t('form.banner.mediaRefused')}</p>}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, values, MAX_CARRIED_LENGTH_BANNER)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
