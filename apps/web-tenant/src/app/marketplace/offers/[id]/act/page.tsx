// apps/web-tenant/src/app/marketplace/offers/[id]/act/page.tsx · THE PROMOTIONS MUTATE CHAIN — W2724 confirm → W2725 success →
// W2726 failure · PC-56 TENANT-10b.
//
// The canon's only act on this chain is *Retry* — a PAGE LOAD (refused by name: `retryIsMutation`). The real state change on
// this module lands HERE: PAUSE (a person's pause — the festival scheduler never re-opens it, F-10) and RESUME, each confirmed
// against the promotion AS IT STANDS (GET /promotions/:id), each with a REASON (required; recorded word for word). Pause is
// offered on a running promotion and resume on a paused one; a spent or ended promotion offers neither, and the server
// refuses by name (PROMOTION_NOT_PAUSABLE / PROMOTION_NOT_RESUMABLE). The success screen shows the audit entry the act wrote.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { Promotion } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { OFFERS_HREF, actsFor, codeKey, consoleState, isPromoAct, isUuid, promoStatusKey } from '../../../../../features/promos/offers';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { promotionActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('promo.actTitle'), robots: { index: false, follow: false } };
}
const AUDIT_ACTION = { pause: 'promotion.paused', resume: 'promotion.resumed' } as const;

export default async function PromotionActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${OFFERS_HREF}/${encodeURIComponent(params.id)}/act`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const act = isPromoAct(searchParams.act) ? searchParams.act : 'pause';
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  if (!env.featurePromotions) {
    return <section><h1>{t.t('promo.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('promo.state.flaggedOff.title')}</strong><p>{t.t('promo.state.flaggedOff.body')}</p></div></section>;
  }

  let row: Promotion | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { row = await tenantClient().promotions.get(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = err?.status === 404 ? 'notFound' : consoleState(err?.code, err?.status); }
  }
  const offered = row ? actsFor(row.status).includes(act) : false;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('promo.breadcrumb')}><Link href={OFFERS_HREF}>{t.t('promo.breadcrumb.offers')}</Link> / <span aria-current="page">{t.t(`promo.act.${act}`)}</span></nav>
      <h1>{t.t(`promo.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('promo.chain.module')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`promo.state.${state}.title`)}</strong><p>{t.t(`promo.state.${state}.body`)}</p></div>}
          {row && (
            <>
              <div className="kv-card">
                <p><strong>{row.defaultName}</strong> · {t.t(promoStatusKey(row.status))}</p>
                <p className="kv-field__hint">{t.t('promo.col.budget')}: {row.budgetMinor === null ? t.t('promo.budget.uncappedLegacy') : formatMoneyMinor(row.budgetMinor, 'INR', lang)} · {t.t('promo.col.spent')}: {formatMoneyMinor(row.spentMinor, 'INR', lang)}</p>
                <p>{t.t(`promo.act.rule.${act}`)}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!offered && <div className="kv-error" role="alert"><p>{t.t(`promo.act.notOffered.${act}`)}</p></div>}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                <label className="kv-field" htmlFor="a-reason"><span>{t.t('promo.act.reason')}</span>
                  <textarea id="a-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
                {reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {offered && rs === 'ok' ? (
                <form action={promotionActAction} className="kv-actions">
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="act" value={act} />
                  <input type="hidden" name="reason" value={reason} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={OFFERS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={OFFERS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`promo.act.done.${act}`)}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="promotion" entityId={params.id} action={AUDIT_ACTION[act]} />}
          <p><Link href={OFFERS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=${act}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={OFFERS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
