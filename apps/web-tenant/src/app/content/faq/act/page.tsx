// apps/web-tenant/src/app/content/faq/act/page.tsx · the FAQ MUTATE chain — W2609 confirm → W2610 success → W2611 failure
// · PC-56 TENANT-8c.
//
// W2609 names one act: *"Retry"* — W177's "Couldn't load FAQ" card, a PAGE LOAD (6a's ruling, PARITY-DECOR). The act the
// FAQ actually needs rides this chain instead: the REORDER — move an entry one place up or down inside its topic (W177
// *"grouped by topic"*), judged by the API against the order as it stands, with a reason, an audit row (before and after
// order) and the confirm page's Idempotency-Key (F-17).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsFaqMovePreview } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState, reasonStateKey, repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../features/mutate/chain';
import { FAQ_ACT_HREF, FAQ_HREF, FAQ_MUTATE, FAQ_MUTATE_FIELDS, isDirection, isKnownTopic, moveLabelKey, refusedKey, topicKey } from '../../../../features/pages/pages';
import { faqMoveAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.faq.title'), robots: { index: false, follow: false } };
}

export default async function FaqActPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(FAQ_ACT_HREF);
  const t = getTranslator();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FAQ_MUTATE_FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const direction = isDirection(values.direction) ? values.direction : null;
  const reason = values.reason ?? '';
  let preview: CmsFaqMovePreview | null = null; let previewError: string | null = null;
  if (step === 'confirm' && direction && values.slug) {
    try { preview = await tenantClient().cms.faq.reorderPreview(values.slug, direction, reason); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const topicName = (code: string | null) => (code === null ? t.t('common.dash') : isKnownTopic(code) ? t.t(topicKey(code)) : code);
  const newOrder = preview?.plan && preview.plan.ok ? preview.plan.order : null;

  return (
    <section>
      <h1>{direction ? t.t(moveLabelKey(direction)) : t.t('mutate.faq.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={FAQ_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && (!direction || !values.slug) && (
        <div className="kv-card kv-card--notice" role="status"><p>{t.t('mutate.faq.noAct')}</p><p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p></div>
      )}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && direction && preview && (
        <>
          <div className="kv-card">
            <h2>{preview.title ?? preview.slug}</h2>
            <p className="kv-field__hint"><code>{preview.slug}</code> · {topicName(preview.topic)}</p>
            <div className="kv-template-compare">
              <div>
                <p className="kv-field__hint">{t.t('mutate.faq.orderNow')}</p>
                <ol>{preview.order.map((o) => <li key={o.slug}>{o.slug === preview!.slug ? <strong>{o.slug}</strong> : o.slug}</li>)}</ol>
              </div>
              {newOrder && (
                <div>
                  <p className="kv-field__hint">{t.t('mutate.faq.orderAfter')}</p>
                  <ol>{newOrder.map((s) => <li key={s}>{s === preview!.slug ? <strong>{s}</strong> : s}</li>)}</ol>
                </div>
              )}
            </div>
          </div>
          {preview.refusals.map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(FAQ_MUTATE, code))}</p></div>)}
          <form action={FAQ_ACT_HREF} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="slug" value={preview.slug} />
            <input type="hidden" name="direction" value={direction} />
            <label className="kv-field" htmlFor="faq-reason">
              <span>{t.t('mutate.faq.reasonLabel')}</span>
              <textarea id="faq-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(reasonState(reason)) && <p className="kv-field__hint">{t.t(reasonStateKey(reasonState(reason))!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>
          {canConfirm(preview, reason) ? (
            <form action={faqMoveAction}>
              <input type="hidden" name="slug" value={preview.slug} />
              <input type="hidden" name="direction" value={direction} />
              <input type="hidden" name="reason" value={reason} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={FAQ_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.faq.done', { n: typeof searchParams.position === 'string' ? searchParams.position : '' })}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('cms_page', typeof searchParams.id === 'string' ? searchParams.id : null) && <p><Link href={auditHref('cms_page', searchParams.id as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={FAQ_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(FAQ_ACT_HREF, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={FAQ_HREF} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
