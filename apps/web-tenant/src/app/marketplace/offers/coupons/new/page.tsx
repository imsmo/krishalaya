// apps/web-tenant/src/app/marketplace/offers/coupons/new/page.tsx · THE NEW COUPON FORM CHAIN — W2539 form-error · W2540
// review · W2541 success · W2542 failure · PC-56 TENANT-10b.
//
// edit → review → success | failure, values in the URL. The promotion is CHOSEN from this tenant's own promotions (never a
// pasted id); a coupon under a promotion with no engine, or one that has ended, is refused by name. The review is the API's
// (`POST /coupons/review`), re-run by the act. With no promotion at all the page prints the canon's "create a promotion
// first" state instead of a form. THE IDEMPOTENCY KEY IS MINTED ON THE REVIEW PAGE.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { CouponReview, Promotion } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { auditHref, chainStep, chainStepKey, failureKey, repeatedFailuresGapKey, retryHref, isFormError } from '../../../../../features/forms/chain';
import { COUPONS_HREF, COUPON_FORM_KEYS, NEW_COUPON_HREF, NEW_PROMOTION_HREF, OFFERS_HREF, carried, codeKey, consoleState, couponEntries, couponFieldKey, isUuid, promoStatusKey } from '../../../../../features/promos/offers';
import { ReviewTable } from '../../ReviewTable';
import { createCouponAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cpn.new.title'), robots: { index: false, follow: false } };
}

export default async function NewCouponPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(NEW_COUPON_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = chainStep(typeof searchParams.step === 'string' ? searchParams.step : undefined);
  const values = carried(COUPON_FORM_KEYS, (k) => searchParams[k]);
  const failed = (typeof searchParams.error === 'string' ? searchParams.error : '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const createdId = typeof searchParams.id === 'string' && isUuid(searchParams.id) ? searchParams.id : null;
  const back = `${NEW_COUPON_HREF}?${new URLSearchParams({ ...values, step: 'edit' }).toString()}`;

  if (!env.featurePromotions) {
    return <section><h1>{t.t('cpn.new.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('cpn.state.flaggedOff.title')}</strong><p>{t.t('cpn.state.flaggedOff.body')}</p><p className="kv-field__hint">{t.t('cpn.state.flaggedOff.ridesPromotions')}</p></div></section>;
  }

  let promos: Promotion[] = []; let state: string | null = null; let review: CouponReview | null = null;
  if (step === 'edit' || step === 'review') {
    try { promos = (await tenantClient().promotions.list({ limit: 100 })).items; }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  if (step === 'review' && !state) {
    try { review = await tenantClient().promotions.reviewCoupon(couponEntries(values)); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const names = Object.fromEntries(promos.map((p) => [p.id, p.defaultName]));
  const offerable = promos.filter((p) => p.hasEngine && p.status !== 'expired' && p.status !== 'exhausted');
  const formError = isFormError(step, review);

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('promo.breadcrumb')}><Link href={OFFERS_HREF}>{t.t('promo.breadcrumb.offers')}</Link> / <Link href={COUPONS_HREF}>{t.t('cpn.title')}</Link> / <span aria-current="page">{t.t('cpn.new.title')}</span></nav>
      <h1>{t.t('cpn.new.title')}</h1>
      <p className="kv-field__hint">{t.t(chainStepKey(step, formError))} · {t.t('cpn.chain.module')}</p>
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`cpn.state.${state}.title`)}</strong><p>{t.t(`cpn.state.${state}.body`)}</p></div>}

      {step === 'edit' && !state && (offerable.length === 0 ? (
        <div className="kv-card">
          <strong>{t.t('cpn.noPromotion.title')}</strong><p className="kv-detail__muted">{t.t('cpn.noPromotion.body')}</p>
          <Link href={`${NEW_PROMOTION_HREF}?step=edit`} className="kv-btn kv-btn--sm">{t.t('promo.new')}</Link>
        </div>
      ) : (
        <form action={NEW_COUPON_HREF} method="get" className="kv-card kv-form">
          <input type="hidden" name="step" value="review" />
          <label className="kv-field" htmlFor="c-promo"><span>{t.t(couponFieldKey('promotionId'))}</span>
            <select id="c-promo" name="promotionId" className="kv-select" defaultValue={values.promotionId ?? ''} required>
              <option value="">{t.t('cpn.form.choosePromotion')}</option>
              {offerable.map((p) => <option key={p.id} value={p.id}>{p.defaultName} · {t.t(promoStatusKey(p.status))}</option>)}
            </select></label>
          <label className="kv-field" htmlFor="c-code"><span>{t.t(couponFieldKey('code'))}</span>
            <input id="c-code" name="code" className="kv-input" maxLength={40} autoCapitalize="characters" defaultValue={values.code ?? ''} required />
            <span className="kv-field__hint">{t.t('cpn.form.codeHint')}</span></label>
          <label className="kv-field" htmlFor="c-max"><span>{t.t(couponFieldKey('maxUses'))}</span>
            <input id="c-max" name="maxUses" className="kv-input" inputMode="numeric" maxLength={9} defaultValue={values.maxUses ?? ''} />
            <span className="kv-field__hint">{t.t('cpn.form.maxUsesHint')}</span></label>
          <label className="kv-field" htmlFor="c-per"><span>{t.t(couponFieldKey('perUserLimit'))}</span>
            <input id="c-per" name="perUserLimit" className="kv-input" inputMode="numeric" maxLength={4} defaultValue={values.perUserLimit ?? ''} />
            <span className="kv-field__hint">{t.t('cpn.form.perUserHint')}</span></label>
          <p className="kv-field__hint">{t.t('promo.moneyNote')}</p>
          <button type="submit" className="kv-btn kv-btn--primary">{t.t('form.toReview')}</button>
        </form>
      ))}

      {step === 'review' && review && (
        <>
          <ReviewTable t={t} lang={lang} review={review} fieldKey={couponFieldKey} names={names} />
          {review.ready ? (
            <form action={createCouponAction} className="kv-actions">
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
          <p>{t.t('cpn.new.done')}</p>
          <p className="kv-field__hint">{t.t('form.auditNote')}</p>
          <p>{createdId && <><Link href={auditHref('coupon', createdId)} className="kv-btn--link">{t.t('form.viewAudit')}</Link>{' · '}</>}
            <Link href={COUPONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={retryHref(NEW_COUPON_HREF, values)} className="kv-btn--link">{t.t('form.retry')}</Link>{' · '}<Link href={COUPONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
