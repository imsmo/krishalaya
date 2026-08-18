// apps/web-tenant/src/app/billing/invoices/[id]/page.tsx · one SaaS invoice, its lines and its RECEIPTS
// (PC-56 TENANT-4d-2 — W2429/W2430). Server-first, requireSession-gated, noindex, every string via i18n.
//
// THE RECEIPT LIST IS THE POINT. 0092 made `saas_invoice_payments` append-only so a tenant disputing a balance
// could see what we believe arrived, when, and with what reference — and until this wave the tenant realm wrote
// no rows to it at all for gateway captures, so there was nothing to show and nothing to dispute against. A
// balance a tenant cannot audit is a balance they have to take on trust, which is the thing Rule Zero spends.
//
// W2430's Retry is a re-POST of the same server action: the idempotency key carries the invoice AND the
// outstanding amount, so pressing Retry reuses the same gateway order while the amount is unchanged and opens a
// fresh one once it is not. Nothing here marks the invoice paid — only a relayed capture does that.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireSession } from '../../../../lib/session';
import { tenantClient } from '../../../../lib/api-client';
import { tenantHasPerm } from '../../../../lib/auth';
import { DataTable } from '../../../../components/DataTable';
import { getTranslator, getLang } from '../../../../lib/i18n';
import { formatMoneyMinor, formatDate } from '@krishalaya/i18n';
import { gstinKey, payButtonKey, refusalKey, taxLineKey, timelinessKey } from '../../../../features/billing/invoices';
import { payInvoiceAction } from '../../actions';
import type { SaasInvoiceDetail, SaasPayQuote } from '@krishalaya/sdk-js';

export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  return { title: getTranslator().t('bill.detailTitle'), robots: { index: false, follow: false } };
}

export default async function SaasInvoicePage({ params, searchParams }: { params: { id: string }; searchParams: { payment?: string; payError?: string } }) {
  await requireSession('/billing');
  const t = getTranslator();
  const lang = getLang();

  if (!tenantHasPerm('tenant.settings')) {
    return (
      <section>
        <h1>{t.t('bill.detailTitle')}</h1>
        <p className="kv-empty" role="status">{t.t('bill.restricted')}</p>
      </section>
    );
  }

  let inv: SaasInvoiceDetail | null = null;
  let quote: SaasPayQuote | null = null;
  const [iR, qR] = await Promise.allSettled([
    tenantClient().tenancy.billing.invoice(params.id),
    tenantClient().tenancy.billing.payQuote(params.id),
  ]);
  if (iR.status === 'fulfilled') inv = iR.value;
  if (qR.status === 'fulfilled') quote = qR.value;
  // Anti-IDOR: a foreign or nonexistent invoice both collapse to 404 here, exactly as the API does — a tenant
  // must not be able to learn which invoice ids exist by the difference between two error pages.
  if (!inv) notFound();

  const payBtn = payButtonKey(quote);

  return (
    <section>
      <h1>{inv.invoiceNo}</h1>
      {searchParams.payError && <p className="kv-error" role="alert">{t.t(refusalKey(searchParams.payError))}</p>}
      {/* The intent was created; the invoice is NOT paid until the capture is relayed and a receipt recorded. */}
      {searchParams.payment && <p className="kv-notice" role="status">{t.t('bill.pay.pending')}</p>}

      <dl className="kv-facts">
        <div className="kv-facts__row"><dt>{t.t('bill.col.status')}</dt><dd><span className="kv-badge">{t.t(`bill.status.${inv.status}`)}</span></dd></div>
        <div className="kv-facts__row"><dt>{t.t('bill.col.total')}</dt><dd>{formatMoneyMinor(inv.totalMinor, inv.currencyCode, lang)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('bill.received')}</dt><dd>{formatMoneyMinor(inv.paidMinor, inv.currencyCode, lang)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('bill.col.outstanding')}</dt><dd>{formatMoneyMinor(inv.outstandingMinor, inv.currencyCode, lang)}</dd></div>
        {/* An overpayment is KEPT and shown, never swallowed into a settled invoice (0092's rule). */}
        {inv.overpaidMinor !== '0' && (
          <div className="kv-facts__row"><dt>{t.t('bill.overpaid')}</dt><dd>{formatMoneyMinor(inv.overpaidMinor, inv.currencyCode, lang)}</dd></div>
        )}
        <div className="kv-facts__row"><dt>{t.t('bill.col.due')}</dt><dd>{formatDate(inv.dueDate, lang)}</dd></div>
        <div className="kv-facts__row"><dt>{t.t('bill.timeliness')}</dt><dd>{t.t(timelinessKey(inv.status, inv.paidAt, inv.dueDate))}</dd></div>
      </dl>

      <p className="kv-field__hint">
        {t.t(taxLineKey(inv.taxBp === null ? 'not_recorded' : inv.taxBp === 0 ? 'zero_rated' : 'stated'), {
          pct: inv.taxBp === null ? '—' : (inv.taxBp / 100).toFixed(2),
          amount: formatMoneyMinor(inv.taxMinor, inv.currencyCode, lang),
        })}
      </p>
      <p className="kv-field__hint">{t.t(gstinKey(inv.billToGstin ? 'snapshot' : 'not_on_invoice'), { gstin: inv.billToGstin ?? '—' })}</p>
      {inv.billToLegalName && <p className="kv-field__hint">{t.t('bill.billedTo', { name: inv.billToLegalName })}</p>}

      <h2 className="kv-section-title">{t.t('bill.linesTitle')}</h2>
      <DataTable
        rows={inv.lineItems}
        empty={t.t('bill.linesEmpty')}
        columns={[
          { header: t.t('bill.col.desc'), cell: (l) => l.desc },
          { header: t.t('bill.col.qty'), cell: (l) => String(l.qty) },
          // A credit line is negative on purpose (W119 prints the charge and the credit separately); it is
          // rendered as its own row rather than folded into a smaller charge.
          { header: t.t('bill.col.amount'), cell: (l) => formatMoneyMinor(l.totalMinor, inv!.currencyCode, lang) },
        ]}
      />

      <h2 className="kv-section-title">{t.t('bill.receiptsTitle')}</h2>
      <DataTable
        rows={inv.receipts}
        empty={t.t('bill.receiptsEmpty')}
        columns={[
          { header: t.t('bill.col.received'), cell: (r) => formatDate(r.receivedAt, lang) },
          { header: t.t('bill.col.amount'), cell: (r) => formatMoneyMinor(r.amountMinor, r.currencyCode, lang) },
          // 'gateway' means the capture is real and the PSP reported no instrument — not a guessed UPI.
          { header: t.t('bill.col.method'), cell: (r) => t.t(`bill.method.${r.method}`) },
          { header: t.t('bill.col.reference'), cell: (r) => r.reference },
          { header: t.t('bill.col.kind'), cell: (r) => t.t(r.isReversal ? 'bill.receipt.reversal' : 'bill.receipt.receipt') },
        ]}
      />

      {payBtn.show && quote?.payable ? (
        <form action={payInvoiceAction} className="kv-inline-form">
          <input type="hidden" name="invoiceId" value={inv.id} />
          <button type="submit" className="kv-btn">
            {t.t(searchParams.payment ? 'bill.pay.retry' : 'bill.pay.button', { amount: formatMoneyMinor(quote.amountMinor, quote.currencyCode, lang) })}
          </button>
        </form>
      ) : (
        <p className="kv-notice" role="status">{t.t(payBtn.key)}</p>
      )}

      <p className="kv-pager"><Link href="/billing" className="kv-btn--link">{t.t('bill.backToBilling')}</Link></p>
    </section>
  );
}
