// modules/payments/repositories/commission-rule-proposal.repository.ts · PC-56 TENANT-SW-a · A3 — SQL for commission_rule_proposals
// (0196, 13b shape). tenant_id in every query (Law 1) + RLS (0175 split, FORCE). kv_app holds SELECT, INSERT and a column-limited
// UPDATE (the decision columns only) — what was proposed cannot be rewritten (trg_crp_moves). Lists page on a microsecond keyset.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';

export type CommissionProposalStatus = 'proposed' | 'confirmed' | 'refused' | 'expired' | 'applied';
export interface CommissionProposalRow {
  id: string; tenantId: string; kind: 'create' | 'deactivate'; targetRuleId: string | null;
  categoryId: string | null; source: string | null; sellerRoleId: string | null;
  rateBps: number | null; fixedMinor: string | null; capMinor: string | null; chargedTo: 'seller' | 'buyer' | null; priority: number | null;
  effectiveFrom: string; effectiveTo: string | null; reason: string;
  proposedBy: string; proposedAt: string; expiresAt: string; status: CommissionProposalStatus;
  confirmedBy: string | null; confirmedAt: string | null; ruleId: string | null;
  refusedBy: string | null; refusedAt: string | null; refuseReason: string | null;
  expiredAt: string | null; appliedAt: string | null; createdAt: string;
}
const COLS = `id, tenant_id, kind, target_rule_id, category_id, source, seller_role_id, rate_bps, fixed_minor, cap_minor, charged_to, priority,
  effective_from::text ef, effective_to::text et, reason, proposed_by, proposed_at, expires_at, status, confirmed_by, confirmed_at, rule_id,
  refused_by, refused_at, refuse_reason, expired_at, applied_at, ${US_SQL('created_at')} AS created_us`;
const iso = (d: any) => (d == null ? null : new Date(d).toISOString());
function toRow(r: any): CommissionProposalRow {
  return { id: r.id, tenantId: r.tenant_id, kind: r.kind, targetRuleId: r.target_rule_id, categoryId: r.category_id, source: r.source,
    sellerRoleId: r.seller_role_id, rateBps: r.rate_bps, fixedMinor: r.fixed_minor != null ? String(r.fixed_minor) : null,
    capMinor: r.cap_minor != null ? String(r.cap_minor) : null, chargedTo: r.charged_to, priority: r.priority,
    effectiveFrom: r.ef, effectiveTo: r.et ?? null, reason: r.reason, proposedBy: r.proposed_by, proposedAt: iso(r.proposed_at)!,
    expiresAt: iso(r.expires_at)!, status: r.status, confirmedBy: r.confirmed_by, confirmedAt: iso(r.confirmed_at), ruleId: r.rule_id,
    refusedBy: r.refused_by, refusedAt: iso(r.refused_at), refuseReason: r.refuse_reason, expiredAt: iso(r.expired_at),
    appliedAt: iso(r.applied_at), createdAt: r.created_us };
}

@Injectable()
export class CommissionRuleProposalRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertTx(tx: TxContext, p: { id: string; tenantId: string; kind: 'create' | 'deactivate'; targetRuleId: string | null;
    categoryId: string | null; source: string | null; sellerRoleId: string | null; rateBps: number | null; fixedMinor: string | null;
    capMinor: string | null; chargedTo: 'seller' | 'buyer' | null; priority: number | null; effectiveFrom: string; effectiveTo: string | null;
    reason: string; proposedBy: string }): Promise<void> {
    // proposed_at / expires_at from ONE now() so the trigger's "expires 7 days after it is made" holds to the microsecond
    await tx.query(
      `INSERT INTO commission_rule_proposals (id, tenant_id, kind, target_rule_id, category_id, source, seller_role_id, rate_bps, fixed_minor, cap_minor,
                                              charged_to, priority, effective_from, effective_to, reason, proposed_by, proposed_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,$15,$16, now(), now() + interval '7 days')`,
      [p.id, p.tenantId, p.kind, p.targetRuleId, p.categoryId, p.source, p.sellerRoleId, p.rateBps, p.fixedMinor, p.capMinor, p.chargedTo,
       p.priority, p.effectiveFrom, p.effectiveTo, p.reason, p.proposedBy]);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<CommissionProposalRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM commission_rule_proposals WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
  async get(tenantId: string, id: string): Promise<CommissionProposalRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM commission_rule_proposals WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async confirmTx(tx: TxContext, tenantId: string, id: string, by: string, ruleId: string | null): Promise<void> {
    await tx.query(`UPDATE commission_rule_proposals SET status='confirmed', confirmed_by=$3, confirmed_at=now(), rule_id=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, ruleId]);
  }
  async refuseTx(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<void> {
    await tx.query(`UPDATE commission_rule_proposals SET status='refused', refused_by=$3, refused_at=now(), refuse_reason=$4 WHERE id=$1 AND tenant_id=$2`, [id, tenantId, by, reason]);
  }
  async markAppliedTx(tx: TxContext, tenantId: string, id: string): Promise<number> {
    const r = await tx.query(`UPDATE commission_rule_proposals SET status='applied', applied_at=now() WHERE id=$1 AND tenant_id=$2 AND status='confirmed'`, [id, tenantId]);
    return r.rowCount ?? 0;
  }
  async markExpiredTx(tx: TxContext, tenantId: string, id: string, note: string): Promise<number> {
    const r = await tx.query(`UPDATE commission_rule_proposals SET status='expired', expired_at=now(), expire_note=$3 WHERE id=$1 AND tenant_id=$2 AND status='proposed' AND expires_at <= now()`, [id, tenantId, note]);
    return r.rowCount ?? 0;
  }

  /** Confirmed proposals whose IST effective date has arrived. */
  async dueToApplyTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM commission_rule_proposals WHERE tenant_id=$1 AND status='confirmed' AND effective_from <= kv_ist_today() ORDER BY effective_from, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x) => x.id);
  }
  async dueToExpireTx(tx: TxContext, tenantId: string, limit: number): Promise<string[]> {
    const r = await tx.query<{ id: string }>(`SELECT id FROM commission_rule_proposals WHERE tenant_id=$1 AND status='proposed' AND expires_at <= now() ORDER BY expires_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x) => x.id);
  }

  async list(tenantId: string, q: { status?: CommissionProposalStatus; cursor?: { ts: string; id: string }; limit: number }): Promise<CommissionProposalRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM commission_rule_proposals WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toRow);
  }

  /** Active, unsuspended tenant_admins — a second signature must exist before a proposal is worth making. */
  async adminCountTx(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query<{ n: number }>(
      `SELECT count(DISTINCT utr.user_id)::int n FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id=$1 AND ro.code='tenant_admin' AND utr.is_active AND utr.deleted_at IS NULL AND kv_is_tenant_admin($1, utr.user_id)`, [tenantId]);
    return r.rows[0]?.n ?? 0;
  }
  /** Every active member — the recipients of the effective-date notice. */
  async memberUserIdsTx(tx: TxContext, tenantId: string): Promise<string[]> {
    const r = await tx.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM user_tenant_roles WHERE tenant_id=$1 AND is_active AND deleted_at IS NULL ORDER BY user_id LIMIT 50000`, [tenantId]);
    return r.rows.map((x) => x.user_id);
  }
}
