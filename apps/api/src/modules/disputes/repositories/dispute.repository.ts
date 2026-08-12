// modules/disputes/repositories/dispute.repository.ts
// All SQL for the disputes aggregate + the dispute_eligibility gate + dispute_reason resolution.
// tenant_id in EVERY query (Law 1) + RLS. No version column (add_std_columns) → mutations LOCK the row
// with SELECT … FOR UPDATE. Reads on the replica.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Dispute } from '../domain/dispute.entity';
import { DisputeStatus } from '../domain/dispute.state';

const COLS = `id, tenant_id, order_id, raised_by, against_user, reason_id, description, status, seller_respond_by,
  ai_triage, resolution_type, resolution_amount_minor, resolution_txn_id, resolved_by, resolved_at, sla_due_at, created_at,
  disputed_amount_minor, disputed_quantity`;
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): Dispute {
  return Dispute.rehydrate({
    id: r.id, tenantId: r.tenant_id, orderId: r.order_id, raisedBy: r.raised_by, againstUser: r.against_user, reasonId: r.reason_id,
    description: r.description, status: r.status as DisputeStatus, sellerRespondBy: r.seller_respond_by, aiTriage: r.ai_triage,
    resolutionType: r.resolution_type, resolutionAmountMinor: big(r.resolution_amount_minor), resolutionTxnId: r.resolution_txn_id,
    resolvedBy: r.resolved_by, resolvedAt: r.resolved_at, slaDueAt: r.sla_due_at, createdAt: r.created_at,
    disputedAmountMinor: big(r.disputed_amount_minor),
    // numeric(14,3) arrives as a string from pg and STAYS one — parsing it to a float is how 2.500 qtl becomes
    // 2.4999999999999996 in a document a farmer reads.
    disputedQuantity: r.disputed_quantity == null ? null : String(r.disputed_quantity),
  });
}
export interface DisputeListQuery { raisedBy?: string; againstUser?: string; status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class DisputeRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- dispute_eligibility (who-can-dispute gate) ----
  async insertEligibility(tx: TxContext, tenantId: string, orderId: string, buyerUserId: string, sellerUserId: string): Promise<void> {
    await tx.query(
      `INSERT INTO dispute_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`, [tenantId, orderId, buyerUserId, sellerUserId]);
  }
  async eligibilityFor(tenantId: string, orderId: string): Promise<{ buyerUserId: string; sellerUserId: string } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT buyer_user_id, seller_user_id FROM dispute_eligibility WHERE tenant_id=$1 AND order_id=$2`, [tenantId, orderId]);
    return r.rows[0] ? { buyerUserId: r.rows[0].buyer_user_id, sellerUserId: r.rows[0].seller_user_id } : null;
  }

  // ---- dispute_reason resolution (global lookup reference, like units/currencies) ----
  async resolveReasonId(tenantId: string, code: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id FROM lookup_values WHERE type_code='dispute_reason' AND code=$1 AND tenant_id IS NULL`, [code]);
    return r.rows[0]?.id ?? null;
  }

  // ---- disputes ----
  async insert(tx: TxContext, d: Dispute): Promise<void> {
    const p = d.toProps();
    await tx.query(
      `INSERT INTO disputes (id, tenant_id, order_id, raised_by, against_user, reason_id, description, status, seller_respond_by, sla_due_at,
                             disputed_amount_minor, disputed_quantity)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [p.id, p.tenantId, p.orderId, p.raisedBy, p.againstUser, p.reasonId, p.description, p.status, p.sellerRespondBy, p.slaDueAt,
       p.disputedAmountMinor?.toString() ?? null, p.disputedQuantity]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Dispute | null> {
    const r = await tx.query(`SELECT ${COLS} FROM disputes WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Dispute | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM disputes WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** No version column → unconditional update within the FOR UPDATE-locked tx. */
  async update(tx: TxContext, d: Dispute): Promise<void> {
    const p = d.toProps();
    await tx.query(
      `UPDATE disputes SET status=$3, seller_respond_by=$4, ai_triage=$5, resolution_type=$6, resolution_amount_minor=$7,
         resolution_txn_id=$8, resolved_by=$9, resolved_at=$10, sla_due_at=$11, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.status, p.sellerRespondBy, p.aiTriage ? JSON.stringify(p.aiTriage) : null, p.resolutionType,
       p.resolutionAmountMinor?.toString() ?? null, p.resolutionTxnId, p.resolvedBy, p.resolvedAt, p.slaDueAt]);
  }

  /** The raiser already has an ACTIVE dispute on this order? (bounds dispute spam). */
  async hasActiveForOrderRaiser(tx: TxContext, tenantId: string, orderId: string, raisedBy: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM disputes WHERE tenant_id=$1 AND order_id=$2 AND raised_by=$3
         AND status IN ('open','seller_responded','under_review','escalated') LIMIT 1`, [tenantId, orderId, raisedBy]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Link the ledger reversal txn to a resolved dispute (idempotent: only stamps once). */
  async stampResolutionTxn(tx: TxContext, tenantId: string, id: string, txnId: string): Promise<void> {
    await tx.query(`UPDATE disputes SET resolution_txn_id=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND resolution_txn_id IS NULL`, [id, tenantId, txnId]);
  }

  async listFor(tenantId: string, q: DisputeListQuery): Promise<Dispute[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.raisedBy) where += ` AND raised_by=${p(q.raisedBy)}`;
    if (q.againstUser) where += ` AND against_user=${p(q.againstUser)}`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM disputes WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
