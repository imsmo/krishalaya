// apps/web-tenant/src/app/ops/logistics/zones/act/page.tsx · W233 · the zone MUTATE chain (confirm → success → failure) — PC-56 TENANT-SW-a.
// Acts on a ZONE (propose a fee re-point onto a definition W150 approved / propose a deactivation / propose a re-activation — each with a
// reason ≥ 20) and on a PROPOSAL (confirm — offered only to a different administrator; refuse or withdraw — reason ≥ 20). The database
// re-judges every one of them. The success screen reads the act's audit entry back from the trail.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { DeliveryZone, DeliveryZoneProposal, ZoneFeeDefinition } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { mutateStep, mutateStepKey, failureKey } from '../../../../../features/mutate/chain';
import { ZONES_HREF, codeKey, isUuid, isZoneAct, pageState } from '../../../../../features/swa/console';
import { AuditEntryCard } from '../../../../people/ambassadors/AuditEntryCard';
import { zoneActAction } from './actions';
import { SEEN_FIELD, seenToken, isStaleFailure, readDiff } from '../../../../../features/mutate/verify';
import { VERIFY_FIELDS } from '../../../../../features/mutate/verify-fields';
import { StaleDiffChip } from '../../../../../components/StaleDiffChip';
import { staleLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swa.zone.actTitle'), robots: { index: false, follow: false } }; }

export default async function ZoneActPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const base = `${ZONES_HREF}/act`;
  await requireSession(base);
  const t = getTranslator(); const lang = getLang();
  const act = isZoneAct(searchParams.act) ? searchParams.act : 'confirm';
  const id = isUuid(searchParams.id) ? searchParams.id : null;
  const step = mutateStep(searchParams.step);
  const reason = (searchParams.reason ?? '').trim().slice(0, 500);
  const def = isUuid(searchParams.chargeDefinitionId) ? searchParams.chargeDefinitionId : searchParams.chargeDefinitionId === 'none' ? 'none' : '';
  const failed = (searchParams.error ?? '').split(',').filter((x) => /^[A-Za-z0-9_]{2,60}$/.test(x));
  const onProposal = act === 'confirm' || act === 'refuse';
  let zone: DeliveryZone | null = null; let p: DeliveryZoneProposal | null = null; let defs: ZoneFeeDefinition[] = [];
  let state: string | null = id ? null : 'notFound';
  if (id && step === 'confirm') {
    try {
      if (onProposal) { p = await tenantClient().tenantConfig.zoneProposal(id); zone = p.kind === 'create' ? null : await tenantClient().tenantConfig.getDeliveryZone(p.zoneId).catch(() => null); }
      else zone = await tenantClient().tenantConfig.getDeliveryZone(id);
      defs = await tenantClient().tenantConfig.zoneFeeDefinitions().catch(() => []);
    } catch (e) { state = pageState(e instanceof SdkError ? e.status : undefined, false); }
  }
  const feeLabel = (fid: string | null) => {
    if (!fid) return t.t('swa.zone.noFee');
    const d = defs.find((x) => x.id === fid);
    return d ? `${d.label ?? d.chargeCode} · ${t.t(`swa.zone.calc.${d.calcMethod}`)}` : t.t('swa.zone.feeDef', { id: fid.slice(0, 8) });
  };
  const needsReason = act !== 'confirm';
  const reasonOk = !needsReason || reason.length >= 20;
  const defOk = act !== 'repoint' || def === 'none' || (def !== '' && defs.some((d) => d.id === def));
  const stateOk = act === 'deactivate' ? !!zone?.isActive : act === 'activate' ? !!zone && !zone.isActive : true;
  const offered = act === 'confirm' ? !!p?.canConfirm : act === 'refuse' ? !!p?.canRefuse : !!zone && stateOk;
  const carry: Record<string, string> = { act, ...(id ? { id } : {}) };
  const auditEntity = act === 'confirm' ? 'delivery_zone' : 'delivery_zone_proposal';
  const CONFIRMED: Record<string, string> = { create: 'created', repoint_fee: 'fee_repointed', activate: 'activated', deactivate: 'deactivated' };
  const doneKind = CONFIRMED[searchParams.kind ?? ''] ?? null;
  const auditAction = act === 'refuse' ? 'logistics.delivery_zone_change_refused' : act === 'confirm' ? (doneKind ? `logistics.delivery_zone_${doneKind}` : null) : 'logistics.delivery_zone_change_proposed';

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swa.zone.title')}><Link href={ZONES_HREF}>{t.t('swa.zone.title')}</Link> / <span aria-current="page">{t.t(`swa.zone.act.${act}`)}</span></nav>
      <h1>{t.t(`swa.zone.act.${act}`)}</h1>
      <p className="kv-field__hint">{t.t(mutateStepKey(step))}</p>
      {step === 'confirm' && (state ? (
        <div className="kv-error" role="alert"><strong>{t.t(`swa.zone.state.${state}.title`)}</strong><p>{t.t(`swa.zone.state.${state}.body`)}</p></div>
      ) : (
        <>
          <div className="kv-card">
            {zone && <p><strong>{zone.defaultName}</strong> · {zone.pincodes.length <= 4 ? zone.pincodes.join(', ') : `${zone.pincodes.slice(0, 3).join(', ')} +${zone.pincodes.length - 3}`} · {feeLabel(zone.chargeDefinitionId)} · {t.t(zone.isActive ? 'swa.zone.active' : 'swa.zone.inactive')}</p>}
            {p && <p><strong>{t.t(`swa.zone.kind.${p.kind}`)}</strong> · {p.defaultName ?? zone?.defaultName ?? p.zoneId.slice(0, 8)}{p.kind === 'create' || p.kind === 'repoint_fee' ? ` · ${feeLabel(p.chargeDefinitionId)}` : ''}</p>}
            {p?.pincodes && p.pincodes.length > 0 && <p className="kv-detail__muted">{p.pincodes.join(', ')}</p>}
            {p && <p className="kv-detail__muted">{p.reason}</p>}
            {p && <p className="kv-detail__muted">{t.t('swa.com.expires', { at: formatDate(p.expiresAt, lang, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>}
            <p>{t.t(`swa.zone.act.rule.${act}`)}</p>
            <p className="kv-field__hint">{t.t('mutate.auditNote')}</p>
          </div>
          {!offered && <div className="kv-error" role="alert"><p>{t.t(`swa.zone.act.notOffered.${act}`)}</p></div>}
          {needsReason && offered && (
            <form method="get" action={base} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {act === 'repoint' && (
                <label className="kv-field" htmlFor="z-def"><span>{t.t('swa.zone.form.fee')}</span>
                  <select id="z-def" name="chargeDefinitionId" className="kv-input" defaultValue={def}>
                    <option value="">{t.t('swa.zone.form.feePick')}</option>
                    <option value="none">{t.t('swa.zone.noFee')}</option>
                    {defs.map((d) => <option key={d.id} value={d.id}>{feeLabel(d.id)}</option>)}
                  </select>
                  {defs.length === 0 && <span className="kv-field__hint">{t.t('swa.zone.form.noApproved')}</span>}
                </label>
              )}
              <label className="kv-field" htmlFor="z-why"><span>{t.t('swa.zone.form.reason')}</span>
                <textarea id="z-why" name="reason" className="kv-textarea" rows={2} maxLength={500} defaultValue={reason} /></label>
              {reason !== '' && !reasonOk && <p className="kv-field__hint">{t.t('swa.zone.form.err.reason')}</p>}
              {act === 'repoint' && def === '' && reason !== '' && <p className="kv-field__hint">{t.t('swa.zone.form.err.fee')}</p>}
              <button type="submit" className="kv-btn--link">{t.t('mutate.reason.check')}</button>
            </form>
          )}
          {offered && reasonOk && defOk ? (
            <form action={zoneActAction} className="kv-actions">
              {/* PC-56 TENANT-SW-f · W318 §3: what this confirm step showed — re-read before the write (verify-before-write) */}
              <input type="hidden" name={SEEN_FIELD} value={seenToken((onProposal ? p : zone) as never, onProposal ? VERIFY_FIELDS.zoneProposal : VERIFY_FIELDS.deliveryZone)} />
              {Object.entries(carry).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
              {reason && <input type="hidden" name="reason" value={reason} />}
              {act === 'repoint' && <input type="hidden" name="chargeDefinitionId" value={def} />}
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('mutate.confirm')}</button>{' '}
              <Link href={ZONES_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link>
            </form>
          ) : <p><Link href={ZONES_HREF} className="kv-btn--link">{t.t('mutate.cancel')}</Link></p>}
        </>
      ))}
      {step === 'success' && (
        <>
          <div className="kv-card kv-card--notice" role="status"><p>{t.t(`swa.zone.act.done.${act}`)}</p></div>
          {isUuid(searchParams.auditId) && auditAction && <AuditEntryCard t={t} lang={lang} entityType={auditEntity} entityId={searchParams.auditId} action={auditAction} />}
          <p><Link href={ZONES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </>
      )}
      {step === 'failure' && isStaleFailure(searchParams.error) && <StaleDiffChip code={String(searchParams.error)} diffs={readDiff(searchParams.kv_diff)} labels={staleLabels(t)} recheckHref={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(reason ? { reason } : {}), ...(def ? { chargeDefinitionId: def } : {}) }).toString()}`} />}
      {step === 'failure' && !isStaleFailure(searchParams.error) && (
        <div className="kv-error" role="alert">
          <p>{t.t('mutate.failure.title')}</p>
          <ul>{failed.map((c) => <li key={c}>{t.t(codeKey(c))} <code>{c}</code></li>)}</ul>
          <p className="kv-field__hint">{t.t(failureKey())}</p>
          <p><Link href={`${base}?${new URLSearchParams({ step: 'confirm', ...carry, ...(reason ? { reason } : {}), ...(def ? { chargeDefinitionId: def } : {}) }).toString()}`} className="kv-btn--link">{t.t('mutate.retry')}</Link>{' · '}<Link href={ZONES_HREF} className="kv-btn--link">{t.t('form.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
