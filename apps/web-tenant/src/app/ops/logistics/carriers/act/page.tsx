// apps/web-tenant/src/app/ops/logistics/carriers/act/page.tsx · W2382 confirm → W2383 success → W2384 failure (retry) — a carrier's
// activate / deactivate, PC-56 TENANT-SW-e. The reason (≥ 10) is typed before anything is sent; the success screen reads the audit entry
// back (actor · time · reason · before → after).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { CarrierRow } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../../features/mutate/chain';
import { CARRIERS_HREF, failedCodes, isCarrierAct, isUuid, swePageState, sweCodeKey } from '../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { carrierActAction } from './actions';
import { SEEN_FIELD, seenToken, isStaleFailure, readDiff } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';
import { StaleDiffChip } from '../../../../../components/StaleDiffChip';
import { staleLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.carriers.title'), robots: { index: false, follow: false } }; }

export default async function CarrierActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${CARRIERS_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const act = isCarrierAct(searchParams.act) ? searchParams.act : 'deactivate';
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, 500);
  let c: CarrierRow | null = null; let state: string | null = id ? null : 'notFound';
  if (id && step === 'confirm') {
    try { c = await tenantClient().carriers.get(id); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  const offered = !!c && c.scope !== 'platform' && (act === 'activate' ? !c.isActive : c.isActive);
  const reasonOk = reason.length >= 10;
  const carry: Record<string, string> = { act, ...(id ? { id } : {}) };
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.carriers.title')}><Link href={CARRIERS_HREF}>{t.t('swe.carriers.title')}</Link> / <span aria-current="page">{t.t(`swe.carriers.act.${act}`)}</span></nav>
      <h1>{t.t(`swe.carriers.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p></div>
      ) : (
        <>
          {c && <div className="kv-card"><p><strong>{c.defaultName}</strong> · {t.t(`swe.carriers.kind.${c.partnerKind}`)} · {t.t(c.isActive ? 'swe.active' : 'swe.inactive')}</p>
            <p>{t.t(`swe.carriers.act.rule.${act}`)}</p><p className="kv-field__hint">{t.t('mutate.auditNote')}</p></div>}
          {!offered && <div className="kv-error" role="alert"><p>{t.t(`swe.carriers.act.notOffered`)}</p></div>}
          {offered && (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <label className="kv-field" htmlFor="c-why"><span>{t.t('swe.reason')}</span>
                <textarea id="c-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={reason} /></label>
              {reason !== '' && !reasonOk && <p className="kv-field__hint">{t.t('swe.reasonMin10')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && reasonOk ? (
            <form action={carrierActAction} className="kv-actions">
              {/* PC-56 TENANT-SW-f · W318 §3: what this confirm step showed — re-read before the write (verify-before-write) */}
              <input type="hidden" name={SEEN_FIELD} value={seenToken((c) as never, VERIFY_FIELDS.carrier)} />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              <input type="hidden" name="reason" value={reason} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={CARRIERS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={CARRIERS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && id && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swe.carriers.act.done.${act}`)}</p></div>
          <AuditEntryCard t={t} lang={lang} entityType="logistics_partner" entityId={id} action={`logistics.partner_${act === 'activate' ? 'activated' : 'deactivated'}`} />
          <p><Link href={CARRIERS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && isStaleFailure(searchParams.error) && <StaleDiffChip code={String(searchParams.error)} diffs={readDiff(searchParams.kv_diff)} labels={staleLabels(t)} recheckHref={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(reason ? { reason } : {}) }).toString()}`} />}
      {step === 'failure' && !isStaleFailure(searchParams.error) && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((x) => <li key={x}>{t.t(sweCodeKey(x))} <code>{x}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(reason ? { reason } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={CARRIERS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
