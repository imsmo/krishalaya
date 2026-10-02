// apps/web-tenant/src/app/marketplace/offers/new/page.tsx · THE NEW PROMOTION FORM CHAIN — W2720 form-error · W2721 review ·
// W2722 success · W2723 failure · PC-56 TENANT-10b.
//
// edit → review → success | failure, ONE page, the values in the URL (features/forms/chain.ts). Amounts are typed in RUPEES
// and travel as typed; the API is asked in paise. The review is the API's own (`POST /promotions/review`) — the same rule
// function the act re-runs — so a "ready" review cannot be followed by a refusal it could have named. It shows the status
// the promotion will have the moment it is saved, and the sentence that matters most: this money is RESERVED FROM YOUR
// ORGANISATION WALLET when a coupon is applied (F-2). The form offers only the two promotion types with an engine (B7) and
// a budget is required (B2 — uncapped is refused by name). THE IDEMPOTENCY KEY IS MINTED ON THE REVIEW PAGE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { PromotionReview } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref, isFormError } from '../../../../features/forms/chain';
import { DISCOUNT_TYPES, ENGINE_TYPES, NEW_PROMOTION_HREF, OFFERS_HREF, PROMO_FORM_KEYS, carried, codeKey, consoleState, isUuid, promoFieldKey, promoStatusKey, promotionEntries } from '../../../../features/promos/offers';
import { ReviewTable } from '../ReviewTable';
import { createPromotionAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('promo.new.title'), robots: { index: false, follow: false } };
}

export default async function NewPromotionPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_PROMOTION_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(PROMO_FORM_KEYS, (k) => searchParams[k]);
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const createdId = typeof searchParams.id === 'string' && isUuid(searchParams.id) ? searchParams.id : null;
  const v = (k: string) => values[k] ?? '';
  const back = `${NEW_PROMOTION_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;

  if (!env.featurePromotions) {
    return <section><h1>{t.t('promo.new.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('promo.state.flaggedOff.title')}</strong><p>{t.t('promo.state.flaggedOff.body')}</p></div></section>;
  }

  let review: PromotionReview | null = null; let state: string | null = null;
  if (step === 'review') {
    try { review = await tenantClient().promotions.review(promotionEntries(values)); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const formError = isFormError(step, review);

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('promo.breadcrumb')}><Link href={OFFERS_HREF}>{t.t('promo.breadcrumb.offers')}</Link> / <span aria-current="page">{t.t('promo.new.title')}</span></nav>
      <h1>{t.t('promo.new.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, formError))} · {t.t('promo.chain.module')}</p>

      {step === 'edit' && (
        <form action={NEW_PROMOTION_HREF} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="p-name"><span>{t.t(promoFieldKey('defaultName'))}</span>
            <input id="p-name" name="name" className="kv-input" maxLength={150} defaultValue={v('name')} required /></label>
          <label className="kv-field" htmlFor="p-type"><span>{t.t(promoFieldKey('promoType'))}</span>
            <select id="p-type" name="promoType" className="kv-select" defaultValue={v('promoType') || 'discount'}>
              {ENGINE_TYPES.map((x) => <option key={x} value={x}>{t.t(`promo.type.${x}.name`)}</option>)}
            </select>
            <span className="kv-field__hint">{t.t('promo.form.typeHint')}</span></label>
          <label className="kv-field" htmlFor="p-dt"><span>{t.t(promoFieldKey('discountType'))}</span>
            <select id="p-dt" name="discountType" className="kv-select" defaultValue={v('discountType') || 'percent'}>
              {DISCOUNT_TYPES.map((x) => <option key={x} value={x}>{t.t(`promo.discount.${x}`)}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="p-pct"><span>{t.t(promoFieldKey('percentOff'))}</span>
            <input id="p-pct" name="percentOff" className="kv-input" inputMode="numeric" maxLength={3} defaultValue={v('percentOff')} />
            <span className="kv-field__hint">{t.t('promo.form.percentHint')}</span></label>
          <label className="kv-field" htmlFor="p-max"><span>{t.t(promoFieldKey('maxDiscountMinor'))}</span>
            <input id="p-max" name="maxDiscount" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('maxDiscount')} />
            <span className="kv-field__hint">{t.t('promo.form.maxHint')}</span></label>
          <label className="kv-field" htmlFor="p-amt"><span>{t.t(promoFieldKey('amountOffMinor'))}</span>
            <input id="p-amt" name="amountOff" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('amountOff')} />
            <span className="kv-field__hint">{t.t('promo.form.amountHint')}</span></label>
          <label className="kv-field" htmlFor="p-min"><span>{t.t(promoFieldKey('minOrderMinor'))}</span>
            <input id="p-min" name="minOrder" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('minOrder')} /></label>
          <label className="kv-field" htmlFor="p-budget"><span>{t.t(promoFieldKey('budgetMinor'))}</span>
            <input id="p-budget" name="budget" className="kv-input" inputMode="decimal" maxLength={16} defaultValue={v('budget')} required />
            <span className="kv-field__hint">{t.t('promo.form.budgetHint')}</span></label>
          <label className="kv-field" htmlFor="p-starts"><span>{t.t(promoFieldKey('startsAt'))}</span>
            <input id="p-starts" name="starts" type="datetime-local" className="kv-input" defaultValue={v('starts')} required /></label>
          <label className="kv-field" htmlFor="p-ends"><span>{t.t(promoFieldKey('endsAt'))}</span>
            <input id="p-ends" name="ends" type="datetime-local" className="kv-input" defaultValue={v('ends')} required />
            <span className="kv-field__hint">{t.t('promo.form.windowHint')}</span></label>
          <p className="kv-field__hint">{t.t('promo.moneyNote')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
        </form>
      )}

      {step === 'review' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`promo.state.${state}.title`)}</strong><p>{t.t(`promo.state.${state}.body`)}</p></div>}
          {review && <ReviewTable t={t} lang={lang} review={review} fieldKey={promoFieldKey} />}
          {review && review.ready && review.computedStatus && (
            <div className="kv-card">
              <p>{t.t('promo.review.status', { status: t.t(promoStatusKey(review.computedStatus)) })}</p>
              <p><strong>{t.t('promo.moneyNote')}</strong></p>
              <p className="kv-field__hint">{t.t('promo.review.declineNote')}</p>
            </div>
          )}
          {review && review.ready ? (
            <form action={createPromotionAction} className="kv-actions">
              {Object.entries(values).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.submit')}</button>{' '}
              <Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link>
            </form>
          ) : (
            <p><span className="kv-field__hint">{t.t('form.fixFirst')}</span>{' '}<Link href={back} className="kv-btn--link">{t.t('form.backToEdit')}</Link></p>
          )}
        </>
      )}

      {step === 'success' && (
        <div className="kv-card kv-card--notice" role="status">
          <p>{t.t('promo.new.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p>{createdId && <><Link href={auditHref('promotion', createdId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}</>}
            <Link href={OFFERS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(NEW_PROMOTION_HREF, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={OFFERS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
