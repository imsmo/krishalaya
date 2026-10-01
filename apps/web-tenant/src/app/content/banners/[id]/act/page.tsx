// apps/web-tenant/src/app/content/banners/[id]/act/page.tsx · the banner MUTATE chain — W2507 confirm → W2508 success →
// W2509 failure · PC-56 TENANT-8d.
//
// W2507 names the acts: *"Pause · Retry"*, and promises *"confirming writes an audit-trail entry with actor, time and
// reason"*. Before 0178 Pause was `deactivate` — no reason, no audit row (F-7). The chain now carries the four acts a
// banner has — ACTIVATE (a draft onto members' screens), PAUSE, RESUME, ARCHIVE (final) — each with a reason that is
// recorded word for word, and the API's verdict: activate and resume are judged against the ACTIVATION LAW (en · hi · gu
// words, the cooperative's own clean image, a window not over, an audience the registries still hold) and every reason is
// printed. *Retry* is W174's "Couldn't save" card — a re-save, the form chain's own Retry, not an act (PARITY-DECOR). The
// Idempotency-Key is minted HERE and travels in the form (F-17).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { CmsBannerAct, CmsBannerActs } from '@krishalaya/sdk-js';
import {
  MAX_REASON, auditHref, canConfirm, canLinkAudit, carryValues, failureKey, mutateRefusalKey, mutateStep, mutateStepKey, readCarried, reasonState, reasonStateKey,
  repeatedFailuresGapKey, retryToConfirm, valuesLostKey,
} from '../../../../../features/mutate/chain';
import {
  BANNER_MUTATE, actDoneKey, actLabelKey, bannerHref, headlineFor, isBannerAct, isKnownPlacement, phaseKey, placementKey, refusedKey, verdictFor, windowText,
} from '../../../../../features/banners/banners';
import { bannerActAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('mutate.banner.title'), robots: { index: false, follow: false } };
}

const FIELDS = ['act', 'reason'] as const;

export default async function BannerActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | string[] | undefined> }) {
  const id = decodeURIComponent(params.id);
  const PATH = `${bannerHref(id)}/act`;
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const failedRefusals = typeof searchParams.refusals === 'string' ? searchParams.refusals.split(',').filter(Boolean) : [];
  const failedLangs = typeof searchParams.langs === 'string' ? searchParams.langs.split(',').filter(Boolean).join(' · ') : '';
  const act: CmsBannerAct | null = isBannerAct(values.act) ? values.act : null;
  const backHref = bannerHref(id);

  let preview: CmsBannerActs | null = null; let previewError: string | null = null;
  if (step === 'confirm' && act) {
    try { preview = await tenantClient().cms.banners.acts(id, values.reason ?? ''); }
    catch (e) { previewError = e instanceof SdkError ? (e.code || 'preview') : 'preview'; }
  }
  const verdict = preview && act ? verdictFor(preview.verdicts, act) : null;
  const reason = values.reason ?? '';
  const rState = reasonState(reason);
  const b = preview?.banner ?? null;
  const h = b ? headlineFor(b.texts, lang) : null;

  return (
    <section>
      <h1>{act ? t.t(actLabelKey(act)) : t.t('mutate.banner.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && !act && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('mutate.banner.noAct')}</p>
          <p className="kv-field__hint">{t.t(refusedKey('retryIsResave'))}</p>
        </div>
      )}
      {step === 'confirm' && previewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {previewError}</p></div>}

      {step === 'confirm' && act && preview && verdict && b && (
        <>
          {/* ---- THE OBJECT ---- */}
          <div className="kv-card">
            <h2 lang={h?.lang}>{h ? h.text : t.t('banners.noWords')}</h2>
            <p className="kv-field__hint">{isKnownPlacement(b.placement) ? t.t(placementKey(b.placement)) : b.placement} · {windowText(b.startsLocal, b.endsLocal)} ({b.timezone}) · {t.t(phaseKey(b.phase))}</p>
            {verdict.to && <p>{t.t(`mutate.banner.effect.${act}`)}</p>}
            {act === 'pause' && <p className="kv-field__hint">{t.t('mutate.banner.pauseNote')}</p>}
            {act === 'archive' && <p className="kv-field__hint">{t.t('mutate.banner.archiveNote')}</p>}
            <p className="kv-field__hint">{t.t('banners.reader.none')}</p>
          </div>

          {verdict.refusals.map((code) => <div className="kv-error" role="alert" key={code}><p>{t.t(mutateRefusalKey(BANNER_MUTATE, code), { langs: verdict.missingLanguages.join(' · ') })}</p></div>)}

          {/* ---- THE REASON, WHICH IS THE AUDIT ROW ---- */}
          <form action={PATH} method="get" className="kv-card">
            <input type="hidden" name="step" value="confirm" />
            <input type="hidden" name="act" value={act} />
            <label className="kv-field" htmlFor="act-reason">
              <span>{t.t('mutate.banner.reasonLabel')}</span>
              <textarea id="act-reason" name="reason" defaultValue={reason} maxLength={MAX_REASON} rows={3} />
            </label>
            <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
            {reasonStateKey(rState) && <p className="kv-field__hint">{t.t(reasonStateKey(rState)!)}</p>}
            <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
          </form>

          {canConfirm(verdict, reason) ? (
            <form action={bannerActAction}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="act" value={act} />
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
          <p>{act ? t.t(actDoneKey(act)) : t.t('mutate.step.success')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('banner', id) && <p><Link href={auditHref('banner', id)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          {failedRefusals.map((code) => <p key={code}>{t.t(mutateRefusalKey(BANNER_MUTATE, code), { langs: failedLangs })}</p>)}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
