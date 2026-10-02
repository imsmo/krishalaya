// modules/promotions/read-models/offers.read-model.ts · PC-56 TENANT-10b · W129 KPIs, W130's tenant-wide coupon list and
// its "Recent redemptions" panel. Replica reads, tenant_id in every query (Law 1) + RLS; every figure is a SUM over rows
// that exist — no total is stored anywhere.
//
// THE FIGURES AND WHAT THEY ARE (each labelled on the screen exactly as computed)
//   • Active + scheduled — promotions by DERIVED status (promotion.state), counted here over the live rows.
//   • Budget committed — SUM(budget_minor) over active + scheduled (what the tenant's wallet may be asked to reserve).
//   • Spent (year) — SUM of reservations TAKEN this calendar year (Asia/Kolkata) and not released: coupon_redemptions with a
//     hold, `released_at IS NULL`, over every promotion including ended ones (A6 — the money, not the bookkeeping). Discounts
//     recorded before 0185 had no reservation (the seller bore them, F-2); they are a SEPARATE figure, never mixed in.
//   • GMV of coupon orders (30d) — SUM(orders.total_minor) of orders whose coupon was applied and reserved in the last 30
//     days (not released), with its ratio to the same redemptions' discount. Labelled exactly that — "attributed GMV" would
//     claim the coupon CAUSED the order, which nothing here measures.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { derivePromotionStatus, PromotionStatus } from '../domain/promotion.state';
import { encodeCursor } from '../domain/cursor';
import { maskPhone } from '../domain/display';
import { hasEngine } from '../domain/promotions.events';

export interface OffersSummary {
  year: number;
  activeCount: number; scheduledCount: number; budgetCommittedMinor: string;
  spentYearMinor: string; endedSpentYearMinor: string; legacyDiscountYearMinor: string;
  couponGmv30dMinor: string; couponDiscount30dMinor: string; gmvToSpendTenths: string | null; couponOrders30d: number;
}

export type CouponStatus = PromotionStatus | 'used_up' | 'no_promotion';
export interface CouponListRow {
  id: string; code: string; promotionId: string | null; promotionName: string | null; promoType: string | null; promotionHasEngine: boolean;
  uses: number; maxUses: number | null; perUserLimit: number; redeemedValueMinor: string; legacyValueMinor: string;
  status: CouponStatus; startsAt: string | null; endsAt: string | null; createdAt: string;
}

export type RedemptionMoneyState = 'reserved' | 'settled' | 'released' | 'unfunded';
export interface CouponRedemptionRow {
  id: string; at: string; outcome: string; stage: string | null; amountMinor: string | null;
  orderId: string | null; orderNo: string | null; buyerPhoneMasked: string | null; buyerPlace: string | null;
  moneyState: RedemptionMoneyState | null;
}

const UNSETTLED_LIVE = `cr.hold_txn_id IS NOT NULL AND cr.released_txn_id IS NULL`;
/** Law 8 — an order's partition window from its v7 id (checkout mints the id and created_at together). */
const ORDER_PRUNE = `o.created_at >= uuid_v7_time(cr.order_id) - interval '5 seconds' AND o.created_at < uuid_v7_time(cr.order_id) + interval '5 seconds'`;

/** PURE: a coupon's status — its promotion's derived status, then its own global cap. */
export function couponStatus(p: { status: PromotionStatus } | null, uses: number, maxUses: number | null): CouponStatus {
  if (!p) return 'no_promotion';
  if (p.status === 'active' && maxUses != null && uses >= maxUses) return 'used_up';
  return p.status;
}
/** PURE: GMV ÷ spend in TENTHS, integer arithmetic (16.6× → "166"); null when nothing was spent. */
export function ratioTenths(gmvMinor: bigint, spendMinor: bigint): string | null {
  return spendMinor > 0n ? ((gmvMinor * 10n) / spendMinor).toString() : null;
}

@Injectable()
export class OffersReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async summary(tenantId: string, now: Date = new Date()): Promise<OffersSummary> {
    const db = this.replica.forTenant(tenantId);
    const promos = await db.query<{ is_active: boolean; starts_at: Date; ends_at: Date; budget_minor: string | null; spent_minor: string }>(
      `SELECT is_active, starts_at, ends_at, budget_minor::text, spent_minor::text FROM promotions WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId]);
    let active = 0, scheduled = 0, committed = 0n;
    for (const r of promos.rows) {
      const s = derivePromotionStatus({ isActive: r.is_active, startsAt: new Date(r.starts_at), endsAt: new Date(r.ends_at), budgetMinor: r.budget_minor == null ? null : BigInt(r.budget_minor), spentMinor: BigInt(r.spent_minor) }, now);
      if (s === 'active') active += 1;
      if (s === 'scheduled') scheduled += 1;
      if ((s === 'active' || s === 'scheduled') && r.budget_minor != null) committed += BigInt(r.budget_minor);
    }
    const year = await db.query<{ y: number; spent: string; ended: string; legacy: string }>(
      `WITH yr AS (SELECT (date_trunc('year', $2::timestamptz AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata') AS since)
       SELECT EXTRACT(YEAR FROM $2::timestamptz AT TIME ZONE 'Asia/Kolkata')::int AS y,
              COALESCE(SUM(cr.amount_minor) FILTER (WHERE ${UNSETTLED_LIVE}), 0)::text AS spent,
              COALESCE(SUM(cr.amount_minor) FILTER (WHERE ${UNSETTLED_LIVE} AND (p.ends_at < $2::timestamptz OR (p.budget_minor IS NOT NULL AND p.spent_minor >= p.budget_minor))), 0)::text AS ended,
              COALESCE(SUM(cr.amount_minor) FILTER (WHERE cr.hold_txn_id IS NULL), 0)::text AS legacy
         FROM coupon_redemptions cr
         JOIN coupons c ON c.id = cr.coupon_id AND c.tenant_id = cr.tenant_id
         LEFT JOIN promotions p ON p.id = c.promotion_id AND p.tenant_id = c.tenant_id
        WHERE cr.tenant_id = $1 AND cr.created_at >= (SELECT since FROM yr)`, [tenantId, now]);
    const gmv = await db.query<{ gmv: string; disc: string; n: number }>(
      `SELECT COALESCE(SUM(o.total_minor), 0)::text AS gmv, COALESCE(SUM(cr.amount_minor), 0)::text AS disc, count(*)::int AS n
         FROM coupon_redemptions cr
         JOIN orders o ON o.id = cr.order_id AND o.tenant_id = cr.tenant_id AND ${ORDER_PRUNE} AND o.created_at >= $2::timestamptz - interval '31 days'
        WHERE cr.tenant_id = $1 AND ${UNSETTLED_LIVE} AND cr.created_at >= $2::timestamptz - interval '30 days'`, [tenantId, now]);
    const g = gmv.rows[0]; const y = year.rows[0];
    return {
      year: y.y, activeCount: active, scheduledCount: scheduled, budgetCommittedMinor: committed.toString(),
      spentYearMinor: y.spent, endedSpentYearMinor: y.ended, legacyDiscountYearMinor: y.legacy,
      couponGmv30dMinor: g.gmv, couponDiscount30dMinor: g.disc, gmvToSpendTenths: ratioTenths(BigInt(g.gmv), BigInt(g.disc)), couponOrders30d: g.n,
    };
  }

  /** B1 — every live coupon of the tenant, newest first (µs keyset), with its promotion, derived status and redeemed value. */
  async coupons(tenantId: string, q: { cursor?: { c: string; id: string }; limit: number; id?: string }, now: Date = new Date()): Promise<{ items: CouponListRow[]; nextCursor: string | null; total: number }> {
    const db = this.replica.forTenant(tenantId);
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `c.tenant_id = $1 AND c.deleted_at IS NULL`;
    if (q.id) where += ` AND c.id = ${p(q.id)}::uuid`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (c.created_at < ${cc}::timestamptz OR (c.created_at = ${cc}::timestamptz AND c.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await db.query<any>(
      `SELECT c.id, c.code, c.promotion_id, c.uses, c.max_uses, c.per_user_limit, c.created_at, c.created_at::text AS raw,
              pr.default_name, pr.promo_type, pr.is_active, pr.starts_at, pr.ends_at, pr.budget_minor::text AS budget_minor, pr.spent_minor::text AS spent_minor,
              COALESCE((SELECT SUM(cr.amount_minor) FROM coupon_redemptions cr WHERE cr.tenant_id = c.tenant_id AND cr.coupon_id = c.id AND ${UNSETTLED_LIVE}), 0)::text AS redeemed,
              COALESCE((SELECT SUM(cr.amount_minor) FROM coupon_redemptions cr WHERE cr.tenant_id = c.tenant_id AND cr.coupon_id = c.id AND cr.hold_txn_id IS NULL), 0)::text AS legacy
         FROM coupons c
         LEFT JOIN promotions pr ON pr.id = c.promotion_id AND pr.tenant_id = c.tenant_id AND pr.deleted_at IS NULL
        WHERE ${where}
        ORDER BY c.created_at DESC, c.id DESC LIMIT ${lp}`, params);
    const total = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM coupons WHERE tenant_id=$1 AND deleted_at IS NULL`, [tenantId])).rows[0].n;
    const items: CouponListRow[] = r.rows.map((x) => {
      const promo = x.default_name == null ? null : { status: derivePromotionStatus({ isActive: x.is_active, startsAt: new Date(x.starts_at), endsAt: new Date(x.ends_at), budgetMinor: x.budget_minor == null ? null : BigInt(x.budget_minor), spentMinor: BigInt(x.spent_minor) }, now) };
      return {
        id: x.id, code: x.code, promotionId: x.promotion_id, promotionName: x.default_name ?? null, promoType: x.promo_type ?? null, promotionHasEngine: x.promo_type ? hasEngine(x.promo_type) : false,
        uses: x.uses, maxUses: x.max_uses, perUserLimit: x.per_user_limit, redeemedValueMinor: x.redeemed, legacyValueMinor: x.legacy,
        status: couponStatus(promo, x.uses, x.max_uses), startsAt: x.starts_at ? new Date(x.starts_at).toISOString() : null, endsAt: x.ends_at ? new Date(x.ends_at).toISOString() : null,
        createdAt: new Date(x.created_at).toISOString(),
      };
    });
    const last = r.rows[r.rows.length - 1];
    return { items, nextCursor: r.rows.length === q.limit && last ? encodeCursor(last.raw, last.id) : null, total };
  }

  /** One live coupon as W130 shows it (the delete chain's confirm screen); null = no such live coupon. */
  async coupon(tenantId: string, id: string, now: Date = new Date()): Promise<CouponListRow | null> {
    return (await this.coupons(tenantId, { id, limit: 1 }, now)).items[0] ?? null;
  }

  /**
   * W130's "Recent redemptions" for ONE coupon: the applied redemptions (with what happened to their money) and the
   * DECLINED attempts (with the reason as an outcome code the screen turns into words), newest first, one µs keyset over
   * both. The buyer is a MASKED phone (the 1b mask) and the default address's village — never a name, never a full number.
   */
  async couponRedemptions(tenantId: string, couponId: string, q: { cursor?: { c: string; id: string }; limit: number }): Promise<{ items: CouponRedemptionRow[]; nextCursor: string | null }> {
    const params: unknown[] = [tenantId, couponId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let keyset = '';
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); keyset = ` WHERE (x.created_at < ${cc}::timestamptz OR (x.created_at = ${cc}::timestamptz AND x.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query<any>(
      `SELECT x.* FROM (
         SELECT cr.id, cr.created_at, cr.created_at::text AS raw, 'applied'::text AS outcome, NULL::text AS stage, cr.amount_minor::text AS amount_minor,
                cr.order_id, o.order_no, u.phone, ad.village,
                CASE WHEN cr.hold_txn_id IS NULL THEN 'unfunded' WHEN cr.settled_txn_id IS NOT NULL THEN 'settled'
                     WHEN cr.released_txn_id IS NOT NULL THEN 'released' ELSE 'reserved' END AS money_state
           FROM coupon_redemptions cr
           LEFT JOIN orders o ON o.id = cr.order_id AND o.tenant_id = cr.tenant_id AND ${ORDER_PRUNE}
           LEFT JOIN users u ON u.id = cr.user_id
           LEFT JOIN addresses ad ON ad.user_id = cr.user_id AND ad.is_default = true AND ad.deleted_at IS NULL
          WHERE cr.tenant_id = $1 AND cr.coupon_id = $2
         UNION ALL
         SELECT a.id, a.created_at, a.created_at::text AS raw, a.outcome::text, a.stage, a.amount_minor::text,
                a.order_id, o2.order_no, u2.phone, ad2.village, NULL::text
           FROM coupon_redemption_attempts a
           LEFT JOIN orders o2 ON o2.id = a.order_id AND o2.tenant_id = a.tenant_id
                              AND o2.created_at >= uuid_v7_time(a.order_id) - interval '5 seconds' AND o2.created_at < uuid_v7_time(a.order_id) + interval '5 seconds'
           LEFT JOIN users u2 ON u2.id = a.user_id
           LEFT JOIN addresses ad2 ON ad2.user_id = a.user_id AND ad2.is_default = true AND ad2.deleted_at IS NULL
          WHERE a.tenant_id = $1 AND a.coupon_id = $2 AND a.outcome <> 'applied'
       ) x${keyset}
       ORDER BY x.created_at DESC, x.id DESC LIMIT ${lp}`, params);
    const items: CouponRedemptionRow[] = r.rows.map((x) => ({
      id: x.id, at: new Date(x.created_at).toISOString(), outcome: x.outcome, stage: x.stage, amountMinor: x.amount_minor,
      orderId: x.order_id, orderNo: x.order_no ?? null, buyerPhoneMasked: x.phone ? maskPhone(x.phone) : null, buyerPlace: x.village ?? null,
      moneyState: x.money_state ?? null,
    }));
    const last = r.rows[r.rows.length - 1];
    return { items, nextCursor: r.rows.length === q.limit && last ? encodeCursor(last.raw, last.id) : null };
  }
}
