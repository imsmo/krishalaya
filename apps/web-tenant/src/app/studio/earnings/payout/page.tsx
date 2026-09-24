// apps/web-tenant/src/app/studio/earnings/payout/page.tsx · the royalty payout chain — confirm → success → failure ·
// PC-56 TENANT-7d-money.
//
// W418: *"Payout rides the monthly wage-lane, alongside labour and ambassador payouts — same rails, same reconciliation."*
// The rails are the payment plane's: this chain REQUESTS a payout (purpose `course_royalty`) and nothing more. The API
// reviews the request BEFORE it is written (`payoutReview`: an accepted agreement, the amount within Σ released lines,
// the currency one this desk has money in) and refuses by name; the plane then applies its own gates (KYC as an
// instructor per 0125, the caller's own bank account, no overdraw). A queued payout rides the tenant's batch and leaves
// only after two humans sign (0143 / 0174 §174.5) — the success screen says exactly that, and names no clock.
//
// THE AMOUNT is typed in major units the way a person writes money and re-scaled to minor units at the currency's own
// scale (`majorToMinorText` — digit moving, not arithmetic); the API validates it again. NO figure on this page is computed
// here: available and held are the API's sums, formatted.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { EarningsView, RoyaltyPayoutReview } from '@krishalaya/sdk-js';
import { auditHref, canLinkAudit, carryValues, failureKey, mutateStep, mutateStepKey, readCarried, repeatedFailuresGapKey, retryToConfirm, valuesLostKey } from '../../../../features/mutate/chain';
import { PAYOUT_FIELDS, PAYOUT_PATH, earningsHref, earningsRefusedKey, majorToMinorText, payoutRefusalKey } from '../../../../features/studio/earnings';
import { requestRoyaltyPayoutAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('earnings.payout.title'), robots: { index: false, follow: false } };
}

export default async function RoyaltyPayoutPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const PATH = PAYOUT_PATH;
  await requireSession(PATH);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = readCarried(searchParams, [...PAYOUT_FIELDS, 'amountMajor']);
  const carried = carryValues(step, values);
  const failed = typeof searchParams.error === 'string' ? searchParams.error : null;
  const failedRefusals = typeof searchParams.refusals === 'string' ? searchParams.refusals.split(',').filter(Boolean) : [];
  const payoutId = typeof searchParams.payout === 'string' ? searchParams.payout : null;
  const backHref = earningsHref();

  let view: EarningsView | null = null; let viewError: string | null = null; let review: RoyaltyPayoutReview | null = null;
  if (step === 'confirm') {
    try { view = await tenantClient().instructorEarnings.view(); }
    catch (e) { viewError = e instanceof SdkError ? (e.code || 'view') : 'view'; }
  }
  const tile = view?.tiles.find((x) => x.currencyCode === values.currencyCode) ?? view?.tiles[0] ?? null;
  const currencyCode = tile?.currencyCode ?? values.currencyCode ?? null;
  // the typed amount, re-scaled at the currency's own scale; the carried minor value (from a retry) is kept when nothing new was typed
  const amountMinor = values.amountMajor !== undefined && tile ? majorToMinorText(values.amountMajor, tile.minorUnits) : (values.amountMinor ?? null);
  const bankAccountId = values.bankAccountId ?? (view?.bankAccounts.length === 1 ? view.bankAccounts[0].id : null);
  if (step === 'confirm' && view && currencyCode && amountMinor && bankAccountId) {
    try { review = await tenantClient().instructorEarnings.payoutReview({ amountMinor, currencyCode, bankAccountId }); }
    catch (e) { viewError = e instanceof SdkError ? (e.code || 'review') : 'review'; }
  }

  return (
    <section>
      <h1>{t.t('earnings.payout.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      <p className="kv-field__hint"><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
      {!carried.preserved && <div className="kv-error" role="alert"><p>{t.t(valuesLostKey())}</p></div>}
      {step === 'confirm' && viewError && <div className="kv-error" role="alert"><p>{t.t('mutate.previewFailed')} {viewError}</p></div>}

      {step === 'confirm' && view && (
        <>
          <div className="kv-card">
            <h2>{t.t('earnings.payout.object')}</h2>
            {tile ? (
              <>
                <p>{t.t('earnings.tile.available')}: <strong>{formatMoneyMinor(tile.available, tile.currencyCode, lang)}</strong> · {t.t('earnings.tile.held')}: {formatMoneyMinor(tile.lifetime.held, tile.currencyCode, lang)} · {t.t('earnings.tile.paidOut')}: {formatMoneyMinor(tile.paidOut, tile.currencyCode, lang)}</p>
                <p className="kv-field__hint">{t.t('earnings.payout.rides')}</p>
                <p className="kv-field__hint">{t.t(earningsRefusedKey('monthlyLaneClock'))}</p>
              </>
            ) : <p className="kv-field__hint">{t.t('earnings.payout.noCurrency')}</p>}
            {view.agreement.current ? null : <div className="kv-error" role="alert"><p>{t.t(payoutRefusalKey('AGREEMENT_NOT_ACCEPTED'))}</p></div>}
          </div>

          {tile && (
            <form action={PATH} method="get" className="kv-card">
              <input type="hidden" name="step" value="confirm" />
              <input type="hidden" name="currencyCode" value={tile.currencyCode} />
              <label className="kv-field" htmlFor="payout-amount">
                <span>{t.t('earnings.payout.amountLabel', { code: tile.currencyCode })}</span>
                <input id="payout-amount" name="amountMajor" inputMode="decimal" defaultValue={values.amountMajor ?? ''} aria-describedby="payout-amount-hint" />
              </label>
              <p id="payout-amount-hint" className="kv-field__hint">{t.t('earnings.payout.amountHint', { scale: String(tile.minorUnits) })}</p>
              {values.amountMajor !== undefined && !amountMinor && <p className="kv-error" role="alert">{t.t(payoutRefusalKey('AMOUNT_INVALID'))}</p>}
              <label className="kv-field" htmlFor="payout-bank">
                <span>{t.t('earnings.payout.bankLabel')}</span>
                <select id="payout-bank" name="bankAccountId" defaultValue={bankAccountId ?? ''}>
                  <option value="">{t.t('earnings.payout.bankChoose')}</option>
                  {view.bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.label} {b.verified ? '' : `· ${t.t('earnings.payout.bankUnverified')}`}</option>)}
                </select>
              </label>
              {view.bankAccounts.length === 0 && <p className="kv-field__hint">{t.t('earnings.payout.noBank')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}

          {review && (
            <div className="kv-card">
              <h2>{t.t('earnings.payout.review')}</h2>
              <p>{formatMoneyMinor(review.amountMinor, review.currencyCode, lang)} · {t.t('earnings.payout.purpose')} · {t.t('earnings.payout.agreementVersion', { version: review.agreementVersion === null ? t.t('common.dash') : String(review.agreementVersion) })}</p>
              {review.refusals.map((r) => <div className="kv-error" role="alert" key={r}><p>{t.t(payoutRefusalKey(r))}</p></div>)}
              <p className="kv-field__hint">{t.t('earnings.payout.planeGates')}</p>
              {review.ready ? (
                <form action={requestRoyaltyPayoutAction}>
                  <input type="hidden" name="amountMinor" value={review.amountMinor} />
                  <input type="hidden" name="currencyCode" value={review.currencyCode} />
                  <input type="hidden" name="bankAccountId" value={bankAccountId as string} />
                  <button type="submit" className="kv-btn">{t.t('earnings.payout.confirm')}</button>
                </form>
              ) : <p className="kv-field__hint">{t.t('mutate.cannotProceed')}</p>}
            </div>
          )}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('earnings.payout.done')}</p>
          <p className="kv-field__hint">{t.t('earnings.payout.stage.awaitingBatch')}</p>
          <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          {canLinkAudit('payout', payoutId) && <p><Link href={auditHref('payout', payoutId as string)} className="kv-btn--link">{t.t('mutate.viewAudit')}</Link></p>}
          <p><Link href={backHref} className="kv-btn--link">{t.t('mutate.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')} {failed}</p>
          {failedRefusals.map((r) => <p key={r}>{t.t(payoutRefusalKey(r))}</p>)}
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
