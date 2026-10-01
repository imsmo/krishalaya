// apps/web-tenant/src/app/content/banners/slot/page.tsx · the banners MUTATE chain — W2514 confirm → W2515 success → W2516
// failure · PC-56 TENANT-8d.
//
// W2514's only act is *Retry* — W173's "Couldn't load banners" card: a page load, not a state change (PARITY-DECOR, the 6a
// ruling; the list's own Retry link reloads W173). The list-level act a placement DOES need rides this chain: the ORDER
// of the banners in one slot (0178's `slot_order`) — move one banner one place up or down, judged by the API against the
// slot as it stands (`banner-slot.ts`, the slot locked), with a reason, an audit row carrying the order before and after,
// and the confirm page's Idempotency-Key. No reader serves the order to a member yet — said by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator } from '../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsBannerSlotPreview } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState, reasonStateKey,
  repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../features/mutate/chain';
import { BANNERS_HREF, BANNERS_MUTATE, BANNER_SLOT_HREF, bannerHref, isDirection, isKnownPlacement, moveLabelKey, placementKey, refusedKey } from '../../../../features/banners/banners';
import { bannerSlotAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.banners.title'), robots: { index: false, follow: false } };
}

const FIELDS = ['id', 'direction', 'reason'] as const;

export default async function BannerSlotPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(BANNER_SLOT_HREF);
  const t = getTranslator();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const direction = isDirection(values.direction) ? values.direction : null;
  const backHref = values.id ? bannerHref(values.id) : BANNERS_HREF;

  let preview: CmsBannerSlotPreview | null = null; let previewError: string | null = null;
  if (step === 'confirm' && values.id && direction) {
    try { preview = await tenantClient().cms.banners.slotPreview(values.id, direction, values.reason ?? ''); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const reason = values.reason ?? '';
  const rState = reasonState(reason);
  const label = (x: { id: string; headline: string | null }) => x.headline ?? t.t('banners.noWords');

  return (
    <section>
      <h1>{direction ? t.t(moveLabelKey(direction)) : t.t('mutate.banners.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && (!values.id || !direction) && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.banners.noMove')}</p>
          <p className="kv-field__hint">{t.t(refusedKey('retryPageLoad'))}</p>
        </div>
      )}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && preview && direction && (
        <>
          <div className="kv-card">
            <h2>{t.t('mutate.banners.slotOf', { placement: isKnownPlacement(preview.placement) ? t.t(placementKey(preview.placement)) : preview.placement })}</h2>
            <p className="kv-field__hint">{t.t('mutate.banners.before')}</p>
            <ol>{preview.before.map((x) => <li key={x.id}>{x.id === preview!.id ? <strong>{label(x)}</strong> : label(x)}</li>)}</ol>
            {preview.after && (
              <>
                <p className="kv-field__hint">{t.t('mutate.banners.after')}</p>
                <ol>{preview.after.map((x) => <li key={x.id}>{x.id === preview!.id ? <strong>{label(x)}</strong> : label(x)}</li>)}</ol>
              </>
            )}
            <p className="kv-field__hint">{t.t('banners.reader.none')}</p>
          </div>

          {preview.refusals.map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(BANNERS_MUTATE, code))}</p></div>)}

          <form action={BANNER_SLOT_HREF} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="id" value={preview.id} />
            <input type="hidden" name="direction" value={direction} />
            <label className="kv-field" htmlFor="slot-reason">
              <span>{t.t('mutate.banners.reasonLabel')}</span>
              <textarea id="slot-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>

          {canConfirm(preview, reason) ? (
            <form action={bannerSlotAction}>
              <input type="hidden" name="id" value={preview.id} />
              <input type="hidden" name="direction" value={direction} />
              <input type="hidden" name="reason" value={reason} />
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.banners.done')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('banner', values.id ?? null) && <p><Link href={auditHref('banner', values.id as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(BANNER_SLOT_HREF, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
