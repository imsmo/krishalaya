// apps/web-tenant/src/app/insights/reports/runs/[id]/page.tsx · one report run — PC-56 TENANT-SW-f. Status (queued · running · ready · failed ·
// refused, each with its code's sentence), rows, the statement timeout as OBSERVED inside the run's transaction, the watermark the file
// carries, and the link to the file's receipt on the 6e-2 plane. A failed / refused run is retried as a NEW run (the chain's Retry).
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { SdkError } from '@krishalaya/sdk-js';
import type { ReportRun } from '@krishalaya/sdk-js';
import { formatDate } from '@krishalaya/i18n';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { AsOf } from '../../../../../components/AsOf';
import { REPORTS_HREF, asOfLabels, insightExportHref, isUuid, swfCodeKey, swfPageState, watermarkPairs } from '../../../../../features/swf/console';
import { DirArrow } from '../../../../../components/DirArrow'; // PC-56 TENANT-CLOSE · RTL: the range arrow flips under dir="rtl"

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('swf.reports.runTitle'), robots: { index: false, follow: false } }; }

export default async function ReportRunPage({ params }: { params: { id: string } }) {
  await requireSession(`${REPORTS_HREF}/runs/${params.id}`);
  const t = getTranslator(); const lang = getLang();
  let r: ReportRun | null = null; let state: string | null = isUuid(params.id) ? null : 'notFound';
  if (!state) { try { r = await tenantClient().reports.run(params.id); } catch (e) { state = swfPageState(e instanceof SdkError ? e.status : undefined); if (state === 'flaggedOff' && e instanceof SdkError && e.code === 'REPORT_RUN_NOT_FOUND') state = 'notFound'; } }
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : t.t('common.dash'));
  const retry = r ? `${REPORTS_HREF}/act?${new URLSearchParams({ step: 'confirm', act: 'run', dataset: r.datasetCode, from: r.fromDay, to: r.toDay, ...(r.definitionId ? { def: r.definitionId } : {}) }).toString()}${r.definitionId ? '' : r.dimensions.map((d) => `&dims=${d}`).join('') + r.measures.map((m) => `&measures=${m}`).join('')}` : REPORTS_HREF;
  return (
    <section>
      <nav className="kv-breadcrumb" aria-label={t.t('swf.reports.title')}><Link href={REPORTS_HREF}>{t.t('swf.reports.title')}</Link> / <span aria-current="page">{t.t('swf.reports.runTitle')}</span></nav>
      <h1>{t.t('swf.reports.runTitle')}</h1>
      {state ? <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role="alert"><strong>{t.t(`swf.state.${state}.title`)}</strong><p>{t.t(`swf.state.${state}.body`)}</p></div> : r && (
        <>
          <AsOf at={new Date().toISOString()} labels={asOfLabels(t)} />
          <div className="kv-card">
            <dl className="kv-dl">
              <dt>{t.t('swf.reports.col.dataset')}</dt><dd>{t.t(`swf.reports.ds.${r.datasetCode}`)} · {r.dimensions.join(', ') || t.t('common.dash')} · {r.measures.join(', ')}</dd>
              <dt>{t.t('swf.reports.col.range')}</dt><dd>{r.fromDay} <DirArrow /> {r.toDay}</dd>
              <dt>{t.t('swf.reports.col.status')}</dt><dd><span className="kv-badge">{t.t(`swf.reports.status.${r.status}`)}</span>{r.errorCode && <> {t.t(swfCodeKey(r.errorCode))} <code>{r.errorCode}</code></>}</dd>
              <dt>{t.t('swf.reports.col.rows')}</dt><dd>{r.rowCount === null ? t.t('common.dash') : String(r.rowCount)}</dd>
              <dt>{t.t('swf.reports.timeoutObserved')}</dt><dd>{r.statementTimeout ? <code>{r.statementTimeout}</code> : t.t('common.dash')} {r.statementMs !== null && <span className="kv-detail__muted">· {t.t('swf.reports.took', { ms: String(r.statementMs) })}</span>}</dd>
              <dt>{t.t('swf.reports.col.when')}</dt><dd>{when(r.queuedAt)} <DirArrow /> {when(r.finishedAt)}</dd>
            </dl>
            {r.exportJobId && <p><Link href={insightExportHref(r.exportJobId, 'reports')} className="kv-btn kv-btn--primary">{t.t('swf.reports.openFile')}</Link></p>}
            {(r.status === 'failed' || r.status === 'refused') && <p><Link href={retry} className="kv-btn--link">{t.t('swf.retry')}</Link> <span className="kv-field__hint">{t.t('swf.reports.retryIsNew')}</span></p>}
          </div>
          {r.watermark && (
            <div className="kv-card"><h2>{t.t('swf.reports.watermark')}</h2><p className="kv-field__hint">{t.t('swf.reports.watermarkLead')}</p>
              <dl className="kv-dl">{watermarkPairs(r.watermark).map(([k, v]) => <Fragment key={k}><dt><code>{k}</code></dt><dd>{v}</dd></Fragment>)}</dl></div>
          )}
        </>
      )}
    </section>
  );
}
