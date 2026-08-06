// apps/web-admin/src/app/billing/invoices/[id]/page.tsx · invoice detail + dunning history + admin actions. Server
// component: requireAdmin gates, fetches GET /v1/billing/invoices/:id + GET :id/dunning in parallel (each degrades;
// 404 → notFound). Status transitions (issue / mark-overdue / void) are surfaced ONLY when legal (features/billing
// mirrors invoice.state); run-dunning is offered while the invoice is collectible. Each is a Server-Action form
// carrying a mandatory audit reason; admin-api requires FIDO2 + step-up, so a 403 degrades to a re-auth notice.
// Money via formatMoneyMinor (minor-unit strings — never floated). No inline styles.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoneyMinor } from '@krishalaya/i18n';
import { requireAdmin } from '../../../../lib/admin-auth';
import { adminGet, AdminApiError } from '../../../../lib/admin-client';
import { DataTable, Column } from '../../../../components/DataTable';
import { getTranslator } from '../../../../lib/i18n';
import { adminNoticeKey } from '../../../../features/nav/nav-model';
import { invoiceStatusKey, canIssue, canMarkOverdue, canVoid, canDun, DUNNING_CHANNELS, DUNNING_OUTCOMES, type InvoiceRow, type DunningAttempt } from '../../../../features/billing/billing';
import {
  reconcileLines, lineVarianceMinor, gstLabelPct, hsnLabel, hsnAbsentThroughout, pdfState, invoicePdfFileName,
  type LineRow,
} from '../../../../features/billing/invoice-lines';
import { updateInvoiceAction, recordDunningAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.invoiceDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['issue', 'mark_overdue', 'void', 'dunning']);
const ERR = new Set(['reason', 'channel', 'outcome', 'note', 'elevation', 'illegal', 'notFound', 'generic']);

export default async function InvoiceDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  requireAdmin();
  const t = getTranslator();

  let inv: InvoiceRow | undefined; let notice: string | undefined;
  try { inv = (await adminGet<InvoiceRow>(`billing/invoices/${params.id}`)).data; }
  catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    notice = t.t(`notice.${adminNoticeKey(e instanceof AdminApiError ? e.status : undefined)}`);
  }

  let dunning: DunningAttempt[] = [];
  try { dunning = (await adminGet<DunningAttempt[]>(`billing/invoices/${params.id}/dunning`, { limit: 50 })).data ?? []; }
  catch { /* dunning degrades independently */ }

  if (!inv) {
    return <section><p className="kv-backlink"><Link href="/billing/invoices">{t.t('billing.backInvoices')}</Link></p><p className="kv-error" role="alert">{notice}</p></section>;
  }

  const okKey = searchParams.ok && OK.has(searchParams.ok) ? searchParams.ok : null;
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const s = invoiceStatusKey(inv.status);
  const lines: LineRow[] = inv.lineItems ?? [];
  const recon = reconcileLines(lines, inv.subtotalMinor);
  const variance = lineVarianceMinor(lines, inv.subtotalMinor);
  const pdf = pdfState(inv.pdfMediaId);

  const dunCols: Column<DunningAttempt>[] = [
    { header: t.t('billing.attempt'), cell: (d) => `#${d.attemptNo}` },
    { header: t.t('billing.channel'), cell: (d) => t.t(`billing.channel.${d.channel}`) },
    { header: t.t('billing.outcome'), cell: (d) => t.t(`billing.outcome.${d.outcome}`) },
    { header: t.t('billing.when'), cell: (d) => d.createdAt ?? t.t('common.dash') },
  ];

  return (
    <section>
      <p className="kv-backlink"><Link href="/billing/invoices">{t.t('billing.backInvoices')}</Link></p>
      <h1>{inv.invoiceNo}</h1>
      {okKey && <p className="kv-success" role="status">{t.t(`billing.ok.${okKey}`)}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`billing.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('billing.invStatus')}</dt><dd>{t.t(`billing.status.${s}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('billing.total')}</dt><dd>{formatMoneyMinor(inv.totalMinor, inv.currency)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('billing.subtotal')}</dt><dd>{formatMoneyMinor(inv.subtotalMinor, inv.currency)} + {formatMoneyMinor(inv.taxMinor, inv.currency)} {t.t('billing.tax')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('billing.dueDate')}</dt><dd>{inv.dueDate ?? t.t('common.dash')}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('billing.dunningAttempts')}</dt><dd>{inv.dunningAttempts.toLocaleString()}</dd></div>
      </dl>

      {/* WHAT WAS BILLED (PC-56 ADMIN-1, canon W013). The lines come from `saas_invoices.line_items` exactly as filed;
          nothing here re-derives GST or re-multiplies a line. When the visible lines do not add up to the filed
          subtotal, the page SAYS SO rather than letting a reader total the rows and reach a different number than the
          document — a line that could not be parsed is dropped server-side, so incompleteness is a real possibility
          and silence about it would be the actual error. */}
      <h2>{t.t('billing.linesTitle')}</h2>
      {lines.length === 0 ? <p className="kv-empty">{t.t(`billing.lines.${recon === 'unknown' ? 'unknown' : 'none'}`)}</p> : (
        <>
          <table className="kv-table">
            <thead>
              <tr>
                <th scope="col">{t.t('billing.lineDesc')}</th>
                <th scope="col">{t.t('billing.lineQty')}</th>
                <th scope="col">{t.t('billing.lineUnit')}</th>
                <th scope="col">{t.t('billing.lineHsn')}</th>
                <th scope="col">{t.t('billing.lineGst')}</th>
                <th scope="col">{t.t('billing.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={`${l.desc}-${i}`}>
                  <td>{l.desc}</td>
                  <td>{String(l.qty ?? 1)}</td>
                  <td>{formatMoneyMinor(String(l.unitMinor ?? '0'), inv.currency)}</td>
                  <td>{hsnLabel(l) ?? t.t('billing.notRecorded')}</td>
                  <td>{gstLabelPct(l) === null ? t.t('billing.notRecorded') : `${gstLabelPct(l)}%`}</td>
                  <td>{formatMoneyMinor(String(l.totalMinor ?? '0'), inv.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {hsnAbsentThroughout(lines) && <p className="kv-field__hint">{t.t('billing.hsnAbsentNote')}</p>}
          {recon === 'mismatch' && (
            <p className="kv-error" role="alert">
              {t.t('billing.lineMismatch', {
                filed: formatMoneyMinor(inv.subtotalMinor, inv.currency),
                variance: variance === null ? t.t('billing.notRecorded') : formatMoneyMinor(variance.toString(), inv.currency),
              })}
            </p>
          )}
          {recon === 'ok' && <p className="kv-field__hint">{t.t('billing.linesReconciled')}</p>}
        </>
      )}

      {/* THE PDF (canon W441) — the artefact the tenant actually received. The media id is shown because it makes the
          asset traceable; NO download button is rendered, because admin-api has no media-presign route and a button
          that 404s is worse than an honest sentence. Queued: GAP-BACKEND ADMIN-1-Q2. */}
      <h2>{t.t('billing.pdfTitle')}</h2>
      {pdf === 'generated' ? (
        <dl className="kv-facts">
          <div className="kv-facts__row"><dt>{t.t('billing.pdfState')}</dt><dd>{t.t('billing.pdf.generated')}</dd></div>
          <div className="kv-facts__row"><dt>{t.t('billing.pdfFile')}</dt><dd><code>{invoicePdfFileName(inv.invoiceNo)}</code></dd></div>
          <div className="kv-facts__row"><dt>{t.t('billing.pdfMediaId')}</dt><dd><code>{inv.pdfMediaId}</code></dd></div>
        </dl>
      ) : <p className="kv-empty">{t.t('billing.pdf.not_generated')}</p>}
      <p className="kv-field__hint">{t.t('billing.pdfNoDownloadNote')}</p>

      <h2>{t.t('billing.invActions')}</h2>
      <p className="kv-muted kv-note">{t.t('billing.invActionsNote')}</p>
      <div className="kv-action-cards">
        {canIssue(s) && <ReasonForm id={inv.id} action="issue" verb={t.t('billing.issue')} label={t.t('billing.reason')} />}
        {canMarkOverdue(s) && <ReasonForm id={inv.id} action="mark_overdue" verb={t.t('billing.markOverdue')} label={t.t('billing.reason')} />}
        {canVoid(s) && <ReasonForm id={inv.id} action="void" verb={t.t('billing.void')} label={t.t('billing.reason')} danger />}
        {!canIssue(s) && !canMarkOverdue(s) && !canVoid(s) && <p className="kv-muted">{t.t('billing.invTerminal')}</p>}
      </div>

      {canDun(s) && (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('billing.runDunning')}</summary>
          <form action={recordDunningAction} className="kv-form">
            <input type="hidden" name="id" value={inv.id} />
            <label htmlFor="channel" className="kv-field__label">{t.t('billing.channel')}</label>
            <select id="channel" name="channel" className="kv-input" defaultValue="email">
              {DUNNING_CHANNELS.map((c) => <option key={c} value={c}>{t.t(`billing.channel.${c}`)}</option>)}
            </select>
            <label htmlFor="outcome" className="kv-field__label">{t.t('billing.outcome')}</label>
            <select id="outcome" name="outcome" className="kv-input" defaultValue="sent">
              {DUNNING_OUTCOMES.map((o) => <option key={o} value={o}>{t.t(`billing.outcome.${o}`)}</option>)}
            </select>
            <label htmlFor="dunNote" className="kv-field__label">{t.t('billing.note')}</label>
            <input id="dunNote" name="note" className="kv-input" maxLength={1000} />
            <button type="submit" className="kv-btn">{t.t('billing.runDunningSubmit')}</button>
          </form>
        </details>
      )}

      <h2>{t.t('billing.dunningHistory')}</h2>
      <DataTable columns={dunCols} rows={dunning} empty={t.t('billing.noDunning')} />
    </section>
  );
}

function ReasonForm({ id, action, verb, label, danger }: { id: string; action: string; verb: string; label: string; danger?: boolean }) {
  return (
    <form action={updateInvoiceAction} className="kv-card kv-action-card">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <label className="kv-field__label">{label}</label>
      <input name="reason" className="kv-input" required minLength={3} maxLength={1000} />
      <button type="submit" className={`kv-btn${danger ? ' kv-btn--danger' : ''}`}>{verb}</button>
    </form>
  );
}
