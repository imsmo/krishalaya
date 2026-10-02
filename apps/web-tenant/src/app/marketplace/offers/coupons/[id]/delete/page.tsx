// apps/web-tenant/src/app/marketplace/offers/coupons/[id]/delete/page.tsx · THE COUPONS MUTATE CHAIN — W2543 confirm → W2544
// success → W2545 failure · PC-56 TENANT-10b.
//
// The canon's only act on this chain is *Retry* — a page load (refused by name). The real act is DELETE (a soft delete:
// the code stays reserved — UNIQUE per organisation — and every redemption on it stays on record), confirmed against the
// coupon as it stands (GET /coupons/:id), with a REASON (required). The server answers 404 when there was nothing to
// delete and writes no audit row then (F-12). Redemptions already reserved keep their money path: a deleted coupon's
// reservations are still paid to the seller at settlement or returned on cancel.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { CouponListRow } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../../lib/i18n';
import { env } from '../../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../../features/mutate/chain';
import { COUPONS_HREF, OFFERS_HREF, codeKey, consoleState, couponStatusKey, isUuid, usesKey } from '../../../../../../features/promos/offers';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { deleteCouponAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('cpn.delete.title'), robots: { index: false, follow: false } };
}

export default async function DeleteCouponPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${COUPONS_HREF}/${encodeURIComponent(params.id)}/delete`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  if (!env.featurePromotions) {
    return <section><h1>{t.t('cpn.delete.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('cpn.state.flaggedOff.title')}</strong><p>{t.t('cpn.state.flaggedOff.body')}</p></div></section>;
  }

  let row: CouponListRow | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { row = await tenantClient().promotions.getCoupon(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = err?.status === 404 ? 'notFound' : consoleState(err?.code, err?.status); }
  }

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('promo.breadcrumb')}><Link href={OFFERS_HREF}>{t.t('promo.breadcrumb.offers')}</Link> / <Link href={COUPONS_HREF}>{t.t('cpn.title')}</Link> / <span aria-current="page">{t.t('cpn.delete.title')}</span></nav>
      <h1>{t.t('cpn.delete.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('cpn.chain.module')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`cpn.state.${state}.title`)}</strong><p>{t.t(`cpn.state.${state}.body`)}</p></div>}
          {row && (
            <>
              <div className="kv-card">
                <p><strong><code>{row.code}</code></strong> · {row.promotionName ?? t.t('cpn.promotion.none')} · {t.t(couponStatusKey(row.status))}</p>
                <p className="kv-field__hint">{t.t(usesKey(row.maxUses), { uses: formatNumber(row.uses, lang), max: row.maxUses === null ? '' : formatNumber(row.maxUses, lang) })} · {t.t('cpn.col.redeemed')}: {formatMoneyMinor(row.redeemedValueMinor, 'INR', lang)}</p>
                <p>{t.t('cpn.delete.rule')}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <label className="kv-field" htmlFor="d-reason"><span>{t.t('cpn.delete.reason')}</span>
                  <textarea id="d-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
                {reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {rs === 'ok' ? (
                <form action={deleteCouponAction} className="kv-actions">
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="reason" value={reason} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={COUPONS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={COUPONS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('cpn.delete.done')}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="coupon" entityId={params.id} action="coupon.deleted" />}
          <p><Link href={COUPONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={COUPONS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
