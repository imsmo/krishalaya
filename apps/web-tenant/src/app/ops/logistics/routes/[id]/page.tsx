// apps/web-tenant/src/app/ops/logistics/routes/[id]/page.tsx · W232 · Village Run — PC-56 TENANT-SW-e.
//
// One route: its villages, its drop points (each kept by an ambassador), its runs (draft → confirmed by a SECOND person → loading → in
// transit → completed, or cancelled with a reason), the current run's figures — "Parcels consolidated" = shipments on the run ÷ shipments
// bound for the route's villages that week (real, method printed) and the run's freight only where a carrier bill names it (else refused) —
// the handovers with both OTP marks, and the Ambassador economics card: the fee in force (≥ the platform floor) and each keeper's accrued /
// paid / unpaid parcel fees as recorded (paid only by SW-b's weekly run). "₹31 vs ₹96 ad-hoc" and the return leg are refused by name.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { RunDetail, VillageRunPage } from '@krishalaya/sdk-js';
import { formatDate, formatMoneyMinor } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { tenantHasPerm } from '../../../../../lib/auth';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { DataTable } from '../../../../../components/DataTable';
import { ROUTES_BOARD_HREF, isUuid, ratioLabel, refusedKey, routeHref, swePageState, weekdayKey } from '../../../../../features/swe/console';
import { AsOf } from '../../../../../components/AsOf';
import { asOfLabels } from '../../../../../features/swf/console';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swe.run.title'), robots: { index: false, follow: false } }; }

export default async function VillageRunRoutePage({ params, searchParams }: { params: { id: string }; searchParams: { run?: string } }) {
  const id = isUuid(params.id) ? params.id : '';
  await requireSession(routeHref(params.id));
  const t = getTranslator(); const lang = getLang();
  const canManage = tenantHasPerm('logistics.manage');
  let page: VillageRunPage | null = null; let state: string | null = id ? null : 'notFound';
  if (id) { try { page = await tenantClient().villageRun.route(id); } catch (e) { state = swePageState(e instanceof SdkError ? e.status : undefined, false); } }
  const runId = isUuid(searchParams.run) ? searchParams.run : page?.current?.id ?? null;
  let run: RunDetail | null = null;
  if (page && runId) { try { run = await tenantClient().villageRun.run(runId); } catch { run = null; } }
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  const money = (minor: string | null, cur: string | null) => (minor == null ? t.t('common.dash') : cur ? formatMoneyMinor(minor, cur, lang) : t.t('swe.minorUnits', { minor }));
  const base = routeHref(id);
  const cur = page?.current ?? null;

  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swe.run.title')}><Link href={ROUTES_BOARD_HREF}>{t.t('swe.run.routes')}</Link> / <span aria-current="page">{page?.route.name ?? t.t('swe.run.title')}</span></nav>
      <h1>{page ? page.route.name : t.t('swe.run.title')}</h1>
      {/* PC-56 TENANT-SW-f · W318 §1: when this page's data was read — absolute IST + relative; stale past 1 h */}
      <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
      {state && <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swe.state.${state}.title`)}</strong><p>{t.t(`swe.state.${state}.body`)}</p>
        {state === 'error' && <p><Link href={base} className="kv-btn--link">{t.t('swe.retry')}</Link></p>}</div>}
      {page && (
        <>
          <p className="kv-field__hint">{t.t('swe.run.subtitle', { day: page.route.runWeekday == null ? t.t('swe.run.noRunDay') : t.t(weekdayKey(page.route.runWeekday)) })} · {page.route.villages.map((v) => v.name ?? v.id.slice(0, 8)).join(', ')}</p>
          {canManage && page.route.runWeekday != null && <p><Link href={`${base}/plan`} className="kv-btn kv-btn--primary">{t.t('swe.run.draft', { day: t.t(weekdayKey(page.route.runWeekday)) })}</Link></p>}

          {cur && (
            <div className="kv-card">
              <h2>{t.t('swe.run.current', { date: cur.runDate })} · {t.t(`swe.run.status.${cur.status}`)}</h2>
              <dl className="kv-detail">
                <dt>{t.t('swe.run.consolidated')}</dt><dd>{cur.consolidation ? (ratioLabel(cur.consolidation.ratio) ?? t.t('swe.run.noneBound')) : t.t('common.dash')}</dd>
                <dt>{t.t('swe.run.stops')}</dt><dd>{cur.stops ?? t.t('common.dash')}</dd>
                <dt>{t.t('swe.run.freight')}</dt><dd>{cur.freight ? ('kind' in cur.freight && cur.freight.kind === 'refused'
                  ? <span className="kv-badge kv-badge--muted">{t.t(refusedKey(cur.freight.code))}</span>
                  : (cur.freight as { byCurrency: Array<{ currency: string; billedMinor: string; lines: number }> }).byCurrency.map((b) => `${money(b.billedMinor, b.currency)} (${b.lines})`).join(' · ')) : t.t('common.dash')}</dd>
                <dt>{t.t('swe.run.freightVsAdHoc')}</dt><dd><span className="kv-badge kv-badge--muted">{t.t(refusedKey(page.refused.freightVsAdHoc))}</span></dd>
                <dt>{t.t('swe.run.returnLeg')}</dt><dd><span className="kv-badge kv-badge--muted">{t.t(refusedKey(page.refused.returnLeg))}</span></dd>
              </dl>
              <p className="kv-field__hint">{t.t('swe.run.method.consolidation')}</p>
            </div>
          )}

          <h2>{t.t('swe.run.dropPoints')}</h2>
          {canManage && <p><Link href={`${base}/drop-point`} className="kv-btn--link">{t.t('swe.run.addDropPoint')}</Link></p>}
          {page.dropPoints.length === 0 ? <p className="kv-field__hint">{t.t('swe.run.noDropPoints')}</p> : (
            <DataTable rows={page.dropPoints} empty={t.t('swe.run.noDropPoints')} columns={[
              { header: '#', cell: (d) => String(d.sequence) },
              { header: t.t('swe.run.col.dropPoint'), cell: (d) => `${d.name} · ${d.regionName ?? ''}` },
              { header: t.t('swe.run.col.keeper'), cell: (d) => <span>{d.keeper.name ?? t.t('common.dash')} <span className="kv-detail__muted">{d.keeper.phoneMasked ?? ''}</span></span> },
              { header: t.t('swe.run.col.window'), cell: (d) => (d.window ? `${d.window.start}–${d.window.end ?? ''}` : t.t('common.dash')) },
              { header: t.t('swe.run.col.parcelsIn'), cell: (d) => String(d.parcelsIn) },
              { header: t.t('swe.carriers.col.status'), cell: (d) => (d.active ? t.t('swe.active') : <span>{t.t('swe.inactive')} <span className="kv-detail__muted">{d.deactivateReason ?? ''}</span></span>) },
              { header: '', cell: (d) => (canManage && d.active ? <Link href={`${base}/act?act=deactivate_drop_point&id=${d.id}`} className="kv-btn--link">{t.t('swe.run.act.deactivate_drop_point')}</Link> : <span className="kv-detail__muted">{t.t('common.dash')}</span>) },
            ]} />
          )}

          <h2>{t.t('swe.run.runs')}</h2>
          {page.runs.length === 0 ? <p className="kv-field__hint">{t.t('swe.run.noRuns')}</p> : (
            <DataTable rows={page.runs} empty={t.t('swe.run.noRuns')} columns={[
              { header: t.t('swe.run.col.date'), cell: (r) => <Link href={`${base}?run=${r.id}`} className="kv-btn--link">{r.runDate}</Link> },
              { header: t.t('swe.carriers.col.status'), cell: (r) => t.t(`swe.run.status.${r.status}`) },
              { header: t.t('swe.run.col.parcels'), cell: (r) => String(r.parcels) },
              { header: t.t('swe.run.col.drafted'), cell: (r) => <span>{when(r.draftedAt)}{r.youDrafted ? <span className="kv-detail__muted"> · {t.t('swe.run.youDrafted')}</span> : null}</span> },
              { header: t.t('swe.run.col.confirmed'), cell: (r) => when(r.confirmedAt) },
              { header: '', cell: (r) => (canManage ? <span>{r.acts.map((a, i) => <span key={a}>{i > 0 ? ' · ' : ''}<Link href={`${base}/act?act=${a}&id=${r.id}`} className="kv-btn--link">{t.t(`swe.run.act.${a}`)}</Link></span>)}
                {r.status === 'draft' && r.youDrafted && <span className="kv-detail__muted"> {t.t('swe.run.needsSecond')}</span>}</span> : null) },
            ]} />
          )}

          {run && (
            <div className="kv-card">
              <h2>{t.t('swe.run.handovers', { date: run.runDate })}</h2>
              {run.handovers.length === 0 ? <p className="kv-field__hint">{t.t('swe.run.noHandovers')}</p> : (
                <DataTable rows={run.handovers} empty={t.t('swe.run.noHandovers')} columns={[
                  { header: t.t('swe.run.col.dropPoint'), cell: (h) => h.dropPoint ?? t.t('common.dash') },
                  { header: t.t('swe.run.col.parcel'), cell: (h) => <code>{h.shipmentId.slice(0, 8)}</code> },
                  { header: t.t('swe.run.col.keeperOtp'), cell: (h) => `✓ ${when(h.keeperOtpConfirmedAt)}` },
                  { header: t.t('swe.run.col.memberOtp'), cell: (h) => (h.memberOtpConfirmedAt ? `✓ ${when(h.memberOtpConfirmedAt)}` : t.t('common.dash')) },
                  { header: t.t('swe.carriers.col.status'), cell: (h) => <span>{t.t(`swe.run.handover.${h.status}`)}{h.returnReason ? <span className="kv-detail__muted"> · {h.returnReason}</span> : null}</span> },
                  { header: t.t('swe.run.col.fee'), cell: (h) => money(h.feeMinor, page!.economics.currencyCode) },
                ]} />
              )}
              <p className="kv-field__hint">{t.t('swe.run.method.handover')}</p>
            </div>
          )}

          <div className="kv-card">
            <h2>{t.t('swe.run.economics')}</h2>
            <dl className="kv-detail">
              <dt>{t.t('swe.run.feeInForce')}</dt><dd>{money(page.economics.feeInForceMinor, page.economics.currencyCode)}</dd>
              <dt>{t.t('swe.run.floor')}</dt><dd>{money(page.economics.platformFloorMinor, page.economics.currencyCode)}</dd>
            </dl>
            {page.economics.keepers.length === 0 ? <p className="kv-field__hint">{t.t('swe.run.noKeepers')}</p> : (
              <DataTable rows={page.economics.keepers} empty={t.t('swe.run.noKeepers')} columns={[
                { header: t.t('swe.run.col.keeper'), cell: (k) => <span>{k.name ?? t.t('common.dash')} <span className="kv-detail__muted">{k.phoneMasked ?? ''}</span></span> },
                { header: t.t('swe.run.col.parcels'), cell: (k) => String(k.parcels) },
                { header: t.t('swe.run.col.accrued'), cell: (k) => money(k.accruedMinor, page!.economics.currencyCode) },
                { header: t.t('swe.run.col.paid'), cell: (k) => money(k.paidMinor, page!.economics.currencyCode) },
                { header: t.t('swe.run.col.unpaid'), cell: (k) => money(k.unpaidMinor, page!.economics.currencyCode) },
              ]} />
            )}
            <p className="kv-field__hint">{t.t('swe.run.method.economics')}</p>
          </div>
        </>
      )}
    </section>
  );
}
