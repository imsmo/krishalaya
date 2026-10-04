// apps/web-tenant/src/app/ops/logistics/cold-chain/breaches/act/page.tsx · W2536 confirm → W2537 success → W2538 failure (retry) — the
// breach acts · PC-56 TENANT-SW-e. Only the acts the API offers for this breach are offered here; the audit entry is read back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ColdBreach } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../../lib/session';
import { tenantClient } from '../../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../../../features/mutate/chain';
import { BREACHES_HREF, BREACH_OUTCOMES, bandLabel, breachActRefusal, failedCodes, isBreachAct, isUuid, readBreachActDraft, swePageState, sweCodeKey } from '../../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../../people/ambassadors/AuditEntryCard';
import { breachActAction } from './actions';
import { SEEN_FIELD, seenToken, isStaleFailure, readDiff } from '../../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../../features/mutate/verify-fields';
import { StaleDiffChip } from '../../../../../../components/StaleDiffChip';
import { staleLabels } from '../../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.cold.breaches'), robots: { index: false, follow: false } }; }

export default async function BreachActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${BREACHES_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const act = isBreachAct(searchParams.act) ? searchParams.act : 'acknowledge';
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const step = mutateStep(searchParams.step);
  const d = readBreachActDraft(searchParams);
  let b: ColdBreach | null = null; let state: string | null = id ? null : 'notFound';
  if (id && step === 'confirm') { try { b = await tenantClient().coldChain.breach(id); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); } }
  const offered = !!b && b.acts.includes(act);
  const typed = Object.values(d).some((v) => v !== '');
  const refusal = breachActRefusal(act, d);
  const carry: Record<string, string> = { act, ...(id ? { id } : {}), ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== '')) };
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.cold.breaches')}><Link href={BREACHES_HREF}>{t.t('swe.cold.breaches')}</Link> / <span aria-current="page">{t.t(`swe.cold.act.${act}`)}</span></nav>
      <h1>{t.t(`swe.cold.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p></div>
      ) : b && (
        <>
          <div className="kv-card">
            <p><strong>{b.subjectRef}</strong> · {bandLabel(b.band)} · {b.peakC} °C · {when(b.openedAt)}{b.closedAt ? ` → ${when(b.closedAt)}` : ` · ${t.t('swe.cold.ongoing')}`}</p>
            <p>{t.t(`swe.cold.act.rule.${act}`)}</p><p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          </div>
          {!offered && <div className="kv-error" role="alert"><p>{t.t('swe.cold.act.notOffered')}</p></div>}
          {offered && act !== 'acknowledge' && (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" /><input type="hidden" name="act" value={act} /><input type="hidden" name="id" value={b.id} />
              {act === 'record_action' && <label className="kv-field" htmlFor="b-note"><span>{t.t('swe.cold.actionNote')}</span><textarea id="b-note" name="note" className="kv-textarea" rows={3} maxLength={500} defaultValue={d.note} /></label>}
              {act === 'record_outcome' && <>
                <label className="kv-field" htmlFor="b-out"><span>{t.t('swe.cold.col.outcome')}</span>
                  <select id="b-out" name="outcome" className="kv-select" defaultValue={d.outcome}><option value="">{t.t('swe.pick')}</option>{BREACH_OUTCOMES.map((o) => <option key={o} value={o}>{t.t(`swe.cold.outcome.${o}`)}</option>)}</select></label>
                <label className="kv-field" htmlFor="b-why"><span>{t.t('swe.reason')}</span><textarea id="b-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={d.reason} /></label>
                <label className="kv-field" htmlFor="b-loss"><span>{t.t('swe.cold.lossMinor')}</span><input id="b-loss" name="lossMinor" className="kv-input" inputMode="numeric" maxLength={15} defaultValue={d.lossMinor} /></label>
                <label className="kv-field" htmlFor="b-cur"><span>{t.t('swe.cold.lossCurrency')}</span><input id="b-cur" name="lossCurrency" className="kv-input" maxLength={3} defaultValue={d.lossCurrency} /></label>
                <p className="kv-field__hint">{t.t('swe.cold.method.loss')}</p>
              </>}
              {typed && refusal && <p className="kv-error">{t.t(`swe.cold.actErr.${refusal}`)}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && !refusal ? (
            <form action={breachActAction} className="kv-actions">
              {/* PC-56 TENANT-SW-f · W318 §3: what this confirm step showed — re-read before the write (verify-before-write) */}
              <input type="hidden" name={SEEN_FIELD} value={seenToken((b) as never, VERIFY_FIELDS.breach)} />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}<Link href={BREACHES_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={BREACHES_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && id && (
        <><div className="kv-card kv-card--notice" role="status"><p>{t.t(`swe.cold.act.done.${act}`)}</p></div>
          <AuditEntryCard t={t} lang={lang} entityType="cold_chain_breach" entityId={id} action={`logistics.cold_chain_breach_${act}`} />
          <p><Link href={BREACHES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p></>
      )}
      {step === 'failure' && isStaleFailure(searchParams.error) && <StaleDiffChip code={String(searchParams.error)} diffs={readDiff(searchParams.kv_diff)} labels={staleLabels(t)} recheckHref={`${base}?${new URLSearchParams({ step: 'confirm', ...carry }).toString()}`} />}
      {step === 'failure' && !isStaleFailure(searchParams.error) && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((x) => <li key={x}>{t.t(sweCodeKey(x))} <code>{x}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...carry }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={BREACHES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
