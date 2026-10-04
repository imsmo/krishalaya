// apps/web-tenant/src/app/people/ambassadors/earnings/act/page.tsx · THE RUN'S MUTATE CHAIN — W2478 confirm → W2479 success →
// W2480 failure · PC-56 TENANT-SW-b.
//
// The canon's only act on this chain is *Retry* — a PAGE LOAD (refused by name). The real acts land here, each confirmed against
// the run AS IT STANDS (GET /ambassadors/payout-runs/:id): PREPARE (the maker; nothing moves), CONFIRM (the CHECKER — a different
// tenant admin; the database refuses the preparer; confirming PAYS tenant Main → ambassador wallets), PAY AGAIN (only a partly
// paid / unfunded run's unpaid lines; never its preparer) and REFUSE (nothing moves). A reason is REQUIRED on every one.
// THE IDEMPOTENCY KEY IS MINTED ON THIS PAGE, so a double click pays once. The success screen reads the run's audit row back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorRunDetail } from '@krishalaya/sdk-js';
import { formatMoneyMinor, formatNumber, formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { AMBASSADORS_HREF } from '../../../../../features/ambassadors/console';
import {
  EARNINGS_ACT_HREF, EARNINGS_HREF, codesFromUrl, fundingKey, isRunAct, isUuid, runActsFor, runStatusKey, swbCodeKey, swbState,
} from '../../../../../features/swb/console';
import { AuditEntryCard } from '../../AuditEntryCard';
import { runActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.run.actTitle'), robots: { index: false, follow: false } };
}
const AUDIT_ACTION = { prepare: 'ambassador.payout_run.prepared', confirm: 'ambassador.payout_run.confirmed', pay: 'ambassador.payout_run.paid', refuse: 'ambassador.payout_run.refused' } as const;
const num = (v: string | undefined) => (/^\d{1,9}$/.test(v ?? '') ? Number(v) : 0);

export default async function RunActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  await requireSession(EARNINGS_ACT_HREF);
  const t = getTranslator();
  const lang = getLang();
  const money = (m: string | null | undefined) => formatMoneyMinor(m && /^\d+$/.test(m) ? m : '0', 'INR', lang);
  const act = isRunAct(searchParams.act) ? searchParams.act : 'confirm';
  const step = mutateStep(searchParams.step);
  const runId = isUuid(searchParams.run) ? searchParams.run : null;
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const failed = codesFromUrl(searchParams.error);
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={AMBASSADORS_HREF}>{t.t('amb.title')}</Link> / <Link href={EARNINGS_HREF}>{t.t('swb.run.title')}</Link> / <span aria-current="page">{t.t(`swb.run.act.${act}`)}</span></nav>;
  if (!env.featureAmbassadors) {
    return <section>{crumbs}<h1>{t.t('swb.run.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div></section>;
  }
  let run: AmbassadorRunDetail | null = null; let state: string | null = null;
  if (step === 'confirm') {
    try {
      if (act === 'prepare') run = (await tenantClient().ambassadors.currentRun()).run;
      else if (runId) run = await tenantClient().ambassadors.run(runId);
      else state = 'notFound';
    } catch (e) { const err = e instanceof SdkError ? e : null; state = swbState(err?.code, err?.status); }
  }
  const offered = act === 'prepare' ? run === null : !!run && runActsFor(run).includes(act);
  const hidden = (act === 'prepare' ? {} : { run: runId ?? '' }) as Record<string, string>;
  const sp = new URLSearchParams({ step: 'confirm', act, ...hidden }).toString();

  return (
    <section>
      {crumbs}
      <h1>{t.t(`swb.run.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('swb.run.chain')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`amb.state.${state}.title`)}</strong><p>{t.t(`amb.state.${state}.body`)}</p></div>}
          {!state && (
            <>
              <div className="kv-card">
                {run && (
                  <>
                    <p><strong>{t.t('swb.run.object', { amount: money(run.totalMinor), n: formatNumber(run.lineCount, lang), date: formatDate(`${run.payDate}T00:00:00+05:30`, lang, { dateStyle: 'medium', timeZone: 'Asia/Kolkata' }) })}</strong> · {t.t(runStatusKey(run.status))}</p>
                    <p className="kv-field__hint">{t.t(fundingKey(run.lastPayCheck ?? run.fundingCheck), { amount: money((run.lastPayCheck ?? run.fundingCheck).shortfallMinor) })}</p>
                  </>
                )}
                <p>{t.t(`swb.run.rule.${act}`)}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!offered && <div className="kv-error" role="alert"><p>{t.t(`swb.run.notOffered.${act}`)}</p></div>}
              <form action={EARNINGS_ACT_HREF} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                {runId && <input type="hidden" name="run" value={runId} />}
                <label className="kv-field" htmlFor="r-reason"><span>{t.t('amb.act.reason')}</span>
                  <textarea id="r-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
                {reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {offered && rs === 'ok' ? (
                <form action={runActAction} className="kv-actions">
                  <input type="hidden" name="act" value={act} />
                  {runId && <input type="hidden" name="run" value={runId} />}
                  <input type="hidden" name="reason" value={reason} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={EARNINGS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={EARNINGS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t(`swb.run.done.${act}`, { paid: formatNumber(num(searchParams.paid), lang), unfunded: formatNumber(num(searchParams.unfunded), lang), failed: formatNumber(num(searchParams.failed), lang), amount: money(searchParams.amount), n: formatNumber(num(searchParams.lines), lang) })}</p>
            {(act === 'confirm' || act === 'pay') && num(searchParams.unfunded) > 0 && <p className="kv-field__hint">{t.t('swb.run.done.unfundedKind')}</p>}
            {(act === 'confirm' || act === 'pay') && <p className="kv-field__hint">{t.t('swb.run.legs')}</p>}
          </div>
          {isUuid(searchParams.run) && <AuditEntryCard t={t} lang={lang} entityType="ambassador_payout_run" entityId={searchParams.run} action={AUDIT_ACTION[act]} />}
          <p><Link href={EARNINGS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(swbCodeKey('run', code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${EARNINGS_ACT_HREF}?${sp}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={EARNINGS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
