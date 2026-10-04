// modules/insights/repositories/insights.repository.ts · PC-56 TENANT-SW-f — the READ side of W193 (mandi pulse), W194 (demand map) and
// W195 (wastage), plus the wastage writer's one door (`kv_wastage_record` / `kv_wastage_backfill`, 0202).
//
// CQRS (Law 12): every read goes through the replica provider with the tenant set (RLS is the net); `tenant_id = $1` is in every query
// (Law 1). These are read models over other modules' tables (listings, crop seasons, mandi prices, price alerts, requirements, consents,
// orders) — the SW-d AGM precedent: a figure is read where it is printed, never copied into a second table that could drift.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { usSql, LossLine, WastageSourceTable, INSIGHTS_ZONE } from '../domain/insights';

export interface CropRow { productId: string; crop: string; listed: boolean; declared: boolean }
export interface MandiRow { productId: string; mandiId: string; mandi: string; priceDate: string; modalMinor: string; currency: string; unit: string; prevDate: string | null; prevModalMinor: string | null }
export interface StockRow { productId: string; unit: string; quantity: string; listings: number }
export interface RequirementRow {
  id: string; reqNo: string | null; title: string; productId: string | null; categoryId: string | null; crop: string | null; quantity: string; fulfilled: string;
  unit: string; budgetMinMinor: string | null; budgetMaxMinor: string | null; currency: string; deliveryPincode: string | null; needBy: string | null;
  status: string; buyerUserId: string; createdUs: string;
}
export interface SellerStockRow { productId: string; categoryId: string; unit: string; sellerUserId: string; quantity: string }
export interface ConsentRow { requirementId: string; memberUserId: string; memberName: string | null; quantity: string | null; priceMinor: string | null; unit: string | null; recordedAt: string }
export interface WastageEventRow {
  id: string; occurredAt: string; occurredUs: string; kind: string; sourceKind: string; sourceTable: string; sourceId: string; chainKey: string | null;
  productId: string | null; crop: string | null; subjectType: string | null; subjectId: string | null; quantity: string | null; unit: string | null;
  valueMinor: string | null; currency: string | null; valueReason: string | null; methodCode: string; recordedAt: string;
}

const PUB = `status = 'published' AND deleted_at IS NULL`;
const pub = (a: string) => `${a}.status = 'published' AND ${a}.deleted_at IS NULL`;

@Injectable()
export class InsightsRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private db(tenantId: string, tx?: SqlExecutor | null): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ─────────────────────────────── W193 · the member-crop filter ─────────────────────────────── */
  /** Crops in a published listing today, or declared in a crop season of this year or last (abandoned seasons excluded). */
  async memberCrops(tenantId: string, tx?: SqlExecutor | null): Promise<CropRow[]> {
    const r = await this.db(tenantId, tx).query(
      `WITH c AS (
         SELECT l.product_id, true AS listed, false AS declared FROM listings l WHERE l.tenant_id = $1 AND ${pub('l')}
         UNION ALL
         SELECT cs.product_id, false, true FROM crop_seasons cs
          WHERE cs.tenant_id = $1 AND cs.deleted_at IS NULL AND cs.status <> 'abandoned'
            AND cs.year >= extract(year FROM (now() AT TIME ZONE '${INSIGHTS_ZONE}'))::int - 1)
       SELECT c.product_id, p.default_name AS crop, bool_or(c.listed) AS listed, bool_or(c.declared) AS declared
         FROM c JOIN products p ON p.id = c.product_id
        GROUP BY c.product_id, p.default_name ORDER BY p.default_name, c.product_id`, [tenantId]);
    return r.rows.map((x: any) => ({ productId: x.product_id, crop: x.crop, listed: x.listed === true, declared: x.declared === true }));
  }

  /** The latest accepted modal per (crop, mandi) in the last 14 days, and the same mandi's previous earlier day inside that window. */
  async latestModals(tenantId: string, productIds: readonly string[], tx?: SqlExecutor | null): Promise<MandiRow[]> {
    if (productIds.length === 0) return [];
    const r = await this.db(tenantId, tx).query(
      `WITH p AS (
         SELECT mp.product_id, mp.mandi_id, mp.price_date, mp.modal_minor, mp.currency_code, mp.unit_code, mp.id,
                row_number() OVER (PARTITION BY mp.product_id, mp.mandi_id ORDER BY mp.price_date DESC, mp.id DESC) AS rn
           FROM mandi_prices mp
          WHERE mp.product_id = ANY($2::uuid[]) AND (mp.tenant_id IS NULL OR mp.tenant_id = $1) AND mp.mandi_id IS NOT NULL
            AND mp.anomaly_state IN ('accepted', 'released')
            AND mp.price_date >= ((now() AT TIME ZONE '${INSIGHTS_ZONE}')::date - 14))
       SELECT cur.product_id, cur.mandi_id, m.default_name AS mandi, cur.price_date::text AS d, cur.modal_minor::text AS modal, cur.currency_code AS cur, cur.unit_code AS unit,
              prev.price_date::text AS pd, prev.modal_minor::text AS pm
         FROM p cur JOIN mandis m ON m.id = cur.mandi_id
         LEFT JOIN LATERAL (SELECT p2.price_date, p2.modal_minor FROM p p2
                             WHERE p2.product_id = cur.product_id AND p2.mandi_id = cur.mandi_id AND p2.price_date < cur.price_date
                             ORDER BY p2.price_date DESC, p2.id DESC LIMIT 1) prev ON true
        WHERE cur.rn = 1
        ORDER BY cur.product_id, m.default_name, cur.mandi_id`, [tenantId, [...productIds]]);
    return r.rows.map((x: any) => ({ productId: x.product_id, mandiId: x.mandi_id, mandi: x.mandi, priceDate: x.d, modalMinor: x.modal, currency: String(x.cur).trim(),
      unit: x.unit, prevDate: x.pd ?? null, prevModalMinor: x.pm ?? null }));
  }

  /** Σ quantity available on the cooperative's published listings, per crop and unit — "listed stock", a fact. */
  async listedStock(tenantId: string, tx?: SqlExecutor | null): Promise<StockRow[]> {
    const r = await this.db(tenantId, tx).query(
      `SELECT product_id, unit_code, sum(quantity_available)::text AS q, count(*)::int AS n FROM listings
        WHERE tenant_id = $1 AND ${PUB} AND quantity_available > 0 GROUP BY product_id, unit_code ORDER BY product_id, unit_code`, [tenantId]);
    return r.rows.map((x: any) => ({ productId: x.product_id, unit: x.unit_code, quantity: x.q, listings: Number(x.n) }));
  }

  async alerts(tenantId: string, weekStart: Date, tx?: SqlExecutor | null): Promise<{ active: number; fired: number }> {
    const r = await this.db(tenantId, tx).query(
      `SELECT (SELECT count(*)::int FROM price_alerts WHERE tenant_id = $1 AND is_active AND deleted_at IS NULL) AS active,
              (SELECT count(*)::int FROM price_alert_triggers WHERE tenant_id = $1 AND triggered_at >= $2 AND deleted_at IS NULL) AS fired`, [tenantId, weekStart]);
    return { active: Number(r.rows[0]?.active ?? 0), fired: Number(r.rows[0]?.fired ?? 0) };
  }

  /* ─────────────────────────────── W194 · the demand map ─────────────────────────────── */
  async openRequirements(tenantId: string, cursor: { us: string; id: string } | null, limit: number, tx?: SqlExecutor | null): Promise<RequirementRow[]> {
    const p: unknown[] = [tenantId, limit + 1];
    let c = '';
    if (cursor) { p.push(cursor.us, cursor.id); c = `AND (r.created_at < $3::timestamptz OR (r.created_at = $3::timestamptz AND r.id < $4::uuid))`; }
    const r = await this.db(tenantId, tx).query(
      `SELECT r.id, r.req_no, r.title, r.product_id, r.category_id, coalesce(p.default_name, cat.default_name) AS crop, r.quantity::text AS qty, r.fulfilled_quantity::text AS ful,
              r.unit_code, r.budget_min_minor::text AS bmin, r.budget_max_minor::text AS bmax, r.currency_code, r.delivery_pincode, r.need_by::text AS need_by, r.status::text AS status,
              r.buyer_user_id, ${usSql('r.created_at')} AS us
         FROM requirements r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN categories cat ON cat.id = r.category_id
        WHERE r.tenant_id = $1 AND r.deleted_at IS NULL AND r.status IN ('open', 'partially_matched') ${c}
        ORDER BY r.created_at DESC, r.id DESC LIMIT $2`, p);
    return r.rows.map((x: any) => ({ id: x.id, reqNo: x.req_no ?? null, title: x.title, productId: x.product_id ?? null, categoryId: x.category_id ?? null, crop: x.crop ?? null,
      quantity: x.qty, fulfilled: x.ful, unit: x.unit_code, budgetMinMinor: x.bmin ?? null, budgetMaxMinor: x.bmax ?? null, currency: String(x.currency_code).trim(),
      deliveryPincode: x.delivery_pincode ?? null, needBy: x.need_by ?? null, status: x.status, buyerUserId: x.buyer_user_id, createdUs: x.us }));
  }

  async sellerStock(tenantId: string, productIds: readonly string[], categoryIds: readonly string[], tx?: SqlExecutor | null): Promise<SellerStockRow[]> {
    if (productIds.length === 0 && categoryIds.length === 0) return [];
    const r = await this.db(tenantId, tx).query(
      `SELECT product_id, category_id, unit_code, seller_user_id, sum(quantity_available)::text AS q FROM listings
        WHERE tenant_id = $1 AND ${PUB} AND quantity_available > 0 AND (product_id = ANY($2::uuid[]) OR category_id = ANY($3::uuid[]))
        GROUP BY product_id, category_id, unit_code, seller_user_id`, [tenantId, [...productIds], [...categoryIds]]);
    return r.rows.map((x: any) => ({ productId: x.product_id, categoryId: x.category_id, unit: x.unit_code, sellerUserId: x.seller_user_id, quantity: x.q }));
  }

  /** Members who CONSENTED to a quote on these requirements (11d `requirement_consents` act=quote) — the only member-level rows shown. */
  async quoteConsents(tenantId: string, requirementIds: readonly string[], tx?: SqlExecutor | null): Promise<ConsentRow[]> {
    if (requirementIds.length === 0) return [];
    const r = await this.db(tenantId, tx).query(
      `SELECT c.requirement_id, c.member_user_id, u.full_name, c.quantity::text AS q, c.price_minor::text AS pm, l.unit_code, ${usSql('c.recorded_at')} AS at
         FROM requirement_consents c JOIN users u ON u.id = c.member_user_id LEFT JOIN listings l ON l.id = c.listing_id
        WHERE c.tenant_id = $1 AND c.act = 'quote' AND c.requirement_id = ANY($2::uuid[]) ORDER BY c.recorded_at, c.id`, [tenantId, [...requirementIds]]);
    return r.rows.map((x: any) => ({ requirementId: x.requirement_id, memberUserId: x.member_user_id, memberName: x.full_name ?? null, quantity: x.q ?? null,
      priceMinor: x.pm ?? null, unit: x.unit_code ?? null, recordedAt: x.at }));
  }

  /** The cooperative's districts: the district (level 2) holding its own region, and those of its located published listings. */
  async tenantDistricts(tenantId: string, tx?: SqlExecutor | null): Promise<string[]> {
    const r = await this.db(tenantId, tx).query(
      `WITH x AS (
         SELECT t.region_id FROM tenants t WHERE t.id = $1 AND t.region_id IS NOT NULL
         UNION SELECT l.region_id FROM listings l WHERE l.tenant_id = $1 AND ${pub('l')} AND l.region_id IS NOT NULL
         UNION SELECT pc.region_id FROM listings l JOIN tenants t ON t.id = l.tenant_id
                 JOIN pincodes pc ON pc.pincode = l.pincode AND pc.country_code = t.country_code
                WHERE l.tenant_id = $1 AND ${pub('l')} AND pc.region_id IS NOT NULL)
       SELECT DISTINCT d.id FROM x JOIN admin_regions r ON r.id = x.region_id JOIN admin_regions d ON d.level = 2 AND d.path @> r.path ORDER BY d.id`, [tenantId]);
    return r.rows.map((x: any) => x.id as string);
  }

  /** Each requirement's district from its delivery pincode (pincodes → region → the level-2 ancestor), in the tenant's country. */
  async requirementDistricts(tenantId: string, requirementIds: readonly string[], tx?: SqlExecutor | null): Promise<Map<string, string>> {
    if (requirementIds.length === 0) return new Map();
    const r = await this.db(tenantId, tx).query(
      `SELECT rq.id, d.id AS district FROM requirements rq JOIN tenants t ON t.id = rq.tenant_id
         JOIN pincodes pc ON pc.pincode = rq.delivery_pincode AND pc.country_code = t.country_code
         JOIN admin_regions rr ON rr.id = pc.region_id JOIN admin_regions d ON d.level = 2 AND d.path @> rr.path
        WHERE rq.tenant_id = $1 AND rq.id = ANY($2::uuid[])`, [tenantId, [...requirementIds]]);
    return new Map(r.rows.map((x: any) => [x.id as string, x.district as string]));
  }

  /* ─────────────────────────────── W195 · wastage ─────────────────────────────── */
  /** The window's events, a POD rejection and the dispute it opened counted ONCE (the dispute when it exists), folded by kind and
   *  currency (where a money value was recorded) or unit (where only a quantity was). */
  async lossLines(tenantId: string, windowDays: number, tx?: SqlExecutor | null): Promise<LossLine[]> {
    const r = await this.db(tenantId, tx).query(
      `WITH w AS (SELECT * FROM wastage_events WHERE tenant_id = $1 AND occurred_at >= now() - make_interval(days => $2::int)),
            d AS (SELECT * FROM w WHERE chain_key IS NULL
                  UNION ALL
                  (SELECT DISTINCT ON (chain_key) * FROM w WHERE chain_key IS NOT NULL
                    ORDER BY chain_key, (source_kind = 'transit_dispute_variance') DESC, occurred_at DESC, id DESC))
       SELECT kind,
              CASE WHEN value_minor IS NOT NULL THEN currency_code::text END AS currency,
              CASE WHEN value_minor IS NULL AND quantity IS NOT NULL THEN unit_code END AS unit,
              count(*)::int AS n, sum(value_minor)::text AS v, sum(CASE WHEN value_minor IS NULL THEN quantity END)::text AS q
         FROM d GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`, [tenantId, windowDays]);
    return r.rows.map((x: any) => ({ kind: x.kind, currency: x.currency ? String(x.currency).trim() : null, unit: x.unit ?? null, events: Number(x.n), valueMinor: x.v ?? null, quantity: x.q ?? null }));
  }

  async sourceCounts(tenantId: string, windowDays: number, tx?: SqlExecutor | null): Promise<Array<{ sourceKind: string; events: number }>> {
    const r = await this.db(tenantId, tx).query(
      `SELECT source_kind, count(*)::int AS n FROM wastage_events WHERE tenant_id = $1 AND occurred_at >= now() - make_interval(days => $2::int) GROUP BY 1 ORDER BY 1`, [tenantId, windowDays]);
    return r.rows.map((x: any) => ({ sourceKind: x.source_kind, events: Number(x.n) }));
  }

  /** GMV of the same window by SW-d's AGM method: the goods subtotal of orders COMPLETED in it, per currency. */
  async gmvWindow(tenantId: string, windowDays: number, tx?: SqlExecutor | null): Promise<Array<{ currency: string; goodsMinor: string; orders: number }>> {
    const r = await this.db(tenantId, tx).query(
      `SELECT o.currency_code AS cur, count(*)::int AS n, coalesce(sum(o.subtotal_minor), 0)::text AS goods FROM orders o
        WHERE o.tenant_id = $1 AND o.status = 'completed' AND o.completed_at >= now() - make_interval(days => $2::int) GROUP BY 1 ORDER BY 1`, [tenantId, windowDays]);
    return r.rows.map((x: any) => ({ currency: String(x.cur).trim(), goodsMinor: x.goods, orders: Number(x.n) }));
  }

  async wastageEvents(tenantId: string, cursor: { us: string; id: string } | null, limit: number, windowDays: number, tx?: SqlExecutor | null): Promise<WastageEventRow[]> {
    const p: unknown[] = [tenantId, limit + 1, windowDays];
    let c = '';
    if (cursor) { p.push(cursor.us, cursor.id); c = `AND (w.occurred_at < $4::timestamptz OR (w.occurred_at = $4::timestamptz AND w.id < $5::uuid))`; }
    const r = await this.db(tenantId, tx).query(
      `SELECT w.*, ${usSql('w.occurred_at')} AS us, p.default_name AS crop FROM wastage_events w LEFT JOIN products p ON p.id = w.product_id
        WHERE w.tenant_id = $1 AND w.occurred_at >= now() - make_interval(days => $3::int) ${c}
        ORDER BY w.occurred_at DESC, w.id DESC LIMIT $2`, p);
    return r.rows.map(toWastage);
  }

  /** THE WRITER. Names the source and nothing else; the database derives the facts (0202). `written | exists | not_fact`. */
  async record(tx: TxContext, table: WastageSourceTable, sourceId: string, method: 'event' | 'rerun' | 'sweep', by: string | null): Promise<string> {
    const r = await tx.query<{ v: string }>(`SELECT kv_wastage_record($1, $2::uuid, $3, $4::uuid) AS v`, [table, sourceId, method, by]);
    return String(r.rows[0]?.v);
  }
  async backfill(tx: TxContext, tenantId: string, method: 'rerun' | 'sweep', by: string | null): Promise<Array<{ source: string; written: number; existing: number }>> {
    const r = await tx.query(`SELECT o_source, o_written, o_existing FROM kv_wastage_backfill($1::uuid, $2, $3::uuid)`, [tenantId, method, by]);
    return r.rows.map((x: any) => ({ source: x.o_source, written: Number(x.o_written), existing: Number(x.o_existing) }));
  }
}

function toWastage(x: any): WastageEventRow {
  const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
  return {
    id: x.id, occurredAt: iso(x.occurred_at) as string, occurredUs: x.us, kind: x.kind, sourceKind: x.source_kind, sourceTable: x.source_table, sourceId: x.source_id,
    chainKey: x.chain_key ?? null, productId: x.product_id ?? null, crop: x.crop ?? null, subjectType: x.subject_type ?? null, subjectId: x.subject_id ?? null,
    quantity: x.quantity == null ? null : String(x.quantity), unit: x.unit_code ?? null, valueMinor: x.value_minor == null ? null : String(x.value_minor),
    currency: x.currency_code ? String(x.currency_code).trim() : null, valueReason: x.value_reason ?? null, methodCode: x.method_code, recordedAt: iso(x.recorded_at) as string,
  };
}
