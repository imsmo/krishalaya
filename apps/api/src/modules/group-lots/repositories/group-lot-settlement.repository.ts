// modules/group-lots/repositories/group-lot-settlement.repository.ts · PC-56 TENANT-11c · the SQL of the sale and the settlement
// (0188 group_lot_settlements + lines), and the READS of the sale order's own settlement — `order_items` (which listings the
// order bought), `settlement_lines` (what the order's settlement paid its seller) and `coupon_redemptions` (any coupon
// top-up paid to that seller for it, TENANT-10b). Those three are read, never written, by this module: the order's money is
// the payments module's; this module only moves the seller's money on (gl-hold, gl-settle) through WalletPort.
// tenant_id in every query (Law 1) + RLS; the reads run in kv_app's unit of work, never on the relay's kv_relay transaction.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface SettlementRow {
  id: string; groupLotId: string; coordinatorUserId: string; saleOrderId: string; productId: string; unitCode: string; quantity: string;
  grossMinor: bigint; feeBps: number; feeMinor: bigint; netMinor: bigint; status: 'prepared' | 'confirmed' | 'refused';
  preparedBy: string; preparedAt: string; confirmedBy: string | null; confirmedAt: string | null; confirmReason: string | null;
  settlementTxnId: string | null; refusedBy: string | null; refusedAt: string | null; refuseReason: string | null;
}
export interface SettlementLineRow { id: string; pledgeId: string; farmerUserId: string; quantity: string; shareMinor: bigint; }

const COLS = `id, group_lot_id, coordinator_user_id, sale_order_id, product_id, unit_code, quantity::text AS quantity, gross_minor::text AS gross_minor, fee_bps,
  fee_minor::text AS fee_minor, net_minor::text AS net_minor, status, prepared_by, prepared_at, confirmed_by, confirmed_at, confirm_reason, settlement_txn_id,
  refused_by, refused_at, refuse_reason`;
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const toRow = (x: any): SettlementRow => ({
  id: x.id, groupLotId: x.group_lot_id, coordinatorUserId: x.coordinator_user_id, saleOrderId: x.sale_order_id, productId: x.product_id, unitCode: x.unit_code,
  quantity: String(x.quantity), grossMinor: BigInt(x.gross_minor), feeBps: Number(x.fee_bps), feeMinor: BigInt(x.fee_minor), netMinor: BigInt(x.net_minor), status: x.status,
  preparedBy: x.prepared_by, preparedAt: iso(x.prepared_at)!, confirmedBy: x.confirmed_by ?? null, confirmedAt: iso(x.confirmed_at), confirmReason: x.confirm_reason ?? null,
  settlementTxnId: x.settlement_txn_id ?? null, refusedBy: x.refused_by ?? null, refusedAt: iso(x.refused_at), refuseReason: x.refuse_reason ?? null,
});

@Injectable()
export class GroupLotSettlementRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // --- the sale order's own settlement (read only) ---------------------------------------------------------------------
  /** The order's lines with each listing's group lot. Read in kv_app's unit of work (RLS-bound to the event's tenant). */
  async orderLines(tx: TxContext, tenantId: string, orderId: string): Promise<Array<{ listingId: string; lineTotalMinor: bigint; groupLotId: string | null }>> {
    const r = await tx.query<any>(
      `SELECT oi.listing_id, oi.line_total_minor::text AS line_total, l.group_lot_id
         FROM order_items oi LEFT JOIN listings l ON l.id = oi.listing_id AND l.tenant_id = oi.tenant_id
        WHERE oi.order_id = $1 AND oi.tenant_id = $2`, [orderId, tenantId]);
    return r.rows.map((x: any) => ({ listingId: x.listing_id, lineTotalMinor: BigInt(x.line_total), groupLotId: x.group_lot_id ?? null }));
  }
  /** What the order's settlement paid its seller (payments' OrderCompletedHandler, `uq_settlement_line_order`). */
  async settlementLine(tx: TxContext, tenantId: string, orderId: string): Promise<{ sellerUserId: string; netMinor: bigint } | null> {
    const r = await tx.query<any>(`SELECT seller_user_id, net_minor::text AS net FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [tenantId, orderId]);
    return r.rows[0] ? { sellerUserId: r.rows[0].seller_user_id, netMinor: BigInt(r.rows[0].net) } : null;
  }
  /** The coupon top-up the seller was paid for this order (TENANT-10b: tenant Hold → seller Main at the same settlement). */
  async couponTopUp(tx: TxContext, tenantId: string, orderId: string): Promise<bigint> {
    const r = await tx.query<{ s: string }>(`SELECT COALESCE(sum(amount_minor), 0)::text AS s FROM coupon_redemptions WHERE tenant_id=$1 AND order_id=$2 AND settled_txn_id IS NOT NULL`, [tenantId, orderId]);
    return BigInt(r.rows[0]?.s ?? '0');
  }

  // --- the settlement ----------------------------------------------------------------------------------------------------
  async insert(tx: TxContext, s: { id: string; tenantId: string; groupLotId: string; coordinatorUserId: string; saleOrderId: string; productId: string; unitCode: string;
    quantity: string; grossMinor: bigint; feeBps: number; feeMinor: bigint; netMinor: bigint; preparedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO group_lot_settlements (id, tenant_id, group_lot_id, coordinator_user_id, sale_order_id, product_id, unit_code, quantity, gross_minor, fee_bps, fee_minor, net_minor, prepared_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,$9,$10,$11,$12,$13)`,
      [s.id, s.tenantId, s.groupLotId, s.coordinatorUserId, s.saleOrderId, s.productId, s.unitCode, s.quantity, s.grossMinor.toString(), s.feeBps,
        s.feeMinor.toString(), s.netMinor.toString(), s.preparedBy]);
  }
  async insertLine(tx: TxContext, l: { id: string; tenantId: string; settlementId: string; pledgeId: string; farmerUserId: string; quantity: string; shareMinor: bigint }): Promise<void> {
    await tx.query(`INSERT INTO group_lot_settlement_lines (id, tenant_id, settlement_id, pledge_id, farmer_user_id, quantity, share_minor) VALUES ($1,$2,$3,$4,$5,$6::numeric,$7)`,
      [l.id, l.tenantId, l.settlementId, l.pledgeId, l.farmerUserId, l.quantity, l.shareMinor.toString()]);
  }
  /** The live (prepared | confirmed) settlement of a lot, locked. */
  async liveForUpdate(tx: TxContext, tenantId: string, groupLotId: string): Promise<SettlementRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM group_lot_settlements WHERE tenant_id=$1 AND group_lot_id=$2 AND status IN ('prepared','confirmed') FOR UPDATE`, [tenantId, groupLotId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  /** The latest settlement of a lot (any status) — what the detail page shows. */
  async latest(tenantId: string, groupLotId: string, tx?: TxContext): Promise<SettlementRow | null> {
    const q = tx ?? this.replica.forTenant(tenantId);
    const r = await q.query(`SELECT ${COLS} FROM group_lot_settlements WHERE tenant_id=$1 AND group_lot_id=$2 ORDER BY created_at DESC, id DESC LIMIT 1`, [tenantId, groupLotId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async lines(tenantId: string, settlementId: string, tx?: TxContext): Promise<SettlementLineRow[]> {
    const q = tx ?? this.replica.forTenant(tenantId);
    const r = await q.query<any>(`SELECT id, pledge_id, farmer_user_id, quantity::text AS quantity, share_minor::text AS share FROM group_lot_settlement_lines
        WHERE tenant_id=$1 AND settlement_id=$2 ORDER BY share_minor DESC, id`, [tenantId, settlementId]);
    return r.rows.map((x: any) => ({ id: x.id, pledgeId: x.pledge_id, farmerUserId: x.farmer_user_id, quantity: String(x.quantity), shareMinor: BigInt(x.share) }));
  }
  /** Confirm. The trigger refuses `confirmed_by` = the preparer or the coordinator (maker ≠ checker) — BEFORE any money moves. */
  async markConfirmed(tx: TxContext, tenantId: string, id: string, by: string, reason: string | null, txnId: string): Promise<void> {
    const r = await tx.query(`UPDATE group_lot_settlements SET status='confirmed', confirmed_by=$3, confirmed_at=now(), confirm_reason=$4, settlement_txn_id=$5
        WHERE id=$1 AND tenant_id=$2 AND status='prepared'`, [id, tenantId, by, reason, txnId]);
    if (r.rowCount !== 1) throw new Error(`group_lot_settlements confirm touched ${r.rowCount} rows for ${id}`);
  }
  async markRefused(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    const r = await tx.query(`UPDATE group_lot_settlements SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4 WHERE id=$1 AND tenant_id=$2 AND status='prepared'`,
      [id, tenantId, by, reason]);
    if (r.rowCount !== 1) throw new Error(`group_lot_settlements refuse touched ${r.rowCount} rows for ${id}`);
  }

  /**
   * B — "Why pooling pays": the tenant's CONFIRMED pooled sales of THIS product, newest first — the realised seller proceeds and
   * the pooled quantity. The panel prints a figure only when three or more exist (the service decides).
   */
  async pooledHistory(tenantId: string, productId: string, unitCode: string, limit = 3): Promise<{ count: number; recent: Array<{ grossMinor: bigint; quantity: string }> }> {
    const q = this.replica.forTenant(tenantId);
    const c = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM group_lot_settlements WHERE tenant_id=$1 AND product_id=$2 AND unit_code=$3 AND status='confirmed'`, [tenantId, productId, unitCode]);
    const r = await q.query<any>(`SELECT gross_minor::text AS g, quantity::text AS q FROM group_lot_settlements WHERE tenant_id=$1 AND product_id=$2 AND unit_code=$3 AND status='confirmed'
        ORDER BY confirmed_at DESC, id DESC LIMIT $4`, [tenantId, productId, unitCode, limit]);
    return { count: Number(c.rows[0]?.n ?? 0), recent: r.rows.map((x: any) => ({ grossMinor: BigInt(x.g), quantity: String(x.q) })) };
  }
}
