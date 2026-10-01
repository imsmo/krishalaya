// apps/web-tenant/src/app/content/templates/[id]/act/page.tsx · the template MUTATE chain — W2783 confirm → W2784 success
// → W2785 failure · PC-56 TENANT-8a.
//
// W2783 names the acts this chain hosts: *"Retry · Send test to my phone."* Neither is a state change this platform can
// make honestly: *Retry* on W181's "Couldn't load" card is a PAGE LOAD (6a's ruling), and *Send test* needs a real send
// path the tenant realm does not have (the notifier is the noop gateway here, and a test SMS on an unregistered DLT
// template would be refused at the operator) — both refused by name. The acts the override's lifecycle actually needs
// ride this chain instead, one page for five: SUBMIT (the author) · APPROVE and REJECT (a second person with
// `notification.templates.approve`, never the author) · WITHDRAW (the author's own) · RETIRE (fall back to the platform
// default). The confirm step reviews the object and the reason; the API re-takes its verdict on the locked row; the
// reason is mandatory, never pre-filled, and is what the audit row holds. The Idempotency-Key is minted HERE and travels
// in the form (F-17).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator } from '../../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { TemplateActs, TemplateOverrideAct } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState, reasonStateKey,
  repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../../features/mutate/chain';
import {
  MUTATE_FIELDS, MUTATE_MODULE, actDoneKey, actLabelKey, approvalServes, channelKey, isOverrideAct, lifecycleKey, providerKey, reasonLabelKey, refusedKey, templateHref, verdictFor,
} from '../../../../../features/templates/override';
import { templateActAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.template.title'), robots: { index: false, follow: false } };
}

export default async function TemplateActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = `${templateHref(params.id)}/act`;
  await requireSession(PATH);
  const t = getTranslator();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, MUTATE_FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const to = typeof searchParams.to === 'string' ? searchParams.to : null;
  const act: TemplateOverrideAct | null = isOverrideAct(values.act) ? values.act : null;
  const backHref = templateHref(params.id);

  let preview: TemplateActs | null = null;
  let previewError: string | null = null;
  if (step === 'confirm' && act) {
    try { preview = await tenantClient().notifications.templateActs(params.id, values.reason ?? ''); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const verdict = preview && act ? verdictFor(preview.verdicts, act) : null;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);
  const v = preview?.view ?? null;
  const openBody = v?.open ? v.versions.find((x) => x.id === v.open!.id)?.body ?? null : null;

  return (
    <section>
      <h1>{act ? t.t(actLabelKey(act)) : t.t('mutate.template.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && !act && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.template.noAct')}</p>
          <p className="kv-field__hint">{t.t(refusedKey('sendTest'))}</p>
          <p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p>
        </div>
      )}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && act && v && verdict && (
        <>
          {/* ---- THE OBJECT ---- */}
          <div className="kv-card">
            <h2><code>{v.slot.eventCode}</code> × {t.t(channelKey(v.slot.channel))} × {v.slot.languageCode}</h2>
            {act !== 'retire' && v.open && (
              <>
                <p className="kv-field__hint">{t.t('mutate.template.transition', { v: String(v.open.versionNo), from: t.t(lifecycleKey(v.open.lifecycle)), to: verdict.to ? t.t(lifecycleKey(verdict.to)) : t.t('common.dash') })}</p>
                {openBody && <p className="kv-template-body kv-template-body--mine" lang={v.slot.languageCode}>{openBody}</p>}
                {v.open.rendered && <p className="kv-field__hint">{t.t('mutate.template.rendered')} {v.open.rendered}</p>}
              </>
            )}
            {act === 'retire' && v.override?.words && (
              <>
                <p className="kv-field__hint">{t.t('mutate.template.retireNote', { v: String(v.override.words.versionNo) })}</p>
                <p className="kv-template-body">{v.platform.words ? v.platform.words.body : t.t('templates.editor.noPlatform')}</p>
              </>
            )}
            {act === 'approve' && <p className="kv-field__hint">{t.t(approvalServes(v.slot.channel) ? 'mutate.template.approveServes' : providerKey(v.provider))}</p>}
            {act === 'reject' && <p className="kv-field__hint">{t.t('mutate.template.rejectNote')}</p>}
            <p className="kv-field__hint">{t.t('mutate.template.noMoney')}</p>
          </div>

          {verdict.refusals.map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(MUTATE_MODULE, code))}</p></div>)}

          {/* ---- THE REASON, WHICH IS THE AUDIT ROW ---- */}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            {values.versionId && <input type="hidden" name="versionId" value={values.versionId} />}
            <label className="kv-field" htmlFor="act-reason">
              <span>{t.t(reasonLabelKey(act))}</span>
              <textarea id="act-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>

          {canConfirm(verdict, reason) ? (
            <form action={templateActAction}>
              <input type="hidden" name="id" value={params.id} />
              <input type="hidden" name="act" value={act} />
              <input type="hidden" name="reason" value={reason} />
              {values.versionId && <input type="hidden" name="versionId" value={values.versionId} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(actDoneKey(act, to)) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('notification_template', params.id) && <p><Link href={auditHref('notification_template', params.id)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
