// apps/web-tenant/src/app/insights/reports/page.tsx · W196 · Report builder — PC-56 TENANT-SW-f (DELTA-028, founder: TENANT REPORT STORE +
// BOUNDED BUILDER OVER ALLOW-LISTED DATASETS).
//
// Dataset (an ALLOW-LIST: orders, settlements, listings, memberships, dairy cycles, cold-chain breaches, wastage events, mandi pulse) ·
// Dimensions (≤ 3) · Measures (≤ 6) · From / To (≤ 92 IST days). A run is READ by a registered job under a 60-second statement timeout on the
// PRIMARY — the canon's "analytics replica" is refused by name (NO_ANALYTICS_REPLICA) and the page says so; > 50,000 rows is refused
// (ROW_CAP), never truncated. The file goes to the 6e-2 plane with a WATERMARK (tenant, user, generated-at IST, run, definition, row count)
// before its header, and every run is AUDITED (report.run). "Signed": unsigned, said. The member dimension is not offered (aggregates only).
// Saved definitions are the cooperative's own; platform definitions are listed read-only. Schedules run daily / weekly / monthly at an IST
// time to tenant roles. Every act is the W2738–W2740 chain (./act).
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ReportCatalogue, ReportDefinition, ReportRun, ReportSchedule } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { getTranslator, getLang } from '../../../lib/i18n';
import { DataTable } from '../../../components/DataTable';
import { AsOf } from '../../../components/AsOf';
import { REPORTS_HREF, RETRY_HREF, CADENCES, asOfLabels, istDaysAgo, istToday, keyList, swfCodeKey, swfPageState } from '../../../features/swf/console';
import { istClock } from '../../../features/offline/stale';
import { InsightsNav } from '../InsightsNav';
import { RefusedLine } from '../RefusedLine';
import { DirArrow } from '../../../components/DirArrow'; // PC-56 TENANT-CLOSE · RTL: the range arrow flips under dir="rtl"

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.reports.title'), robots: { index: false, follow: false } }; }

export default async function ReportsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  await requireSession(REPORTS_HREF);
  const t = getTranslator(); const lang = getLang();
  const sp = (k: string) => (Array.isArray(searchParams[k]) ? (searchParams[k] as string[])[0] : (searchParams[k] as string | undefined));
  let cat: ReportCatalogue | null = null; let defs: ReportDefinition[] = []; let runs: ReportRun[] = []; let schedules: ReportSchedule[] = []; let state: string | null = null;
  try {
    const c = tenantClient();
    [cat, defs, runs, schedules] = await Promise.all([c.reports.catalogue(), c.reports.definitions({ limit: 50 }).then((r) => r.items), c.reports.runs({ limit: 25 }).then((r) => r.items), c.reports.schedules({ limit: 25 }).then((r) => r.items)]);
  } catch (e) { state = swfPageState(e instanceof SdkError ? e.status : undefined); }
  const asOf = new Date().toISOString();
  const chosen = cat?.datasets.find((d) => d.code === sp('dataset')) ?? null;
  const dims = keyList(searchParams.dims); const measures = keyList(searchParams.measures);
  const from = sp('from') ?? istDaysAgo(30); const to = sp('to') ?? istToday();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  const defTitle = (id: string | null) => (id ? defs.find((d) => d.id === id)?.title ?? id.slice(0, 8) : t.t('swf.reports.adHoc'));
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.nav.label')}><span>{t.t('swf.nav.insights')}</span> / <span aria-current="page">{t.t('swf.reports.title')}</span></nav>
      <h1>{t.t('swf.reports.title')}</h1>
      <p className="kv-field__hint">{t.t('swf.reports.lead')}</p>
      <InsightsNav t={t} active="reports" />
      {state ? (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert">
          <strong>{t.t(`swf.state.${state}.title`)}</strong><p>{t.t(state === 'flaggedOff' ? 'swf.reports.flaggedOff' : state === 'restricted' ? 'swf.reports.restricted' : `swf.state.${state}.body`)}</p>
          {state === 'error' && <p><Link href={`${RETRY_HREF}?from=reports`} className="kv-btn--link">{t.t('swf.retry')}</Link></p>}
        </div>
      ) : cat && (
        <>
          <AsOf at={asOf} labels={asOfLabels(t)} />
          <div className="kv-card">
            <h2>{t.t('swf.reports.bounds')}</h2>
            <ul className="kv-list">
              <li>{t.t('swf.reports.boundsLine', { days: String(cat.bounds.maxRangeDays), rows: String(cat.bounds.rowCap), timeout: cat.bounds.statementTimeout })}</li>
              <li><RefusedLine t={t} lang={lang} code={cat.replica.code} /></li>
              <li><RefusedLine t={t} lang={lang} code={cat.memberDimension.code} /></li>
              <li>{t.t('swf.reports.watermarked')}</li>
              <li><RefusedLine t={t} lang={lang} code={cat.signed.code} /></li>
            </ul>
          </div>

          <h2>{t.t('swf.reports.run')}</h2>
          <form method="get" action={REPORTS_HREF} className="kv-card kv-form">
            <label className="kv-field" htmlFor="r-ds"><span>{t.t('swf.reports.dataset')}</span>
              <select id="r-ds" name="dataset" className="kv-input" defaultValue={chosen?.code ?? ''}>
                <option value="">{t.t('swf.reports.pickDataset')}</option>
                {cat.datasets.map((d) => <option key={d.code} value={d.code} disabled={!d.permitted}>{t.t(`swf.reports.ds.${d.code}`)}{d.permitted ? '' : ` — ${t.t(swfCodeKey(d.refusal ?? 'FORBIDDEN'))}`}</option>)}
              </select></label>
            <button type="submit" className="kv-btn--link">{t.t('swf.reports.choose')}</button>
          </form>
          {chosen && (
            <form method="get" action={`${REPORTS_HREF}/act`} className="kv-card kv-form">
              <input type="hidden" name="step" value="confirm" /><input type="hidden" name="act" value="run" /><input type="hidden" name="dataset" value={chosen.code} />
              <fieldset><legend>{t.t('swf.reports.dimensions')}</legend>
                {chosen.dimensions.map((k) => <label key={k} className="kv-check"><input type="checkbox" name="dims" value={k} defaultChecked={dims.includes(k)} /> {t.t(`swf.reports.dim.${k}`)}</label>)}
                <p className="kv-field__hint">{t.t('swf.reports.dimHint')}</p></fieldset>
              <fieldset><legend>{t.t('swf.reports.measures')}</legend>
                {chosen.measures.map((m) => <label key={m.key} className="kv-check"><input type="checkbox" name="measures" value={m.key} defaultChecked={measures.includes(m.key)} /> {t.t(`swf.reports.measure.${m.key}`)}</label>)}
                <p className="kv-field__hint">{t.t('swf.reports.measureHint')}</p></fieldset>
              <label className="kv-field" htmlFor="r-from"><span>{t.t('swf.reports.from')}</span><input id="r-from" name="from" type="date" className="kv-input" defaultValue={from} /></label>
              <label className="kv-field" htmlFor="r-to"><span>{t.t('swf.reports.to')}</span><input id="r-to" name="to" type="date" className="kv-input" defaultValue={to} /></label>
              <label className="kv-field" htmlFor="r-title"><span>{t.t('swf.reports.titleOptional')}</span><input id="r-title" name="title" className="kv-input" maxLength={160} /></label>
              <p className="kv-field__hint">{t.t('swf.reports.rangeHint', { days: String(cat.bounds.maxRangeDays) })}</p>
              <p><button type="submit" className="kv-btn">{t.t('swf.reports.runReport')}</button>{' '}
                <button type="submit" name="act" value="save" className="kv-btn kv-btn--muted">{t.t('swf.reports.saveDefinition')}</button></p>
            </form>
          )}

          <h2>{t.t('swf.reports.saved')}</h2>
          {defs.length === 0 ? <div className="kv-card kv-card--notice" role="status"><strong>{t.t('swf.reports.empty.title')}</strong><p>{t.t('swf.reports.empty.body')}</p></div> : (
            <DataTable rows={defs} empty={t.t('swf.reports.empty.title')} columns={[
              { header: t.t('swf.reports.col.title'), cell: (d) => <span>{d.title} {d.readOnly && <span className="kv-badge kv-badge--muted">{t.t('swf.reports.platformReadOnly')}</span>}{d.archivedAt && <span className="kv-badge kv-badge--muted"> {t.t('swf.reports.archived')}</span>}</span> },
              { header: t.t('swf.reports.col.dataset'), cell: (d) => (d.datasetCode ? t.t(`swf.reports.ds.${d.datasetCode}`) : <span className="kv-detail__muted">{t.t('swf.reports.platformMetric')} <code>{d.metric}</code></span>) },
              { header: t.t('swf.reports.col.shape'), cell: (d) => (d.datasetCode ? `${d.dimensions.join(', ') || t.t('common.dash')} · ${d.measures.join(', ')} · ${t.t('swf.reports.lastDays', { n: String(d.rangeDays ?? '') })}` : t.t('common.dash')) },
              { header: t.t('swf.reports.col.acts'), cell: (d) => (d.readOnly || d.archivedAt ? <span className="kv-detail__muted">{t.t(d.readOnly ? 'swf.reports.readOnly' : 'swf.reports.archived')}</span> : (
                <span><Link href={`${REPORTS_HREF}/act?step=confirm&act=run&def=${d.id}`} className="kv-btn--link">{t.t('swf.reports.runReport')}</Link>{' · '}
                  <Link href={`${REPORTS_HREF}/act?step=confirm&act=schedule&def=${d.id}`} className="kv-btn--link">{t.t('swf.reports.schedule')}</Link>{' · '}
                  <Link href={`${REPORTS_HREF}/act?step=confirm&act=archive&def=${d.id}`} className="kv-btn--link">{t.t('swf.reports.archive')}</Link></span>)) },
            ]} />
          )}

          <h2>{t.t('swf.reports.runs')}</h2>
          <DataTable rows={runs} empty={t.t('swf.reports.noRuns')} columns={[
            { header: t.t('swf.reports.col.when'), cell: (r) => <Link href={`${REPORTS_HREF}/runs/${r.id}`} className="kv-btn--link">{when(r.queuedAt)}</Link> },
            { header: t.t('swf.reports.col.dataset'), cell: (r) => `${t.t(`swf.reports.ds.${r.datasetCode}`)} · ${defTitle(r.definitionId)}` },
            { header: t.t('swf.reports.col.range'), cell: (r) => <>{r.fromDay} <DirArrow /> {r.toDay}</> },
            { header: t.t('swf.reports.col.status'), cell: (r) => <span><span className="kv-badge">{t.t(`swf.reports.status.${r.status}`)}</span>{r.errorCode ? <> {t.t(swfCodeKey(r.errorCode))} <code>{r.errorCode}</code></> : null}</span> },
            { header: t.t('swf.reports.col.rows'), cell: (r) => (r.rowCount === null ? t.t('common.dash') : String(r.rowCount)) },
          ]} />

          <h2>{t.t('swf.reports.schedules')}</h2>
          <DataTable rows={schedules} empty={t.t('swf.reports.noSchedules')} columns={[
            { header: t.t('swf.reports.col.title'), cell: (s) => defTitle(s.definitionId) },
            { header: t.t('swf.reports.col.cadence'), cell: (s) => `${t.t(`swf.reports.cadence.${s.cadence}`)}${s.weekdayIso ? ` · ${t.t(`swf.weekday.${s.weekdayIso}`)}` : ''}${s.monthDay ? ` · ${s.monthDay}` : ''} · ${s.timeIst} IST` },
            { header: t.t('swf.reports.col.next'), cell: (s) => (s.active ? istClock(s.nextRunAt) : <span className="kv-detail__muted">{t.t('swf.reports.scheduleOff')}</span>) },
            { header: t.t('swf.reports.col.recipients'), cell: (s) => s.recipientRoles.map((r) => t.t(`swf.role.${r}`)).join(', ') },
            { header: t.t('swf.reports.col.acts'), cell: (s) => (s.active ? <Link href={`${REPORTS_HREF}/act?step=confirm&act=unschedule&sched=${s.id}`} className="kv-btn--link">{t.t('swf.reports.unschedule')}</Link> : t.t('common.dash')) },
          ]} />
          <p className="kv-field__hint">{t.t('swf.reports.cadences', { list: CADENCES.map((c) => t.t(`swf.reports.cadence.${c}`)).join(' · ') })}</p>
        </>
      )}
    </section>
  );
}
