// apps/web-tenant/src/app/people/referrals/[id]/activate/page.tsx · THE REFERRALS MUTATE CHAIN — W2735 confirm → W2736 success
// → W2737 failure · PC-56 TENANT-10a.
//
// The canon labels the chain "Retry · activated → rewarded · invited". Retry is a page load (refused by name). "→ rewarded"
// has no act: no reward rule exists (F-11). "invited" (resend / expire an invite) has no act either. The ONE real act is
// ACTIVATION: a manual, recorded confirmation that the referred member is real — it accrues the referring ambassador's
// onboarding commission (if the referrer is one) and writes `referral.activated` with the reason (REQUIRED). The success
// screen reads that audit entry back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ReferralDeskRow } from '@krishalaya/sdk-js';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { env } from '../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { REFERRALS_HREF, codeKey, consoleState, isUuid, personKey, statusKey } from '../../../../../features/ambassadors/console';
import { AuditEntryCard } from '../../../ambassadors/AuditEntryCard';
import { activateReferralAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('ref.activateTitle'), robots: { index: false, follow: false } };
}

export default async function ActivateReferralPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${REFERRALS_HREF}/${encodeURIComponent(params.id)}/activate`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  if (!env.featureAmbassadors) {
    return <section><h1>{t.t('ref.activateTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('ref.state.flaggedOff.title')}</strong><p>{t.t('ref.state.flaggedOff.body')}</p></div></section>;
  }
  let row: ReferralDeskRow | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { row = await tenantClient().ambassadors.referral(params.id); if (row.status !== 'signed_up') state = 'notActivatable'; }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const by = row ? personKey(row.referrer.displayName) : null;
  const to = row?.referee ? personKey(row.referee.displayName) : null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={REFERRALS_HREF}>{t.t('ref.title')}</Link> / <span aria-current="page">{t.t('ref.activateTitle')}</span></nav>
      <h1>{t.t('ref.activateTitle')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('ref.chain.module')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`ref.state.${state}.title`)}</strong><p>{t.t(`ref.state.${state}.body`)}</p></div>}
          {row && by && row.status === 'signed_up' && (
            <>
              <div className="kv-card">
                <p><code>{row.code}</code> · {t.t(statusKey(row.status))}</p>
                <p>{t.t('ref.activate.object', { referrer: t.t(by.key, by.vars), referee: to ? t.t(to.key, to.vars) : t.t('ref.notYetJoined') })}</p>
                <p className="kv-field__hint">{t.t('ref.activate.rule')} {row.referrer.isAmbassador ? t.t('ref.activate.commission') : t.t('ref.activate.noCommission')}</p>
                <p className="kv-field__hint">{t.t('ref.refused.rewardRule')}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <label className="kv-field" htmlFor="ra-reason"><span>{t.t('amb.act.reason')}</span>
                  <textarea id="ra-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
                {reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {rs === 'ok' ? (
                <form action={activateReferralAction} className="kv-actions">
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="reason" value={reason} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={REFERRALS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={REFERRALS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('ref.activate.done')}</p><p className="kv-field__hint">{t.t('ref.refused.rewardPaid')}</p></div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="referral" entityId={params.id} action="referral.activated" />}
          <p><Link href={REFERRALS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={REFERRALS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
