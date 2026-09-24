// apps/web-tenant/src/app/studio/earnings/exports/[id]/page.tsx · W2553 (Export queued) + W2554 (Export ready) — PC-56 TENANT-7d-money, 6e-2's page ported to W418's export.
// Server-first, requireSession-gated, noindex, no client JS: "Check ready page" is a link to this URL, "Download" is a
// form POST that mints the link and hands the browser the file.
//
// WHAT THIS PAGE SAYS THAT THE CANON PROMISES, AND CAN NOW SAY TRUTHFULLY:
//   • **"queued with a position and ETA"** — the position is a FACT counted live across the one worker queue every tenant
//     shares (1 = next); the ETA is an ESTIMATE from the median of recent runs and is labelled so, and until the platform
//     has ever finished an export it reads "no estimate yet" — never 0 seconds. Unknown is not zero.
//   • **"audit-stamped receipt: file name, row count, sha256, generated-at, requester"** — all five, from the row the
//     worker wrote in the same transaction as the file's digest. Row count is DATA rows; the header is not a row, and the
//     page says so. The receipt's NOTES are printed: the three figures W172 refuses are NOT in the file, and the notes are
//     where the file admits it.
//   • **"delivery via 15-min signed URL, every fetch logged"** — the button mints the link (audited with its jti), the
//     console proxies the bytes so the session travels with the link, and the fetch counts on this page come from the log,
//     refused attempts included.
// AND WHAT IT SAYS THE CANON DOES NOT: a `failed` job names its reason code; an `expired` job keeps its receipt and says
// the file is gone after seven days; a member without the dairy verb is told so; a switched-off plane is a sentence, not
// a 404.
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireSession } from '../../../../../lib/session';
import { tenantClient } from '../../../../../lib/api-client';
import { getTranslator, getLang } from '../../../../../lib/i18n';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { ExportJob } from '@krishalaya/sdk-js';
import {
  byteParts, byteUnitKey, downloadErrorKey, downloadStateKey, etaKey, etaParts, etaUnitKey, exportState,
  exportStateKey, exportTitleKey, exportTransportState, failureKeyFor, shaGroups,
} from '../../../../../features/dairy/exports';
import { EARNINGS_PATH, exportHref } from '../../../../../features/studio/earnings';
import { mintDownloadLinkAction } from './actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.export.title.queued'), robots: { index: false, follow: false } };
}

const when = (iso: string | null, lang: string) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : null);

export default async function EarningsExportPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const id = params.id;
  await requireSession(exportHref(id));
  const t = getTranslator();
  const lang = getLang();

  let job: ExportJob | null = null;
  let state = 'error' as ReturnType<typeof exportState> | NonNullable<ReturnType<typeof exportTransportState>>;
  try {
    job = await tenantClient().exportsPlane.get(id);
    state = exportState(job);
  } catch (e) {
    const err = e instanceof SdkError ? e : null;
    state = exportTransportState(err?.code ?? 'generic', err?.status) ?? 'error';
  }
  const downloadError = downloadErrorKey(searchParams.error);
  const receipt = job?.receipt ?? null;

  return (
    <section>
      <nav aria-label={t.t('dairy.export.breadcrumb')} className="kv-field__hint">
        <Link href={EARNINGS_PATH}>{t.t('earnings.title')}</Link>{' / '}{t.t(exportTitleKey(state))}
      </nav>
      <h1>{t.t(exportTitleKey(state))}</h1>
      <p className="kv-field__hint">{t.t('dairy.export.lead')}</p>

      {/* The download route's refusal, carried back here as a sentence — the API has already logged the attempt. */}
      {downloadError && (
        <div className="kv-error" role="alert">
          <p>{t.t(downloadError)}</p>
          <p className="kv-field__hint">{t.t('dairy.export.refused.logged')}</p>
        </div>
      )}

      {/* ---- the four transport/flag states: flagged-off, permission-denied, empty (no such job), error ---- */}
      {!job && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(state === 'restricted' ? 'earnings.export.restricted' : exportStateKey(state))}</p>
          {state === 'error' && <p><Link href={exportHref(id)} className="kv-btn--link">{t.t('dairy.retry')}</Link></p>}
          <p><Link href={EARNINGS_PATH} className="kv-btn kv-btn--secondary">{t.t('dairy.export.back')}</Link></p>
        </div>
      )}

      {/* ---- W2553: queued / running ---- */}
      {job && (state === 'queued' || state === 'running') && (
        <div className="kv-card" role="status" aria-live="polite">
          <p>{t.t(exportStateKey(state))}</p>
          {job.standing && (
            <dl className="kv-dl">
              <dt>{t.t('dairy.export.position')}</dt>
              <dd><strong>{formatNumber(job.standing.position, lang)}</strong> <span className="kv-field__hint">({t.t('dairy.export.ahead')} {formatNumber(job.standing.ahead, lang)})</span></dd>
              <dt>{t.t('dairy.export.eta')}</dt>
              <dd>
                {job.standing.eta.kind === 'estimate' ? (() => {
                  const p = etaParts(job.standing!.eta.kind === 'estimate' ? job.standing!.eta.seconds : 0);
                  return (
                    <>
                      <strong>{formatNumber(p.value, lang)} {t.t(etaUnitKey(p.unit))}{p.unit === 'hours' && p.minutes ? <> {formatNumber(p.minutes, lang)} {t.t(etaUnitKey('minutes'))}</> : null}</strong>
                      {' '}<span className="kv-badge kv-badge--muted">{t.t(etaKey(job.standing!.eta))}</span>
                      <span className="kv-field__hint"> · {t.t('dairy.export.eta.basis')} {formatNumber(job.standing!.eta.kind === 'estimate' ? job.standing!.eta.sample : 0, lang)}</span>
                    </>
                  );
                })() : (
                  <span className="kv-badge kv-badge--muted">{t.t(etaKey(job.standing.eta))}</span>
                )}
              </dd>
            </dl>
          )}
          {state === 'running' && <p className="kv-field__hint">{t.t('dairy.export.running.since')} {when(job.startedAt, lang)}</p>}
          <p className="kv-field__hint">{t.t('dairy.export.queued.at')} {when(job.queuedAt, lang)} · {t.t('dairy.export.requester')} <code>{job.requestedBy}</code></p>
          <p>
            {/* W2553's two buttons. "Check ready page" IS this page again: the state decides which screen it is. */}
            <Link href={exportHref(id)} className="kv-btn kv-btn--primary">{t.t('dairy.export.checkReady')}</Link>{' '}
            <Link href={EARNINGS_PATH} className="kv-btn kv-btn--secondary">{t.t('dairy.export.back')}</Link>
          </p>
        </div>
      )}

      {/* ---- failed: honest, with the code ---- */}
      {job && state === 'failed' && (
        <div className="kv-error" role="alert">
          <p>{t.t(exportStateKey('failed'))}</p>
          <p>{t.t(failureKeyFor(job.failure?.code ?? ''))} <code>{job.failure?.code}</code></p>
          {job.failure?.detail && <p className="kv-field__hint"><code>{job.failure.detail}</code></p>}
          <p className="kv-field__hint">{t.t('dairy.export.failed.at')} {when(job.failedAt, lang)} · {t.t('dairy.export.attempts')} {formatNumber(job.attempts, lang)}</p>
          <p><Link href={EARNINGS_PATH} className="kv-btn kv-btn--secondary">{t.t('dairy.export.backToScreen')}</Link></p>
        </div>
      )}

      {/* ---- W2554: ready / expired — the receipt ---- */}
      {job && receipt && (state === 'ready' || state === 'expired') && (
        <>
          <div className={state === 'expired' ? 'kv-card kv-card--notice' : 'kv-card'} role="status">
            <p>{t.t(exportStateKey(state))}</p>
            <h2>{t.t('dairy.export.receipt.title')}</h2>
            <dl className="kv-dl">
              <dt>{t.t('dairy.export.receipt.fileName')}</dt><dd><code>{receipt.fileName}</code></dd>
              <dt>{t.t('dairy.export.receipt.rowCount')}</dt>
              <dd>{formatNumber(receipt.rowCount, lang)} <span className="kv-field__hint">{t.t('dairy.export.receipt.rowsBasis')}</span></dd>
              <dt>{t.t('dairy.export.receipt.sha256')}</dt><dd><code className="kv-mono" style={{ overflowWrap: 'anywhere' }}>{shaGroups(receipt.sha256)}</code></dd>
              <dt>{t.t('dairy.export.receipt.generatedAt')}</dt><dd>{when(receipt.generatedAt, lang)}</dd>
              <dt>{t.t('dairy.export.receipt.requester')}</dt><dd><code>{receipt.requestedBy}</code></dd>
              <dt>{t.t('dairy.export.receipt.size')}</dt>
              <dd>{(() => { const b = byteParts(receipt.byteSize); return <>{formatNumber(b.value, lang)} {t.t(byteUnitKey(b.unit))}</>; })()}</dd>
              <dt>{t.t('dairy.export.receipt.expiresAt')}</dt>
              <dd>{state === 'expired' ? <>{t.t('dairy.export.receipt.expiredAt')} {when(job.expiredAt, lang)}</> : when(job.expiresAt, lang)}</dd>
            </dl>

            {/* WHAT THE FILE ADMITS. The refused figures live here, not as rows. */}
            {receipt.notes.length > 0 && (
              <>
                <h3>{t.t('dairy.export.receipt.notes')}</h3>
                <p className="kv-field__hint">{t.t('dairy.export.receipt.notesLead')}</p>
                <ul className="kv-list">{receipt.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              </>
            )}
          </div>

          <div className="kv-card">
            <h2>{t.t('dairy.export.download.title')}</h2>
            {job.download.kind === 'available' ? (
              <form action={mintDownloadLinkAction} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={job.id} />
                <button type="submit" className="kv-btn kv-btn--primary" aria-describedby="link-ttl">
                  {t.t('dairy.export.download.button')}
                </button>
                <p id="link-ttl" className="kv-field__hint">
                  {t.t('dairy.export.download.ttl')} {formatNumber(Math.round(job.download.linkTtlSec / 60), lang)} {t.t('dairy.export.eta.unit.minutes')}
                  {' · '}{t.t('dairy.export.download.logged')}
                </p>
              </form>
            ) : (
              <p className="kv-badge kv-badge--muted">{t.t(downloadStateKey(job.download) ?? 'common.dash')}</p>
            )}

            {/* *"every fetch logged"* — the counts, from the log, refused attempts included. */}
            {job.fetches && (
              <p className="kv-field__hint">
                {t.t('dairy.export.fetches.attempts')} {formatNumber(job.fetches.attempts, lang)}
                {' · '}{t.t('dairy.export.fetches.served')} {formatNumber(job.fetches.served, lang)}
                {' · '}{t.t('dairy.export.fetches.refused')} {formatNumber(job.fetches.refused, lang)}
                {job.fetches.mismatched > 0 && <> {' · '}<span className="kv-badge kv-badge--danger">{t.t('dairy.export.fetches.mismatched')} {formatNumber(job.fetches.mismatched, lang)}</span></>}
                {job.fetches.lastServedAt && <> {' · '}{t.t('dairy.export.fetches.last')} {when(job.fetches.lastServedAt, lang)}</>}
              </p>
            )}
          </div>

          <p><Link href={EARNINGS_PATH} className="kv-btn kv-btn--primary">{t.t('dairy.export.backToScreen')}</Link></p>
        </>
      )}
    </section>
  );
}
