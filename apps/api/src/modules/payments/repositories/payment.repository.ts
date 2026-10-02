// modules/payments/repositories/payment.repository.ts
// All SQL for the payments aggregate (tenant_id in EVERY query — Law 1; RLS is the net).
// Concurrency on the webhook path uses SELECT … FOR UPDATE (the schema has no version column;
// the row lock serializes concurrent webhook deliveries for the same payment).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Payment } from '../domain/payment.entity';
import { PaymentStatus } from '../domain/payment.state';

const COLS = `id, tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, refunded_minor,
  currency_code, status, provider_code, gateway_order_id, gateway_payment_id, method, idempotency_key,
  failure_code, failure_reason, ledger_txn_id, created_at`;
const big = (v: any) => BigInt(v);

function toDomain(r: any): Payment {
  return Payment.rehydrate({
    id: r.id, tenantId: r.tenant_id, userId: r.user_id, purposeId: r.purpose_id, referenceType: r.reference_type,
    referenceId: r.reference_id, amountMinor: big(r.amount_minor), refundedMinor: big(r.refunded_minor),
    currencyCode: r.currency_code, status: r.status as PaymentStatus, providerCode: r.provider_code,
    gatewayOrderId: r.gateway_order_id, gatewayPaymentId: r.gateway_payment_id, method: r.method,
    idempotencyKey: r.idempotency_key, failureCode: r.failure_code, failureReason: r.failure_reason,
    ledgerTxnId: r.ledger_txn_id, version: 1, createdAt: r.created_at,
  });
}

@Injectable()
export class PaymentRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** PC-56 TENANT-11a (F-2): what this order has ALREADY been credited in escrow by an auction deposit — the net of the
   *  escrow legs of `emd_apply` / `emd_forfeit` / `emd_return` txns referenced to the order (apply +EMD; forfeit / return
   *  −EMD). The winner's EMD was applied to the order at settlement, so the order is paid by `total − credit`, never by
   *  the total again (escrow would hold the EMD twice). 0 for every non-auction order. Read inside the caller's tx when
   *  given one (the wallet-pay path), else on the replica (the gateway intent check, outside any tx). */
  async orderEmdCreditMinor(tenantId: string, orderId: string, tx?: TxContext): Promise<bigint> {
    const sql = `SELECT COALESCE(sum(e.amount_minor), 0)::text AS n
         FROM ledger_transactions t JOIN lookup_values lv ON lv.id = t.txn_type_id
         JOIN ledger_entries e ON e.txn_id = t.id JOIN wallet_accounts w ON w.id = e.account_id
        WHERE t.tenant_id = $1 AND t.reference_type = 'order' AND t.reference_id = $2
          AND lv.code IN ('emd_apply', 'emd_forfeit', 'emd_return') AND w.owner_kind = 'platform' AND w.account_code = 'escrow'`;
    const r = tx ? await tx.query<{ n: string }>(sql, [tenantId, orderId]) : await this.replica.forTenant(tenantId).query<{ n: string }>(sql, [tenantId, orderId]);
    const n = BigInt(r.rows[0]?.n ?? '0');
    return n > 0n ? n : 0n;
  }

  async insert(tx: TxContext, p: Payment): Promise<void> {
    const v = p.toProps();
    await tx.query(
      `INSERT INTO payments (id, tenant_id, user_id, purpose_id, reference_type, reference_id, amount_minor, refunded_minor,
        currency_code, status, provider_code, gateway_order_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [v.id, v.tenantId, v.userId, v.purposeId, v.referenceType, v.referenceId, v.amountMinor.toString(), v.refundedMinor.toString(),
       v.currencyCode, v.status, v.providerCode, v.gatewayOrderId, v.idempotencyKey]);
  }

  /** Webhook path: lock the payment row for the gateway order (FOR UPDATE) within the tx. */
  async getByGatewayOrderForUpdate(tx: TxContext, tenantId: string, gatewayOrderId: string): Promise<Payment | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payments WHERE tenant_id=$1 AND gateway_order_id=$2 FOR UPDATE`, [tenantId, gatewayOrderId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** The captured (success) payment for an order — the source of the buyer + escrowed gross when a
   *  dispute resolves into a refund. In-tx read (no lock needed; the wallet post enforces no-overdraw). */
  async findSuccessByOrder(tx: TxContext, tenantId: string, orderId: string): Promise<Payment | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payments WHERE tenant_id=$1 AND reference_type='order' AND reference_id=$2 AND status='success' ORDER BY created_at DESC LIMIT 1`, [tenantId, orderId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Payment | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payments WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Persist a status/amount change + gateway ids + ledger link (full overwrite of mutable fields). */
  async update(tx: TxContext, p: Payment): Promise<void> {
    const v = p.toProps();
    await tx.query(
      `UPDATE payments SET status=$3, refunded_minor=$4, gateway_payment_id=$5, method=$6, failure_code=$7,
         failure_reason=$8, ledger_txn_id=$9, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [v.id, v.tenantId, v.status, v.refundedMinor.toString(), v.gatewayPaymentId, v.method, v.failureCode, v.failureReason, v.ledgerTxnId]);
  }

  async attachGatewayOrder(tx: TxContext, tenantId: string, id: string, gatewayOrderId: string): Promise<void> {
    await tx.query(`UPDATE payments SET gateway_order_id=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, gatewayOrderId]);
  }

  /** Visible to the owner or a moderator only (404 to others — no enumeration). */
  async getVisible(tenantId: string, id: string, viewerUserId: string, canModerate: boolean): Promise<Payment | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM payments WHERE id=$1 AND tenant_id=$2 AND ($3=true OR user_id=$4)`, [id, tenantId, canModerate, viewerUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async resolvePurposeId(tenantId: string, code: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string }>(
      `SELECT id FROM lookup_values WHERE type_code='payment_purpose' AND tenant_id IS NULL AND code=$1 AND is_active=true`, [code]);
    return r.rows[0]?.id ?? null;
  }

  /** Cursor list of a user's payments (keyset on created_at,id — never OFFSET). */
  async listForUser(tenantId: string, userId: string, opts: { cursor?: { c: string; id: string }; limit: number }): Promise<Payment[]> {
    const params: unknown[] = [tenantId, userId];
    let where = `tenant_id=$1 AND user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM payments WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
