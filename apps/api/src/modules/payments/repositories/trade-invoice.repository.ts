// modules/payments/repositories/trade-invoice.repository.ts
// Buyer-facing GST trade invoices (one per order). tenant_id in EVERY query (Law 1) + RLS.
// invoice_no is GST-compliant sequential via next_doc_number(); generation is idempotent on
// (tenant_id, order_id) (unique index, migration 0019). Reads off the replica; writes in tx.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface TradeInvoiceRow {
  id: string; invoiceNo: string; orderId: string; sellerGstin: string | null; buyerGstin: string | null;
  totalMinor: string; taxBreakup: Record<string, unknown>; pdfMediaId: string | null; createdAt: Date;
  // PC-56 TENANT-3c-1 (0140): the columns that make the document checkable. NULL on every pre-0140 row, and NULL
  // means "not recorded" — those invoices were computed as a blended percentage of the whole order and their
  // components cannot be re-derived, so nothing here guesses them.
  taxableMinor: string | null; exemptMinor: string | null; taxMinor: string | null;
  lines: unknown[] | null; placeOfSupplyCode: string | null; supplyType: string | null;
  taxBasisComplete: boolean | null; issuedAt: Date | null;
}
const COLS = `id, invoice_no, order_id, seller_gstin, buyer_gstin, total_minor, tax_breakup, pdf_media_id, created_at,
  taxable_minor, exempt_minor, tax_minor, lines, place_of_supply_code, supply_type, tax_basis_complete, issued_at`;
function toRow(r: any): TradeInvoiceRow {
  return { id: r.id, invoiceNo: r.invoice_no, orderId: r.order_id, sellerGstin: r.seller_gstin, buyerGstin: r.buyer_gstin, totalMinor: String(r.total_minor), taxBreakup: r.tax_breakup, pdfMediaId: r.pdf_media_id ?? null, createdAt: r.created_at,
    taxableMinor: r.taxable_minor == null ? null : String(r.taxable_minor),
    exemptMinor: r.exempt_minor == null ? null : String(r.exempt_minor),
    taxMinor: r.tax_minor == null ? null : String(r.tax_minor),
    lines: r.lines ?? null, placeOfSupplyCode: r.place_of_supply_code ?? null, supplyType: r.supply_type ?? null,
    taxBasisComplete: r.tax_basis_complete ?? null, issuedAt: r.issued_at ?? null };
}

@Injectable()
export class TradeInvoiceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async findByOrder(tx: TxContext, tenantId: string, orderId: string): Promise<TradeInvoiceRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2`, [tenantId, orderId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async nextNumber(tx: TxContext, tenantId: string, period: string): Promise<string> {
    const r = await tx.query<{ n: string }>(`SELECT next_doc_number($1,'invoice','INV',$2) n`, [tenantId, period]);
    return r.rows[0].n;
  }

  /** The credit-note series — its own doc_type, so an invoice number and a credit-note number can never collide and
   *  neither series develops a gap because the other advanced (0140). */
  async nextCreditNoteNumber(tx: TxContext, tenantId: string, period: string): Promise<string> {
    const r = await tx.query<{ n: string }>(`SELECT next_doc_number($1,'credit_note','CRN',$2) n`, [tenantId, period]);
    return r.rows[0].n;
  }

  /**
   * The party facts an invoice needs: the seller's own GSTIN, whatever the platform holds of the buyer's, and the
   * state the goods are going to.
   *
   * **READ ON THE PRIMARY, INSIDE THE GENERATING TRANSACTION, AND THAT IS THE POINT.** A buyer's first order arrives
   * seconds after their delivery address is written; off a lagging replica that address is absent and the place of
   * supply would resolve to `unknown` — permanently, on an immutable document. Slow-moving data still has to be read
   * where it is certain.
   *
   * The crossings (`tenants`, `business_kyc_profiles`, `addresses`, `admin_regions`) are other modules' tables. A
   * READ is the one thing that may cross (the blueprint forbids importing another module's repositories); the
   * alternative — a service call per invoice from inside a relay transaction — would put a second module's write
   * path in the middle of this one.
   */
  async resolveParties(tx: TxContext, i: { tenantId: string; buyerUserId: string | null; deliveryAddressId: string | null }): Promise<{
    sellerGstin: string | null; buyerGstin: string | null; deliveryStateCode: string | null;
  }> {
    const r = await tx.query(
      `SELECT t.gstin AS seller_gstin,
              (SELECT b.gstin_masked FROM business_kyc_profiles b
                WHERE b.tenant_id = $1 AND b.user_id = $2 AND b.deleted_at IS NULL
                ORDER BY b.created_at DESC LIMIT 1) AS buyer_gstin,
              -- The address's STATE is its level-1 ltree ancestor (in.gj contains in.gj.junagadh.vadal), which is why
              -- 0140 put the GST code on level 1 and nowhere else. An address with no region resolves to NULL, and
              -- NULL travels as "unknown" rather than as a default state.
              (SELECT st.gst_state_code
                 FROM addresses a
                 JOIN admin_regions r ON r.id = a.region_id
                 JOIN admin_regions st ON st.level = 1 AND st.path @> r.path
                WHERE a.id = $3 LIMIT 1) AS delivery_state_code
         FROM tenants t WHERE t.id = $1`,
      [i.tenantId, i.buyerUserId, i.deliveryAddressId]);
    const row = r.rows[0] ?? {};
    return {
      sellerGstin: row.seller_gstin ?? null,
      buyerGstin: row.buyer_gstin ?? null,
      deliveryStateCode: row.delivery_state_code ?? null,
    };
  }

  /** What has already been credited against an invoice — read FOR UPDATE-serialised by the caller's lock on the
   *  invoice row, so two concurrent credit notes cannot each pass the remaining-credit check alone. */
  async creditedTotal(tx: TxContext, tenantId: string, invoiceId: string): Promise<bigint> {
    const r = await tx.query<{ s: string | null }>(
      `SELECT COALESCE(SUM(total_minor),0)::text s FROM credit_notes
        WHERE tenant_id=$1 AND invoice_id=$2 AND deleted_at IS NULL`, [tenantId, invoiceId]);
    return BigInt(r.rows[0]?.s ?? '0');
  }

  /** Lock the invoice row while a credit note is decided against it (no version column on trade_invoices). */
  async getByIdForUpdate(tx: TxContext, tenantId: string, id: string): Promise<TradeInvoiceRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM trade_invoices WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Idempotent insert (one invoice per order). Returns true if inserted, false if it already existed. */
  async insertIfAbsent(tx: TxContext, i: { id: string; tenantId: string; orderId: string; invoiceNo: string; buyerUserId: string | null; sellerUserId: string | null; sellerGstin: string | null; buyerGstin: string | null; totalMinor: bigint; taxBreakup: Record<string, unknown>;
    taxableMinor: bigint; exemptMinor: bigint; taxMinor: bigint; lines: unknown[]; placeOfSupplyCode: string | null; supplyType: string; taxBasisComplete: boolean; issuedAt: Date }): Promise<boolean> {
    const r = await tx.query(
      `INSERT INTO trade_invoices (id, tenant_id, order_id, invoice_no, buyer_user_id, seller_user_id, seller_gstin, buyer_gstin, total_minor, tax_breakup,
                                   taxable_minor, exempt_minor, tax_minor, lines, place_of_supply_code, supply_type, tax_basis_complete, issued_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16,$17,$18) ON CONFLICT (tenant_id, order_id) DO NOTHING`,
      [i.id, i.tenantId, i.orderId, i.invoiceNo, i.buyerUserId, i.sellerUserId, i.sellerGstin, i.buyerGstin, i.totalMinor.toString(), JSON.stringify(i.taxBreakup),
       i.taxableMinor.toString(), i.exemptMinor.toString(), i.taxMinor.toString(), JSON.stringify(i.lines),
       i.placeOfSupplyCode, i.supplyType, i.taxBasisComplete, i.issuedAt]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Attach the rendered PDF media id (tenant-scoped). */
  async setPdfMediaId(tx: TxContext, tenantId: string, orderId: string, mediaId: string): Promise<void> {
    await tx.query(`UPDATE trade_invoices SET pdf_media_id=$3, updated_at=now() WHERE tenant_id=$1 AND order_id=$2`, [tenantId, orderId, mediaId]);
  }

  /** Visible to the order's buyer or seller, or a finance moderator (404 otherwise — no IDOR). */
  async getByOrderVisible(tenantId: string, orderId: string, viewerUserId: string, canModerate: boolean): Promise<TradeInvoiceRow | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM trade_invoices WHERE tenant_id=$1 AND order_id=$2 AND ($3=true OR buyer_user_id=$4 OR seller_user_id=$4)`,
      [tenantId, orderId, canModerate, viewerUserId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Resolve the S3 key of the invoice's rendered PDF, ONLY when the media asset is virus-scan CLEAN
   *  (an infected/pending asset is never presigned). Tenant-scoped join; null if no clean PDF yet.
   *  Authorization is the CALLER's responsibility (gate via getByOrderVisible first — anti-IDOR). */
  async getCleanPdfKey(tenantId: string, orderId: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query<{ s3_key: string }>(
      `SELECT ma.s3_key FROM trade_invoices ti JOIN media_assets ma ON ma.id = ti.pdf_media_id
        WHERE ti.tenant_id=$1 AND ti.order_id=$2 AND ma.scan_status='clean'
        LIMIT 1`, [tenantId, orderId]);
    return r.rows[0]?.s3_key ?? null;
  }
}
