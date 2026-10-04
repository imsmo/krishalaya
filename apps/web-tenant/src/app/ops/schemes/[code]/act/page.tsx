// apps/web-tenant/src/app/ops/schemes/[code]/act/page.tsx · THE SCHEMES MUTATE CHAIN — W2751 confirm → W2752 success → W2753
// failure · PC-56 TENANT-SW-b.
//
// The canon's only act on this chain is *Retry* — a PAGE LOAD (refused by name). The real act here is "Run eligibility sweep":
// confirmed against the scheme AS IT STANDS (its pipeline read), with a REQUIRED reason, keyed on THIS PAGE's Idempotency-Key.
// It queues one sweep (once per scheme per IST day); the job evaluates every member and writes a CALL LIST — no application is
// ever created. The success screen reads the sweep's audit row back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { SchemePipeline } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { env } from '../../../../../lib/env';
import { MAX_REASON, MIN_REASON, failureKey, mutateStep, mutateStepKey, reasonState, reasonStateKey, repeatedFailuresGapKey } from '../../../../../features/mutate/chain';
import { SCHEMES_DESK_HREF, codesFromUrl, isSchemeCode, isUuid, schemeHref, swbCodeKey, swbState } from '../../../../../features/swb/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { schemeActAction } from './actions';
import { SEEN_FIELD, seenToken, isStaleFailure, readDiff } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';
import { StaleDiffChip } from '../../../../../components/StaleDiffChip';
import { staleLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('swb.scm.actTitle'), robots: { index: false, follow: false } };
}

export default async function SchemeActPage({ params, searchParams }: { params: { code: string }; searchParams: Record<string, string | undefined> }) {
  const code = isSchemeCode(params.code) ? params.code : '';
  const base = code ? `${schemeHref(code)}/act` : SCHEMES_DESK_HREF;
  await requireSession(base);
  const t = getTranslator();
  const lang = getLang();
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, MAX_REASON + 50);
  const rs = reasonState(reason);
  const failed = codesFromUrl(searchParams.error);
  const crumbs = <nav className="kv-breadcrumb" aria-label={t.t('swb.scm.breadcrumb')}><Link href={SCHEMES_DESK_HREF}>{t.t('swb.scm.title')}</Link> / {code ? <Link href={schemeHref(code)}>{code}</Link> : null} / <span aria-current="page">{t.t('swb.scm.act.sweep')}</span></nav>;
  if (!env.featureSchemes) {
    return <section>{crumbs}<h1>{t.t('swb.scm.actTitle')}</h1><div className="kv-card kv-card--notice" role="status"><strong>{t.t('swb.scm.state.flaggedOff.title')}</strong><p>{t.t('swb.scm.state.flaggedOff.body')}</p></div></section>;
  }
  let p: SchemePipeline | null = null; let state: string | null = code ? null : 'notFound';
  if (!state && step === 'confirm') {
    try { p = await tenantClient().schemes.deskPipeline(code, { limit: 1 }); }
    catch (e) { const err = e instanceof SdkError ? e : null; state = swbState(err?.code, err?.status); }
  }
  const offered = !!p && p.scheme.isActive;

  return (
    <section>
      {crumbs}
      <h1>{t.t('swb.scm.act.sweep')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))} · {t.t('swb.scm.chain')}</p>

      {step === 'confirm' && (
        <>
          {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swb.scm.state.${state}.title`)}</strong><p>{t.t(`swb.scm.state.${state}.body`)}</p></div>}
          {p && (
            <>
              <div className="kv-card">
                <p><strong>{p.scheme.name}</strong> · <code>{p.scheme.code}</code> · {t.t('swb.scm.version', { v: String(p.scheme.version) })}</p>
                <p>{t.t('swb.scm.rule.sweep')}</p>
                <p className="kv-field__hint">{t.t('swb.scm.refused.autoApply')}</p>
                <p className="kv-field__hint">{t.t('mutate.reason.recorded')}</p>
              </div>
              {!offered && <div className="kv-error" role="alert"><p>{t.t('swb.code.SWEEP_SCHEME_INACTIVE')}</p></div>}
              <form action={`${schemeHref(code)}/act`} method="get" className="kv-card kv-form">
                <input type="hidden" name="step" value="confirm" />
                <input type="hidden" name="act" value="sweep" />
                <label className="kv-field" htmlFor="s-reason"><span>{t.t('amb.act.reason')}</span>
                  <textarea id="s-reason" name="reason" className="kv-textarea" rows={3} defaultValue={reason} maxLength={MAX_REASON} minLength={MIN_REASON} required /></label>
                {reasonStateKey(rs) && <p className="kv-field__hint">{t.t(reasonStateKey(rs)!)}</p>}
                <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
              </form>
              {offered && rs === 'ok' ? (
                <form action={schemeActAction} className="kv-actions">
              {/* PC-56 TENANT-SW-f · W318 §3: what this confirm step showed — re-read before the write (verify-before-write) */}
              <input type="hidden" name={SEEN_FIELD} value={seenToken((p) as never, VERIFY_FIELDS.schemeSweep)} />
                  <input type="hidden" name="code" value={code} />
                  <input type="hidden" name="reason" value={reason} />
                  <input type="hidden" name="idempotencyKey" value={randomUUID()} />
                  <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
                  <Link href={schemeHref(code)} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
                </form>
              ) : <p><Link href={code ? schemeHref(code) : SCHEMES_DESK_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
            </>
          )}
        </>
      )}

      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t('swb.scm.done.sweep')}</p></div>
          {isUuid(searchParams.sweep) && <AuditEntryCard t={t} lang={lang} entityType="scheme_eligibility_sweep" entityId={searchParams.sweep} action="schemes.eligibility_sweep.requested" />}
          <p><Link href={code ? schemeHref(code) : SCHEMES_DESK_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}

      {step === 'failure' && isStaleFailure(searchParams.error) && <StaleDiffChip code={String(searchParams.error)} diffs={readDiff(searchParams.kv_diff)} labels={staleLabels(t)} recheckHref={`${base}?${new URLSearchParams({ step: 'confirm', act: 'sweep', ...(reason ? { reason } : {}) }).toString()}`} />}
      {step === 'failure' && !isStaleFailure(searchParams.error) && (
        <div className="kv-error" role="alert">
          <p>{t.t('form.failure.title')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(swbCodeKey('scm', c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p className="kv-field__hint">{t.t(repeatedFailuresGapKey())}</p>
          <p><Link href={`${base}?step=confirm&act=sweep`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={code ? schemeHref(code) : SCHEMES_DESK_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
