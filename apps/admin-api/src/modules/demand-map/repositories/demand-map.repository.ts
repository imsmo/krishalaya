// apps/admin-api/src/modules/demand-map/repositories/demand-map.repository.ts · W108 (PC-56 ADMIN-SWEEP-c3).
//
// LIVE READS, NO MV (0137's header carries the decision): requirements and listings are point-in-time states with
// no history table, so they are read AS OF NOW; orders are the one source with a timeline and are windowed by the
// requested ISO week, pruning partitions natively. District = admin_regions level 2, resolved by ltree ancestry
// (`d.path @> leaf.path` over 0001's gist index) from whatever leaf region the row can honestly reach — pincode
// for requirements, delivery address for orders, listing region for supply. Rows that resolve to NO district are
// COUNTED by the accounting queries below, never guessed into one.
//
// All money stays bigint end to end: sums come back ::text, supply is rounded ONCE after the Σ (half-up, the
// Farmer 360 discipline), and every filter value is a bind parameter.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';

export interface DemandCellRow {
  districtId: string; districtName: string; productId: string; productName: string;
  demandMinor: string | null; unvaluedN: number; buyersN: number; requirementsN: number;
  supplyMinor: string | null; listingsN: number;
}

export interface OrderFlowRow { districtId: string; districtName: string; flowMinor: string; ordersN: number }

const OPEN_DEMAND = `r.status IN ('open', 'partially_matched') AND r.deleted_at IS NULL`;

@Injectable()
export class DemandMapRepository {
  constructor(private readonly pool: AdminPool) {}

  /** District × product cells: open-requirement demand FULL OUTER JOIN published-listing supply — a district a
   *  buyer wants but nobody supplies must appear, and so must the reverse. */
  async cells(): Promise<DemandCellRow[]> {
    const r = await this.pool.query(
      `WITH dist AS (SELECT id, default_name, path FROM admin_regions WHERE level = 2),
            req AS (
              SELECT d.id AS district_id, r.product_id,
                     SUM(COALESCE(r.budget_max_minor, r.budget_min_minor))::text AS demand_minor,
                     COUNT(*) FILTER (WHERE r.budget_max_minor IS NULL AND r.budget_min_minor IS NULL)::int AS unvalued_n,
                     COUNT(DISTINCT r.buyer_user_id)::int AS buyers_n,
                     COUNT(*)::int AS requirements_n
                FROM requirements r
                JOIN pincodes p ON p.pincode = r.delivery_pincode AND p.country_code = 'IN'
                JOIN admin_regions leaf ON leaf.id = p.region_id
                JOIN dist d ON d.path @> leaf.path
               WHERE ${OPEN_DEMAND}
                 AND r.currency_code = 'INR' AND r.product_id IS NOT NULL
               GROUP BY 1, 2),
            sup AS (
              SELECT d.id AS district_id, l.product_id,
                     round(SUM(l.price_minor::numeric * COALESCE(l.quantity_available, 0)))::bigint::text AS supply_minor,
                     COUNT(*)::int AS listings_n
                FROM listings l
                JOIN admin_regions leaf ON leaf.id = l.region_id
                JOIN dist d ON d.path @> leaf.path
               WHERE l.status = 'published' AND l.deleted_at IS NULL AND l.currency_code = 'INR'
               GROUP BY 1, 2)
       SELECT COALESCE(rq.district_id, sp.district_id) AS "districtId",
              d.default_name AS "districtName",
              COALESCE(rq.product_id, sp.product_id) AS "productId",
              pr.default_name AS "productName",
              rq.demand_minor AS "demandMinor", COALESCE(rq.unvalued_n, 0) AS "unvaluedN",
              COALESCE(rq.buyers_n, 0) AS "buyersN", COALESCE(rq.requirements_n, 0) AS "requirementsN",
              sp.supply_minor AS "supplyMinor", COALESCE(sp.listings_n, 0) AS "listingsN"
         FROM req rq
         FULL OUTER JOIN sup sp ON sp.district_id = rq.district_id AND sp.product_id = rq.product_id
         JOIN dist d ON d.id = COALESCE(rq.district_id, sp.district_id)
         JOIN products pr ON pr.id = COALESCE(rq.product_id, sp.product_id)
        ORDER BY 2, 4`);
    return r.rows;
  }

  /** Order flow per district over [start, end) — the one windowed source. Cancelled orders are not flow. */
  async orderFlow(start: Date, end: Date): Promise<OrderFlowRow[]> {
    const r = await this.pool.query(
      `SELECT d.id AS "districtId", d.default_name AS "districtName",
              SUM(o.total_minor)::text AS "flowMinor", COUNT(*)::int AS "ordersN"
         FROM orders o
         JOIN addresses a ON a.id = o.delivery_address_id
         JOIN admin_regions leaf ON leaf.id = a.region_id
         JOIN admin_regions d ON d.level = 2 AND d.path @> leaf.path
        WHERE o.created_at >= $1 AND o.created_at < $2
          AND o.status <> 'cancelled' AND o.currency_code = 'INR'
        GROUP BY 1, 2`, [start, end]);
    return r.rows;
  }

  /** The requirements the map could NOT place or value — counted and said, never guessed (unknown ≠ zero). */
  async requirementsAccounting(): Promise<{ openN: number; categoryOnlyN: number; nonInrN: number; unlocatableN: number }> {
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS "openN",
              COUNT(*) FILTER (WHERE r.product_id IS NULL)::int AS "categoryOnlyN",
              COUNT(*) FILTER (WHERE r.currency_code <> 'INR')::int AS "nonInrN",
              COUNT(*) FILTER (WHERE r.product_id IS NOT NULL AND r.currency_code = 'INR' AND NOT EXISTS (
                  SELECT 1 FROM pincodes p
                  JOIN admin_regions leaf ON leaf.id = p.region_id
                  JOIN admin_regions d2 ON d2.level = 2 AND d2.path @> leaf.path
                 WHERE p.pincode = r.delivery_pincode AND p.country_code = 'IN'))::int AS "unlocatableN"
         FROM requirements r
        WHERE ${OPEN_DEMAND}`);
    return r.rows[0];
  }

  /** Orders in the window whose delivery address resolves to no district — same honesty, other clock. */
  async ordersUnlocatable(start: Date, end: Date): Promise<number> {
    const r = await this.pool.query(
      `SELECT COUNT(*)::int AS n
         FROM orders o
        WHERE o.created_at >= $1 AND o.created_at < $2
          AND o.status <> 'cancelled' AND o.currency_code = 'INR'
          AND NOT EXISTS (
              SELECT 1 FROM addresses a
              JOIN admin_regions leaf ON leaf.id = a.region_id
              JOIN admin_regions d ON d.level = 2 AND d.path @> leaf.path
             WHERE a.id = o.delivery_address_id)`, [start, end]);
    return r.rows[0].n;
  }

  /** Centroids for the districts on the page — the only geometry the platform HAS (0001). Boundary polygons
   *  exist nowhere; drawing them would be invented geography (GAP-BACKEND, named in the tracker). */
  async districtCentroids(ids: readonly string[]): Promise<{ id: string; lat: string | null; lng: string | null }[]> {
    if (ids.length === 0) return [];
    const r = await this.pool.query(
      `SELECT id, centroid_lat::text AS lat, centroid_lng::text AS lng
         FROM admin_regions WHERE level = 2 AND id = ANY($1::uuid[])`, [ids as string[]]);
    return r.rows;
  }

  /** 0120's append-only receipt register, report = 'demand_map'. */
  async insertReceipt(v: { report: string; generatedByAdminId: string; rowCount: number; truncated: boolean; fileName: string; contentSha256: string; digestBasis: string; watermarked: boolean; piiMasked: boolean; filters: Record<string, unknown>; objectKey: string | null; expiresAt: string | null }): Promise<string> {
    const r = await this.pool.query(
      `INSERT INTO report_export_receipts
         (report, generated_by_admin_id, row_count, truncated, file_name, content_sha256, digest_basis,
          watermarked, pii_masked, filters, object_key, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12) RETURNING id`,
      [v.report, v.generatedByAdminId, v.rowCount, v.truncated, v.fileName, v.contentSha256, v.digestBasis,
        v.watermarked, v.piiMasked, JSON.stringify(v.filters), v.objectKey, v.expiresAt]);
    return String(r.rows[0].id);
  }
}
