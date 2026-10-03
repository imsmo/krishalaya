// modules/payments/repositories/commission-rule.repository.ts
// Resolves the MOST-SPECIFIC effective commission rule for an order. commission_rules is hybrid:
// tenant_id NULL = platform default, set = tenant override (RLS 0196, the 0175 split: read NULL-or-own, write own only). Every
// query binds tenant_id (Law 1). Specificity wins: a tenant/category/role/source-specific rule beats the platform default; ties
// broken by `priority` ASC, then the lowest id (a deterministic answer — F-21's duplicates were tied on everything). Effective-dated.
//
// PC-56 TENANT-SW-a: a TENANT row is written ONLY by a confirmed commission_rule_proposal (0196 trg_commission_rules_gate) — the
// writers below run inside the confirming / applying transaction and cite the proposal (app.commission_proposal_id). Its
// platform_share_bps is the plan floor (kv_commission_platform_share_bps), never a caller's figure. Soft-retired rows
// (deleted_at, F-21's duplicates) never resolve. Lists page on a MICROSECOND keyset (F-14).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { CommissionRuleValues } from '../domain/commission-rule.entity';
import { RuleCandidate } from '../domain/commission-proposal';
import { US_SQL } from '../../../shared/pagination/us-keyset';

export interface ResolvedCommissionRule extends CommissionRuleValues { id: string; scope: 'tenant' | 'platform'; }

export interface CommissionQuery { tenantId: string; categoryId: string | null; sellerRoleId: string | null; source: string | null; onDate?: string; }

function toValues(r: any): ResolvedCommissionRule {
  return { id: r.id, scope: r.tenant_id == null ? 'platform' : 'tenant', rateBps: r.rate_bps, fixedMinor: BigInt(r.fixed_minor),
    capMinor: r.cap_minor != null ? BigInt(r.cap_minor) : null, platformShareBps: r.platform_share_bps, chargedTo: r.charged_to };
}

export interface CommissionRuleRow {
  id: string; tenantId: string | null; categoryId: string | null; source: string | null; sellerRoleId: string | null;
  rateBps: number; fixedMinor: string; capMinor: string | null; platformShareBps: number; chargedTo: 'seller' | 'buyer';
  priority: number; effectiveFrom: string; effectiveTo: string | null; isActive: boolean; createdAt: string;
  proposalId: string | null; deactivationProposalId: string | null;
}
const CAT_COLS = `id, tenant_id, category_id, source, seller_role_id, rate_bps, fixed_minor, cap_minor, platform_share_bps, charged_to, priority,
  effective_from::text AS effective_from, effective_to::text AS effective_to, is_active, ${US_SQL('created_at')} AS created_us, proposal_id, deactivation_proposal_id`;
function toCatalogRow(r: any): CommissionRuleRow {
  return { id: r.id, tenantId: r.tenant_id, categoryId: r.category_id, source: r.source, sellerRoleId: r.seller_role_id,
    rateBps: r.rate_bps, fixedMinor: String(r.fixed_minor), capMinor: r.cap_minor != null ? String(r.cap_minor) : null,
    platformShareBps: r.platform_share_bps, chargedTo: r.charged_to, priority: r.priority,
    effectiveFrom: r.effective_from, effectiveTo: r.effective_to ?? null, isActive: r.is_active, createdAt: r.created_us,
    proposalId: r.proposal_id ?? null, deactivationProposalId: r.deactivation_proposal_id ?? null };
}

@Injectable()
export class CommissionRuleRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Resolve within the caller's tx. Binds tenant_id + matches NULL (= "applies to all") dimensions; most specific first. */
  async resolveBest(tx: TxContext, q: CommissionQuery): Promise<ResolvedCommissionRule | null> {
    const r = await tx.query(
      `SELECT id, tenant_id, rate_bps, fixed_minor, cap_minor, platform_share_bps, charged_to
         FROM commission_rules
        WHERE is_active = true AND deleted_at IS NULL
          AND (tenant_id = $1 OR tenant_id IS NULL)
          AND (category_id = $2 OR category_id IS NULL)
          AND (seller_role_id = $3 OR seller_role_id IS NULL)
          AND (source = $4 OR source IS NULL)
          AND effective_from <= COALESCE($5::date, CURRENT_DATE)
          AND (effective_to IS NULL OR effective_to >= COALESCE($5::date, CURRENT_DATE))
        ORDER BY (tenant_id IS NOT NULL) DESC, (category_id IS NOT NULL) DESC,
                 (seller_role_id IS NOT NULL) DESC, (source IS NOT NULL) DESC, priority ASC, id ASC
        LIMIT 1`,
      [q.tenantId, q.categoryId, q.sellerRoleId, q.source, q.onDate ?? null]);
    return r.rows[0] ? toValues(r.rows[0]) : null;
  }

  /** Every live rule (own + platform) as resolution candidates — the W149 "resolution example" evaluates them in TypeScript with
   *  the resolver's own order (domain/commission-proposal.ts resolveAmong), so the review step can show "after this change". */
  async candidates(tenantId: string): Promise<RuleCandidate[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, tenant_id, category_id, seller_role_id, source, priority, effective_from::text ef, effective_to::text et, is_active
         FROM commission_rules WHERE (tenant_id = $1 OR tenant_id IS NULL) AND deleted_at IS NULL AND is_active ORDER BY id LIMIT 500`, [tenantId]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, categoryId: x.category_id, sellerRoleId: x.seller_role_id, source: x.source,
      priority: x.priority, effectiveFrom: x.ef, effectiveTo: x.et ?? null, isActive: x.is_active }));
  }

  /** The tenant's plan floor — the ONLY platform share a tenant row may carry (0196). */
  async platformShareFloor(tx: TxContext, tenantId: string): Promise<number> {
    const r = await tx.query<{ bps: number }>(`SELECT kv_commission_platform_share_bps($1) AS bps`, [tenantId]);
    return Number(r.rows[0].bps);
  }
  async platformShareFloorRead(tenantId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT kv_commission_platform_share_bps($1) AS bps`, [tenantId]);
    return Number(r.rows[0].bps);
  }

  /** Insert the TENANT rule a confirmation writes. The caller has set app.commission_proposal_id in this tx; the trigger checks the
   *  row equals what two administrators confirmed and that the share is the plan floor. */
  async insertConfirmedTx(tx: TxContext, r: { id: string; tenantId: string; proposalId: string; categoryId: string | null; source: string | null;
    sellerRoleId: string | null; rateBps: number; fixedMinor: string; capMinor: string | null; platformShareBps: number; chargedTo: 'seller' | 'buyer';
    priority: number; effectiveFrom: string; effectiveTo: string | null; createdBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO commission_rules (id, tenant_id, category_id, source, seller_role_id, rate_bps, fixed_minor, cap_minor, platform_share_bps, charged_to,
                                     priority, effective_from, effective_to, is_active, proposal_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date,$13::date,true,$14,$15)`,
      [r.id, r.tenantId, r.categoryId, r.source, r.sellerRoleId, r.rateBps, r.fixedMinor, r.capMinor, r.platformShareBps, r.chargedTo, r.priority,
       r.effectiveFrom, r.effectiveTo, r.proposalId, r.createdBy]);
  }

  /** Lock a tenant-owned rule. NULL-tenant (platform) rows are never returned (write-protected here). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<CommissionRuleRow | null> {
    const r = await tx.query(`SELECT ${CAT_COLS} FROM commission_rules WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toCatalogRow(r.rows[0]) : null;
  }
  async getRead(tenantId: string, id: string): Promise<CommissionRuleRow | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${CAT_COLS} FROM commission_rules WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL) AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toCatalogRow(r.rows[0]) : null;
  }

  /** A confirmed deactivation end-dates the rule (the last day it is in force = the day before the proposal's date). */
  async endDateTx(tx: TxContext, tenantId: string, id: string, lastDay: string, proposalId: string): Promise<number> {
    const r = await tx.query(`UPDATE commission_rules SET effective_to=$3::date, deactivation_proposal_id=$4, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [id, tenantId, lastDay, proposalId]);
    return r.rowCount ?? 0;
  }
  /** At the effective IST midnight the apply job flips is_active (the trigger refuses it any earlier). */
  async deactivateTx(tx: TxContext, tenantId: string, id: string): Promise<number> {
    const r = await tx.query(`UPDATE commission_rules SET is_active=false, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND is_active`, [id, tenantId]);
    return r.rowCount ?? 0;
  }

  /** The tenant's own rules (and, optionally, the inherited platform defaults — read-only). Microsecond keyset (F-14). */
  async list(tenantId: string, q: { activeOnly: boolean; includePlatformDefaults: boolean; cursor?: { ts: string; id: string }; limit: number }): Promise<CommissionRuleRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = (q.includePlatformDefaults ? `(tenant_id=$1 OR tenant_id IS NULL)` : `tenant_id=$1`) + ` AND deleted_at IS NULL`;
    if (q.activeOnly) where += ` AND is_active = true`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${CAT_COLS} FROM commission_rules WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toCatalogRow);
  }
}
