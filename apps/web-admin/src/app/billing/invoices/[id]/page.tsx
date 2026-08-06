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
import { hasPdfLink, humanBytes, type PdfLink } from '../../../../features/billing/subscription-write';
import {
  PAYMENT_METHODS, canRecordPayment, payableBlockedReason, reversedIds, canReverse, reverseBlockedReason,
  isReversal, isOverpaid, isSettled, type PaymentRow,
} from '../../../../features/billing/money-controls';
import { updateInvoiceAction, recordDunningAction, recordPaymentAction, reversePaymentAction } from '../../actions';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('billing.invoiceDetailTitle'), robots: { index: false, follow: false } };
}

const OK = new Set(['issue', 'mark_overdue', 'void', 'dunning', 'payment', 'reversed']);
const ERR = new Set(['reason', 'channel', 'outcome', 'note', 'elevation', 'illegal', 'notFound', 'generic',
  'pay_amount', 'pay_reference', 'pay_method', 'pay_receivedAt', 'pay_future', 'pay_currency']);

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

  // PC-56 ADMIN-1b · the money actually received (0092). Degrades independently: if this read fails the page still
  // shows the invoice, and the payments section says it could not be loaded rather than implying nothing was paid —
  // "no payments shown" and "no payments received" must never look the same on a collections screen.
  interface PaymentsView { currency?: string; totalMinor?: string; paidMinor?: string; outstandingMinor?: string; overpaidMinor?: string; payments?: PaymentRow[] }
  let money: PaymentsView | null = null; let moneyFailed = false;
  try { money = (await adminGet<PaymentsView>(`billing/invoices/${params.id}/payments`)).data ?? null; }
  catch { moneyFailed = true; }

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

  // PC-56 ADMIN-1c (ADMIN-1-Q2): mint the download link only when a PDF exists. The link is short-lived and minted
  // per render, so it is never cached into a page a screenshot could outlive. A failure here degrades to "not
  // available" — the invoice page must not break because storage is unconfigured in this deploy.
  let pdfLink: PdfLink | null = null;
  if (pdf === 'generated') {
    try { pdfLink = (await adminGet<PdfLink>(`billing/invoices/${params.id}/pdf`)).data ?? null; }
    catch { pdfLink = null; }
  }

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

      {/* WHAT WAS RECEIVED (PC-56 ADMIN-1b, canon W013 payments panel — closes ADMIN-1-Q1). Before migration 0092
          the platform had nowhere to record this, so `partially_paid` meant "some unknown amount". Every figure below
          comes from the server's own SUM over the payment rows — the same sum that drove the invoice's status — and
          none of it is recomputed here, because a page that derives money a second way eventually disagrees with the
          invoice it is displaying. */}
      <h2>{t.t('pay.title')}</h2>
      {moneyFailed ? <p className="kv-error" role="alert">{t.t('pay.loadError')}</p> : money && (
        <>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('pay.received')}</dt><dd>{formatMoneyMinor(String(money.paidMinor ?? '0'), inv.currency)}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('pay.outstanding')}</dt><dd>
              {isSettled(money)
                ? <span className="kv-status kv-status--ok">{t.t('pay.settled')}</span>
                : <strong>{formatMoneyMinor(String(money.outstandingMinor ?? '0'), inv.currency)}</strong>}
            </dd></div>
            {isOverpaid(money) && (
              <div className="kv-facts__row"><dt>{t.t('pay.overpaid')}</dt><dd>
                <span className="kv-status kv-status--warn">{formatMoneyMinor(String(money.overpaidMinor), inv.currency)}</span>
              </dd></div>
            )}
          </dl>
          {/* An overpayment is kept, never clamped — and it is said out loud, because the tenant will ask. */}
          {isOverpaid(money) && <p className="kv-notice" role="note">{t.t('pay.overpaidNote')}</p>}

          {(money.payments ?? []).length === 0 ? <p className="kv-empty">{t.t('pay.none')}</p> : (
            <ul className="kv-list" role="list">
              {(() => {
                const rows = money.payments ?? [];
                const reversed = reversedIds(rows);
                return rows.map((pmt) => (
                  <li key={pmt.id} className="kv-card">
                    <p className="kv-card__title">
                      {formatMoneyMinor(String(pmt.amountMinor ?? '0'), pmt.currency ?? inv.currency)}
                      {' '}<span className={`kv-status ${isReversal(pmt) ? 'kv-status--danger' : 'kv-status--ok'}`}>
                        {t.t(isReversal(pmt) ? 'pay.reversalLabel' : `pay.method.${String(pmt.method)}`)}
                      </span>
                    </p>
                    <p className="kv-detail__muted">
                      {t.t('pay.reference')}: <code>{pmt.reference}</code>
                      {pmt.receivedAt ? ` · ${t.t('pay.receivedOn')} ${pmt.receivedAt}` : ''}
                      {pmt.walletTxnId ? ` · ${t.t('pay.viaWallet')}` : ''}
                    </p>
                    {pmt.note && <p className="kv-detail__muted">{pmt.note}</p>}
                    {canReverse(pmt, reversed) ? (
                      <details className="kv-limit-form">
                        <summary>{t.t('pay.reverse')}</summary>
                        <p className="kv-field__hint">{t.t('pay.reverseHint')}</p>
                        <form action={reversePaymentAction} className="kv-form">
                          <input type="hidden" name="invoiceId" value={inv.id} />
                          <input type="hidden" name="paymentId" value={String(pmt.id ?? '')} />
                          <label htmlFor={`rv-${pmt.id}`} className="kv-field__label">{t.t('billing.reason')}</label>
                          <input id={`rv-${pmt.id}`} name="reason" className="kv-input" required minLength={3} maxLength={1000} />
                          <button type="submit" className="kv-btn kv-btn--danger">{t.t('pay.reverseSubmit')}</button>
                        </form>
                      </details>
                    ) : (
                      <p className="kv-detail__muted">{t.t(`pay.reverseBlocked.${reverseBlockedReason(pmt, reversed)}`)}</p>
                    )}
                  </li>
                ));
              })()}
            </ul>
          )}
        </>
      )}

      {/* Recording a receipt. The CURRENCY is a hidden field carrying the invoice's own — never a selector, because
          the server (correctly) refuses a mismatched currency and there is no reason to let someone discover that
          after typing everything. The status gate mirrors `assertPayable` and NAMES the reason when it blocks. */}
      {canRecordPayment(inv.status) ? (
        <details className="kv-card kv-limit-form">
          <summary className="kv-card__title">{t.t('pay.recordTitle')}</summary>
          <p className="kv-field__hint">{t.t('pay.recordHint')}</p>
          <form action={recordPaymentAction} className="kv-form">
            <input type="hidden" name="id" value={inv.id} />
            <input type="hidden" name="currency" value={inv.currency} />
            <label htmlFor="pay-amount" className="kv-field__label">{t.t('pay.amount', { currency: inv.currency })}</label>
            <input id="pay-amount" name="amountMajor" className="kv-input" required inputMode="decimal" placeholder="4990.00" />
            <label htmlFor="pay-method" className="kv-field__label">{t.t('pay.methodLabel')}</label>
            <select id="pay-method" name="method" className="kv-input" defaultValue="bank_transfer">
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{t.t(`pay.method.${m}`)}</option>)}
            </select>
            <label htmlFor="pay-ref" className="kv-field__label">{t.t('pay.reference')}</label>
            <input id="pay-ref" name="reference" className="kv-input" required minLength={3} maxLength={120} placeholder="UTR / cheque no" />
            <p className="kv-field__hint">{t.t('pay.referenceHint')}</p>
            <label htmlFor="pay-at" className="kv-field__label">{t.t('pay.receivedAt')}</label>
            <input id="pay-at" name="receivedAt" className="kv-input" required type="datetime-local" />
            <label htmlFor="pay-note" className="kv-field__label">{t.t('billing.note')}</label>
            <input id="pay-note" name="note" className="kv-input" maxLength={1000} />
            <button type="submit" className="kv-btn">{t.t('pay.recordSubmit')}</button>
          </form>
        </details>
      ) : (
        <p className="kv-notice" role="note">{t.t(`pay.blocked.${payableBlockedReason(inv.status)}`)}</p>
      )}

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
        <>
          <dl className="kv-facts">
            <div className="kv-facts__row"><dt>{t.t('billing.pdfState')}</dt><dd>{t.t('billing.pdf.generated')}</dd></div>
            <div className="kv-facts__row"><dt>{t.t('billing.pdfFile')}</dt><dd><code>{pdfLink?.fileName ?? invoicePdfFileName(inv.invoiceNo)}</code></dd></div>
            <div className="kv-facts__row"><dt>{t.t('billing.pdfMediaId')}</dt><dd><code>{inv.pdfMediaId}</code></dd></div>
          </dl>
          {hasPdfLink(pdfLink) ? (
            <p>
              {/* Plain <a>: a presigned S3 URL, not an app route. Downloading is audited server-side (who minted a
                  link for whose tax document), which is why the link comes from the API and is not built here. */}
              <a className="kv-btn" href={String(pdfLink?.url)} download={pdfLink?.fileName ?? undefined}
                target="_blank" rel="noopener noreferrer">
                {t.t('billing.pdfDownload')}
                {humanBytes(pdfLink?.bytes) ? ` · ${humanBytes(pdfLink?.bytes)}` : ''}
              </a>
              <span className="kv-field__hint"> {t.t('billing.pdfExpiry', { n: String(pdfLink?.expiresInSec ?? 0) })}</span>
            </p>
          ) : (
            // storage unconfigured in this deploy, or the link could not be minted — said plainly, because "no
            // download button" must not be read as "no document"
            <p className="kv-notice" role="note">{t.t('billing.pdfLinkUnavailable')}</p>
          )}
        </>
      ) : <p className="kv-empty">{t.t('billing.pdf.not_generated')}</p>}

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
