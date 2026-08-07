// apps/web-admin/src/app/analytics/exports/page.tsx · W2126 / W2127 (PC-56 ADMIN-10).
//
// **THE RECEIPT LAW, WITH BOTH HALVES, FOR THE FIRST TIME.** W2127 spells the receipt out: "file name, row count,
// sha256, generated-at, requester — delivery via 15-min signed URL, every fetch logged." Six export surfaces on this
// platform compute the digest; ADMIN-5c wrote `watermarkPreamble()` and `withWatermark()` to close the other half and
// **no production file has ever called them** — the fix existed, was correct, and was unreachable.
//
// AND "EVERY FETCH LOGGED" IS INCOMPATIBLE WITH A PRESIGNED URL: a presigned link is fetched from S3, so the platform
// never sees the download. This plane serves its own bytes instead — these are small aggregates, not tenant dumps — and
// every fetch is a row with the digest RE-COMPUTED over what was delivered. The presigned surfaces elsewhere cannot make
// that promise and this page says which.
//
// THE QUEUED STATE IS HONEST TOO: W2126 promises a position and an ETA. Exports here are synchronous, and a queue with
// a position nothing enqueues into would be the seventh status-recording-an-act-nobody-performs (ADMIN-10-Q1).
import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../lib/admin-client';
import { getTranslator } from '../../../lib/i18n';
import { exportReportAction } from '../actions';
import {
  deliveryKey, metricKey, mismatchClass, mismatchKey, receiptComplete, truncatedKey, watermarkKey,
} from '../../../features/reports/dashboard';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('rp.exports.title'), robots: { index: false, follow: false } };
}

interface Receipt {
  id: string; report: string; generatedAt: string; generatedByAdminId: string; rowCount: number;
  truncated: boolean; fileName: string; contentSha256: string; digestBasis: string;
  watermarked: boolean; piiMasked: boolean | null; objectKey: string | null;
}
interface Meta { digestMismatches: number; fetchLogging: string }

export default async function ExportsPage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let rows: Receipt[] = []; let meta: Meta | undefined; let notice: string | undefined;
  try {
    const res = await adminGet<Receipt[]>('reports/exports/receipts');
    rows = res.data ?? []; meta = res.meta as unknown as Meta;
  } catch (e) {
    notice = e instanceof AdminApiError && e.status === 403 ? 'rp.restricted.exports' : 'rp.error.exports';
  }

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/dashboard">{t.t('nav.dashboard')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/analytics/reports">{t.t('rp.builder.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{t.t('rp.exports.title')}</span>
      </nav>

      <header className="kv-page__head">
        <h1>{t.t('rp.exports.title')}</h1>
        <p className="kv-page__sub">{t.t('rp.exports.sub')}</p>
      </header>

      {notice ? <p className="kv-note is-danger" role="alert">{t.t(notice)}</p> : null}
      {searchParams.ok ? <p className="kv-note is-ok" role="status">{t.t(`rp.ok.${searchParams.ok}`)}</p> : null}
      {searchParams.error ? <p className="kv-note is-danger" role="alert">{t.t(`rp.err.${searchParams.error}`)}</p> : null}

      {/* THE DELIVERY CONTRACT, first — it qualifies every row below. */}
      <p className="kv-note">{t.t(deliveryKey(false))}</p>
      {meta ? <p className="kv-note">{meta.fetchLogging}</p> : null}
      {meta ? (
        <p className={mismatchClass(meta.digestMismatches)}>
          {t.t(mismatchKey(meta.digestMismatches), { n: String(meta.digestMismatches) })}
        </p>
      ) : null}

      <section className="kv-panel" aria-labelledby="rp-new">
        <h2 id="rp-new" className="kv-panel__title">{t.t('rp.exports.new')}</h2>
        <form action={exportReportAction}>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="rpx-metric">{t.t('rp.builder.metric')}</label>
            <select className="kv-input" id="rpx-metric" name="metric" defaultValue="gmv_minor">
              {['orders', 'gmv_minor', 'new_tenants', 'new_users', 'dbt_minor'].map((m) => (
                <option key={m} value={m}>{t.t(metricKey(m))}</option>
              ))}
            </select>
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="rpx-from">{t.t('rp.builder.from')}</label>
            <input className="kv-input" id="rpx-from" name="from" type="date" defaultValue={monthAgo} required />
          </div>
          <div className="kv-field">
            <label className="kv-field__label" htmlFor="rpx-to">{t.t('rp.builder.to')}</label>
            <input className="kv-input" id="rpx-to" name="to" type="date" defaultValue={today} required />
          </div>
          <input type="hidden" name="bucket" value="day" />
          <p className="kv-field__help">{t.t('rp.exports.permission')}</p>
          <button className="kv-btn" type="submit">{t.t('rp.exports.generate')}</button>
        </form>
      </section>

      {rows.length === 0 && !notice ? (
        <div className="kv-empty">
          <h2>{t.t('rp.exports.empty.title')}</h2>
          {/* Recording began with this release, so an empty list is the absence of a record rather than a clean history
              — the same distinction the residency log and the step-up log had to make. */}
          <p>{t.t('rp.exports.empty.body')}</p>
        </div>
      ) : (
        <table className="kv-table">
          <caption className="kv-table__caption">{t.t('rp.exports.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{t.t('rp.exports.file')}</th>
              <th scope="col">{t.t('rp.exports.report')}</th>
              <th scope="col">{t.t('rp.exports.rows')}</th>
              <th scope="col">{t.t('rp.exports.digest')}</th>
              <th scope="col">{t.t('rp.exports.mark')}</th>
              <th scope="col">{t.t('rp.exports.when')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/analytics/exports/${encodeURIComponent(r.id)}`}>{r.fileName}</Link>
                  {/* A receipt missing a field is a receipt that does not answer the question it exists for. */}
                  {!receiptComplete({ ...r, generatedBy: r.generatedByAdminId })
                    ? <><br /><small className="is-danger">{t.t('rp.exports.incomplete')}</small></> : null}
                </td>
                <td>{r.report}</td>
                <td>
                  {r.rowCount.toLocaleString('en-IN')}
                  <br /><small>{t.t(truncatedKey(r.truncated))}</small>
                </td>
                <td>
                  <span className="kv-mono">{r.contentSha256.slice(0, 12)}…</span>
                  {/* WHAT THE DIGEST COVERS, beside it. A hash whose basis is unrecorded cannot be re-derived by anybody
                      who did not write the code, which makes it a decoration. */}
                  <br /><small>{r.digestBasis}</small>
                </td>
                <td>
                  <span className={r.watermarked ? 'kv-badge is-ok' : 'kv-badge is-warn'}>
                    {t.t(watermarkKey(r.watermarked))}
                  </span>
                </td>
                <td>{r.generatedAt.slice(0, 16).replace('T', ' ')}<br /><small>{r.generatedByAdminId.slice(0, 8)}</small></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
