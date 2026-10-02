// modules/promotions/repositories/promotion.repository.ts
// All SQL for the promotions aggregate. tenant_id in EVERY query (Law 1) + RLS. No version column
// (add_std_columns) → budget mutations lock the row with SELECT … FOR UPDATE. Reads on the replica.
// PC-56 TENANT-10b: the human-pause bit (paused_by_user_id / paused_at, 0185) is read and written here; lists page on the
// microsecond keyset (`created_at::text`, F-17) and count their total ("Showing N of M").
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Promotion, parsePromoRules } from '../domain/promotion.entity';

const COLS = `id, tenant_id, promo_type, default_name, rules, budget_minor, spent_minor, starts_at, ends_at, is_active, created_at,
  created_at::text AS created_at_raw, paused_by_user_id, paused_at`;
const big = (v: any) => (v == null ? null : BigInt(v));
function toDomain(r: any): Promotion {
  return Promotion.rehydrate({
    id: r.id, tenantId: r.tenant_id, promoType: r.promo_type, defaultName: r.default_name, rules: parsePromoRules(r.rules),
    budgetMinor: big(r.budget_minor), spentMinor: BigInt(r.spent_minor), startsAt: r.starts_at, endsAt: r.ends_at, isActive: r.is_active, createdAt: r.created_at,
    createdAtRaw: r.created_at_raw ?? null, pausedByUserId: r.paused_by_user_id ?? null, pausedAt: r.paused_at ?? null,
  });
}
export interface PromoListQuery { activeOnly?: boolean; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class PromotionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, p: Promotion): Promise<void> {
    const v = p.toProps();
    await tx.query(
      `INSERT INTO promotions (id, tenant_id, promo_type, default_name, rules, budget_minor, spent_minor, starts_at, ends_at, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)`,
      [v.id, v.tenantId, v.promoType, v.defaultName, JSON.stringify(rulesToJson(v.rules)), v.budgetMinor?.toString() ?? null, v.spentMinor.toString(), v.startsAt, v.endsAt, v.isActive,
        tx.userId && /^[0-9a-f-]{36}$/i.test(tx.userId) ? tx.userId : null]);
  }
  /** Lock for a budget/active mutation (serializes concurrent redemptions sharing a budget). */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Promotion | null> {
    const r = await tx.query(`SELECT ${COLS} FROM promotions WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Promotion | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM promotions WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Read inside a tx without a lock (the preview's facts, the coupon act's re-check). */
  async getInTx(tx: TxContext, tenantId: string, id: string): Promise<Promotion | null> {
    const r = await tx.query(`SELECT ${COLS} FROM promotions WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** No version column → unconditional update within the FOR UPDATE-locked tx (spend + active toggle + the pause bit). */
  async update(tx: TxContext, p: Promotion): Promise<void> {
    const v = p.toProps();
    await tx.query(`UPDATE promotions SET spent_minor=$3, is_active=$4, paused_by_user_id=$5, paused_at=$6, updated_at=now() WHERE id=$1 AND tenant_id=$2`,
      [v.id, v.tenantId, v.spentMinor.toString(), v.isActive, v.pausedByUserId ?? null, v.pausedAt ?? null]);
  }
  /** Microsecond keyset (F-17): `created_at < $c::timestamptz` round-trips the column's own text exactly. */
  async listFor(tenantId: string, q: PromoListQuery): Promise<Promotion[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (val: unknown) => { params.push(val); return `$${params.length}`; };
    if (q.activeOnly) where += ` AND is_active=true`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM promotions WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  async countFor(tenantId: string, activeOnly?: boolean): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT count(*)::int n FROM promotions WHERE tenant_id=$1 AND deleted_at IS NULL${activeOnly ? ' AND is_active=true' : ''}`, [tenantId]);
    return r.rows[0].n as number;
  }
  /** Names for a set of promotion ids (the coupon list's Promotion column). */
  async namesFor(tenantId: string, ids: string[]): Promise<Map<string, Promotion>> {
    if (ids.length === 0) return new Map();
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM promotions WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
    return new Map(r.rows.map((x: any) => [x.id as string, toDomain(x)]));
  }

  // ---- worker-job finders (cross-tenant; kv_relay, BYPASSRLS). Bounded + SKIP LOCKED. ----
  /** promo-budget-watch: ACTIVE promotions that have hit/exceeded their budget. */
  async findBudgetExhausted(tx: TxContext, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await tx.query(
      `SELECT id, tenant_id FROM promotions
        WHERE is_active = true AND budget_minor IS NOT NULL AND spent_minor >= budget_minor
        ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id }));
  }
  /** festival-campaign-scheduler: 'festival' promotions whose is_active disagrees with their [starts_at, ends_at] window
   *  right now (need to be opened or closed). PC-56 TENANT-10b · F-10: a promotion a PERSON paused (`paused_at` set) is
   *  never a candidate — the scheduler does not re-open a human pause, and it has nothing to close (it is already off). */
  async findFestivalToggles(tx: TxContext, now: Date, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await tx.query(
      `SELECT id, tenant_id FROM promotions
        WHERE promo_type = 'festival' AND paused_at IS NULL AND deleted_at IS NULL
          AND is_active <> ($1::timestamptz BETWEEN starts_at AND ends_at AND NOT (budget_minor IS NOT NULL AND spent_minor >= budget_minor))
        ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`, [now, limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id }));
  }
}

/** Serialize the typed rules back to the stored jsonb shape (minor amounts as strings). */
function rulesToJson(r: ReturnType<Promotion['toProps']>['rules']): Record<string, unknown> {
  return { discountType: r.discountType, percentOff: r.percentOff ?? undefined, amountOffMinor: r.amountOffMinor?.toString(),
    minOrderMinor: r.minOrderMinor?.toString(), maxDiscountMinor: r.maxDiscountMinor?.toString() };
}
