// modules/payments/repositories/credit-note.repository.ts · SQL for GST credit notes (0140, PC-56 TENANT-3c-1).
// tenant_id in EVERY query (Law 1) + RLS. INSERT-ONLY: the table has no UPDATE grant for kv_app's writes here and
// no update method exists — a credit note is a document, and a document that can be edited after issue is the thing
// W152's "never edited" promise exists to prevent. A wrong credit note is corrected by another one.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface CreditNoteRow {
  id: string; invoiceId: string; orderId: string; creditNoteNo: string; reasonCode: string; reasonText: string;
  totalMinor: string; taxableMinor: string; exemptMinor: string; taxMinor: string; lines: unknown[];
  placeOfSupplyCode: string | null; supplyType: string | null; approvalId: string; issuedBy: string; issuedAt: Date;
}

const COLS = `id, invoice_id, order_id, credit_note_no, reason_code, reason_text, total_minor, taxable_minor,
  exempt_minor, tax_minor, lines, place_of_supply_code, supply_type, approval_id, issued_by, issued_at`;

function toRow(r: any): CreditNoteRow {
  return { id: r.id, invoiceId: r.invoice_id, orderId: r.order_id, creditNoteNo: r.credit_note_no,
    reasonCode: r.reason_code, reasonText: r.reason_text, totalMinor: String(r.total_minor),
    taxableMinor: String(r.taxable_minor), exemptMinor: String(r.exempt_minor), taxMinor: String(r.tax_minor),
    lines: r.lines ?? [], placeOfSupplyCode: r.place_of_supply_code, supplyType: r.supply_type,
    approvalId: r.approval_id, issuedBy: r.issued_by, issuedAt: r.issued_at };
}

@Injectable()
export class CreditNoteRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, c: {
    id: string; tenantId: string; invoiceId: string; orderId: string; creditNoteNo: string;
    reasonCode: string; reasonText: string; totalMinor: bigint; taxableMinor: bigint; exemptMinor: bigint; taxMinor: bigint;
    lines: unknown[]; placeOfSupplyCode: string | null; supplyType: string; approvalId: string; issuedBy: string;
  }): Promise<void> {
    await tx.query(
      `INSERT INTO credit_notes (id, tenant_id, invoice_id, order_id, credit_note_no, reason_code, reason_text,
                                total_minor, taxable_minor, exempt_minor, tax_minor, lines,
                                place_of_supply_code, supply_type, approval_id, issued_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)`,
      [c.id, c.tenantId, c.invoiceId, c.orderId, c.creditNoteNo, c.reasonCode, c.reasonText,
       c.totalMinor.toString(), c.taxableMinor.toString(), c.exemptMinor.toString(), c.taxMinor.toString(),
       JSON.stringify(c.lines), c.placeOfSupplyCode, c.supplyType, c.approvalId, c.issuedBy]);
  }

  async getById(tenantId: string, id: string): Promise<CreditNoteRow | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM credit_notes WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`, [tenantId, id]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Already issued against this approval? The unique index refuses a second one; this turns the refusal into a
   *  named error instead of a constraint violation reaching the client. */
  async existsForApproval(tx: TxContext, tenantId: string, approvalId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM credit_notes WHERE tenant_id=$1 AND approval_id=$2 AND deleted_at IS NULL LIMIT 1`, [tenantId, approvalId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** The month's credit notes, for the GSTR-1 export's CDNR/CDNUR side. */
  async listForWindow(tenantId: string, w: { fromIso: string; toIso: string }, cap = 5000): Promise<CreditNoteRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM credit_notes
        WHERE tenant_id=$1 AND deleted_at IS NULL AND issued_at >= $2::timestamptz AND issued_at < $3::timestamptz
        ORDER BY credit_note_no LIMIT $4`, [tenantId, w.fromIso, w.toIso, cap]);
    return r.rows.map(toRow);
  }
}
