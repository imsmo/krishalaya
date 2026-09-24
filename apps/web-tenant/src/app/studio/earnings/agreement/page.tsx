// apps/web-tenant/src/app/studio/earnings/agreement/page.tsx · the agreement chain — confirm → success → failure ·
// PC-56 TENANT-7d-money.
//
// THE AGREEMENT ON RECORD (0174 `instructor_agreements`): the desk OFFERS (course.publish; never to themselves — the API's
// verdict and 0174's trigger), the INSTRUCTOR accepts or declines (only their own user), the desk supersedes. Until one is
// accepted every purchase's instructor leg is HELD; acceptance releases every held line hold → main in the same
// transaction, and the success screen prints the API's release figures — computed nowhere else.
//
// The confirm step reviews the OBJECT the API holds: the offer's version and three shares (as percent text from basis
// points), the terms note, and — for an offer — the rule in force the desk is offering at, or the share it typed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { EarningsView } from '@krishalaya/sdk-js';
import { auditHref, canLinkAudit, carryValues, failureKey, mutateStep, mutateStepKey, readCarried, repeatedFailuresGapKey, retryToConfirm, valuesLostKey } from '../../../../features/mutate/chain';
import { AGREEMENT_FIELDS, AGREEMENT_PATH, agreementChainAct, agreementStatusKey, earningsHref, earningsRefusedKey, percentToBps, shareText } from '../../../../features/studio/earnings';
import { agreementAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('earnings.agreement.title'), robots: { index: false, follow: false } };
}

export default async function AgreementPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = AGREEMENT_PATH;
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, AGREEMENT_FIELDS);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const failedRefusals = typeof searchParams.refusals === 'string' ? searchParams.refusals.split(',').filter(Boolean) : [];
  const released = typeof searchParams.released === 'string' ? searchParams.released.split(',').filter(Boolean).map((x) => { const [c, a, n] = x.split(':'); return { currencyCode: c, amountMinor: a, lines: n }; }) : [];
  const act = agreementChainAct(values.act);
  const instructorId = values.instructor ?? null;
  const backHref = earningsHref({ instructor: act === 'offer' || act === 'supersede' ? instructorId : null });

  let view: EarningsView | null = null; let viewError: string | null = null;
  if (step === 'confirm' && act) {
    try { view = await tenantClient().instructorEarnings.view(act === 'offer' || act === 'supersede' ? instructorId : null); }
    catch (e) { viewError = e instanceof SdkError ? (e.code || 'view') : 'view'; }
  }
  const offered = view?.agreement.offered ?? null;
  const current = view?.agreement.current ?? null;
  const target = act === 'accept' || act === 'decline' ? (offered && offered.id === values.agreement ? offered : null) : act === 'supersede' ? (current && current.id === values.agreement ? current : offered && offered.id === values.agreement ? offered : null) : null;
  const typedBps = values.shareBps ? percentToBps(values.shareBps) : null;
  const canAct = view && act ? (act === 'offer' ? !!instructorId && !offered && (!values.shareBps || typedBps !== null) : !!target) : false;

  return (
    <section>
      <h1>{act ? t.t(`earnings.agreement.act.${act}`) : t.t('earnings.agreement.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && !act && <div className="kv-error" role="alert"><p>{t.t('earnings.agreement.noAct')}</p></div>}
      {step === 'confirm' && viewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {viewError}</p></div>}

      {step === 'confirm' && act && view && (
        <>
          <div className="kv-card">
            <h2>{view.instructor.name ?? t.t('studio.unnamed')}</h2>
            {target && <p>{t.t('earnings.agreement.object', { version: formatNumber(target.version, lang), status: t.t(agreementStatusKey(target.status)), instructor: shareText(target.instructorShareBps), tenant: shareText(target.tenantShareBps), platform: shareText(target.platformShareBps) })}</p>}
            {target?.termsNote && <p className="kv-field__hint">{target.termsNote}</p>}
            {act === 'offer' && view.rule && <p>{t.t('earnings.agreement.offerAt', { instructor: typedBps !== null ? shareText(typedBps) : shareText(view.rule.instructorShareBps), platform: shareText(view.rule.platformShareBps) })}</p>}
            {act === 'offer' && offered && <div className="kv-error" role="alert"><p>{t.t('earnings.agreement.refusal.OFFER_ALREADY_OPEN')}</p></div>}
            {(act === 'accept' || act === 'decline' || act === 'supersede') && !target && <div className="kv-error" role="alert"><p>{t.t('earnings.agreement.refusal.NOT_FOUND')}</p></div>}
            {act === 'accept' && view.tiles.some((x) => x.lifetime.heldLines > 0) && (
              <p>{t.t('earnings.agreement.willRelease')} {view.tiles.filter((x) => x.lifetime.heldLines > 0).map((x) => `${formatMoneyMinor(x.lifetime.held, x.currencyCode, lang)} (${formatNumber(x.lifetime.heldLines, lang)})`).join(' · ')}</p>
            )}
            <p className="kv-field__hint">{t.t(`earnings.agreement.note.${act}`)}</p>
          </div>

          {act === 'offer' && (
            <form action={PATH} method="get" className="kv-card">
              <input type="hidden" name="step" value="confirm" />
              <input type="hidden" name="act" value="offer" />
              <input type="hidden" name="instructor" value={instructorId ?? ''} />
              <label className="kv-field" htmlFor="agr-share"><span>{t.t('earnings.agreement.shareLabel')}</span><input id="agr-share" name="shareBps" inputMode="decimal" defaultValue={values.shareBps ?? ''} /></label>
              {values.shareBps && typedBps === null && <p className="kv-error" role="alert">{t.t('earnings.rule.refusal.SHARE_INVALID')}</p>}
              <label className="kv-field" htmlFor="agr-terms"><span>{t.t('earnings.agreement.termsLabel')}</span><textarea id="agr-terms" name="termsNote" defaultValue={values.termsNote ?? ''} maxLength={600} rows={3} /></label>
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}

          {canAct ? (
            <form action={agreementAction}>
              <input type="hidden" name="act" value={act} />
              {values.agreement && <input type="hidden" name="agreement" value={values.agreement} />}
              {instructorId && <input type="hidden" name="instructor" value={instructorId} />}
              {values.shareBps && <input type="hidden" name="shareBps" value={values.shareBps} />}
              {values.termsNote && <input type="hidden" name="termsNote" value={values.termsNote} />}
              <button type="submit" className="kv-btn">{t.t('mutate.confirm')}</button>
            </form>
          ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{act ? t.t(`earnings.agreement.done.${act}`) : t.t('mutate.step.success')}</p>
          {act === 'accept' && (released.length === 0
            ? <p className="kv-field__hint">{t.t('earnings.agreement.releasedNone')}</p>
            : <p>{t.t('earnings.agreement.released')} {released.map((r) => `${formatMoneyMinor(r.amountMinor, r.currencyCode, lang)} (${r.lines})`).join(' · ')}</p>)}
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('instructor_agreement', values.agreement ?? null) && <p><Link href={auditHref('instructor_agreement', values.agreement as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          {failedRefusals.map((r) => <p key={r}>{t.t(`earnings.agreement.refusal.${r}`) || r}</p>)}
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p className="kv-field__hint">{t.t(earningsRefusedKey('retry'))}</p>
          <p><Link href={retryToConfirm(PATH, values)} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
