// apps/web-tenant/src/app/ops/logistics/slots/act/page.tsx · W2400 confirm → success → W2401 failure (retry) — withdraw a slot proposal
// · PC-56 TENANT-SW-e. Offered only while the proposal is open; the reason (≥ 10) is typed first; the audit entry is read back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { SlotProposal } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../../features/mutate/chain';
import { SLOTS_HREF, failedCodes, isUuid, swePageState, sweCodeKey, weekdayKey } from '../../../../../features/swe/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { withdrawProposalAction } from './actions';
import { SEEN_FIELD, seenToken, isStaleFailure, readDiff } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';
import { StaleDiffChip } from '../../../../../components/StaleDiffChip';
import { staleLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.slots.withdraw'), robots: { index: false, follow: false } }; }

export default async function SlotActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${SLOTS_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, 500);
  let p: SlotProposal | null = null; let state: string | null = id ? null : 'notFound';
  if (id && step === 'confirm') { try { p = await tenantClient().pickupSlots.proposal(id); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); } }
  const offered = p?.status === 'proposed';
  const reasonOk = reason.length >= 10;
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.slots.title')}><Link href={SLOTS_HREF}>{t.t('swe.slots.title')}</Link> / <span aria-current="page">{t.t('swe.slots.withdraw')}</span></nav>
      <h1>{t.t('swe.slots.withdraw')}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p></div>
      ) : p && (
        <>
          <div className="kv-card"><p><strong>{p.sellerName ?? t.t('common.dash')}</strong> · {p.windows.map((w) => `${t.t(weekdayKey(w.weekday))} ${w.start}–${w.end}`).join(' · ')}</p>
            <p className="kv-detail__muted">{t.t(`swe.slots.status.${p.status}`)}</p><p className="kv-field__hint">{t.t('mutate.auditNote')}</p></div>
          {!offered ? <div className="kv-error" role="alert"><p>{t.t('swe.slots.notOpen')}</p></div> : (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" /><input type="hidden" name="id" value={p.id} />
              <label className="kv-field" htmlFor="s-why"><span>{t.t('swe.reason')}</span>
                <textarea id="s-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={reason} /></label>
              {reason !== '' && !reasonOk && <p className="kv-field__hint">{t.t('swe.reasonMin10')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && reasonOk ? (
            <form action={withdrawProposalAction} className="kv-actions">
              {/* PC-56 TENANT-SW-f · W318 §3: what this confirm step showed — re-read before the write (verify-before-write) */}
              <input type="hidden" name={SEEN_FIELD} value={seenToken((p) as never, VERIFY_FIELDS.slotProposal)} />
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="reason" value={reason} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}<Link href={SLOTS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={SLOTS_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && id && (
        <><div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.slots.withdrawn')}</p></div>
          <AuditEntryCard t={t} lang={lang} entityType="pickup_slot_proposal" entityId={id} action="logistics.slot_proposal_withdrawn" />
          <p><Link href={SLOTS_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p></>
      )}
      {step === 'failure' && isStaleFailure(searchParams.error) && <StaleDiffChip code={String(searchParams.error)} diffs={readDiff(searchParams.kv_diff)} labels={staleLabels(t)} recheckHref={`${SLOTS_HREF}/act?${new URLSearchParams({ step: 'confirm', act: 'withdraw', id: id ?? '', ...(reason ? { reason } : {}) }).toString()}`} />}
      {step === 'failure' && !isStaleFailure(searchParams.error) && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failedCodes(searchParams.error).map((x) => <li key={x}>{t.t(sweCodeKey(x))} <code>{x}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...(id ? { id } : {}), ...(reason ? { reason } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link></p>
        </div>
      )}
    </section>
  );
}
