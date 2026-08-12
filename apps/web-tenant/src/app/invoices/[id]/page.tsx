// apps/web-tenant/src/app/invoices/[id]/page.tsx · W152, the invoice document (PC-56 TENANT-3c-1).
// Server-first, requireSession-gated; notFound() on a missing id or a caller without finance scope (the API answers
// 404 either way — no enumeration). All copy via i18n; noindex.
//
// THE DOCUMENT'S FOUR STATUTORY FIELDS ARE PRINTED AS FACTS OR AS ABSENCES, NEVER AS DECORATION:
//   • the gapless number (UNIQUE tenant + invoice_no, its own series);
//   • the place of supply AND the supply type — 'unknown' says so rather than showing intra-state;
//   • the HSN and rate per line, with the CITATION where one is recorded and "citation not recorded" where none is;
//   • what can and cannot be filed, so nobody discovers it at export time.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../lib/session';
import { tenantClient } from '../../../lib/api-client';
import { tenantHasPerm } from '../../../lib/auth';
import { getTranslator, getLang } from '../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { rateBasisKey, supplyKey, filableState, remainingMinor, creditNoteBlockedBy } from '../../../features/invoices/console';
import { issueCreditNoteAction } from '../actions';
import { CREDIT_NOTE_REASON_CODES } from '../../../features/invoices/reasons';
import type { TradeInvoiceDetail } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('invd.title'), robots: { index: false, follow: false } };
}

const ERR = new Set(['reason', 'reasonShort', 'approval', 'noApproval', 'notApproved', 'exceeds', 'noBreakdown', 'alreadyIssued', 'forbidden', 'generic']);

export default async function InvoiceDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { ok?: string; error?: string } }) {
  await requireSession(`/invoices/${params.id}`);
  const t = getTranslator();
  const lang = getLang();
  const canFinance = tenantHasPerm('report.view');

  let inv: TradeInvoiceDetail;
  try { inv = await tenantClient().payments.invoices.detail(params.id); }
  catch { notFound(); }

  const money = (minor: string | null | undefined) => (minor ? formatMoneyMinor(minor, 'INR', lang) : t.t('common.dash'));
  const errKey = searchParams.error && ERR.has(searchParams.error) ? searchParams.error : null;
  const blocked = creditNoteBlockedBy(inv, { canFinance });
  const filable = filableState(inv);

  return (
    <section>
      <div className="kv-page-head">
        <h1>{t.t('invd.heading', { no: inv.invoiceNo })}</h1>
        <Link href="/invoices" className="kv-btn--link">← {t.t('inv.title')}</Link>
      </div>
      <p className="kv-field__hint">{t.t('invd.immutable')}</p>

      {searchParams.ok === 'credited' && <p className="kv-success" role="status">{t.t('invd.creditIssued')}</p>}
      {errKey && <p className="kv-error" role="alert">{t.t(`invd.error.${errKey}`)}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('invd.order')}</dt><dd><Link href={`/orders/${inv.orderId}`} className="kv-link">{inv.orderNo ?? inv.orderId}</Link></dd></div>
        <div className="kv-facts__row"><dt>{t.t('invd.issued')}</dt><dd>{formatDate(String(inv.issuedAt ?? inv.createdAt), lang)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('invd.sellerGstin')}</dt><dd className="kv-mono">{inv.sellerGstin ?? t.t('inv.gstinNotRecorded')}</dd></div>
        {/* 0140 DEFECT 6: the platform stores only a MASK for a buyer (0058), so there is nothing to "reveal" and the
            page says that instead of offering a control that cannot work. */}
        <div className="kv-facts__row"><dt>{t.t('invd.buyerGstin')}</dt><dd className="kv-mono">{inv.buyerGstin ?? t.t('inv.gstinNotRecorded')}</dd>{inv.buyerGstin && <dd className="kv-muted">{t.t('invd.maskedOnly')}</dd>}</div>
        <div className="kv-facts__row"><dt>{t.t('invd.placeOfSupply')}</dt><dd>{inv.placeOfSupplyCode ?? t.t('invd.placeUnknown')} · {t.t(`inv.supply.${supplyKey(inv.supplyType)}`)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('invd.irn')}</dt><dd className="kv-muted">{t.t('invd.irnPending')}</dd></div>
      </dl>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('invd.lines')}</h2>
        {!inv.lines || inv.lines.length === 0 ? (
          // Every pre-0140 invoice. The document exists and the buyer holds it; the breakdown was never recorded and
          // is not re-derivable, so this says so rather than rendering an empty table as though the invoice had no
          // lines at all.
          <p className="kv-muted">{t.t('invd.linesNotRecorded')}</p>
        ) : (
          <table className="kv-table">
            <thead>
              <tr>
                <th>{t.t('invd.colItem')}</th><th>{t.t('invd.colHsn')}</th><th>{t.t('invd.colTaxable')}</th>
                <th>{t.t('invd.colRate')}</th><th>{t.t('invd.colTax')}</th><th>{t.t('invd.colAmount')}</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l) => (
                <tr key={l.key}>
                  <td>{t.t(`invd.line.${l.key}`)}</td>
                  <td className="kv-mono">{l.hsn ?? t.t('common.dash')}</td>
                  <td>{BigInt(l.taxableMinor) > 0n ? money(l.taxableMinor) : <span className="kv-muted">{t.t(`invd.rateBasis.${rateBasisKey(l.rateBasis)}`)}</span>}</td>
                  <td className="kv-mono">{l.rateBps > 0 ? `${(l.rateBps / 100).toFixed(2)}%` : t.t('common.dash')}</td>
                  <td>{money(l.taxMinor)}</td>
                  <td>{money(l.grossMinor)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={5}><strong>{t.t('invd.total')}</strong></td>
                <td><strong>{money(inv.totalMinor)}</strong></td>
              </tr>
            </tbody>
          </table>
        )}
        {/* The invariant, stated on the document: the invoice total IS the buyer's payment, and the tax inside it was
            extracted rather than added — see 0140 DEFECT 3 for why that is a named choice and not an accident. */}
        <p className="kv-field__hint">{t.t('invd.inclusiveNote')}</p>
        {filable !== 'filable' && <p className="kv-notice" role="note">{t.t(`inv.notFilable.${filable}`)}</p>}
      </div>

      <div className="kv-card">
        <h2 className="kv-card__title">{t.t('invd.corrections')}</h2>
        <p className="kv-field__hint">{t.t('invd.correctionsNote')}</p>
        {inv.creditNotes.length === 0 ? (
          <p className="kv-muted">{t.t('invd.noCorrections')}</p>
        ) : (
          <ul className="kv-thread">
            {inv.creditNotes.map((c) => (
              <li key={c.id} className="kv-thread__item">
                <span className="kv-mono">{c.creditNoteNo}</span>
                <span>{money(c.totalMinor)}</span>
                <span className="kv-badge">{t.t(`invd.reason.${c.reasonCode}`) || c.reasonCode}</span>
                <span className="kv-muted">{formatDate(c.issuedAt, lang)}</span>
                <p className="kv-review__body">{c.reasonText}</p>
              </li>
            ))}
            <li className="kv-thread__item"><strong>{t.t('invd.remainingLabel', { amount: money(remainingMinor(inv)) })}</strong></li>
          </ul>
        )}

        {blocked ? (
          <p className="kv-notice" role="note">{t.t(`invd.creditBlocked.${blocked}`)}</p>
        ) : (
          <form action={issueCreditNoteAction} className="kv-form">
            <input type="hidden" name="invoiceId" value={inv.id} />
            {/* THE APPROVAL IS THE AUTHORITY AND THE AMOUNT. It is proposed and signed on the refund plane (0139,
                widened by 0140), so this form takes its id rather than a figure a single operator could type. */}
            <label className="kv-field__label" htmlFor="approvalId">{t.t('invd.approvalId')}</label>
            <input id="approvalId" name="approvalId" className="kv-input" required />
            <p className="kv-field__hint">{t.t('invd.approvalHint')}</p>
            <label className="kv-field__label" htmlFor="reasonCode">{t.t('invd.reasonCode')}</label>
            <select id="reasonCode" name="reasonCode" className="kv-select" defaultValue="quantity_short">
              {CREDIT_NOTE_REASON_CODES.map((r) => <option key={r} value={r}>{t.t(`invd.reason.${r}`)}</option>)}
            </select>
            <label className="kv-field__label" htmlFor="reasonText">{t.t('invd.reasonText')}</label>
            <textarea id="reasonText" name="reasonText" className="kv-textarea" rows={2} minLength={20} maxLength={2000} required />
            <p className="kv-field__hint">{t.t('invd.reasonTextHint')}</p>
            <button type="submit" className="kv-btn">{t.t('invd.issueCta')}</button>
          </form>
        )}
      </div>
    </section>
  );
}
