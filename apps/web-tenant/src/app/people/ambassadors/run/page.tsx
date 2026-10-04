// apps/web-tenant/src/app/people/ambassadors/run/page.tsx · W159 "Weekly earnings run" — the mutate chain (W2485 confirm →
// W2486 success → W2487 failure) over POST /ambassadors/payouts/run · PC-56 TENANT-10a (A13), re-cut by PC-56 TENANT-SW-b.
//
// FOUNDER DECISION (2026-10-03, closes F-23): ambassadors are paid from the COOPERATIVE'S OWN Main wallet under MAKER-CHECKER.
// This page is now the MAKER's act: it PREPARES this week's run (nothing moves). The job prepares the same run every Thursday
// 23:00 IST; a DIFFERENT tenant admin confirms it on the earnings run screen (W161, /people/ambassadors/earnings), and only then
// does money move — tenant Main → each ambassador's wallet, one zero-sum transfer per ambassador. The platform's Fees account
// no longer pays. The success screen reads the run's own audit row back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorSummary } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../features/mutate/chain';
import { AMBASSADORS_HREF, EARNINGS_HREF, RUN_HREF, codeKey, consoleState, isUuid } from '../../../../features/ambassadors/console';
import { AuditEntryCard } from '../AuditEntryCard';
import { runPayoutsAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('amb.run.title'), robots: { index: false, follow: false } };
}
const num = (v: string | undefined) => (/^\d{1,9}$/.test(v ?? '') ? Number(v) : 0);

export default async function WeeklyRunPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(RUN_HREF);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  const money = (m: string) => formatMoneyMinor(/^\d+$/.test(m) ? m : '0', 'INR', lang);
  if (!env.featureAmbassadors) {
    return <section><h1>{t.t('amb.run.title')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div></section>;
  }
  let sum: AmbassadorSummary | null = null; let state: string | null = null;
  if (step === 'confirm') {
    try { sum = await tenantClient().ambassadors.summary(); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status, true); }
  }
  const owed = sum ? /^\d+$/.test(sum.owedThisWeekMinor) && BigInt(sum.owedThisWeekMinor) > 0n : false;
  const runId = isUuid(searchParams.run) ? searchParams.run : null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={AMBASSADORS_HREF}>{t.t('amb.title')}</Link> / <span aria-current="page">{t.t('amb.run.title')}</span></nav>
      <h1>{t.t('amb.run.title')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('amb.chain.module')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`amb.state.${state}.title`)}</strong><p>{t.t(`amb.state.${state}.body`)}</p></div>}
          {sum && (
            <>
              <div className="kv-card">
                <p>{t.t('amb.run.object', { amount: money(sum.owedThisWeekMinor), n: formatNumber(sum.activeCount, lang) })}</p>
                <p className="kv-field__hint">{t.t('amb.run.rule')}</p>
                <p className="kv-field__hint">{t.t('amb.refused.fridayRun')} {t.t('amb.act.payoutFunding')} {t.t('amb.act.payoutVerb')}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!owed && <div className="kv-card kv-card--notice" role="status"><p>{t.t('amb.run.nothing')}</p></div>}
              <form action={RUN_HREF} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <label className="kv-field" htmlFor="r-reason"><span>{t.t('amb.act.reason')}</span>
                  <textarea id="r-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
                {reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {owed && rs === 'ok' ? (
                <form action={runPayoutsAction} className="kv-actions">
                  <input type="hidden" name="reason" value={reason} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={AMBASSADORS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={AMBASSADORS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t('amb.run.done', { paid: formatNumber(num(searchParams.lines), lang), amount: money(searchParams.total ?? '0') })}</p>
            <p className="kv-field__hint">{t.t(searchParams.covers === '1' ? 'swb.run.funding.coversShort' : 'swb.run.funding.shortShort', { amount: money(searchParams.short ?? '0') })}</p>
            <p className="kv-field__hint">{t.t('amb.act.zeroSum')}</p>
          </div>
          {runId && <AuditEntryCard t={t} lang={lang} entityType="ambassador_payout_run" entityId={runId} action="ambassador.payout_run.prepared" />}
          <p><Link href={EARNINGS_HREF} className="kv-btn--link">{t.t('amb.run.toEarnings')}</Link>{' · '}<Link href={AMBASSADORS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${RUN_HREF}?step=confirm`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={AMBASSADORS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
