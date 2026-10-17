// apps/web-storefront/src/components/account/DataRightsScreen.tsx · PC-56 STORE-4a · C4 — "Download my data": canon W3029 (queued) and W3030
// (ready), REAL (founder D2), under whichever chrome the person is in (one copy). PROTECTED + dynamic.
//   • no request yet (or the last one expired / failed) → the request act, a key minted at render;
//   • queued → the position and the plane's HONEST ETA (an estimate in minutes, or "no estimate yet") + "we notify you when it is ready" (TRUE:
//     the plane's `exports.export_ready` reaches the requester) + Back;
//   • running → "being compiled now";
//   • ready (W3030) → the receipt (file, rows, sha256, generated-at, requester = you) + "Download (link valid N minutes)" — N from the plane's
//     `download.linkTtlSec`, never a literal — minted on click,
//     fetched through this app's own route beside the session — and "every fetch is logged" (TRUE);
//   • expired → "the file was removed on <the plane's expiry date>; request again"; failed → the code by name + request again;
//   • "across every organisation you used" (TRUE — the personal dataset reads every organisation); the helpline refused.
import { randomUUID } from 'crypto';
import Link from 'next/link';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import type { PrivacyRequest, UserProfile } from '@krishalaya/sdk-js';
import { serverClient } from '../../lib/api-client';
import { requireSession } from '../../lib/session';
import { getTranslator, getLang } from '../../lib/i18n';
import { reloadHref } from '../../features/home/load-result';
import { accountHref, chromeField, readOne, type AccountChrome } from '../../features/store4a/account';
import { exportView, etaMinutes, canRequestExport, exportFailureKey, downloadErrorKey } from '../../features/store4a/data-rights';
import { requestExportAction, mintDownloadAction } from '../../app/(platform)/account/actions';
import { RefusalList } from '../RefusalList';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export async function DataRightsScreen({ chrome, searchParams }: { chrome: AccountChrome; searchParams: SP }) {
  await requireSession(accountHref(chrome, 'data'));
  const t = getTranslator();
  const lang = getLang();
  const api = serverClient(chrome.kind === 'tenant' ? chrome.slug : undefined);
  let requests: PrivacyRequest[] = []; let failed = false;
  try { requests = await api.privacy.myRequests(); } catch { failed = true; }
  let me: UserProfile | null = null;
  try { me = await api.auth.me(); } catch { me = null; }
  const v = exportView(requests as never, me?.id ?? null);
  const ok = readOne(searchParams.ok, ['requested'] as const);
  const error = readOne(searchParams.error, ['request'] as const);
  const dl = one(searchParams.download) ?? null;
  const key = (() => { const k = one(searchParams.k); return typeof k === 'string' && /^dsr-export:[0-9a-f-]{36}$/.test(k) ? k : `dsr-export:${randomUUID()}`; })();
  const eta = etaMinutes(v.etaSeconds);
  const date = (iso: string | null | undefined) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  const head = (
    <>
      <nav aria-label={t.t('store4a.crumb.label')}><ol className="kv-crumb"><li><Link href={accountHref(chrome)}>{t.t('account.title')}</Link></li><li aria-current="page">{t.t('store4a.data.title')}</li></ol></nav>
      <h1>{t.t('store4a.data.title')}</h1>
      <p className="kv-detail__muted">{t.t('store4a.data.lead')}</p>
    </>
  );
  const requestForm = (
    <form action={requestExportAction} data-kv-act-class="countdown" data-kv-needs-signal-reason="exportLink" className="kv-inline-form" data-kv-form="export-request">
      <input type="hidden" name="chrome" value={chromeField(chrome)} />
      <input type="hidden" name="key" value={key} />
      <button type="submit" className="kv-btn" data-kv-cta="request-export">{t.t(v.phase === 'none' ? 'store4a.data.request' : 'store4a.data.requestAgain')}</button>
    </form>
  );
  if (failed) {
    return (
      <section className="kv-data" data-kv-screen="data" data-kv-chrome={chromeField(chrome)}>
        {head}
        <div className="kv-state kv-state--error" role="alert" data-kv-state="error">
          <p>{t.t('store4a.data.error')}</p>
          <a href={reloadHref(accountHref(chrome, 'data'), searchParams)} className="kv-btn" data-kv-retry="reload">{t.t('home.retry')}</a>
        </div>
        <RefusalList surface="data" />
      </section>
    );
  }
  return (
    <section className="kv-data" data-kv-screen="data" data-kv-phase={v.phase} data-kv-chrome={chromeField(chrome)}>
      {head}
      {ok && <p className="kv-form__notice" role="status" data-kv-ok={ok}>{t.t('store4a.data.ok.requested')}</p>}
      {error && <p className="kv-form__error" role="alert" data-kv-error={error}>{t.t('store4a.data.requestError')}</p>}
      {dl && <p className="kv-form__error" role="alert" data-kv-download-error={dl}>{t.t(downloadErrorKey(dl))}</p>}

      {v.phase === 'none' && <div data-kv-state="none"><p>{t.t('store4a.data.none')}</p>{requestForm}</div>}

      {v.phase === 'queued' && (
        <div className="kv-state" role="status" data-kv-state="queued">
          <p><strong>{t.t('store4a.data.queued')}</strong></p>
          {v.position !== null && <p data-kv-position={v.position}>{t.t('store4a.data.position', { n: formatNumber(v.position, lang) })}</p>}
          <p data-kv-eta={eta === null ? 'no_history' : 'estimate'}>{eta === null ? t.t('store4a.data.etaNone') : t.t('store4a.data.eta', { n: formatNumber(eta, lang) })}</p>
          <p className="kv-detail__muted">{t.t('store4a.data.notify')}</p>
          <Link href={accountHref(chrome, 'data')} className="kv-btn" data-kv-cta="check">{t.t('store4a.data.check')}</Link>{' '}
          <Link href={accountHref(chrome)} className="kv-btn--link">{t.t('store4a.data.back')}</Link>
        </div>
      )}
      {v.phase === 'running' && (
        <div className="kv-state" role="status" data-kv-state="running">
          <p><strong>{t.t('store4a.data.running')}</strong></p>
          <p className="kv-detail__muted">{t.t('store4a.data.notify')}</p>
          <Link href={accountHref(chrome, 'data')} className="kv-btn" data-kv-cta="check">{t.t('store4a.data.check')}</Link>
        </div>
      )}

      {(v.phase === 'ready' || v.phase === 'expired') && v.receipt && (
        <div data-kv-state={v.phase}>
          <h2>{t.t('store4a.data.receiptTitle')}</h2>
          <table className="kv-table" data-kv-receipt>
            <tbody>
              <tr><th scope="row">{t.t('store4a.data.receipt.file')}</th><td><code className="kv-mono" data-kv-file>{v.receipt.fileName}</code></td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.rows')}</th><td data-kv-rows={v.receipt.rowCount}>{formatNumber(v.receipt.rowCount, lang)}</td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.sha256')}</th><td><code className="kv-mono" data-kv-sha256>{v.receipt.sha256}</code></td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.generatedAt')}</th><td>{date(v.receipt.generatedAt)}</td></tr>
              <tr><th scope="row">{t.t('store4a.data.receipt.requester')}</th><td data-kv-requester={v.receipt.requestedByYou ? 'you' : 'unknown'}>{t.t(v.receipt.requestedByYou ? 'store4a.data.receipt.you' : 'store4a.data.receipt.unknown')}</td></tr>
            </tbody>
          </table>
          <p className="kv-detail__muted">{t.t('store4a.data.contents')}</p>
          {v.phase === 'ready' && v.downloadable && v.jobId && (
            <form action={mintDownloadAction} data-kv-act-class="countdown" data-kv-needs-signal-reason="exportLink" className="kv-inline-form" data-kv-form="download">
              <input type="hidden" name="chrome" value={chromeField(chrome)} />
              <input type="hidden" name="id" value={v.jobId} />
              <button type="submit" className="kv-btn" data-kv-cta="download">{v.linkTtlSec ? t.t('store4a.data.download', { n: formatNumber(Math.round(v.linkTtlSec / 60), lang) }) : t.t('store4a.data.downloadPlain')}</button>
            </form>
          )}
          {v.phase === 'ready' && <p className="kv-detail__muted" data-kv-fetch-log>{t.t('store4a.data.fetchLogged')}</p>}
          {v.phase === 'ready' && v.expiresAt && <p className="kv-detail__muted">{t.t('store4a.data.expiresAt', { date: date(v.expiresAt) })}</p>}
          {v.phase === 'expired' && <div data-kv-expired><p>{v.expiresAt ? t.t('store4a.data.expired', { date: date(v.expiresAt) }) : t.t('store4a.data.expiredPlain')}</p>{requestForm}</div>}
        </div>
      )}
      {v.phase === 'failed' && (
        <div className="kv-state kv-state--error" role="alert" data-kv-state="failed" data-kv-failure={v.failureCode ?? ''}>
          <p>{t.t(exportFailureKey(v.failureCode))}</p>
          {requestForm}
        </div>
      )}
      {canRequestExport(v) ? null : <p className="kv-detail__muted" data-kv-one-open>{t.t('store4a.data.oneOpen')}</p>}
      <RefusalList surface="data" />
    </section>
  );
}
