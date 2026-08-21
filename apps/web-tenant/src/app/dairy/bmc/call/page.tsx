// apps/web-tenant/src/app/dairy/bmc/call/page.tsx · the bmc mutate chain — W2521–W2523 · PC-56 TENANT-6d-5.
//
// The canon's shared MUTATE pattern (B2) over the act W170 puts at the top of the monitor: **"Call MCC-AND-03
// operator"**. Three screens, one page, three states — confirm, success, failure — with the object and the typed reason
// in the query string, because this console ships no client JS and *"Retry — back to confirm"* has to be able to
// rebuild the step it returns to.
//
// WHAT AN OPERATOR IS ASKED TO CONFIRM, AND WHAT THEY ARE NOT TOLD
//
// They are shown the TANK (its centre, its temperature, and whether that temperature is current or is itself the
// problem), the PERSON who will be reached — by name, when this cooperative's own roles can verify them — and their own
// reason, which goes into the audit row verbatim. They are NOT shown a phone number, here or anywhere: the telephony
// provider owns the directory and bridges the two parties, so the platform never learns either number. TENANT-6d-2
// masked the operator's number on the centres board because the board had to print something; this act never needs it.
//
// AND THE CONFIRM STEP IS NOT A TICKET. The server re-takes its verdict when the button is pressed, because custody of
// a centre can change hands in the minutes between reading a screen and acting on it — 6d-2 made that a first-class
// act, so this screen must not treat its own answer as an authorisation.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyBmcCallPreview } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, calleeKey, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep,
  mutateStepKey, objectTempKey, readCarried, reasonState, reasonStateKey, repeatedFailuresGapKey, retryToConfirm,
  valuesLostKey,
} from '../../../../features/mutate/chain';
import { BMC_HREF, bmcHref } from '../../../../features/dairy/bmc';
import { callOperatorAction } from './actions';

export const dynamic = 'force-dynamic';

const PATH = '/dairy/bmc/call';
const MODULE = 'bmc';
/** The two things this chain carries. `unitId` identifies the object; `reason` is what the audit row will hold. */
const FIELDS = ['unitId', 'reason'] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.bmc.title'), robots: { index: false, follow: false } };
}

export default async function CallOperatorPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const unitId = values.unitId ?? '';

  // The confirm step asks the API for the object and the verdict. The success and failure steps do not: the act is
  // over, and re-asking would show a screen that has moved on from what just happened.
  let preview: DairyBmcCallPreview | null = null;
  let previewError: string | null = null;
  if (step === 'confirm' && unitId.length > 0) {
    try {
      preview = await tenantClient().dairy.previewBmcCall({ unitId, reason: values.reason });
    } catch (e) {
      previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview';
    }
  }

  const reason = values.reason ?? '';
  const rState = reasonState(reason);

  return (
    <section>
      <h1>{t.t('mutate.bmc.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={unitId ? bmcHref(unitId) : BMC_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>

      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && unitId.length === 0 && (
        <div className="kv-error" role="alert"><p>{t.t('mutate.bmc.noUnit')}</p></div>
      )}

      {step === 'confirm' && previewError && (
        <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>
      )}

      {step === 'confirm' && preview && (
        <>
          {/* ---- THE OBJECT (W2521: "review the object and reason below") ---- */}
          <div className="kv-card">
            <h2>{preview.object.mccCode} · {preview.object.mccName}</h2>
            <p>
              {preview.object.tempC === null
                ? <span className="kv-field__hint">{t.t(objectTempKey(preview.object))}</span>
                : <>
                    <strong>{preview.object.tempC}°C</strong>{' '}
                    <span className="kv-field__hint">{t.t(objectTempKey(preview.object))}</span>
                  </>}
              {preview.object.gapMinutes !== null && (
                <> {' · '}<span className="kv-field__hint">
                  {formatNumber(preview.object.gapMinutes, lang)} {t.t('mutate.bmc.gapMinutes')}
                </span></>
              )}
            </p>
            <p>
              <span className="kv-field__hint">{t.t(calleeKey(preview.object))}</span>
              {preview.object.operatorName && !preview.object.operatorUnnamed && <> <strong>{preview.object.operatorName}</strong></>}
            </p>
            {/* The promise that makes this act safe to offer at all. */}
            <p className="kv-field__hint">{t.t('mutate.bmc.numberNeverShown')}</p>
          </div>

          {/* ---- EVERY REASON THE CALL WOULD BE REFUSED ---- */}
          {preview.refusals.map((code) => (
            <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(MODULE, code))}</p></div>
          ))}

          {/* ---- THE REASON, WHICH IS THE AUDIT ROW ---- */}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="unitId" value={unitId} />
            <label className="kv-field">
              <span>{t.t('mutate.bmc.reasonLabel')}</span>
              <textarea name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            {/* A GET, so the confirm step re-renders with the reason in the URL and stays bookmarkable. */}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>

          {canConfirm(preview, reason) ? (
            <form action={callOperatorAction}>
              <input type="hidden" name="unitId" value={unitId} />
              <input type="hidden" name="reason" value={reason} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : (
            <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>
          )}
          <p><Link href={unitId ? bmcHref(unitId) : BMC_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.bmc.placed')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {/* W2522's own promise — kept, not stated: the trail for THIS cooler. */}
          {canLinkAudit('bmc_unit', unitId) && (
            <p><Link href={auditHref('bmc_unit', unitId)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>
          )}
          {/* W2522 also says money-adjacent actions reconcile before this page shows. This act moves no money, and
              saying so is better than letting a reader wonder which kind of act they just performed. */}
          <p className="kv-field__hint">{t.t('mutate.bmc.noMoney')}</p>
          <p className="kv-field__hint">{t.t('mutate.bmc.answerUnknown')}</p>
          <p><Link href={unitId ? bmcHref(unitId) : BMC_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={unitId ? bmcHref(unitId) : BMC_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
