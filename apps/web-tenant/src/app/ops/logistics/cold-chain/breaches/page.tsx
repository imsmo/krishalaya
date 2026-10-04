// apps/web-tenant/src/app/ops/logistics/cold-chain/breaches/page.tsx · W240 · Cold-chain breaches — PC-56 TENANT-SW-e.
//
// Twelve months of breaches (µs cursor; `?hours=` kept for the old links): subject, band, peak, duration, alert, acknowledgement, action,
// outcome, the buyer's decision. "Median alert → action" = the median of (action − opened) over breaches with both, or refused by name when
// none has an action; "Loss" only where an operator recorded one with a reason (an empty cell is "none recorded", never zero). Each breach
// opens the mutate chain (acknowledge · record action · record outcome / loss); the export is queued on the 6e-2 plane, unsigned.
import type { Metadata } from 'next';
import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { SdkError } from '@krishalaya/sdk-js';
import type { ColdBreachPage } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { DataTable } from '../../../../../components/DataTable';
import { BREACHES_HREF, COLD_HREF, bandLabel, coldSubjectHref, durationParts, failedCodes, refusedKey, swePageState, sweCodeKey } from '../../../../../features/swe/console';
import { exportBreachesAction } from './actions';
import { AsOf } from '../../../../../components/AsOf';
import { asOfLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.cold.breaches'), robots: { index: false, follow: false } }; }

export default async function BreachesPage({ searchParams }: { searchParams: { cursor?: string; hours?: string; error?: string } }) {
  await requireSession(BREACHES_HREF);
  const t = getTranslator(); const lang = getLang();
  const canManage = tenantHasPerm('logistics.manage');
  const hours = /^\d{1,5}$/.test(searchParams.hours ?? '') ? Number(searchParams.hours) : undefined;
  let p: ColdBreachPage | null = null; let state: string | null = null;
  try { p = await tenantClient().coldChain.breaches({ hours, cursor: searchParams.cursor, limit: 50 }); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, true); }
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  const dur = (sec: number | null) => { if (sec == null) return t.t('swe.cold.ongoing'); const d = durationParts(sec); return t.t(`swe.unit.${d.unit}`, { n: String(d.value) }); };
  const w = p?.window ?? null;
  const errors = failedCodes(searchParams.error);
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.cold.title')}><Link href={COLD_HREF}>{t.t('swe.cold.title')}</Link> / <span aria-current="page">{t.t('swe.cold.breaches')}</span></nav>
      <h1>{t.t('swe.cold.breaches')}</h1>
      {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
      <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      {errors.length > 0 && <div className="kv-error" role="alert"><ul>{errors.map((c) => <li key={c}>{t.t(sweCodeKey(c))} <code>{c}</code></li>)}</ul></div>}
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={BREACHES_HREF} className="kv-btn--link">{t.t('swe.retry')}</Link></p>}</div>
      ) : p && (
        <>
          {w && (
            <div className="kv-tiles">
              <div className="kv-card"><p className="kv-detail__muted">{w.months != null ? t.t('swe.cold.windowMonths', { n: String(w.months) }) : t.t('swe.cold.windowHours', { n: String(w.hours ?? '') })}</p><p><strong>{w.count}</strong> <span className="kv-detail__muted">· {t.t('swe.cold.openN', { n: String(w.open) })}</span></p></div>
              <div className="kv-card"><p className="kv-detail__muted">{t.t('swe.cold.median')}</p>
                {w.medianAlertToAction.kind === 'measured'
                  ? <p><strong>{(() => { const d = durationParts(w.medianAlertToAction.seconds); return t.t(`swe.unit.${d.unit}`, { n: String(d.value) }); })()}</strong> <span className="kv-detail__muted">· {t.t('swe.cold.medianOver', { n: String(w.medianAlertToAction.over) })}</span></p>
                  : <p className="kv-badge kv-badge--muted">{t.t(refusedKey(w.medianAlertToAction.code))}</p>}</div>
              <div className="kv-card"><p className="kv-detail__muted">{t.t('swe.cold.loss')}</p>
                {w.loss.kind === 'none_recorded' ? <p>{t.t('swe.cold.noLoss')}</p> : <p><strong>{w.loss.totals.map((x) => formatMoneyMinor(x.minor, x.currency, lang)).join(' · ')}</strong> <span className="kv-detail__muted">· {t.t('swe.cold.lossOver', { n: String(w.loss.breachesWithLoss) })}</span></p>}</div>
            </div>
          )}
          {p.items.length === 0 ? <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swe.cold.noBreaches')}</strong></div> : (
            <DataTable rows={p.items} empty={t.t('swe.cold.noBreaches')} columns={[
              { header: t.t('swe.cold.col.subject'), cell: (b) => <Link href={coldSubjectHref(b.subjectType, b.subjectId)} className="kv-btn--link">{b.subjectRef}</Link> },
              { header: t.t('swe.cold.col.band'), cell: (b) => bandLabel(b.band) },
              { header: t.t('swe.cold.col.peak'), cell: (b) => `${b.peakC} °C (${t.t(`swe.cold.dir.${b.direction}`)})` },
              { header: t.t('swe.cold.col.opened'), cell: (b) => when(b.openedAt) },
              { header: t.t('swe.cold.col.duration'), cell: (b) => dur(b.durationSeconds) },
              { header: t.t('swe.cold.col.alert'), cell: (b) => t.t(`swe.cold.alert.${b.alert.state}`, { n: String(b.alert.recipients) }) },
              { header: t.t('swe.cold.col.action'), cell: (b) => (b.actionAt ? <span>{when(b.actionAt)}<br /><span className="kv-detail__muted">{b.actionNote}</span></span> : b.acknowledgedAt ? t.t('swe.cold.acknowledgedAt', { at: when(b.acknowledgedAt) }) : t.t('common.dash')) },
              { header: t.t('swe.cold.col.outcome'), cell: (b) => (b.outcome ? <span>{t.t(`swe.cold.outcome.${b.outcome}`)}{b.loss ? ` · ${b.loss.currency ? formatMoneyMinor(b.loss.minor, b.loss.currency, lang) : b.loss.minor}` : ''}</span> : t.t('common.dash')) },
              { header: t.t('swe.cold.col.buyer'), cell: (b) => t.t(`swe.cold.offer.${b.buyer.offerState}`) + (b.buyer.decision ? ` · ${t.t(`swe.cold.decision.${b.buyer.decision}`)}` : '') },
              { header: '', cell: (b) => (canManage ? <span>{b.acts.map((a, i) => <span key={a}>{i ? ' · ' : ''}<Link href={`${BREACHES_HREF}/act?act=${a}&id=${b.id}`} className="kv-btn--link">{t.t(`swe.cold.act.${a}`)}</Link></span>)}</span> : null) },
            ]} />
          )}
          {p.nextCursor && <p><Link href={`${BREACHES_HREF}?${new URLSearchParams({ cursor: p.nextCursor, ...(hours ? { hours: String(hours) } : {}) }).toString()}`} className="kv-btn--link">{t.t('swe.next')}</Link></p>}
          <div className="kv-card">
            <h2>{t.t('swe.methods')}</h2>
            <ul className="kv-list">
              <li>{t.t('swe.cold.method.breach')}</li>
              <li>{t.t('swe.cold.method.median')}</li>
              <li>{t.t('swe.cold.method.loss')}</li>
              {p.refused && <li>{t.t('swe.cold.playbookRun')}: {t.t(refusedKey(p.refused.playbookRun))}</li>}
            </ul>
          </div>
          {canManage && (
            <form action={exportBreachesAction} className="kv-card kv-inline-form">
              <input type="hidden" name="idempotencyKey" value={randomUUID()} />
              <label className="kv-field" htmlFor="x-months"><span>{t.t('swe.cold.exportMonths')}</span><input id="x-months" name="months" className="kv-input" inputMode="numeric" defaultValue="12" maxLength={2} /></label>
              <button type="submit" className="kv-btn">{t.t('swe.cold.exportBreaches')}</button>
              <p className="kv-field__hint">{t.t(refusedKey(p.refused?.signedExport ?? 'UNSIGNED_FOUNDER_PHYSICAL_KEY'))}</p>
            </form>
          )}
        </>
      )}
    </section>
  );
}
