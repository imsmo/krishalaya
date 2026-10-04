// apps/web-tenant/src/app/insights/exports/[id]/page.tsx · the insights' export receipts — PC-56 TENANT-SW-f (F-18). ONE page serves
// W2678 / W2679 (mandi), W2569 / W2570 (demand), W2824 / W2825 (wastage) and the report builder's files: the 6e-2 shape — queued with a
// position and an ETA labelled as an estimate (or "no estimate yet"), then the receipt (file name, data rows, sha256, generated-at,
// requester, the file's own notes — refused figures are named there, never rows) and a 15-minute link whose every fetch is logged. The
// file is UNSIGNED and says so. `?from=` only decides the way back.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SdkError } from '@krishalaya/sdk-js';
import type { ExportJob } from '@krishalaya/sdk-js';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { byteParts, byteUnitKey, downloadErrorKey, downloadStateKey, etaKey, etaParts, etaUnitKey, exportState, exportTitleKey, exportTransportState, failureKeyFor, shaGroups } from '../../../../features/dairy/exports';
import { backHrefFor, insightExportHref, isInsightFrom, type InsightFrom } from '../../../../features/swf/console';
import { mintInsightDownloadAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata { return { title: getTranslator().t('dairy.export.title.queued'), robots: { index: false, follow: false } }; }
const when = (iso: string | null, lang: string) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : null);

export default async function InsightExportPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; from?: string } }) {
  const from: InsightFrom = isInsightFrom(searchParams.from) ? searchParams.from : 'reports';
  const id = params.id; const self = insightExportHref(id, from); const back = backHrefFor(from);
  await requireSession(self);
  const t = getTranslator(); const lang = getLang();
  let job: ExportJob | null = null; let state: string = 'error';
  try { job = await tenantClient().exportsPlane.get(id); state = exportState(job); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = exportTransportState(err?.code ?? 'generic', err?.status) ?? 'error'; }
  const downloadError = downloadErrorKey(searchParams.error);
  const receipt = job?.receipt ?? null;
  const title = exportTitleKey(state as Parameters<typeof exportTitleKey>[0]);
  const stateKey = (s: string) => (['notEnabled', 'restricted', 'notFound', 'error'].includes(s) ? `swf.export.state.${s}` : `dairy.export.state.${s}`);
  return (
    <section>
      <nav className="kv-field__hint"><Link href={back} className="kv-btn--link">{t.t(`swf.nav.${from}`)}</Link> › {t.t(title)}</nav>
      <h1>{t.t(title)}</h1>
      <p className="kv-field__hint">{t.t('swf.export.lead')}</p>
      {downloadError && <div className="kv-error" role="alert"><p>{t.t(downloadError)}</p><p className="kv-field__hint">{t.t('dairy.export.refused.logged')}</p></div>}
      {!job && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(stateKey(state))}</p>
          {state === 'error' && <p><Link href={self} className="kv-btn--link">{t.t('swf.retry')}</Link></p>}
          <p><Link href={back} className="kv-btn kv-btn--secondary">{t.t('swf.backToScreen')}</Link></p>
        </div>
      )}
      {job && (state === 'queued' || state === 'running') && (
        <div className="kv-card" role="status" aria-live="polite">
          <p>{t.t(stateKey(state))}</p>
          {job.standing && (
            <dl className="kv-dl">
              <dt>{t.t('dairy.export.position')}</dt><dd><strong>{formatNumber(job.standing.position, lang)}</strong> <span className="kv-field__hint">({t.t('dairy.export.ahead')} {formatNumber(job.standing.ahead, lang)})</span></dd>
              <dt>{t.t('dairy.export.eta')}</dt>
              <dd>{job.standing.eta.kind === 'estimate'
                ? (() => { const p = etaParts(job.standing!.eta.kind === 'estimate' ? job.standing!.eta.seconds : 0); return <><strong>{formatNumber(p.value, lang)} {t.t(etaUnitKey(p.unit))}</strong> <span className="kv-badge kv-badge--muted">{t.t(etaKey(job.standing!.eta))}</span></>; })()
                : <span className="kv-badge kv-badge--muted">{t.t(etaKey(job.standing.eta))}</span>}</dd>
            </dl>
          )}
          <p className="kv-field__hint">{t.t('dairy.export.queued.at')} {when(job.queuedAt, lang)} · {t.t('dairy.export.requester')} <code>{job.requestedBy}</code></p>
          <p><Link href={self} className="kv-btn kv-btn--primary">{t.t('dairy.export.checkReady')}</Link>{' '}<Link href={back} className="kv-btn kv-btn--secondary">{t.t('swf.backToScreen')}</Link></p>
        </div>
      )}
      {job && state === 'failed' && (
        <div className="kv-error" role="alert">
          <p>{t.t(stateKey('failed'))}</p>
          <p>{t.t(failureKeyFor(job.failure?.code ?? ''))} <code>{job.failure?.code}</code></p>
          <p><Link href={back} className="kv-btn kv-btn--secondary">{t.t('swf.backToScreen')}</Link></p>
        </div>
      )}
      {job && receipt && (state === 'ready' || state === 'expired') && (
        <div className={state === 'expired' ? 'kv-card kv-card--notice' : 'kv-card'} role="status">
          <p>{t.t(stateKey(state))}</p>
          <h2>{t.t('dairy.export.receipt.title')}</h2>
          <dl className="kv-dl">
            <dt>{t.t('dairy.export.receipt.fileName')}</dt><dd><code>{receipt.fileName}</code></dd>
            <dt>{t.t('dairy.export.receipt.rowCount')}</dt><dd>{formatNumber(receipt.rowCount, lang)} <span className="kv-field__hint">{t.t('dairy.export.receipt.rowsBasis')}</span></dd>
            <dt>{t.t('dairy.export.receipt.sha256')}</dt><dd><code style={{ overflowWrap: 'anywhere' }}>{shaGroups(receipt.sha256)}</code></dd>
            <dt>{t.t('dairy.export.receipt.generatedAt')}</dt><dd>{when(receipt.generatedAt, lang)}</dd>
            <dt>{t.t('dairy.export.receipt.requester')}</dt><dd><code>{receipt.requestedBy}</code></dd>
            <dt>{t.t('dairy.export.receipt.size')}</dt><dd>{(() => { const b = byteParts(receipt.byteSize); return <>{formatNumber(b.value, lang)} {t.t(byteUnitKey(b.unit))}</>; })()}</dd>
          </dl>
          <p className="kv-field__hint">{t.t('swf.export.unsignedReceipt')}</p>
          {receipt.notes.length > 0 && <><h3>{t.t('dairy.export.receipt.notes')}</h3><p className="kv-field__hint">{t.t('dairy.export.receipt.notesLead')}</p><ul className="kv-list">{receipt.notes.map((n) => <li key={n}>{n}</li>)}</ul></>}
          {job.download.kind === 'available' ? (
            <form action={mintInsightDownloadAction}>
              <input type="hidden" name="id" value={job.id} /><input type="hidden" name="from" value={from} />
              <button type="submit" className="kv-btn kv-btn--primary">{t.t('dairy.export.download.button')}</button>
              <p className="kv-field__hint">{t.t('dairy.export.download.ttl')} {formatNumber(Math.round(job.download.linkTtlSec / 60), lang)} {t.t('dairy.export.eta.unit.minutes')} · {t.t('dairy.export.download.logged')}</p>
            </form>
          ) : <p className="kv-badge kv-badge--muted">{t.t(downloadStateKey(job.download) ?? 'common.dash')}</p>}
          <p><Link href={back} className="kv-btn kv-btn--secondary">{t.t('swf.backToScreen')}</Link></p>
        </div>
      )}
    </section>
  );
}
