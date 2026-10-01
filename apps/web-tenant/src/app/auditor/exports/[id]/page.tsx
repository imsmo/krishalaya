// apps/web-tenant/src/app/auditor/exports/[id]/page.tsx · W2498 (Export queued) + W2499 (Export ready) — the auditor's file on
// the 6e-2 plane (PC-56 TENANT-9c). The state decides which canon screen it is. W2498: *"queued with a position and ETA …
// audit-stamped, checksummed, delivered by signed URL"* — the position is counted live, the ETA is an estimate (or "no estimate
// yet"), and "signed URL" is said precisely: a 15-minute HMAC-signed LINK; the FILE is not signed. W2499: the receipt — file
// name, row count, sha256, generated-at, requester — and its NOTES, which open with the unsigned sentence and carry the
// verification facts that are true (recompute the sha256; for the ledger, how to recompute the hash links of the
// cooperative's own accounts, and why the platform accounts' links are withheld). Every fetch logged, refused ones included.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDate, formatNumber } from '@krishalaya/i18n';
import { SdkError } from '@krishalaya/sdk-js';
import type { ExportJob } from '@krishalaya/sdk-js';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { getLang, getTranslator } from '../../../../lib/i18n';
import { env } from '../../../../lib/env';
import {
  byteParts, byteUnitKey, downloadErrorKey, downloadStateKey, etaKey, etaParts, etaUnitKey, exportState, exportStateKey,
  exportTitleKey, exportTransportState, failureKeyFor, shaGroups,
} from '../../../../features/dairy/exports';
import { AUDITOR_HREF, EXPORTS_HREF, UNSIGNED_EXPORT_KEY, datasetKey, exportHref, sectionKey } from '../../../../features/auditor/realm';
import { mintAuditorDownloadLinkAction } from './actions';

export const dynamic = 'force-dynamic';
export function generateMetadata(): Metadata {
  return { title: getTranslator().t('dairy.export.title.queued'), robots: { index: false, follow: false } };
}

export default async function AuditorExportJobPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  if (!env.featureAuditor) notFound();
  const id = params.id;
  await requireSession(exportHref(id));
  const t = getTranslator();
  const lang = getLang();
  const when = (iso: string | null) => (iso ? formatDate(iso, lang, { dateStyle: 'medium', timeStyle: 'short' }) : null);

  let job: ExportJob | null = null;
  let state = 'error' as ReturnType<typeof exportState> | NonNullable<ReturnType<typeof exportTransportState>>;
  try { job = await tenantClient().exportsPlane.get(id); state = exportState(job); }
  catch (e) { const err = e instanceof SdkError ? e : null; state = exportTransportState(err?.code ?? 'generic', err?.status) ?? 'error'; }
  const downloadError = downloadErrorKey(searchParams.error);
  const receipt = job?.receipt ?? null;
  const stateKey = state === 'restricted' ? 'auditor.exports.restricted' : exportStateKey(state);

  return (
    <section>
      <nav aria-label={t.t('auditor.breadcrumb')} className="kv-field__hint">
        <Link href={AUDITOR_HREF}>{t.t('auditor.title')}</Link>{' / '}<Link href={EXPORTS_HREF}>{t.t('auditor.exports.title')}</Link>{' / '}{t.t(exportTitleKey(state))}
      </nav>
      <h1>{t.t(exportTitleKey(state))}</h1>
      {job && <p>{t.t(datasetKey(job.datasetCode))}{typeof job.params.section === 'string' ? ` · ${t.t(sectionKey(job.params.section))}` : ''} · {String(job.params.from ?? '')} – {String(job.params.to ?? '')}</p>}
      <p className="kv-field__hint">{t.t('auditor.job.lead')}</p>
      <div className="kv-card kv-card--notice" role="note"><p>{t.t(UNSIGNED_EXPORT_KEY)}</p></div>

      {downloadError && (
        <div className="kv-error" role="alert"><p>{t.t(downloadError)}</p><p className="kv-field__hint">{t.t('dairy.export.refused.logged')}</p></div>
      )}

      {!job && (
        <div className={state === 'error' ? 'kv-error' : 'kv-card kv-card--notice'} role={state === 'error' ? 'alert' : 'status'}>
          <p>{t.t(stateKey)}</p>
          <p><Link href={EXPORTS_HREF} className="kv-btn kv-btn--secondary">{t.t('dairy.export.back')}</Link></p>
        </div>
      )}

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
                  return <><strong>{formatNumber(p.value, lang)} {t.t(etaUnitKey(p.unit))}</strong> <span className="kv-badge kv-badge--muted">{t.t(etaKey(job.standing!.eta))}</span></>;
                })() : <span className="kv-badge kv-badge--muted">{t.t(etaKey(job.standing.eta))}</span>}
              </dd>
            </dl>
          )}
          <p className="kv-field__hint">{t.t('dairy.export.queued.at')} {when(job.queuedAt)} · {t.t('dairy.export.requester')} <code>{job.requestedBy}</code></p>
          <p className="kv-field__hint">{t.t('auditor.job.signedLink')}</p>
          <p><Link href={exportHref(id)} className="kv-btn kv-btn--primary">{t.t('dairy.export.checkReady')}</Link>{' '}<Link href={EXPORTS_HREF} className="kv-btn kv-btn--secondary">{t.t('dairy.export.back')}</Link></p>
        </div>
      )}

      {job && state === 'failed' && (
        <div className="kv-error" role="alert">
          <p>{t.t(exportStateKey('failed'))}</p>
          <p>{t.t(failureKeyFor(job.failure?.code ?? ''))} <code>{job.failure?.code}</code></p>
          {job.failure?.detail && <p className="kv-field__hint"><code>{job.failure.detail}</code></p>}
          <p><Link href={EXPORTS_HREF} className="kv-btn kv-btn--secondary">{t.t('dairy.export.backToScreen')}</Link></p>
        </div>
      )}

      {job && receipt && (state === 'ready' || state === 'expired') && (
        <>
          <div className={state === 'expired' ? 'kv-card kv-card--notice' : 'kv-card'} role="status">
            <p>{t.t(exportStateKey(state))}</p>
            <h2>{t.t('dairy.export.receipt.title')}</h2>
            <dl className="kv-dl">
              <dt>{t.t('dairy.export.receipt.fileName')}</dt><dd><code>{receipt.fileName}</code></dd>
              <dt>{t.t('dairy.export.receipt.rowCount')}</dt><dd>{formatNumber(receipt.rowCount, lang)} <span className="kv-field__hint">{t.t('dairy.export.receipt.rowsBasis')}</span></dd>
              <dt>{t.t('dairy.export.receipt.sha256')}</dt><dd><code className="kv-mono" style={{ overflowWrap: 'anywhere' }}>{shaGroups(receipt.sha256)}</code></dd>
              <dt>{t.t('auditor.job.signature')}</dt><dd><span className="kv-badge kv-badge--muted">{t.t('auditor.exports.unsigned')}</span></dd>
              <dt>{t.t('dairy.export.receipt.generatedAt')}</dt><dd>{when(receipt.generatedAt)}</dd>
              <dt>{t.t('dairy.export.receipt.requester')}</dt><dd><code>{receipt.requestedBy}</code></dd>
              <dt>{t.t('dairy.export.receipt.size')}</dt><dd>{(() => { const b = byteParts(receipt.byteSize); return <>{formatNumber(b.value, lang)} {t.t(byteUnitKey(b.unit))}</>; })()}</dd>
              <dt>{t.t('dairy.export.receipt.expiresAt')}</dt><dd>{state === 'expired' ? <>{t.t('dairy.export.receipt.expiredAt')} {when(job.expiredAt)}</> : when(job.expiresAt)}</dd>
            </dl>
            {receipt.notes.length > 0 && (<><h3>{t.t('dairy.export.receipt.notes')}</h3><p className="kv-field__hint">{t.t('dairy.export.receipt.notesLead')}</p><ul className="kv-list">{receipt.notes.map((n) => <li key={n}>{n}</li>)}</ul></>)}
          </div>
          <div className="kv-card">
            <h2>{t.t('dairy.export.download.title')}</h2>
            {job.download.kind === 'available' ? (
              <form action={mintAuditorDownloadLinkAction} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={job.id} />
                <button type="submit" className="kv-btn kv-btn--primary" aria-describedby="link-ttl">{t.t('dairy.export.download.button')}</button>
                <p id="link-ttl" className="kv-field__hint">{t.t('dairy.export.download.ttl')} {formatNumber(Math.round(job.download.linkTtlSec / 60), lang)} {t.t('dairy.export.eta.unit.minutes')} · {t.t('dairy.export.download.logged')} · {t.t('auditor.job.signedLink')}</p>
              </form>
            ) : <p className="kv-badge kv-badge--muted">{t.t(downloadStateKey(job.download) ?? 'common.dash')}</p>}
            {job.fetches && (
              <p className="kv-field__hint">
                {t.t('dairy.export.fetches.attempts')} {formatNumber(job.fetches.attempts, lang)} · {t.t('dairy.export.fetches.served')} {formatNumber(job.fetches.served, lang)} · {t.t('dairy.export.fetches.refused')} {formatNumber(job.fetches.refused, lang)}
                {job.fetches.mismatched > 0 && <> · <span className="kv-badge kv-badge--danger">{t.t('dairy.export.fetches.mismatched')} {formatNumber(job.fetches.mismatched, lang)}</span></>}
              </p>
            )}
          </div>
          <p><Link href={EXPORTS_HREF} className="kv-btn kv-btn--primary">{t.t('dairy.export.backToScreen')}</Link></p>
        </>
      )}
    </section>
  );
}
