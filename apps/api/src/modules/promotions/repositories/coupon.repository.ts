// modules/promotions/repositories/coupon.repository.ts
// All SQL for coupons. tenant_id in EVERY query (Law 1) + RLS. No version column → the redeem path
// locks the coupon row FOR UPDATE so the global cap (max_uses) can't be oversold. UNIQUE(tenant_id, code).
// PC-56 TENANT-10b: microsecond keyset (F-17); the tenant-wide list (B1); a soft delete that reports whether it deleted
// anything (F-12 — a delete of a missing id is a 404, never an audited no-op).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Coupon } from '../domain/coupon.entity';

const COLS = `id, tenant_id, promotion_id, code, max_uses, uses, per_user_limit, deleted_at, created_at, created_at::text AS created_at_raw`;
function toDomain(r: any): Coupon {
  return Coupon.rehydrate({ id: r.id, tenantId: r.tenant_id, promotionId: r.promotion_id, code: r.code, maxUses: r.max_uses, uses: r.uses, perUserLimit: r.per_user_limit, deletedAt: r.deleted_at, createdAt: r.created_at, createdAtRaw: r.created_at_raw ?? null });
}
type Page = { cursor?: { c: string; id: string }; limit: number };
const keyset = (p: (v: unknown) => string, q: Page) => {
  if (!q.cursor) return '';
  const cc = p(q.cursor.c), ci = p(q.cursor.id);
  return ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`;
};

@Injectable()
export class CouponRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Returns false on a (tenant, code) uniqueness conflict (code already exists). */
  async insert(tx: TxContext, c: Coupon): Promise<boolean> {
    const v = c.toProps();
    const r = await tx.query(
      `INSERT INTO coupons (id, tenant_id, promotion_id, code, max_uses, uses, per_user_limit, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, code) DO NOTHING`,
      [v.id, v.tenantId, v.promotionId, v.code, v.maxUses, v.uses, v.perUserLimit, tx.userId && /^[0-9a-f-]{36}$/i.test(tx.userId) ? tx.userId : null]);
    return (r.rowCount ?? 0) > 0;
  }
  /** Lock the live coupon by code for redemption (excludes soft-deleted). */
  async getByCodeForUpdate(tx: TxContext, tenantId: string, code: string): Promise<Coupon | null> {
    const r = await tx.query(`SELECT ${COLS} FROM coupons WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL FOR UPDATE`, [tenantId, code.toUpperCase()]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getByCode(tenantId: string, code: string): Promise<Coupon | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM coupons WHERE tenant_id=$1 AND code=$2 AND deleted_at IS NULL`, [tenantId, code.toUpperCase()]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Is this code already used by ANY coupon of the tenant (deleted ones too — UNIQUE(tenant_id, code) still holds them)? */
  async codeTaken(tenantId: string, code: string, tx?: TxContext): Promise<boolean> {
    const q = tx ?? this.replica.forTenant(tenantId);
    const r = await q.query(`SELECT 1 FROM coupons WHERE tenant_id=$1 AND code=$2 LIMIT 1`, [tenantId, code.trim().toUpperCase()]);
    return (r.rowCount ?? r.rows.length) > 0;
  }
  async getById(tenantId: string, id: string): Promise<Coupon | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM coupons WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getByIdForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Coupon | null> {
    const r = await tx.query(`SELECT ${COLS} FROM coupons WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Persist the consumed (or released) use within the redeem / release tx. */
  async updateUses(tx: TxContext, c: Coupon): Promise<void> {
    const v = c.toProps();
    await tx.query(`UPDATE coupons SET uses=$3, updated_at=now() WHERE id=$1 AND tenant_id=$2`, [v.id, v.tenantId, v.uses]);
  }
  /** F-12: returns how many rows it soft-deleted (0 = no such live coupon → the service answers 404, writes no audit). */
  async softDelete(tx: TxContext, tenantId: string, id: string): Promise<number> {
    const r = await tx.query(`UPDATE coupons SET deleted_at=now(), updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rowCount ?? 0;
  }
  async listForPromotion(tenantId: string, promotionId: string, q: Page): Promise<Coupon[]> {
    const params: unknown[] = [tenantId, promotionId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = `tenant_id=$1 AND promotion_id=$2 AND deleted_at IS NULL${keyset(p, q)}`;
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM coupons WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** B1 — every live coupon of the tenant (W130), newest first, microsecond keyset. */
  async listAll(tenantId: string, q: Page): Promise<Coupon[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const where = `tenant_id=$1 AND deleted_at IS NULL${keyset(p, q)}`;
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM coupons WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  async countAll(tenantId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT count(*)::int n FROM coupons WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId]);
    return r.rows[0].n as number;
  }
}
