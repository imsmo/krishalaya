// modules/payments/services/trade-invoice.service.ts
// Buyer-facing GST trade invoice, one per order. invoice_no is GST-compliant sequential (next_doc_number).
// Reads are ownership-gated (buyer/seller/finance) — 404 to others (no IDOR).
//
// **REWRITTEN BY PC-56 TENANT-3c-1 (schema 0140). WHAT IT USED TO DO, IN FULL:**
//     taxMinor = applyBps(order.total_minor, taxRules.resolve(country,'gst', categoryId))
// with `categoryId` always undefined (the order_completed event never carried one), so every invoice resolved the
// country-wide row — seeded at 500 bps — and applied it to the ENTIRE order, recording the whole order as taxable.
// On W152's own example that declares ₹2,285 of GST where ₹161 is due, and declares exempt produce taxable.
//
// Now the document is built LINE BY LINE from the order's own money row (domain/invoice-tax.ts): the goods at their
// commodity rate, the delivery and the platform fee at the service rate, each with its HSN, its basis and its
// citation — and the three bases must sum to what the buyer paid or nothing is written at all (fail closed, and
// 0140's CHECK says the same thing at the bottom). Place of supply and supply type are DETERMINED rather than
// assumed intra-state, and an unresolvable rate is recorded as unresolved rather than as an exemption.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { OBJECT_STORE, ObjectStore } from '../../../core/media/s3-presign.service';
import { TradeInvoice } from '../domain/trade-invoice.entity';
import {
  buildInvoiceTax, maskGstin, splitTax, stateCodeFromGstin, supplyTypeOf, InvoiceLine,
} from '../domain/invoice-tax';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { TradeInvoiceRepository, TradeInvoiceRow } from '../repositories/trade-invoice.repository';
import { DocumentPdfService } from './document-pdf.service';
import { InvoiceNotFoundError, InvoicePdfNotReadyError } from '../domain/billing.errors';

export interface InvoiceActor { userId: string; canModerate: boolean; }
const PDF_URL_TTL_SEC = 300; // short-lived signed GET (5 min) — re-request to refresh

@Injectable()
export class TradeInvoiceService {
  constructor(
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(OBJECT_STORE) private readonly store: ObjectStore,
    private readonly tax: TaxRuleRepository,
    private readonly invoices: TradeInvoiceRepository,
    private readonly documentPdf: DocumentPdfService,
  ) {}

  /**
   * Generate the order's invoice within the caller's tx. Idempotent on (tenant, order) — 0019's unique index — so
   * the CONFIRM handler and the COMPLETION backstop can both run and only one document exists.
   *
   * W151 says invoices generate "on order confirm", and for a supply of goods the law agrees: a tax invoice is due
   * at or before removal of the goods, which is dispatch, not delivery. TENANT-3c-1 moves the trigger and keeps the
   * completion handler as a backstop for an order whose confirm event was lost.
   */
  async generateForOrder(tx: TxContext, input: {
    tenantId: string; orderId: string; buyerUserId: string | null; sellerUserId: string | null;
    totalMinor: bigint; subtotalMinor?: bigint; deliveryFeeMinor?: bigint; discountMinor?: bigint; platformFeeMinor?: bigint;
    deliveryAddressId?: string | null; categoryId?: string | null; countryCode?: string; now?: Date;
  }): Promise<void> {
    const existing = await this.invoices.findByOrder(tx, input.tenantId, input.orderId);
    if (existing) return;                                  // idempotent — one invoice per order
    const country = input.countryCode ?? 'IN';

    // ---- the money, as the order actually charged it -----------------------------------------------------------
    // Where the components are absent (an old event shape reaching the backstop), the whole total is treated as ONE
    // goods line rather than being split by guesswork — and the line's basis then says which rate it carries.
    const subtotal = input.subtotalMinor ?? null;
    const money = subtotal != null
      ? {
          subtotalMinor: subtotal,
          deliveryFeeMinor: input.deliveryFeeMinor ?? 0n,
          discountMinor: input.discountMinor ?? 0n,
          platformFeeMinor: input.platformFeeMinor ?? 0n,
          totalMinor: input.totalMinor,
        }
      : { subtotalMinor: input.totalMinor, deliveryFeeMinor: 0n, discountMinor: 0n, platformFeeMinor: 0n, totalMinor: input.totalMinor };

    // ---- the rates: the commodity's for the goods, the platform's own service rate for delivery and the fee ------
    // A null rate is NOT 0%. `tax_rules` holding no row for this category means nobody recorded what the commodity
    // attracts, and the line says so (rateBasis 'not_recorded'), which excludes the invoice from the GSTR-1 export
    // instead of filing a rate this code invented (0140 DEFECT 1c).
    const goodsRule = input.categoryId
      ? await this.tax.resolve(tx, { countryCode: country, taxCode: 'gst', categoryId: input.categoryId })
      : null;
    const serviceRule = await this.tax.resolve(tx, { countryCode: country, taxCode: 'gst_service', categoryId: null });
    const tax = buildInvoiceTax(money, {
      goods: { rateBps: goodsRule?.rateBps ?? null, hsn: null, legalRef: null },
      delivery: { rateBps: serviceRule?.rateBps ?? null, hsn: '9997', legalRef: null },
      fee: { rateBps: serviceRule?.rateBps ?? null, hsn: '9997', legalRef: null },
    });

    // ---- who, and where: place of supply from the buyer's GSTIN state, else the delivery address's state ---------
    const parties = await this.invoices.resolveParties(tx, {
      tenantId: input.tenantId, buyerUserId: input.buyerUserId, deliveryAddressId: input.deliveryAddressId ?? null,
    });
    const sellerState = stateCodeFromGstin(parties.sellerGstin);
    const placeOfSupply = stateCodeFromGstin(parties.buyerGstin) ?? parties.deliveryStateCode ?? null;
    const supply = supplyTypeOf(sellerState, placeOfSupply);
    const split = splitTax(tax.taxMinor, supply);

    // The legacy `tax_breakup` column keeps its shape for every existing reader, with the CORRECT taxable base in it
    // now, plus the split the supply type actually calls for and the unallocated bucket for an unknown one.
    const taxBreakup = {
      gstRateBps: serviceRule?.rateBps ?? 0,
      taxableMinor: tax.taxableMinor.toString(),
      exemptMinor: tax.exemptMinor.toString(),
      cgstMinor: split.cgstMinor.toString(), sgstMinor: split.sgstMinor.toString(), igstMinor: split.igstMinor.toString(),
      unallocatedMinor: split.unallocatedMinor.toString(),
      supplyType: supply, placeOfSupplyCode: placeOfSupply, basis: 'fee_inclusive_extraction',
    };

    const issuedAt = input.now ?? new Date();
    const period = `${issuedAt.getUTCFullYear()}-${String(issuedAt.getUTCMonth() + 1).padStart(2, '0')}`;
    const invoiceNo = await this.invoices.nextNumber(tx, input.tenantId, period);
    const id = uuidv7();
    // The entity's guard stays (a split that mixes IGST with CGST/SGST, or tax exceeding the total, never persists).
    TradeInvoice.create({
      id, tenantId: input.tenantId, orderId: input.orderId, invoiceNo,
      sellerGstin: parties.sellerGstin, buyerGstin: null,
      totalMinor: input.totalMinor,
      tax: { gstRateBps: serviceRule?.rateBps ?? 0, taxableMinor: tax.taxableMinor, cgstMinor: split.cgstMinor, sgstMinor: split.sgstMinor, igstMinor: split.igstMinor },
    });
    await this.invoices.insertIfAbsent(tx, {
      id, tenantId: input.tenantId, orderId: input.orderId, invoiceNo,
      buyerUserId: input.buyerUserId, sellerUserId: input.sellerUserId,
      sellerGstin: parties.sellerGstin,
      // Stored as the platform HOLDS it — 0058 keeps only a mask for a buyer, and masking again is harmless while
      // storing something that looks full would be a lie about what can be filed (0140 DEFECT 6).
      buyerGstin: maskGstin(parties.buyerGstin),
      totalMinor: input.totalMinor, taxBreakup,
      taxableMinor: tax.taxableMinor, exemptMinor: tax.exemptMinor, taxMinor: tax.taxMinor,
      lines: tax.lines.map(serialiseLine),
      placeOfSupplyCode: placeOfSupply, supplyType: supply,
      taxBasisComplete: tax.basisComplete, issuedAt,
    });
    this.metrics.inc('payments.invoice_generated', { tenant: input.tenantId });
  }

  async getByOrder(tenantId: string, actor: InvoiceActor, orderId: string): Promise<TradeInvoiceRow> {
    const inv = await this.invoices.getByOrderVisible(tenantId, orderId, actor.userId, actor.canModerate);
    if (!inv) throw new InvoiceNotFoundError();
    return inv;
  }

  /** A short-lived presigned GET URL for the order's invoice PDF. SECURITY: ownership-gated first
   *  (buyer/seller/finance-moderator → 404 to anyone else, no IDOR/enumeration). Lazily renders + stores
   *  the PDF if it hasn't been generated yet (flag-gated real S3 PUT), then presigns the CLEAN media only.
   *  Throws InvoicePdfNotReadyError (409, retryable) when the renderer is disabled or the scan isn't clean. */
  async downloadUrlForOrder(tenantId: string, actor: InvoiceActor, orderId: string): Promise<{ invoiceNo: string; url: string; expiresInSec: number }> {
    const inv = await this.invoices.getByOrderVisible(tenantId, orderId, actor.userId, actor.canModerate);
    if (!inv) throw new InvoiceNotFoundError();                 // 404 — not the caller's invoice

    // Lazily generate the PDF the first time it's requested (no-op unless the document_pdfs flag is on).
    if (!inv.pdfMediaId) await this.documentPdf.storeInvoicePdf(tenantId, orderId);

    const key = await this.invoices.getCleanPdfKey(tenantId, orderId);
    if (!key) throw new InvoicePdfNotReadyError();              // renderer off, or scan not clean yet
    this.metrics.inc('payments.invoice_download_url', { tenant: tenantId });
    return { invoiceNo: inv.invoiceNo, url: this.store.presignDownload(key, PDF_URL_TTL_SEC), expiresInSec: PDF_URL_TTL_SEC };
  }
}

/** jsonb-safe line (bigints do not survive JSON.stringify). */
export function serialiseLine(l: InvoiceLine) {
  return {
    key: l.key, hsn: l.hsn, grossMinor: l.grossMinor.toString(), taxableMinor: l.taxableMinor.toString(),
    exemptMinor: l.exemptMinor.toString(), rateBps: l.rateBps, taxMinor: l.taxMinor.toString(),
    rateBasis: l.rateBasis, legalRef: l.legalRef,
  };
}
