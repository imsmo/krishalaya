// modules/payments/services/document-pdf.service.ts
// Renders the financial DOCUMENTS (seller settlement statement, buyer GST invoice) into real PDFs
// and stores them via the media boundary (putGeneratedDocument → clean tenant document), recording
// pdf_media_id. Rendering is pure (renderTextPdf); storage is gated by the `document_pdfs` flag
// (default OFF) since it performs a real S3 PUT — so default flows never touch S3. Idempotent-ish:
// re-storing simply attaches a fresh media id.
//
// DEV-27 (Q23, G0-4 founder ruling 2026-07-22 — Design_Program/12_G0-2_DECISION_REGISTER.md): every
// billing document header carries BOTH the tenant's own brand (name) AND the platform's small honest
// "Powered by Krishalaya" mark — never one without the other (TS-002 §a "Documents" row; DOC-000
// §a/§b, header zone — the LOGO-4 badge asset is drawn there). See spec_dev27.md for the verbatim
// ruling + a filed discrepancy note (the register's own headline sentence says "footers", but its own
// explanatory text + TS-002 + DOC-000's actual annotation + the drawn anatomy all place the badge in
// the HEADER — this renderer follows the header per the weight of that evidence, DELTA filed, not
// silently resolved).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { MediaService } from '../../../core/media/media-links.service';
import { renderTextPdf, formatMinor } from '../../../core/media/pdf/pdf-writer';
import { TranslationService } from '../../../core/i18n/translation.service';
import { TenantService } from '../../tenancy/services/tenant.service';
import { SettlementStatementRepository, SettlementStatementRow } from '../repositories/settlement-statement.repository';
import { TradeInvoiceRepository } from '../repositories/trade-invoice.repository';

/** Header brand line pair — tenant's own name (nullable, honest degrade) + the platform badge text
 *  (always present — a fixed platform fact, never tenant-conditional, never fabricated). */
export interface DocumentBrand { tenantName: string | null; badgeText: string }

/** pdf-writer.ts is WinAnsi/Helvetica-only (see its own header comment: "callers avoid non-WinAnsi
 *  glyphs") — no Devanagari/Gujarati glyph support exists in this minimal, dependency-free generator.
 *  escapePdf() would silently turn every out-of-range character into "?", so printing a raw hi/gu
 *  translation here would render as "?????" mojibake — a worse, dishonest outcome than showing the
 *  correctly-resolved English string. Real hi/gu strings ARE registered in the i18n bundle (Law 3,
 *  `doc.poweredByKrishalaya`) for any future Unicode-capable renderer/consumer of the same key; this
 *  regex only guards THIS ASCII-only text stream. Flagged as a known, disclosed constraint of this
 *  specific renderer in dev27_report.md — not a silent hack.
 */
// eslint-disable-next-line no-control-regex
const WIN_ANSI_PRINTABLE = /^[\x20-\x7e]*$/;

@Injectable()
export class DocumentPdfService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly flags: FlagsService,
    private readonly media: MediaService,
    private readonly statements: SettlementStatementRepository,
    private readonly invoices: TradeInvoiceRepository,
    private readonly i18n: TranslationService,
    private readonly tenants: TenantService,
  ) {}

  /** Q23 header lines: tenant brand name (if known) THEN the platform badge, exactly mirroring the
   *  DOC-000 header-zone anatomy (tenant logo/name slot beside the "Powered by Krishalaya" mark). */
  private brandHeaderLines(brand: DocumentBrand): string[] {
    return brand.tenantName ? [brand.tenantName, brand.badgeText, ''] : [brand.badgeText, ''];
  }

  /** Pure: a settlement statement → PDF bytes. brand is pre-resolved by the caller (keeps this method
   *  pure/sync-testable — no DB/i18n calls inside the renderer itself). */
  renderStatement(s: SettlementStatementRow, brand: DocumentBrand): Buffer {
    return renderTextPdf(`Settlement Statement ${s.statementNo}`, [
      ...this.brandHeaderLines(brand),
      `Seller: ${s.sellerUserId}`,
      `Period: ${s.periodStart} to ${s.periodEnd}`,
      '',
      `Gross         : INR ${formatMinor(s.grossMinor)}`,
      `Commission    : INR ${formatMinor(s.commissionMinor)}`,
      `Tax (GST+TDS) : INR ${formatMinor(s.taxMinor)}`,
      `Net payable   : INR ${formatMinor(s.netMinor)}`,
      '',
      'This is a computer-generated statement.',
    ]);
  }

  /** Pure: a trade invoice → PDF bytes. brand is pre-resolved by the caller (see renderStatement). */
  renderInvoice(inv: { invoiceNo: string; orderId: string; totalMinor: string; taxBreakup: Record<string, unknown> }, brand: DocumentBrand): Buffer {
    const b = inv.taxBreakup as { cgstMinor?: string; sgstMinor?: string; gstRateBps?: number };
    return renderTextPdf(`Tax Invoice ${inv.invoiceNo}`, [
      ...this.brandHeaderLines(brand),
      `Order: ${inv.orderId}`,
      '',
      `Taxable value : INR ${formatMinor(inv.totalMinor)}`,
      `CGST          : INR ${formatMinor(b.cgstMinor ?? '0')}`,
      `SGST          : INR ${formatMinor(b.sgstMinor ?? '0')}`,
      `GST rate      : ${((b.gstRateBps ?? 0) / 100).toFixed(2)}%`,
      '',
      'This is a computer-generated invoice.',
    ]);
  }

  /** Resolves the i18n key for the caller's lang (Law 3), degrading to the EN string when the
   *  translated value isn't WinAnsi-printable (see WIN_ANSI_PRINTABLE comment above). */
  private badgeText(lang: string): string {
    const translated = this.i18n.t('doc.poweredByKrishalaya', lang);
    return WIN_ANSI_PRINTABLE.test(translated) ? translated : this.i18n.t('doc.poweredByKrishalaya', 'en');
  }

  /** Resolves the Q23 header brand for a tenant. tenantId is always the caller's own RequestContext-
   *  derived id (Law 1 — every call site below passes the tenantId it already authenticated against,
   *  never a client-supplied string). Tenant name comes from the tenant SERVICE (never the repository
   *  directly, matching this module's existing MandateService precedent) — if the tenant record is
   *  unexpectedly unreadable, the tenant-name line is honestly OMITTED (Law 12: never fabricate a
   *  placeholder name like "Tenant" or "Unknown") while the platform badge line still always renders,
   *  since it states a fixed platform fact that is never tenant-conditional. */
  private async resolveBrand(tenantId: string, lang: string): Promise<DocumentBrand> {
    let tenantName: string | null = null;
    try {
      const t = await this.tenants.getMine(tenantId);
      tenantName = (t.displayName || t.legalName || '').trim() || null;
    } catch {
      tenantName = null; // tenant record missing/unreadable — degrade honestly, never invent a name
    }
    return { tenantName, badgeText: this.badgeText(lang) };
  }

  /** Render + store a statement PDF, attaching pdf_media_id. No-op unless the flag is on.
   *  lang defaults to 'en' (no request-scoped locale is available for this system-triggered path
   *  today — see spec_dev27.md's flag/locale disclosure) but the key resolves for hi/gu too. */
  async storeStatementPdf(tenantId: string, statement: SettlementStatementRow, lang = 'en'): Promise<string | null> {
    if (!(await this.flags.isEnabled('document_pdfs', { tenantId }))) return null;
    const brand = await this.resolveBrand(tenantId, lang);
    const mediaId = await this.media.putGeneratedDocument(tenantId, this.renderStatement(statement, brand));
    await this.uow.run(tenantId, async (tx) => this.statements.setPdfMediaId(tx, tenantId, statement.id, mediaId), { userId: 'system' });
    this.metrics.inc('payments.statement_pdf', { tenant: tenantId });
    return mediaId;
  }

  /** Render + store an invoice PDF for an order, attaching pdf_media_id. No-op unless the flag is on. */
  async storeInvoicePdf(tenantId: string, orderId: string, lang = 'en'): Promise<string | null> {
    if (!(await this.flags.isEnabled('document_pdfs', { tenantId }))) return null;
    const inv = await this.uow.run(tenantId, async (tx) => this.invoices.findByOrder(tx, tenantId, orderId), { userId: 'system' });
    if (!inv) return null;
    const brand = await this.resolveBrand(tenantId, lang);
    const mediaId = await this.media.putGeneratedDocument(tenantId, this.renderInvoice(inv, brand));
    await this.uow.run(tenantId, async (tx) => this.invoices.setPdfMediaId(tx, tenantId, orderId, mediaId), { userId: 'system' });
    this.metrics.inc('payments.invoice_pdf', { tenant: tenantId });
    return mediaId;
  }
}
