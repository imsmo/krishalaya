// apps/web-admin/src/app/recon/settlements/[id]/page.tsx · W063 + W442 (PC-56 ADMIN-6b).
//
// Two canon screens on one route, deliberately. W063 is the statement detail (order lines, the money flow, the payout it
// leads to) and W442 is the statement PDF facsimile with its hash anchor. They describe the same object and the same
// arithmetic; the difference is that W442 renders it as a document. A separate route would be a second page reading the
// same row and asserting the same sum — and if the two ever disagreed, a reader would have no way to know which was
// right. The PDF panel below is W442's content, on the record it belongs to.
//
// THE ARITHMETIC IS RECOMPUTED, NOT TRUSTED. W442's claim is "the arithmetic below is the ledger's, to the rupee".
// `SettlementStatement.fromAggregate` validates it at GENERATION time in apps/api, which protects rows written through
// that path and says nothing about a row edited afterwards, restored from a backup, or written by earlier code. A
// document whose whole assertion is its own arithmetic should have that arithmetic checked where it is displayed.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { getTranslator } from '../../../../lib/i18n';
import { Callout, EmptyState, StatusPill } from '@krishalaya/ui';
import {
  balanceTone, balanceKey, formatMinor, lineAgreementKey, pdfTone, pdfKey, shortHash,
} from '../../../../features/payouts/payouts';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('po.stmt.title'), robots: { index: false, follow: false } };
}

interface Detail {
  id: string; tenantId: string; sellerUserId: string; statementNo: string;
  periodStart: string; periodEnd: string;
  grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string;
  equation: string;
  balanced: boolean;
  balanceDetail: { storedNetMinor: string; computedNetMinor: string; driftMinor: string } | null;
  pdf: { kind: 'not_generated' | 'never_hashed' | 'anchored' | 'mismatch'; mediaId?: string; sha256?: string; at?: string; expected?: string; actual?: string };
  runId: string | null;
  lines: {
    id: string; orderId: string; grossMinor: string; commissionMinor: string; gstMinor: string; tdsMinor: string;
    netMinor: string; createdAt: string;
  }[];
  lineTotals: { count: number; grossMinor: string; netMinor: string; agreesWithStatement: boolean };
  linesTruncated: boolean;
  createdAt: string;
  display: { gross: string; commission: string; tax: string; net: string };
}

export default async function SettlementStatementPage({ params }: { params: { id: string } }) {
  requireAdmin();
  const t = getTranslator();

  let d: Detail | null = null; let notice: string | undefined;
  try {
    const res = await adminGet<Detail | null>(`payouts/settlement/statements/${encodeURIComponent(params.id)}`);
    d = res.data ?? null;
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = e instanceof AdminApiError && e.status === 403 ? 'po.restricted.stmt' : 'po.error.stmt';
  }
  if (!d && !notice) notFound();

  const lineNote = d ? lineAgreementKey(d.lineTotals.agreesWithStatement, d.lineTotals.count) : null;

  return (
    <main className="kv-page">
      <nav className="kv-breadcrumb" aria-label={t.t('nav.breadcrumb')}>
        <Link href="/recon">{t.t('nav.recon')}</Link> <span aria-hidden="true">/</span>{' '}
        <Link href="/recon/settlements">{t.t('po.stl.title')}</Link> <span aria-hidden="true">/</span>{' '}
        <span>{d?.statementNo ?? params.id.slice(0, 8)}</span>
      </nav>

      {notice ? <Callout tone="danger" live="assertive">{t.t(notice)}</Callout> : null}

      {d ? (
        <>
          <header className="kv-page__head">
            <h1>{d.statementNo}</h1>
            <p className="kv-page__sub">
              {t.t('po.stmt.sub', {
                seller: d.sellerUserId.slice(0, 8), from: d.periodStart, to: d.periodEnd,
                lines: String(d.lineTotals.count),
              })}
            </p>
          </header>

          {/* ---------------- THE ARITHMETIC ---------------- */}
          <section className="kv-panel" aria-labelledby="po-sum">
            <h2 id="po-sum" className="kv-panel__title">{t.t('po.stmt.sum')}</h2>
            <dl className="kv-stat-row">
              <div><dt>{t.t('po.col.gross')}</dt><dd>{d.display.gross}</dd></div>
              <div><dt>{t.t('po.col.commission')}</dt><dd>−{d.display.commission}</dd></div>
              <div><dt>{t.t('po.col.tax')}</dt><dd>−{d.display.tax}</dd></div>
              <div><dt>{t.t('po.col.net')}</dt><dd>{d.display.net}</dd></div>
            </dl>
            {/* PRINTED AS ARITHMETIC A READER CAN CHECK BY EYE, which is the point of showing it rather than a tick —
                the same argument as W065's zero-sum equation on a ledger transaction. */}
            <p className="kv-pre">{d.equation}</p>
            <p>
              <StatusPill tone={balanceTone(d.balanced)} label={t.t(balanceKey(d.balanced))} />
            </p>
            {d.balanceDetail ? (
              <Callout tone="danger" live="assertive">
                {t.t('po.stmt.drift', {
                  stored: formatMinor(d.balanceDetail.storedNetMinor),
                  computed: formatMinor(d.balanceDetail.computedNetMinor),
                })}
              </Callout>
            ) : null}
          </section>

          {/* ---------------- W442 · THE PDF ANCHOR ---------------- */}
          <section className="kv-panel" aria-labelledby="po-pdf">
            <h2 id="po-pdf" className="kv-panel__title">{t.t('po.pdf.title')}</h2>
            <p><StatusPill tone={pdfTone(d.pdf.kind)} label={t.t(pdfKey(d.pdf.kind))} /></p>
            {/* `never_hashed` IS THE STATE ALMOST EVERY EXISTING STATEMENT IS IN, and the screen says so rather than
                printing "signed" over nothing. W442 called the PDF "hash-anchored to the zero-sum ledger" and until
                0114 there was no column to anchor it in — so the mismatch state it documents could not be represented,
                let alone detected. */}
            {d.pdf.kind === 'anchored' ? (
              <dl className="kv-stat-row">
                <div><dt>{t.t('po.pdf.sha')}</dt><dd className="kv-pre">{shortHash(d.pdf.sha256)}</dd></div>
                <div><dt>{t.t('po.pdf.at')}</dt><dd>{(d.pdf.at ?? '').slice(0, 16).replace('T', ' ')}</dd></div>
              </dl>
            ) : null}
            {d.pdf.kind === 'never_hashed' ? <Callout tone="warning">{t.t('po.pdf.neverHashedNote')}</Callout> : null}
            {d.pdf.kind === 'mismatch' ? (
              <Callout tone="danger" live="assertive">
                {t.t('po.pdf.mismatchNote', {
                  expected: shortHash(d.pdf.expected), actual: shortHash(d.pdf.actual),
                })}
              </Callout>
            ) : null}
            {/* NO DOWNLOAD BUTTON, and the absence is named. W442 describes "delivery via 15-min signed URL,
                audit-logged per fetch"; admin-api has no media-presign route (media and S3 live in apps/api), which is
                the ADMIN-1-Q2 gap still open. A button that 404s is worse than a line saying where the file is. */}
            {d.pdf.kind !== 'not_generated' ? <Callout tone="info">{t.t('po.pdf.noDownload')}</Callout> : null}
          </section>

          {/* ---------------- THE ORDER LINES ---------------- */}
          {lineNote ? <Callout tone="danger" live="assertive">{t.t(lineNote)}</Callout> : null}
          {d.linesTruncated ? <Callout tone="warning">{t.t('po.stmt.linesTruncated')}</Callout> : null}

          {d.lines.length === 0 ? (
            <EmptyState variant="empty" title={t.t('po.stmt.noLines.title')} body={t.t('po.stmt.noLines.body')} />
          ) : (
            <table className="kv-table">
              <caption className="kv-table__caption">{t.t('po.stmt.lines', { n: String(d.lineTotals.count) })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t.t('po.col.order')}</th>
                  <th scope="col">{t.t('po.col.gross')}</th>
                  <th scope="col">{t.t('po.col.commission')}</th>
                  <th scope="col">{t.t('po.col.gst')}</th>
                  <th scope="col">{t.t('po.col.tds')}</th>
                  <th scope="col">{t.t('po.col.net')}</th>
                </tr>
              </thead>
              <tbody>
                {d.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.orderId.slice(0, 8)}</td>
                    <td>{formatMinor(l.grossMinor)}</td>
                    <td>{formatMinor(l.commissionMinor)}</td>
                    <td>{formatMinor(l.gstMinor)}</td>
                    <td>{formatMinor(l.tdsMinor)}</td>
                    <td>{formatMinor(l.netMinor)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t.t('po.stmt.lineTotal')}</th>
                  <td>{formatMinor(d.lineTotals.grossMinor)}</td>
                  <td colSpan={3} />
                  <td>{formatMinor(d.lineTotals.netMinor)}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* THE LEDGER TXN. W063 offers "View ledger txn" and shows the zero-sum legs. `settlement_statements` carries
              no `ledger_txn_id` — the money moves are attributed through `settlement_lines` per order, not through one
              transaction per statement — so this links to the explorer scoped to the period rather than to a txn id
              this row does not have. Named rather than faked: a "View txn" button resolving to nothing would be the
              claim-with-nothing-behind-it pattern in its smallest form. */}
          <Callout tone="info">
            {t.t('po.stmt.noTxnLink')}{' '}
            <Link href={`/recon/ledger?from=${encodeURIComponent(d.periodStart)}&to=${encodeURIComponent(d.periodEnd)}&txnType=settlement`}>
              {t.t('po.stmt.openLedger')}
            </Link>
          </Callout>
        </>
      ) : null}
    </main>
  );
}
