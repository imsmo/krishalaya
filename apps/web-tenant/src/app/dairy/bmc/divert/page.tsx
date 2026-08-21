// apps/web-tenant/src/app/dairy/bmc/divert/page.tsx · the diversion, on the shared MUTATE chain — PC-56 TENANT-6d-6.
//
// W170's playbook, step 2: *"If ≥ 7.5°C by 16:00 → divert evening shift to Bhesan (route notice to 87 pourers,
// Gujarati voice)"*, and its authority: *"playbook overrides are operator + dairy lead together."*
//
// **THIS IS THE SECOND ACT ON TENANT-6d-5's CHAIN, AND THAT IS THE POINT.** W2521–W2523 are a SHARED pattern; a second
// screen that re-implemented confirm/success/failure would be the drift the canon's word *shared* exists to prevent. So
// this page imports the same `features/mutate/chain` view-model, and everything below is what is DIFFERENT about a
// diversion:
//
//   • **THE OBJECT IS TWO VILLAGES AND A SHIFT** — where the milk was going, where it will go, and which evening.
//   • **THE SIZE OF THE DECISION IS PRINTED.** *"87 pourers"* is the number a dairy lead is actually deciding about, so
//     it is on the confirm screen — counted server-side from the route history as of that day, because a member who
//     moved last week is not on tonight's list.
//   • **CONFIRMING ONLY ASKS.** One person cannot divert a village's milk: this screen REQUESTS, and the register
//     carries the signature a second person adds. The success state says exactly that rather than implying the milk has
//     moved.
//   • **AND THE MEMBERS ARE NOT TOLD BY THIS ACT.** Said on the confirm step and again on the success step, because a
//     cooperative that believes the platform phoned 87 families will not phone them itself.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { DairyDiversionPreview, DairyShift } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep,
  mutateStepKey, readCarried, reasonState, reasonStateKey, repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../features/mutate/chain';
import { BMC_HREF } from '../../../../features/dairy/bmc';
import { CENTRES_HREF } from '../../../../features/dairy/centres';
import { diversionNoticeGapKey, diversionShiftKey } from '../../../../features/dairy/diversion';
import { requestDiversionAction } from './actions';

export const dynamic = 'force-dynamic';

const PATH = '/dairy/bmc/divert';
const MODULE = 'diversion';
const FIELDS = ['fromMccId', 'toMccId', 'divertedOn', 'shift', 'reason'] as const;

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.diversion.title'), robots: { index: false, follow: false } };
}

export default async function DivertShiftPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const createdId = typeof searchParams.id === 'string' ? searchParams.id : null;
  const from = values.fromMccId ?? '';
  const to = values.toMccId ?? '';
  const shift = (values.shift === 'morning' || values.shift === 'evening' ? values.shift : 'evening') as DairyShift;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);

  let preview: DairyDiversionPreview | null = null;
  let previewError: string | null = null;
  if (step === 'confirm' && from.length > 0 && to.length > 0) {
    try {
      preview = await tenantClient().dairy.previewDiversion({
        fromMccId: from, toMccId: to, divertedOn: values.divertedOn, shift, reason,
      });
    } catch (e) {
      previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview';
    }
  }

  return (
    <section>
      <h1>{t.t('mutate.diversion.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={BMC_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>

      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}

      {step === 'confirm' && (
        <>
          {/* The two centres are named by ID here on purpose: the picker belongs with the centres board, which is one
              link away, and inventing a second roster on this screen would be a second list to drift. */}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <label className="kv-field"><span>{t.t('mutate.diversion.from')}</span><input name="fromMccId" defaultValue={from} /></label>
            <label className="kv-field"><span>{t.t('mutate.diversion.to')}</span><input name="toMccId" defaultValue={to} /></label>
            <label className="kv-field"><span>{t.t('mutate.diversion.day')}</span><input name="divertedOn" defaultValue={values.divertedOn ?? ''} placeholder="YYYY-MM-DD" /></label>
            <label className="kv-field">
              <span>{t.t('mutate.diversion.shift')}</span>
              <select name="shift" defaultValue={shift}>
                <option value="evening">{t.t(diversionShiftKey('evening'))}</option>
                <option value="morning">{t.t(diversionShiftKey('morning'))}</option>
              </select>
            </label>
            <label className="kv-field">
              <span>{t.t('mutate.diversion.reasonLabel')}</span>
              <textarea name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <p><Link href={CENTRES_HREF} className="kv-btn--link">{t.t('mutate.diversion.findCentres')}</Link></p>
            <button type="submit" className="kv-btn--link">{t.t('mutate.diversion.check')}</button>
          </form>

          {previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

          {preview && (
            <>
              <div className="kv-card">
                <h2>
                  {preview.fromCode ?? t.t('common.dash')} → {preview.toCode ?? t.t('common.dash')}
                  {' · '}{t.t(diversionShiftKey(shift))}{' '}{preview.divertedOn}
                </h2>
                {/* THE SIZE OF THE DECISION. W170 prints "87 pourers" and means it. */}
                <p>
                  <strong>{formatNumber(preview.affectedMembers, lang)}</strong>{' '}
                  {t.t('mutate.diversion.affected')}
                </p>
                <p className="kv-field__hint">{t.t(diversionNoticeGapKey())}</p>
                <p className="kv-field__hint">{t.t('mutate.diversion.notATransfer')}</p>
                <p className="kv-field__hint">{t.t('mutate.diversion.needsSecondSignature')}</p>
              </div>

              {preview.refusals.map((code) => (
                <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(MODULE, code))}</p></div>
              ))}

              {canConfirm(preview, reason) ? (
                <form action={requestDiversionAction}>
                  {FIELDS.map((f) => <input type="hidden" name={f} value={f === 'shift' ? shift : (values[f] ?? '')} key={f} />)}
                  <button type="submit" className="kv-btn">{t.t('mutate.diversion.request')}</button>
                </form>
              ) : (
                <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>
              )}
              <p><Link href={BMC_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          {/* NOT "the milk has moved" — "somebody else must sign it". A success screen that overstated this would send
              87 families to a village nobody has authorised yet. */}
          <p>{t.t('mutate.diversion.requested')}</p>
          <p className="kv-field__hint">{t.t('mutate.diversion.needsSecondSignature')}</p>
          <p className="kv-field__hint">{t.t(diversionNoticeGapKey())}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('dairy_shift_diversion', createdId) && (
            <p><Link href={auditHref('dairy_shift_diversion', createdId as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>
          )}
          <p><Link href={BMC_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={BMC_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
