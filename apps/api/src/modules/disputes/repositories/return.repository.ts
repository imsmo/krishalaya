// modules/disputes/repositories/return.repository.ts
// All SQL for the returns/RMA aggregate. tenant_id in EVERY query (Law 1) + RLS. No version column
// (add_std_columns) → mutations LOCK the row with SELECT … FOR UPDATE. Reads on the replica. Returns
// carry no buyer/seller column, so list scoping (mine/against) joins dispute_eligibility on order_id
// (the buyer+seller recorded at delivery) — the service resolves party roles the same way (anti-IDOR).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Return } from '../domain/return.entity';
import { ReturnStatus } from '../domain/return.state';

const COLS = `id, tenant_id, order_id, dispute_id, status, reason_id, refund_txn_id, created_at,
  refund_amount_minor, inspected_at, inspected_by, inspection_note`;
function toDomain(r: any): Return {
  return Return.rehydrate({
    id: r.id, tenantId: r.tenant_id, orderId: r.order_id, disputeId: r.dispute_id,
    status: r.status as ReturnStatus, reasonId: r.reason_id, refundTxnId: r.refund_txn_id, createdAt: r.created_at,
    refundAmountMinor: r.refund_amount_minor == null ? null : BigInt(r.refund_amount_minor),
    inspectedAt: r.inspected_at, inspectedBy: r.inspected_by, inspectionNote: r.inspection_note,
  });
}
export interface ReturnListQuery { orderIds?: string[]; allTenant?: boolean; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class ReturnRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, r: Return): Promise<void> {
    const p = r.toProps();
    await tx.query(
      `INSERT INTO returns (id, tenant_id, order_id, dispute_id, status, reason_id, refund_amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [p.id, p.tenantId, p.orderId, p.disputeId, p.status, p.reasonId, p.refundAmountMinor?.toString() ?? null]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Return | null> {
    const r = await tx.query(`SELECT ${COLS} FROM returns WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Return | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM returns WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** No version column → unconditional update inside the FOR UPDATE-locked tx. */
  async update(tx: TxContext, r: Return): Promise<void> {
    const p = r.toProps();
    await tx.query(
      `UPDATE returns SET status=$3, reason_id=$4, refund_txn_id=$5, refund_amount_minor=$6,
         inspected_at=$7, inspected_by=$8, inspection_note=$9, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.status, p.reasonId, p.refundTxnId, p.refundAmountMinor?.toString() ?? null,
       p.inspectedAt, p.inspectedBy, p.inspectionNote]);
  }
  /** The order already has an ACTIVE return? (one at a time — bounds abuse). */
  async hasActiveForOrder(tx: TxContext, tenantId: string, orderId: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM returns WHERE tenant_id=$1 AND order_id=$2 AND status NOT IN ('refunded','rejected') LIMIT 1`, [tenantId, orderId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Reverse-resolve reason_id → the dispute_reason CODE, for the read model (PC-55 B8).
   *  The aggregate rightly owns a lookup_values *id*; a CLIENT cannot do anything with one. Every consumer — buyer
   *  app, seller console, mobile — needs the code to translate the reason into the reader's own language, and making
   *  each of them fetch the lookup table to do it would be a per-row round trip and an internal id on the wire.
   *  One bounded query per page instead. Platform values (tenant_id IS NULL) and the tenant's own overrides are both
   *  resolved, preferring the tenant's row — a white-label that renamed a reason keeps its own vocabulary. */
  async reasonCodesFor(tenantId: string, reasonIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(reasonIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, code FROM lookup_values WHERE type_code='dispute_reason' AND id = ANY($1::uuid[])
         AND (tenant_id IS NULL OR tenant_id=$2)`, [ids, tenantId]);
    const out = new Map<string, string>();
    for (const row of r.rows) out.set(row.id, row.code);
    return out;
  }

  async listFor(tenantId: string, q: ReturnListQuery): Promise<Return[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (!q.allTenant) {
      // scoped to the caller's orders (buyer or seller box). An empty set ⇒ no rows (never list-all).
      const ids = q.orderIds ?? [];
      if (ids.length === 0) return [];
      where += ` AND order_id = ANY(${p(ids)}::uuid[])`;
    }
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM returns WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** Stamp the ledger reversal txn id on a refunded return — the payments module's ReturnRefundedHandler calls this
   *  through the module boundary. IDEMPOTENT: only stamps a return that has none, so a relay replay cannot rewrite
   *  the link between a decision and the money that moved. */
  async stampRefundTxn(tx: TxContext, tenantId: string, id: string, txnId: string): Promise<void> {
    await tx.query(
      `UPDATE returns SET refund_txn_id=$3, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND refund_txn_id IS NULL`, [id, tenantId, txnId]);
  }

  /** The refund amount recorded on a return, read inside the money leg's transaction. Returned as a string so the
   *  caller decides the bigint boundary (the handler does), and null where nothing was recorded. */
  async refundAmountFor(tx: TxContext, tenantId: string, id: string): Promise<{ amountMinor: string | null; orderId: string; status: string } | null> {
    const r = await tx.query(
      `SELECT refund_amount_minor::text AS amount, order_id, status FROM returns WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    const row = r.rows[0];
    return row ? { amountMinor: row.amount, orderId: row.order_id, status: row.status } : null;
  }

  /** order ids on which `userId` is the buyer (box 'mine') or the seller (box 'against'). Bounded. */
  async orderIdsForParty(tenantId: string, userId: string, role: 'buyer' | 'seller', limit = 500): Promise<string[]> {
    const col = role === 'buyer' ? 'buyer_user_id' : 'seller_user_id';
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT order_id FROM dispute_eligibility WHERE tenant_id=$1 AND ${col}=$2 ORDER BY order_id DESC LIMIT $3`, [tenantId, userId, limit]);
    return r.rows.map((x) => x.order_id);
  }
}
