// apps/web-tenant/src/app/people/ambassadors/[id]/act/page.tsx · THE AMBASSADORS MUTATE CHAIN — W2485 confirm → W2486
// success → W2487 failure · PC-56 TENANT-10a.
//
// The canon's only act on this chain is *Retry* — a PAGE LOAD (refused by name: `retryIsMutation`). The real state changes
// on this module land HERE, each confirmed against the ambassador AS IT STANDS (GET /ambassadors/:id): SUSPEND (reason
// REQUIRED), REINSTATE (reason optional) and PAY OUT (`ambassador.payout`, tenant_admin only; reason REQUIRED; the
// platform's Fees account pays — founder question F-23 — and the server stamps every locked earning or rolls the wallet leg
// back, F-1). THE IDEMPOTENCY KEY IS MINTED ON THIS PAGE, so a double click pays once. The success screen shows the audit
// entry the act wrote, read back from the trail.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { AmbassadorRosterRow } from '@krishalaya/sdk-js';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { AMBASSADORS_HREF, actKey, actsFor, codeKey, consoleState, detailHref, isAmbAct, isUuid, personKey } from '../../../../../features/ambassadors/console';
import { AuditEntryCard } from '../../AuditEntryCard';
import { ambassadorActAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('amb.actTitle'), robots: { index: false, follow: false } };
}
const AUDIT_ACTION = { suspend: 'ambassador.suspended', reinstate: 'ambassador.reinstated', payout: 'ambassador.payout.run' } as const;

export default async function AmbassadorActPage({ params, searchParams }: { params: { id: string }; searchParams: Record<string, string | undefined> }) {
  const base = `${detailHref(params.id)}/act`;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const act = isAmbAct(searchParams.act) ? searchParams.act : 'suspend';
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const reasonRequired = act !== 'reinstate';
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z_]{2,40}$/.test(x));
  if (!env.featureAmbassadors) {
    return <section><h1>{t.t('amb.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('amb.state.flaggedOff.title')}</strong><p>{t.t('amb.state.flaggedOff.body')}</p></div></section>;
  }

  let row: AmbassadorRosterRow | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { row = await tenantClient().ambassadors.get(params.id); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = consoleState(err?.code, err?.status); }
  }
  const offered = row ? actsFor(row).includes(act) : false;
  const reasonOk = reasonRequired ? rs === 'ok' : (rs === 'ok' || rs === 'empty');
  const who = row ? personKey(row.displayName) : null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('amb.breadcrumb')}><Link href={AMBASSADORS_HREF}>{t.t('amb.title')}</Link> / <Link href={detailHref(params.id)}>{who ? t.t(who.key, who.vars) : t.t('amb.detail.title')}</Link> / <span aria-current="page">{t.t(actKey(act))}</span></nav>
      <h1>{t.t(actKey(act))}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('amb.chain.module')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`amb.state.${state}.title`)}</strong><p>{t.t(`amb.state.${state}.body`)}</p></div>}
          {row && who && (
            <>
              <div className="kv-card">
                <p><strong>{t.t(who.key, who.vars)}</strong> · {row.phoneMasked}</p>
                <p className="kv-field__hint">{t.t(row.isActive ? 'amb.active' : 'amb.suspended')} · {t.t('amb.col.owed')}: {formatMoneyMinor(row.owedMinor, 'INR', lang)}</p>
                <p>{t.t(`amb.act.rule.${act}`)}</p>
                {act === 'payout' && <p className="kv-field__hint">{t.t('amb.act.payoutFunding')} {t.t('amb.act.payoutVerb')}</p>}
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!offered && <div className="kv-error" role="alert"><p>{t.t(`amb.act.notOffered.${act}`)}</p></div>}
              <form action={base} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value={act} />
                <label className="kv-field" htmlFor="a-reason"><span>{t.t(reasonRequired ? 'amb.act.reason' : 'amb.act.reasonOptional')}</span>
                  <textarea id="a-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={reasonRequired ? MIN_REASON : undefined} required={reasonRequired} /></label>
                {(reason.length > 0 || reasonRequired) && reasonStateKey(rs) && !(rs === 'empty' && !reasonRequired) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {offered && reasonOk ? (
                <form action={ambassadorActAction} className="kv-actions">
                  <input type="hidden" name="id" value={params.id} />
                  <input type="hidden" name="act" value={act} />
                  <input type="hidden" name="reason" value={reason} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={detailHref(params.id)} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={detailHref(params.id)} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status">
            <p>{t.t(`amb.act.done.${act}`, act === 'payout' ? { amount: formatMoneyMinor(/^\d+$/.test(searchParams.paid ?? '') ? searchParams.paid! : '0', 'INR', lang), n: /^\d+$/.test(searchParams.count ?? '') ? searchParams.count! : '0' } : {})}</p>
            {act === 'payout' && <p className="kv-field__hint">{t.t('amb.act.zeroSum')}</p>}
          </div>
          {isUuid(params.id) && <AuditEntryCard t={t} lang={lang} entityType="ambassador_profile" entityId={params.id} action={AUDIT_ACTION[act]} />}
          <p><Link href={detailHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link>{act === 'payout' && <>{' · '}<Link href={`${detailHref(params.id)}?unpaid=0`} className="kv-btn--link">{t.t('amb.act.toEarnings')}</Link></>}</p>
        </>
      )}

      {step === 'failure' && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((code) => <li key={code}>{t.t(codeKey(code))} <code>{code}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=${act}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={detailHref(params.id)} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
