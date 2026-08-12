// modules/payments/read-models/invoice-console.read-model.ts · W151's month view and its three KPI cards, W152's
// document, and the GSTR-1 export's rows (PC-56 TENANT-3c-1). Replica-backed, tenant-scoped (Law 1), keyset only.
//
// **W151 DRAWS "‹ 1 2 … 49 ›" AND A ROWS-PER-PAGE SELECT OVER 1,214 INVOICES, AND THIS READ REFUSES BOTH.** A page
// number needs COUNT(*) over the filtered set on every click; at 15,000 tenants each closing tens of thousands of
// invoices a month that count is the query that takes the page down. The month's totals come from ONE bounded
// aggregate instead (which is what the KPI cards actually need), and the list is a cursor. Fifth application of the
// roster rule.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { Gstr1InvoiceInput } from '../domain/gstr1';
import { SupplyType } from '../domain/invoice-tax';

export interface InvoiceListRow {
  id: string; invoiceNo: string; orderId: string; orderNo: string | null;
  buyerGstin: string | null; totalMinor: string; taxMinor: string | null; taxableMinor: string | null;
  exemptMinor: string | null; supplyType: string | null; placeOfSupplyCode: string | null;
  taxBasisComplete: boolean | null; issuedAt: string | null; createdAt: string;
  creditedMinor: string;
}

export interface InvoiceMonthKpis {
  /** Invoices ISSUED in the window. */
  count: number;
  /** Sums over the recorded breakdown only — see `withoutBreakdown`. */
  taxableMinor: string; taxMinor: string; exemptMinor: string;
  /** **INVOICES IN THE WINDOW WITH NO RECORDED BREAKDOWN** (every pre-0140 row). Their totals are NOT in the sums
   *  above, and the card says so: a taxable-value figure that silently excluded a third of the month would be worse
   *  than no figure. */
  withoutBreakdown: number;
  incompleteBasis: number;
  windowFromIso: string; windowToIso: string;
}

@Injectable()
export class InvoiceConsoleReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** W151's three cards, over one month. Every sum carries its own basis; nothing is inferred from a count. */
  async monthKpis(tenantId: string, w: { fromIso: string; toIso: string }): Promise<InvoiceMonthKpis> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n,
              COALESCE(SUM(taxable_minor),0)::text AS taxable,
              COALESCE(SUM(tax_minor),0)::text     AS tax,
              COALESCE(SUM(exempt_minor),0)::text  AS exempt,
              COUNT(*) FILTER (WHERE taxable_minor IS NULL)::int   AS no_breakdown,
              COUNT(*) FILTER (WHERE tax_basis_complete IS FALSE)::int AS incomplete
         FROM trade_invoices
        WHERE tenant_id = $1 AND deleted_at IS NULL
          -- issued_at is 0140's column and is NULL on older rows, so the window falls back to created_at for them:
          -- an invoice must appear in the month it was raised even when the new column was never written.
          AND COALESCE(issued_at, created_at) >= $2::timestamptz
          AND COALESCE(issued_at, created_at) <  $3::timestamptz`,
      [tenantId, w.fromIso, w.toIso]);
    const x = r.rows[0] ?? {};
    return {
      count: x.n ?? 0, taxableMinor: x.taxable ?? '0', taxMinor: x.tax ?? '0', exemptMinor: x.exempt ?? '0',
      withoutBreakdown: x.no_breakdown ?? 0, incompleteBasis: x.incomplete ?? 0,
      windowFromIso: w.fromIso, windowToIso: w.toIso,
    };
  }

  /** W151's table. Keyset on (created_at, id) — never OFFSET, never a page number. */
  async list(tenantId: string, q: { fromIso?: string; toIso?: string; cursor?: { c: string; id: string } | null; limit: number }): Promise<InvoiceListRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `ti.tenant_id = $1 AND ti.deleted_at IS NULL`;
    if (q.fromIso) where += ` AND COALESCE(ti.issued_at, ti.created_at) >= ${p(q.fromIso)}::timestamptz`;
    if (q.toIso) where += ` AND COALESCE(ti.issued_at, ti.created_at) < ${p(q.toIso)}::timestamptz`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (ti.created_at < ${cc} OR (ti.created_at = ${cc} AND ti.id < ${ci}))`; }
    const lp = p(Math.min(Math.max(q.limit, 1), 100));
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT ti.id, ti.invoice_no AS "invoiceNo", ti.order_id AS "orderId", o.order_no AS "orderNo",
              ti.buyer_gstin AS "buyerGstin", ti.total_minor::text AS "totalMinor",
              ti.tax_minor::text AS "taxMinor", ti.taxable_minor::text AS "taxableMinor",
              ti.exempt_minor::text AS "exemptMinor", ti.supply_type AS "supplyType",
              ti.place_of_supply_code AS "placeOfSupplyCode", ti.tax_basis_complete AS "taxBasisComplete",
              ti.issued_at AS "issuedAt", ti.created_at AS "createdAt",
              -- What has already been credited back: a corrected invoice must not read as though it still stands
              -- at its full value (W152's Corrections card is the other half of this).
              (SELECT COALESCE(SUM(cn.total_minor),0)::text FROM credit_notes cn
                WHERE cn.tenant_id = ti.tenant_id AND cn.invoice_id = ti.id AND cn.deleted_at IS NULL) AS "creditedMinor"
         FROM trade_invoices ti
         LEFT JOIN orders o ON o.id = ti.order_id AND o.tenant_id = ti.tenant_id
        WHERE ${where}
        ORDER BY ti.created_at DESC, ti.id DESC LIMIT ${lp}`, params);
    return r.rows;
  }

  /** One invoice, for W152 — visibility is the CALLER's to enforce (the service gates on buyer/seller/finance). */
  async detail(tenantId: string, id: string): Promise<(InvoiceListRow & { lines: unknown[] | null; sellerGstin: string | null; taxBreakup: Record<string, unknown> }) | null> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT ti.id, ti.invoice_no AS "invoiceNo", ti.order_id AS "orderId", o.order_no AS "orderNo",
              ti.seller_gstin AS "sellerGstin", ti.buyer_gstin AS "buyerGstin", ti.total_minor::text AS "totalMinor",
              ti.tax_minor::text AS "taxMinor", ti.taxable_minor::text AS "taxableMinor",
              ti.exempt_minor::text AS "exemptMinor", ti.supply_type AS "supplyType",
              ti.place_of_supply_code AS "placeOfSupplyCode", ti.tax_basis_complete AS "taxBasisComplete",
              ti.issued_at AS "issuedAt", ti.created_at AS "createdAt", ti.lines, ti.tax_breakup AS "taxBreakup",
              (SELECT COALESCE(SUM(cn.total_minor),0)::text FROM credit_notes cn
                WHERE cn.tenant_id = ti.tenant_id AND cn.invoice_id = ti.id AND cn.deleted_at IS NULL) AS "creditedMinor"
         FROM trade_invoices ti
         LEFT JOIN orders o ON o.id = ti.order_id AND o.tenant_id = ti.tenant_id
        WHERE ti.tenant_id = $1 AND ti.id = $2 AND ti.deleted_at IS NULL
        LIMIT 1`, [tenantId, id]);
    return r.rows[0] ?? null;
  }

  /** The credit notes issued against one invoice — W152's Corrections list. */
  async creditNotesFor(tenantId: string, invoiceId: string): Promise<Array<{ id: string; creditNoteNo: string; reasonCode: string; reasonText: string; totalMinor: string; taxMinor: string; issuedAt: string; issuedBy: string }>> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT id, credit_note_no AS "creditNoteNo", reason_code AS "reasonCode", reason_text AS "reasonText",
              total_minor::text AS "totalMinor", tax_minor::text AS "taxMinor", issued_at AS "issuedAt", issued_by AS "issuedBy"
         FROM credit_notes
        WHERE tenant_id = $1 AND invoice_id = $2 AND deleted_at IS NULL
        ORDER BY issued_at DESC LIMIT 50`, [tenantId, invoiceId]);
    return r.rows;
  }

  /** The month's invoices as GSTR-1 inputs. Bounded: a period that exceeds the cap is REFUSED by the service rather
   *  than silently truncated — half a GST return that looks whole is the worst artefact this wave could produce. */
  async gstr1Rows(tenantId: string, w: { fromIso: string; toIso: string }, cap: number): Promise<{ rows: Gstr1InvoiceInput[]; capped: boolean }> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT invoice_no AS "invoiceNo", buyer_gstin AS "buyerGstin", supply_type AS "supplyType",
              place_of_supply_code AS "placeOfSupplyCode", total_minor::text AS "totalMinor",
              taxable_minor::text AS "taxableMinor", tax_minor::text AS "taxMinor",
              tax_basis_complete AS "taxBasisComplete"
         FROM trade_invoices
        WHERE tenant_id = $1 AND deleted_at IS NULL
          AND COALESCE(issued_at, created_at) >= $2::timestamptz
          AND COALESCE(issued_at, created_at) <  $3::timestamptz
        ORDER BY invoice_no
        LIMIT $4`, [tenantId, w.fromIso, w.toIso, cap + 1]);
    const capped = r.rows.length > cap;
    const rows: Gstr1InvoiceInput[] = r.rows.slice(0, cap).map((x: any) => ({
      invoiceNo: x.invoiceNo,
      buyerGstin: x.buyerGstin,
      supplyType: (x.supplyType ?? null) as SupplyType | null,
      placeOfSupplyCode: x.placeOfSupplyCode,
      totalMinor: BigInt(x.totalMinor),
      taxableMinor: x.taxableMinor == null ? null : BigInt(x.taxableMinor),
      taxMinor: x.taxMinor == null ? null : BigInt(x.taxMinor),
      basisComplete: x.taxBasisComplete,
    }));
    return { rows, capped };
  }
}
