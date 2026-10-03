// modules/payments/repositories/settlement-hold.repository.ts · PC-56 TENANT-SW-a · D1 / C1 — settlement_holds + settlement_deferrals
// (0196). tenant_id in every query + RLS (FORCE). Always in the caller's kv_app transaction: the settlement handler LOCKS the open holds
// of an order (FOR UPDATE) before it decides, and a release takes the same row locks, so "settle now" and "defer" can never both miss.
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';

export type HoldReason = 'pod_review' | 'cod_shortfall';
export interface OpenHold { id: string; reason: HoldReason; sourceId: string; openedAt: string }

@Injectable()
export class SettlementHoldRepository {
  /** Open holds of one order, LOCKED for this transaction. */
  async lockOpenTx(tx: TxContext, tenantId: string, orderId: string): Promise<OpenHold[]> {
    const r = await tx.query(`SELECT id, reason, source_id, opened_at FROM settlement_holds WHERE tenant_id=$1 AND order_id=$2 AND released_at IS NULL ORDER BY opened_at, id FOR UPDATE`, [tenantId, orderId]);
    return r.rows.map((x: any) => ({ id: x.id, reason: x.reason, sourceId: x.source_id, openedAt: new Date(x.opened_at).toISOString() }));
  }
  /** Idempotent per (order, reason, source) while open. Returns the hold id (new or existing). */
  async openTx(tx: TxContext, h: { tenantId: string; orderId: string; reason: HoldReason; sourceId: string; openedBy: string | null }): Promise<string> {
    const r = await tx.query<{ id: string }>(
      `INSERT INTO settlement_holds (tenant_id, order_id, reason, source_id, opened_by) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, order_id, reason, source_id) WHERE released_at IS NULL DO NOTHING RETURNING id`,
      [h.tenantId, h.orderId, h.reason, h.sourceId, h.openedBy]);
    if (r.rows[0]) return r.rows[0].id;
    const e = await tx.query<{ id: string }>(`SELECT id FROM settlement_holds WHERE tenant_id=$1 AND order_id=$2 AND reason=$3 AND source_id=$4 AND released_at IS NULL`, [h.tenantId, h.orderId, h.reason, h.sourceId]);
    return e.rows[0].id;
  }
  /** Release the open hold for (order, reason, source); returns rows moved (0 = nothing was open). */
  async releaseTx(tx: TxContext, h: { tenantId: string; orderId: string; reason: HoldReason; sourceId: string; releasedBy: string | null; note: string }): Promise<number> {
    const r = await tx.query(
      `UPDATE settlement_holds SET released_at=now(), released_by=$5, release_note=$6
        WHERE tenant_id=$1 AND order_id=$2 AND reason=$3 AND source_id=$4 AND released_at IS NULL`,
      [h.tenantId, h.orderId, h.reason, h.sourceId, h.releasedBy, h.note]);
    return r.rowCount ?? 0;
  }
  async openCountTx(tx: TxContext, tenantId: string, orderId: string): Promise<number> {
    const r = await tx.query<{ n: number }>(`SELECT count(*)::int n FROM settlement_holds WHERE tenant_id=$1 AND order_id=$2 AND released_at IS NULL`, [tenantId, orderId]);
    return r.rows[0].n;
  }

  /** A completion that met an open hold: keep its payload to settle on release (idempotent per order). */
  async deferTx(tx: TxContext, tenantId: string, orderId: string, payload: Record<string, unknown>): Promise<void> {
    await tx.query(`INSERT INTO settlement_deferrals (tenant_id, order_id, payload) VALUES ($1,$2,$3::jsonb) ON CONFLICT (tenant_id, order_id) DO NOTHING`, [tenantId, orderId, JSON.stringify(payload)]);
  }
  async deferralTx(tx: TxContext, tenantId: string, orderId: string): Promise<{ payload: Record<string, unknown>; settledAt: string | null } | null> {
    const r = await tx.query(`SELECT payload, settled_at FROM settlement_deferrals WHERE tenant_id=$1 AND order_id=$2`, [tenantId, orderId]);
    return r.rows[0] ? { payload: r.rows[0].payload, settledAt: r.rows[0].settled_at ? new Date(r.rows[0].settled_at).toISOString() : null } : null;
  }
  async markDeferralSettledTx(tx: TxContext, tenantId: string, orderId: string): Promise<void> {
    await tx.query(`UPDATE settlement_deferrals SET settled_at=now() WHERE tenant_id=$1 AND order_id=$2 AND settled_at IS NULL`, [tenantId, orderId]);
  }
}
