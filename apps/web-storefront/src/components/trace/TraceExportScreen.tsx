// apps/web-storefront/src/components/trace/TraceExportScreen.tsx · PC-56 STORE-5b · C3 — canon W3154 (queued) and W3155 (ready), REAL (founder D2 /
// Q13: sign-in, on the export plane, CSV), under either chrome. PROTECTED (the sign-in door with `next` otherwise) + dynamic.
//   • no job yet → "Prepare the file" (`requestTraceExportAction`), the key MINTED AT RENDER (or carried back from a failure — Retry re-sends it);
//   • `?job=<id>` queued → the position and the plane's HONEST ETA (an estimate in minutes, or "no estimate yet"), "Check ready page" (this
//     page again), Back to the verify page; running → "being prepared now";
//   • ready (W3155) → the receipt (file, rows, sha256, generated-at, requester = You) + "Download (link valid N minutes)" — N from the plane's
//     `download.linkTtlSec`, never a literal — minted on click and fetched through this app's own route; "every fetch is logged" (TRUE);
//     CSV, not JSON (a DELTA); "signed" refused by name; Back → the verify page (the canon's W273 link is a defect — DELTA);
//   • a failed enqueue by NAME (not published / no longer published / not found / unavailable / sign in / server) with Retry under the SAME key.
import { randomUUID } from 'crypto';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { ExportJob, UserProfile } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import type { AccountChrome } from '../../features/store4a/account';
import { chromeField } from '../../features/store4a/account';
import { downloadErrorKey, etaMinutes, exportFailureKey } from '../../features/store4a/data-rights';
import { carriedExportKey, EXPORT_FAILURES, traceExportView, traceHref, type ExportFailure } from '../../features/store5b/trace';
import { requestTraceExportAction, mintTraceDownloadAction } from '../../app/(platform)/trace/actions';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export async function TraceExportScreen({ chrome, qrToken, searchParams }: { chrome: AccountChrome; qrToken: string; searchParams: SP }) {
  await requireSession(traceHref(chrome, qrToken, 'export'));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined);
  const jobId = one(searchParams.job);
  const failureRaw = one(searchParams.failure);
  const failure = (EXPORT_FAILURES as readonly string[]).includes(failureRaw ?? '') ? (failureRaw as ExportFailure) : null;
  const key = carriedExportKey(one(searchParams.k)) ?? `trace-export:${randomUUID()}`;
  const dl = one(searchParams.download) ?? null;
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  const head = (
    <>
      <nav aria-label={t.t('store4a.crumb.label')}>
        <ol className="kv-crumb">
          <li><Link href={traceHref(chrome, qrToken)}>{t.t('store5b.trace.crumb', { token: qrToken })}</Link></li>
          <li><Link href={traceHref(chrome, qrToken, 'verify')}>{t.t('store5b.verify.title')}</Link></li>
          <li aria-current="page">{t.t('store5b.export.title')}</li>
        </ol>
      </nav>
      <h1>{t.t('store5b.export.title')}</h1>
      <p className="kv-detail__muted">{t.t('store5b.export.lead')}</p>
    </>
  );
  const requestForm = (label: string) => (
    <form action={requestTraceExportAction} className="kv-inline-form" data-kv-form="trace-export">
      <input type="hidden" name="chrome" value={chromeField(chrome)} />
      <input type="hidden" name="qrToken" value={qrToken} />
      <input type="hidden" name="key" value={key} />
      <button type="submit" className="kv-btn" data-kv-cta="request-export">{label}</button>
    </form>
  );
  const back = <Link href={traceHref(chrome, qrToken, 'verify')} className="kv-btn--link" data-kv-cta="back">{t.t('store5b.export.back')}</Link>;

  let job: ExportJob | null = null; let missing = false;
  if (jobId && UUID.test(jobId)) { try { job = await api.exportsPlane.get(jobId); } catch { missing = true; } }
  if (!job) {
    return (
      <section className="kv-prose" data-kv-screen="trace-export" data-kv-chrome={chromeField(chrome)} data-kv-phase={failure ? 'failed-request' : 'none'}>
        {head}
        {failure && <div className="kv-state kv-state--error" role="alert" data-kv-failure={failure}><p>{t.t(`store5b.export.failure.${failure}`)}</p></div>}
        {missing && <p className="kv-form__error" role="alert" data-kv-job-missing>{t.t('store5b.export.jobMissing')}</p>}
        {failure !== 'not_published' && failure !== 'no_longer' && failure !== 'not_found' && requestForm(failure ? t.t('store5b.export.retry') : t.t('store5b.export.request'))}
        <p className="kv-detail__muted">{t.t('store5b.export.csv')}</p>
        <p>{back}</p>
        <RefusalList surface="trace_export" />
      </section>
    );
  }
  let me: UserProfile | null = null;
  try { me = await api.auth.me(); } catch { me = null; }
  const v = traceExportView(job as never, me?.id ?? null);
  const eta = etaMinutes(v.etaSeconds);
  return (
    <section className="kv-prose" data-kv-screen="trace-export" data-kv-chrome={chromeField(chrome)} data-kv-phase={v.phase}>
      {head}
      {dl && <p className="kv-form__error" role="alert" data-kv-download-error={dl}>{t.t(downloadErrorKey(dl))}</p>}
      {v.phase === 'queued' && (
        <div className="kv-state" role="status" data-kv-state="queued">
          <p><strong>{t.t('store5b.export.queued')}</strong></p>
          {v.position !== null && <p data-kv-position={v.position}>{t.t('store4a.data.position', { n: formatNumber(v.position, lang) })}</p>}
          <p data-kv-eta={eta === null ? 'no_history' : 'estimate'}>{eta === null ? t.t('store4a.data.etaNone') : t.t('store4a.data.eta', { n: formatNumber(eta, lang) })}</p>
          <Link href={traceHref(chrome, qrToken, 'export', { job: v.jobId })} className="kv-btn" data-kv-cta="check">{t.t('store5b.export.check')}</Link>{' '}{back}
        </div>
      )}
      {v.phase === 'running' && (
        <div className="kv-state" role="status" data-kv-state="running">
          <p><strong>{t.t('store5b.export.running')}</strong></p>
          <Link href={traceHref(chrome, qrToken, 'export', { job: v.jobId })} className="kv-btn" data-kv-cta="check">{t.t('store5b.export.check')}</Link>{' '}{back}
        </div>
      )}
      {(v.phase === 'ready' || v.phase === 'expired') && v.receipt && (
        <div data-kv-state={v.phase}>
          <h2>{t.t('store5b.export.readyTitle')}</h2>
          <table className="kv-table" data-kv-receipt>
            <tbody>
              <tr><th scope="row">{t.t('store4a.data.receipt.file')}</th><td><code className="kv-mono" data-kv-file>{v.receipt.fileName}</code></td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.rows')}</th><td data-kv-rows={v.receipt.rowCount}>{formatNumber(v.receipt.rowCount, lang)}</td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.sha256')}</th><td><code className="kv-mono" data-kv-sha256>{v.receipt.sha256}</code></td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.generatedAt')}</th><td>{date(v.receipt.generatedAt)}</td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.requester')}</th><td data-kv-requester={v.receipt.requestedByYou ? 'you' : 'unknown'}>{t.t(v.receipt.requestedByYou ? 'store4a.data.receipt.you' : 'store4a.data.receipt.unknown')}</td></tr>
            </tbody>
          </table>
          <p className="kv-detail__muted">{t.t('store5b.export.csv')}</p>
          {v.phase === 'ready' && v.downloadable && (
            <form action={mintTraceDownloadAction} className="kv-inline-form" data-kv-form="trace-download">
              <input type="hidden" name="chrome" value={chromeField(chrome)} />
              <input type="hidden" name="qrToken" value={qrToken} />
              <input type="hidden" name="id" value={v.jobId} />
              <button type="submit" className="kv-btn" data-kv-cta="download">{v.linkTtlSec ? t.t('store4a.data.download', { n: formatNumber(Math.round(v.linkTtlSec / 60), lang) }) : t.t('store4a.data.downloadPlain')}</button>
            </form>
          )}
          {v.phase === 'ready' && <p className="kv-detail__muted" data-kv-fetch-log>{t.t('store4a.data.fetchLogged')}</p>}
          {v.phase === 'ready' && v.expiresAt && <p className="kv-detail__muted">{t.t('store4a.data.expiresAt', { date: date(v.expiresAt) })}</p>}
          {v.phase === 'expired' && <div data-kv-expired><p>{v.expiresAt ? t.t('store4a.data.expired', { date: date(v.expiresAt) }) : t.t('store4a.data.expiredPlain')}</p>{requestForm(t.t('store5b.export.request'))}</div>}
          <p>{back}</p>
        </div>
      )}
      {v.phase === 'failed' && (
        <div className="kv-state kv-state--error" role="alert" data-kv-state="failed" data-kv-failure={v.failureCode ?? ''}>
          <p>{t.t(exportFailureKey(v.failureCode))}</p>
          {requestForm(t.t('store5b.export.retry'))}
          <p>{back}</p>
        </div>
      )}
      <RefusalList surface="trace_export" />
    </section>
  );
}
