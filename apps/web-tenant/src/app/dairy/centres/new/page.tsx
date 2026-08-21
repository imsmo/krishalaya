// apps/web-tenant/src/app/dairy/centres/new/page.tsx · the dairy form chain — W2555–W2558 · PC-56 TENANT-6d-4.
//
// The canon's shared form pattern (B2) names the action this chain hosts: **"Add centre"**. TENANT-6d-2 built that
// action as a plain form on the board — submit and hope — and left the four chain screens for this wave, because the
// chain is not decoration: it is a maker-checker step over a record that decides who is answerable for a village's
// milk.
//
// ONE PAGE, FOUR STATES, VALUES IN THE URL. No client JS, so *"values you entered are preserved"* means the query
// string — which also makes every step bookmarkable and the Back button correct.
//
// AND THE REVIEW IS COMPUTED BY THE API. What the screen shows is not what the operator typed: it is what the platform
// WILL WRITE (`2000` → `2000.00`, a blank operator → *nobody holds this centre yet*) and every reason the write would
// be refused, from the same facts and the same function `create` uses. A review that says "ready" cannot be followed
// by a failure screen.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyReview } from '@krishalaya/sdk-js';
import {
  auditHref, canLinkAudit, chainHref, chainStep, chainStepKey, diffKey, failureKey, fieldLabelKey,
  generalRefusals, isFormError, nothingStoredKey, normalisedKey, readCarried, refusalKey, refusalsFor,
  repeatedFailuresGapKey, retryHref, storedText, valuesLostKey, carryValues,
} from '../../../../features/forms/chain';
import { CENTRES_HREF } from '../../../../features/dairy/centres';
import { createCentreFromChainAction } from './actions';

export const dynamic = 'force-dynamic';

const PATH = '/dairy/centres/new';
const FORM = 'centre';
/** Every field this chain carries. One list, used by the reader, the form and the retry link. */
const FIELDS = [
  'code', 'defaultName', 'capacityLitresShift', 'analyzerModel', 'analyzerSerial', 'operatorUserId', 'operatorReason',
  'morningOpensAt', 'morningClosesAt', 'eveningOpensAt', 'eveningClosesAt',
] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.centre.title'), robots: { index: false, follow: false } };
}

export default async function AddCentrePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PATH);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const createdId = typeof searchParams.id === 'string' ? searchParams.id : null;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;

  // The review is asked for ONLY on the review step: the edit form must not tell an operator a code is taken before
  // they have finished typing it.
  let review: DairyReview | null = null;
  let reviewError: string | null = null;
  if (step === 'review') {
    try {
      review = await tenantClient().dairy.previewMcc({
        code: values.code, defaultName: values.defaultName,
        capacityLitresShift: values.capacityLitresShift, analyzerModel: values.analyzerModel,
        analyzerSerial: values.analyzerSerial, operatorUserId: values.operatorUserId,
        operatorReason: values.operatorReason,
        morningOpensAt: values.morningOpensAt, morningClosesAt: values.morningClosesAt,
        eveningOpensAt: values.eveningOpensAt, eveningClosesAt: values.eveningClosesAt,
      });
    } catch (e) {
      reviewError = e instanceof SdkError ? (e.code || 'review') : 'review';
    }
  }

  return (
    <section>
      <h1>{t.t('form.centre.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={CENTRES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}

      {step === 'edit' && (
        <form action={PATH} method="get" className="kv-card">
          <input type="hidden" name="step" value="review" />
          {FIELDS.map((f) => (
            <label className="kv-field" key={f}>
              <span>{t.t(fieldLabelKey(FORM, f))}</span>
              <input name={f} defaultValue={values[f] ?? ''} maxLength={300} />
            </label>
          ))}
          {/* A GET, so the review step is a URL an operator can bookmark and come back to. */}
          <button type="submit" className="kv-btn">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {reviewError && <div className="kv-error" role="alert"><p>{t.t('form.reviewFailed')} {reviewError}</p></div>}
          {review && (
            <>
              {generalRefusals(review).map((r) => (
                <div className="kv-error" role="alert" key={r.code}><p>{t.t(refusalKey(FORM, r.code))}</p></div>
              ))}
              <table className="kv-table">
                <thead>
                  <tr>
                    <th>{t.t('form.col.field')}</th>
                    <th>{t.t('form.col.entered')}</th>
                    <th>{t.t('form.col.stored')}</th>
                  </tr>
                </thead>
                <tbody>
                  {review.fields.map((f) => (
                    <tr key={f.name}>
                      <td>{t.t(fieldLabelKey(FORM, f.name))}</td>
                      <td>{f.entered ?? <span className="kv-field__hint">{t.t('common.dash')}</span>}</td>
                      <td>
                        {storedText(f).isNothing
                          ? <span className="kv-field__hint">{t.t(nothingStoredKey())}</span>
                          : <strong>{storedText(f).text}</strong>}
                        {f.normalised && !storedText(f).isNothing && (
                          <span className="kv-field__hint"> · {t.t(normalisedKey())}</span>
                        )}
                        {refusalsFor(review, f.name).map((r) => (
                          <div className="kv-error" key={r.code}>{t.t(refusalKey(FORM, r.code))}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* W2556: the diff "where applicable" — and a create has nothing to be different from. */}
              <p className="kv-field__hint">{t.t(diffKey(review))}</p>

              {review.ready ? (
                <form action={createCentreFromChainAction}>
                  {FIELDS.map((f) => <input type="hidden" name={f} value={values[f] ?? ''} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t('form.submit')}</button>
                </form>
              ) : (
                <p className="kv-field__hint">{t.t('form.fixFirst')}</p>
              )}
              <p><Link href={chainHref(PATH, 'edit', values)} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('form.centre.created')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('mcc_centre', createdId) && (
            <p><Link href={auditHref('mcc_centre', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>
          )}
          <p><Link href={CENTRES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, values)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={CENTRES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
