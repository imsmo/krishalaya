// modules/promotions/repositories/coupon-redemption.repository.ts
// APPEND-ONLY redemption ledger. tenant_id in EVERY query (Law 1) + RLS. UNIQUE(coupon_id, order_id) makes redemption
// idempotent per order.
//
// PC-56 TENANT-10b (0185) — THE ROW NOW SAYS WHAT HAPPENED TO ITS MONEY. `hold_txn_id` is written WITH the row (the
// reservation was posted first, in the same tx); `settled_txn_id`/`settled_at` are stamped once by settlement (the relay's
// transaction, kv_relay — 0185 grants it exactly those two columns); `released_txn_id`/`released_at` once by the
// cancel/refund release (kv_app — exactly those two). A trigger refuses every other UPDATE and every DELETE.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { CouponRedemption } from '../domain/coupon-redemption.entity';

/** A redemption as the money legs need it (locked in-tx). */
export interface RedemptionMoneyRow {
  id: string; couponId: string; userId: string; orderId: string | null; amountMinor: bigint;
  holdTxnId: string | null; settledTxnId: string | null; releasedTxnId: string | null;
}
const moneyRow = (x: any): RedemptionMoneyRow => ({
  id: x.id, couponId: x.coupon_id, userId: x.user_id, orderId: x.order_id, amountMinor: BigInt(x.amount_minor),
  holdTxnId: x.hold_txn_id ?? null, settledTxnId: x.settled_txn_id ?? null, releasedTxnId: x.released_txn_id ?? null,
});

@Injectable()
export class CouponRedemptionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Returns false if a redemption already exists for (coupon, order) — idempotent per order. `holdTxnId` is the
   *  reservation already posted in this tx (NULL only for a backstop redemption the tenant could not fund). */
  async insert(tx: TxContext, r: CouponRedemption, holdTxnId: string | null = null): Promise<boolean> {
    const v = r.props;
    const res = await tx.query(
      `INSERT INTO coupon_redemptions (id, coupon_id, tenant_id, user_id, order_id, amount_minor, hold_txn_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (coupon_id, order_id) DO NOTHING`,
      [v.id, v.couponId, v.tenantId, v.userId, v.orderId, v.amountMinor.toString(), holdTxnId]);
    return (res.rowCount ?? 0) > 0;
  }
  /** Whether a redemption already exists for (coupon, order) — read in-tx before a hold is posted. */
  async existsFor(tx: TxContext, tenantId: string, couponId: string, orderId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM coupon_redemptions WHERE tenant_id=$1 AND coupon_id=$2 AND order_id=$3`, [tenantId, couponId, orderId]);
    return (r.rowCount ?? r.rows.length) > 0;
  }
  /** How many LIVE times this user has redeemed this coupon (enforces per_user_limit). A redemption whose order was
   *  cancelled before settlement gave its use back (A3) and no longer counts. In-tx under the coupon lock, or on the
   *  replica for the preview — the same predicate either way (A5). */
  async countForUser(tx: TxContext | null, tenantId: string, couponId: string, userId: string): Promise<number> {
    const q = tx ?? this.replica.forTenant(tenantId);
    const r = await q.query(`SELECT count(*)::int n FROM coupon_redemptions WHERE tenant_id=$1 AND coupon_id=$2 AND user_id=$3 AND released_at IS NULL`, [tenantId, couponId, userId]);
    return r.rows[0].n as number;
  }
  /** Every redemption of an order, LOCKED (the settlement and the release race for the same row — first one wins). */
  async forOrderForUpdate(tx: TxContext, tenantId: string, orderId: string): Promise<RedemptionMoneyRow[]> {
    const r = await tx.query(
      `SELECT id, coupon_id, user_id, order_id, amount_minor, hold_txn_id, settled_txn_id, released_txn_id
         FROM coupon_redemptions WHERE tenant_id=$1 AND order_id=$2 ORDER BY id FOR UPDATE`, [tenantId, orderId]);
    return r.rows.map(moneyRow);
  }
  /** Stamp the settlement (once — the trigger refuses a second). Returns rows stamped. */
  async markSettled(tx: TxContext, tenantId: string, id: string, txnId: string): Promise<number> {
    const r = await tx.query(`UPDATE coupon_redemptions SET settled_txn_id=$3, settled_at=now() WHERE id=$1 AND tenant_id=$2 AND settled_txn_id IS NULL AND released_txn_id IS NULL`, [id, tenantId, txnId]);
    return r.rowCount ?? 0;
  }
  /** Stamp the release (once). Returns rows stamped. */
  async markReleased(tx: TxContext, tenantId: string, id: string, txnId: string): Promise<number> {
    const r = await tx.query(`UPDATE coupon_redemptions SET released_txn_id=$3, released_at=now() WHERE id=$1 AND tenant_id=$2 AND settled_txn_id IS NULL AND released_txn_id IS NULL`, [id, tenantId, txnId]);
    return r.rowCount ?? 0;
  }
  async listForUser(tenantId: string, userId: string, q: { cursor?: { c: string; id: string }; limit: number }): Promise<Array<{ id: string; couponId: string; orderId: string; amountMinor: string; createdAt: Date; createdAtRaw: string }>> {
    const params: unknown[] = [tenantId, userId];
    let where = `tenant_id=$1 AND user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT id, coupon_id, order_id, amount_minor, created_at, created_at::text AS raw FROM coupon_redemptions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x) => ({ id: x.id, couponId: x.coupon_id, orderId: x.order_id, amountMinor: String(x.amount_minor), createdAt: x.created_at, createdAtRaw: x.raw }));
  }
}
