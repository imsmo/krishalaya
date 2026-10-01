// apps/web-tenant/src/app/kyc/submit/page.tsx · THE KYC FORM CHAIN — W2319 form-error → W2320 review → W2321 success →
// W2322 failure, for the canon's three acts *Upload document · Upload first document · Upload renewal* · PC-56 TENANT-9a.
//
// 6d-4's shape: ONE page, four states, values in the URL, and a review THE API COMPUTES (`POST kyc/desk/preview`): which
// ROLES the document will evidence (0180's map ∩ the roles the member holds — F-1/F-2 shown before anything is written),
// its validity window (a licence must carry its date; a lapsed one is refused), whether it RENEWS a verified document
// (which keeps working until its own date — nothing pauses) or re-submits a rejected one, the diff against it, a
// duplicate open submission refused, and the evidence's scan state. The subject is the ORGANISATION (its own documents —
// `kyc.manage`) or a MEMBER (on their behalf — `kyc.manage`; your own needs no verb). THE KEY IS MINTED ON THE REVIEW PAGE.
// The uploader is the one client component (core/media's presigned flow — the 7d precedent); a typed media id works too.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { KycDeskCatalogue, KycSubmitReview } from '@krishalaya/sdk-js';
import { tenantClient } from '../../../lib/api-client';
import { requireSession } from '../../../lib/session';
import { getTranslator, getLang } from '../../../lib/i18n';
import { MediaUploader } from '../../../components/MediaUploader';
import { auditHref, chainHref, chainStep, chainStepKey, failureKey, isFormError, nothingStoredKey, normalisedKey, readCarried, repeatedFailuresGapKey, storedText } from '../../../features/forms/chain';
import { KYC_DESK_HREF, KYC_SUBMIT_HREF, SUBMIT_FIELDS, deskState, docHref, failureCodeKey, fieldKey, refusalKey, subjectKindKey } from '../../../features/kyc/desk';
import { submitKycDocumentAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('kyc.form.title'), robots: { index: false, follow: false } };
}

export default async function KycSubmitPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(KYC_SUBMIT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const failed = typeof searchParams.error === 'string' ? searchParams.error.split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x)) : [];
  const savedId = typeof searchParams.saved === 'string' ? searchParams.saved : null;
  const values = readCarried(searchParams, SUBMIT_FIELDS);
  const subjectKind = values.subjectKind === 'organisation' ? 'organisation' : 'user';
  const c = tenantClient().kyc;

  let cat: KycDeskCatalogue | null = null; let catState: string | null = null;
  if (step === 'edit') { try { cat = await c.deskCatalogue(values.userId); } catch (e) { const err = e instanceof SdkError ? e : null; catState = deskState(err?.code, err?.status); } }
  let review: KycSubmitReview | null = null; let reviewError: string | null = null;
  if (step === 'review') { try { review = await c.deskPreview(values as never); } catch (e) { reviewError = e instanceof SdkError ? (e.code || 'review') : 'review'; } }
  const types = (cat?.docTypes ?? []).filter((d) => d.subjectKind === subjectKind);
  const uploaderLabels = { add: t.t('kyc.photoAdd'), hint: t.t('kyc.form.uploadHint'), uploading: t.t('kyc.photoUploading'), failed: t.t('kyc.photoFailed'), remove: t.t('kyc.photoRemove') };

  return (
    <section>
      <h1>{t.t('kyc.form.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review as never)))} · {t.t('kyc.form.module')}</p>
      <p className="kv-field__hint"><Link href={KYC_DESK_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {step === 'edit' && (
        <>
          {catState && <div className={catState === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="status"><p>{t.t(`kyc.desk.state.${catState}.body`)}</p></div>}
          <form action={KYC_SUBMIT_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="edit" />
            <label className="kv-field" htmlFor="k-subject"><span>{t.t(fieldKey('subjectKind'))}</span>
              <select id="k-subject" name="subjectKind" className="kv-select" defaultValue={subjectKind}>
                <option value="organisation">{t.t(subjectKindKey('organisation'))}</option>
                <option value="user">{t.t(subjectKindKey('user'))}</option>
              </select></label>
            {subjectKind === 'user' && <label className="kv-field" htmlFor="k-user0"><span>{t.t(fieldKey('userId'))}</span><input id="k-user0" name="userId" className="kv-input" defaultValue={values.userId ?? ''} inputMode="text" autoComplete="off" /></label>}
            <button type="submit" className="kv-btn--link">{t.t('kyc.form.chooseSubject')}</button>
          </form>
          {subjectKind === 'user' && cat && (
            <p className="kv-field__hint">{cat.heldRoles === null ? t.t('kyc.form.notMember') : t.t('kyc.form.holds', { name: cat.subjectName ?? t.t('kyc.form.you'), roles: cat.heldRoles.join(', ') || t.t('common.dash') })}</p>
          )}
          <form action={KYC_SUBMIT_HREF} method="get" className="kv-card kv-form">
            <input type="hidden" name="step" value="review" />
            <input type="hidden" name="subjectKind" value={subjectKind} />
            {subjectKind === 'user' && <input type="hidden" name="userId" value={values.userId ?? ''} />}
            <label className="kv-field" htmlFor="k-type"><span>{t.t(fieldKey('docTypeCode'))}</span>
              <select id="k-type" name="docTypeCode" className="kv-select" defaultValue={values.docTypeCode ?? ''} required>
                <option value="" disabled>{t.t('kyc.docTypeChoose')}</option>
                {types.map((d) => <option key={d.code} value={d.code}>{d.name}{d.validity === 'required' ? ` · ${t.t('kyc.form.lapses')}` : ''}{d.evidences.length ? ` — ${t.t('kyc.form.evidences', { roles: d.evidences.join(', ') })}` : ''}</option>)}
              </select></label>
            {subjectKind === 'user' && cat?.heldRoles && cat.heldRoles.length > 1 && (
              <label className="kv-field" htmlFor="k-role"><span>{t.t(fieldKey('roleCode'))}</span>
                <select id="k-role" name="roleCode" className="kv-select" defaultValue={values.roleCode ?? ''}>
                  <option value="">{t.t('kyc.form.everyEvidenced')}</option>
                  {cat.heldRoles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select></label>
            )}
            <span className="kv-field__label">{t.t(fieldKey('mediaId'))}</span>
            <MediaUploader labels={uploaderLabels} fieldName="mediaId" single kind="document" inputId="k-media-file" />
            <label className="kv-field" htmlFor="k-media"><span>{t.t('kyc.form.mediaTyped')}</span><input id="k-media" name="mediaId" className="kv-input" defaultValue={values.mediaId ?? ''} autoComplete="off" /></label>
            <label className="kv-field" htmlFor="k-no"><span>{t.t(fieldKey('docNoMasked'))}</span><input id="k-no" name="docNoMasked" className="kv-input" defaultValue={values.docNoMasked ?? ''} maxLength={50} autoComplete="off" /></label>
            <p className="kv-field__hint">{t.t('kyc.form.maskHint')}</p>
            <label className="kv-field" htmlFor="k-issuer"><span>{t.t(fieldKey('issuedBy'))}</span><input id="k-issuer" name="issuedBy" className="kv-input" defaultValue={values.issuedBy ?? ''} maxLength={150} /></label>
            <label className="kv-field" htmlFor="k-from"><span>{t.t(fieldKey('validFrom'))}</span><input id="k-from" name="validFrom" type="date" className="kv-input" defaultValue={values.validFrom ?? ''} /></label>
            <label className="kv-field" htmlFor="k-until"><span>{t.t(fieldKey('validUntil'))}</span><input id="k-until" name="validUntil" type="date" className="kv-input" defaultValue={values.validUntil ?? ''} /></label>
            <p className="kv-field__hint">{t.t('kyc.form.validityHint')}</p>
            <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
          </form>
        </>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t(reviewError === 'KYC_DESK_RESTRICTED' ? 'kyc.desk.state.restricted.body' : 'form.reviewFailed')} <code>{reviewError}</code></p></div>}
          {review && (
            <>
              {review.refusals.filter((r) => r.field === null).map((r) => <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(r.code))}</p></div>)}
              <table className="kv-table">
                <caption className="kv-sr-only">{t.t('form.step.review')}</caption>
                <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.entered')}</th><th scope="col">{t.t('form.col.stored')}</th></tr></thead>
                <tbody>{review.fields.map((f) => (
                  <tr key={f.name}>
                    <th scope="row">{t.t(fieldKey(f.name))}</th>
                    <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                    <td>
                      {storedText(f as never).isNothing ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span> : <strong>{f.name === 'subjectKind' ? t.t(subjectKindKey(f.stored ?? '')) : f.stored}</strong>}
                      {f.normalised && f.stored !== null && <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>}
                      {review!.refusals.filter((r) => r.field === f.name).map((r) => <div className="kv-error" key={r.code}>{t.t(refusalKey(r.code))}</div>)}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
              <div className="kv-card">
                <h2>{t.t('kyc.form.what')}</h2>
                <dl className="kv-facts">
                  <dt>{t.t('kyc.form.willEvidence')}</dt>
                  <dd>{review.subjectKind === 'organisation' ? t.t('kyc.form.orgEvidence') : review.evidences.length ? review.evidences.join(', ') : t.t('common.dash')}</dd>
                  <dt>{t.t('kyc.form.follows')}</dt>
                  <dd>{review.follows ? <>{t.t(review.follows.kind === 'renewal' ? 'kyc.form.renewal' : 'kyc.form.resubmission')} · <Link href={docHref(review.follows.id)} className="kv-btn--link">{t.t('kyc.desk.openDoc')}</Link></> : t.t('kyc.form.newDoc')}</dd>
                  <dt>{t.t('kyc.doc.validity')}</dt>
                  <dd>{review.validity.validUntil ? `${review.validity.validUntil}${review.validity.daysValid !== null ? ` · ${t.t('kyc.desk.daysLeft', { n: formatNumber(review.validity.daysValid, lang) })}` : ''}` : t.t('kyc.desk.perpetual')}</dd>
                  <dt>{t.t('kyc.form.scan')}</dt>
                  <dd>{t.t(`kyc.doc.scan.${['clean', 'pending', 'infected', 'failed'].includes(review.scan ?? '') ? review.scan : 'unknown'}`)}</dd>
                </dl>
                <p className="kv-field__hint">{t.t(review.follows?.kind === 'renewal' ? 'kyc.doc.renewal.2' : 'kyc.form.pendingRule')}</p>
              </div>
              <p className="kv-field__hint">{t.t(review.diff === null ? 'form.diff.notApplicable' : 'form.diff.heading')}</p>
              {review.diff && review.diff.length > 0 && (
                <table className="kv-table">
                  <thead><tr><th scope="col">{t.t('form.col.field')}</th><th scope="col">{t.t('form.col.before')}</th><th scope="col">{t.t('form.col.after')}</th></tr></thead>
                  <tbody>{review.diff.map((d) => <tr key={d.field}><th scope="row">{t.t(fieldKey(d.field))}</th><td>{d.before ?? t.t('common.dash')}</td><td><strong>{d.after ?? t.t('common.dash')}</strong></td></tr>)}</tbody>
                </table>
              )}
              {review.ready ? (
                <form action={submitKycDocumentAction}>
                  {SUBMIT_FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn">{t.t('kyc.form.submit')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('form.fixFirst')}</p>}
              <p><Link href={chainHref(KYC_SUBMIT_HREF, 'edit', values)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('kyc.form.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {savedId && <p><Link href={docHref(savedId)} className="kv-btn kv-btn--primary">{t.t('kyc.desk.openDoc')}</Link>{' · '}<Link href={auditHref('kyc_document', savedId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>}
          <p><Link href={KYC_DESK_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(failureCodeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={chainHref(KYC_SUBMIT_HREF, 'review', values)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={KYC_DESK_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
