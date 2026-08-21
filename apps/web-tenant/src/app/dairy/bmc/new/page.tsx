// apps/web-tenant/src/app/dairy/bmc/new/page.tsx · the bmc form chain — W2517–W2520 · PC-56 TENANT-6d-4.
//
// The canon's shared form pattern (B2) names the action this chain hosts: **"Add BMC"**. TENANT-6d-1 built that action
// as a plain form on the monitor — submit and hope — and left the four chain screens for this wave, because registering
// a cooler sets the BAND every future breach is judged against, and three of those numbers are DEFAULTS the operator
// never types. A confirm step that did not show them would let somebody accept `0.0 / 4.0 / 0.5` without ever reading
// them, and then be phoned at four in the morning about a threshold they did not know existed.
//
// ONE PAGE, FOUR STATES, VALUES IN THE URL — the same shape as the *Add centre* chain next door, and the same
// `features/forms/chain` view-model, because they are one pattern and two nouns.
//
// AND THE REVIEW IS COMPUTED BY THE API, from the same facts `register` uses: `2000` → `2000.00`, an omitted band end
// → the default that will be written, and `bandMaxC` — the number a breach is actually measured against — computed on
// the review though it appears on no form. A review that says "ready" cannot be followed by a failure screen.
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
import { BMC_HREF } from '../../../../features/dairy/bmc';
import { registerBmcFromChainAction } from './actions';

export const dynamic = 'force-dynamic';

const PATH = '/dairy/bmc/new';
const FORM = 'bmc';
/** Every field this chain carries. One list, used by the reader, the form and the retry link. */
const FIELDS = [
  'mccId', 'capacityLitres', 'minTempC', 'targetTempC', 'toleranceC', 'iotDeviceRef', 'model', 'serialNo',
] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('form.bmc.title'), robots: { index: false, follow: false } };
}

export default async function AddBmcPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PATH);
  const t = getTranslator();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const createdId = typeof searchParams.id === 'string' ? searchParams.id : null;
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;

  // The review is asked for ONLY on the review step: the edit form must not tell an operator a sensor reference is
  // taken before they have finished typing it.
  let review: DairyReview | null = null;
  let reviewError: string | null = null;
  if (step === 'review') {
    try {
      review = await tenantClient().dairy.previewBmcUnit({
        mccId: values.mccId, capacityLitres: values.capacityLitres,
        minTempC: values.minTempC, targetTempC: values.targetTempC, toleranceC: values.toleranceC,
        iotDeviceRef: values.iotDeviceRef, model: values.model, serialNo: values.serialNo,
      });
    } catch (e) {
      reviewError = e instanceof SdkError ? (e.code || 'review') : 'review';
    }
  }

  return (
    <section>
      <h1>{t.t('form.bmc.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, isFormError(step, review)))}</p>
      <p className="kv-field__hint"><Link href={BMC_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>

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
          {/* The band's defaults are NOT pre-filled here: a blank means "whatever the platform applies", and the
              review names those numbers. Pre-filling them would make the operator's silence look like a choice. */}
          <p className="kv-field__hint">{t.t('form.bmc.bandDefaults')}</p>
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

              {/* W2518: the diff "where applicable" — and a create has nothing to be different from. */}
              <p className="kv-field__hint">{t.t(diffKey(review))}</p>

              {review.ready ? (
                <form action={registerBmcFromChainAction}>
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
          <p>{t.t('form.bmc.created')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          {canLinkAudit('bmc_unit', createdId) && (
            <p><Link href={auditHref('bmc_unit', createdId as string)} className="kv-btn--link">{t.t('form.viewAudit')}</Link></p>
          )}
          <p><Link href={BMC_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(PATH, values)} className="kv-btn--link">{t.t('form.retry')}</Link></p>
          <p><Link href={BMC_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
