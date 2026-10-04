// apps/web-tenant/src/app/ops/logistics/cold-chain/[id]/page.tsx · W239 · one cold-chain subject — PC-56 TENANT-SW-e.
//
// The trail since load (each reading: its time on the device and at the server, temperature, the band COPIED from the store when it was
// written, out-of-band or not, and its SOURCE — device or manual), the band in force and its history, the logger, the breaches with their
// markers and the buyer-offer state, and the playbook as the platform runs it. Refused by name: "both tenants alerted" (a shipment belongs to
// one organisation), the auto-call, a playbook run object, a signed export. A manual reading can be added here (temperature only).
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ColdSubjectDetail } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { DataTable } from '../../../../../components/DataTable';
import { BREACHES_HREF, COLD_HREF, bandLabel, coldSubjectHref, durationParts, failedCodes, isColdSubjectType, isUuid, refusedKey, swePageState, sweCodeKey } from '../../../../../features/swe/console';
import { exportTrailAction, recordManualReadingAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.cold.subjectTitle'), robots: { index: false, follow: false } }; }

export default async function ColdSubjectPage({ params, searchParams }: { params: { id: string }; searchParams: { type?: string; hours?: string; cursor?: string; error?: string; recorded?: string } }) {
  const type = isColdSubjectType(searchParams.type) ? searchParams.type : 'shipment';
  const id = isUuid(params.id) ? params.id : '';
  const self = coldSubjectHref(type, params.id);
  await requireSession(self);
  const t = getTranslator(); const lang = getLang();
  const canManage = tenantHasPerm('logistics.manage');
  const hours = Math.min(24 * 90, Math.max(1, Number(searchParams.hours) || 72));
  let s: ColdSubjectDetail | null = null; let state: string | null = id ? null : 'notFound';
  if (id) { try { s = await tenantClient().coldChain.subject(type, id, { hours, cursor: searchParams.cursor, limit: 200 }); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); } }
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'medium' }) : t.t('common.dash'));
  const dur = (sec: number | null) => { if (sec == null) return t.t('swe.cold.ongoing'); const p = durationParts(sec); return t.t(`swe.unit.${p.unit}`, { n: String(p.value) }); };
  const errors = failedCodes(searchParams.error);
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.cold.title')}><Link href={COLD_HREF}>{t.t('swe.cold.title')}</Link> / <span aria-current="page">{s?.label ?? t.t('swe.cold.subjectTitle')}</span></nav>
      <h1>{s?.label ?? t.t('swe.cold.subjectTitle')}</h1>
      {errors.length > 0 && <div className="kv-error" role="alert"><ul>{errors.map((c) => <li key={c}>{t.t(sweCodeKey(c))} <code>{c}</code></li>)}</ul></div>}
      {searchParams.recorded === '1' && <div className="kv-card kv-card--notice" role="status"><p>{t.t('swe.cold.manualRecorded')}</p></div>}
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p>
        {state === 'error' && <p><Link href={self} className="kv-btn--link">{t.t('swe.retry')}</Link></p>}</div>}
      {s && (
        <>
          <div className="kv-card">
            <dl className="kv-detail">
              <dt>{t.t('swe.cold.col.kind')}</dt><dd>{t.t(`swe.cold.kind.${s.subjectType}`)}</dd>
              <dt>{t.t('swe.cold.col.status')}</dt><dd>{t.t(`swe.cold.status.${s.status}`)}</dd>
              <dt>{t.t('swe.cold.col.target')}</dt><dd>{s.band ? <>{bandLabel(s.band)} <span className="kv-detail__muted">· {s.band.reason} · {when(s.band.effectiveFrom)}</span></> : t.t('swe.cold.noBand')}
                {canManage && s.subjectType !== 'bmc_unit' && <>{' · '}<Link href={`${COLD_HREF}/threshold?subjectType=${s.subjectType}&subjectId=${s.subjectId}`} className="kv-btn--link">{t.t('swe.cold.setBand')}</Link></>}</dd>
              <dt>{t.t('swe.cold.col.device')}</dt><dd>{s.device ? `${s.device.serial ?? s.device.id.slice(0, 8)} · ${when(s.device.lastReadingAt)}` : t.t('swe.cold.noDevice')}</dd>
            </dl>
            {s.bandHistory.length > 1 && <details><summary>{t.t('swe.cold.bandHistory', { n: String(s.bandHistory.length) })}</summary>
              <ul className="kv-list">{s.bandHistory.map((b) => <li key={b.id}>{bandLabel(b)} · {when(b.effectiveFrom)} · {b.reason}</li>)}</ul></details>}
          </div>

          <h2>{t.t('swe.cold.trail', { hours: String(s.windowHours) })}</h2>
          <form method="get" action={`${COLD_HREF}/${s.subjectId}`} className="kv-inline-form">
            <input type="hidden" name="type" value={s.subjectType} />
            <label className="kv-field" htmlFor="h-hours"><span>{t.t('swe.cold.hours')}</span><input id="h-hours" name="hours" className="kv-input" inputMode="numeric" defaultValue={String(hours)} maxLength={4} /></label>
            <button type="submit" className="kv-btn--link">{t.t('swe.filter')}</button>
          </form>
          {s.trail.length === 0 ? <p className="kv-field__hint">{t.t('swe.cold.noReadings')}</p> : (
            <DataTable rows={s.trail} empty={t.t('swe.cold.noReadings')} columns={[
              { header: t.t('swe.cold.col.deviceTime'), cell: (r) => when(r.recordedAt) },
              { header: t.t('swe.cold.col.serverTime'), cell: (r) => when(r.serverRecordedAt) },
              { header: t.t('swe.cold.col.temp'), cell: (r) => `${r.tempC} °C` },
              { header: t.t('swe.cold.col.band'), cell: (r) => bandLabel(r.band) ?? t.t('swe.cold.noBand') },
              { header: t.t('swe.cold.col.out'), cell: (r) => (r.band == null ? t.t('common.dash') : r.isBreach ? <span className="kv-badge kv-badge--danger">{t.t('swe.cold.outOfBand')}</span> : t.t('swe.cold.inBand')) },
              { header: t.t('swe.cold.col.source'), cell: (r) => <span>{t.t(`swe.cold.source.${r.source}`)}{r.sequenceNo ? <span className="kv-detail__muted"> #{r.sequenceNo}</span> : null}</span> },
            ]} />
          )}
          {s.nextCursor && <p><Link href={`${self}&hours=${hours}&cursor=${encodeURIComponent(s.nextCursor)}`} className="kv-btn--link">{t.t('swe.next')}</Link></p>}

          <h2>{t.t('swe.cold.breaches')}</h2>
          {s.breaches.length === 0 ? <p className="kv-field__hint">{t.t('swe.cold.noBreaches')}</p> : (
            <DataTable rows={s.breaches} empty={t.t('swe.cold.noBreaches')} columns={[
              { header: t.t('swe.cold.col.opened'), cell: (b) => <Link href={`${BREACHES_HREF}/act?act=acknowledge&id=${b.id}`} className="kv-btn--link">{when(b.openedAt)}</Link> },
              { header: t.t('swe.cold.col.peak'), cell: (b) => `${b.peakC} °C (${t.t(`swe.cold.dir.${b.direction}`)})` },
              { header: t.t('swe.cold.col.duration'), cell: (b) => dur(b.durationSeconds) },
              { header: t.t('swe.cold.col.alert'), cell: (b) => t.t(`swe.cold.alert.${b.alert.state}`, { n: String(b.alert.recipients) }) },
              { header: t.t('swe.cold.col.buyer'), cell: (b) => t.t(`swe.cold.offer.${b.buyer.offerState}`) + (b.buyer.decision ? ` · ${t.t(`swe.cold.decision.${b.buyer.decision}`)}` : '') },
              { header: t.t('swe.cold.col.outcome'), cell: (b) => (b.outcome ? t.t(`swe.cold.outcome.${b.outcome}`) : t.t('common.dash')) },
            ]} />
          )}

          <div className="kv-card">
            <h2>{t.t('swe.cold.playbook')}</h2>
            <ul className="kv-list">
              <li>{t.t('swe.cold.method.breach')}</li>
              <li>{t.t('swe.cold.playbookOffer', { n: String(s.playbook.buyerOfferAfterMinutes) })}</li>
              <li>{t.t('swe.cold.silence', { n: String(s.playbook.silenceMinutes) })} · {t.t('swe.cold.alertedNotCalled')}</li>
              <li>{t.t('swe.cold.bothTenants')}: {t.t(refusedKey(s.refused.bothTenants))}</li>
              <li>{t.t('swe.cold.autoCall')}: {t.t(refusedKey(s.refused.autoCall))}</li>
              <li>{t.t('swe.cold.playbookRun')}: {t.t(refusedKey(s.refused.playbookRun))}</li>
              <li>{t.t('swe.cold.retention', { n: String(s.retentionMonths) })}</li>
            </ul>
          </div>

          {canManage && (
            <div className="kv-card">
              <h2>{t.t('swe.cold.manualTitle')}</h2>
              <p className="kv-field__hint">{t.t('swe.cold.manualHint')}</p>
              <form action={recordManualReadingAction} className="kv-inline-form">
                <input type="hidden" name="subjectType" value={s.subjectType} /><input type="hidden" name="subjectId" value={s.subjectId} />
                <label className="kv-field" htmlFor="m-temp"><span>{t.t('swe.cold.col.temp')}</span><input id="m-temp" name="tempC" className="kv-input" inputMode="decimal" maxLength={6} required /></label>
                <label className="kv-field" htmlFor="m-hum"><span>{t.t('swe.cold.humidity')}</span><input id="m-hum" name="humidityPct" className="kv-input" inputMode="decimal" maxLength={5} /></label>
                <button type="submit" className="kv-btn">{t.t('swe.cold.recordManual')}</button>
              </form>
            </div>
          )}
          {canManage && (
            <form action={exportTrailAction} className="kv-card kv-inline-form">
              <input type="hidden" name="subjectType" value={s.subjectType} /><input type="hidden" name="subjectId" value={s.subjectId} /><input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="x-days"><span>{t.t('swe.cold.exportDays')}</span><input id="x-days" name="days" className="kv-input" inputMode="numeric" defaultValue="30" maxLength={3} /></label>
              <button type="submit" className="kv-btn">{t.t('swe.cold.exportTrail')}</button>
              <p className="kv-field__hint">{t.t(refusedKey(s.refused.signedExport))}</p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
