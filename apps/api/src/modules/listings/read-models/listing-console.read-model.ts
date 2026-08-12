// modules/listings/read-models/listing-console.read-model.ts · W123 staff console + W126 QC queue reads
// (PC-56 TENANT-2a). Replica-backed, tenant-scoped (Law 1), keyset only (the roster rule: page numbers are a
// COUNT(*) per view at scale — the tabs get ONE aggregate count query instead, over idx_listings_tenant_status).
//
// THE QC NUMBERS ARE MEASURED, NEVER INVENTED: the waiting clock starts at qc_submitted_at (0138 — never
// backfilled), so a pre-0138 listing parked in pending_approval shows "submitted before the clock existed"
// rather than a fabricated age, and the median is computed only over decisions the clock stamped. Approved /
// rejected "today" is the tenant's calendar day in ITS OWN timezone, passed in — a Gujarat co-op's "today"
// must not roll over at 05:30 in the evening because the server thinks in UTC.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { LISTING_STATUSES, ListingStatus } from '../domain/listing.state';

export interface ConsoleRow {
  id: string; title: string; status: string; sellerUserId: string; sellerName: string | null;
  productName: string | null; priceMinor: string; currencyCode: string; unitCode: string;
  quantityAvailable: string; quantityTotal: string; saleType: string;
  publishedAt: string | null; createdAt: string; qcSubmittedAt: string | null;
}

export interface QcQueueRow {
  id: string; title: string; sellerUserId: string; sellerName: string | null;
  priceMinor: string; currencyCode: string; unitCode: string; quantityTotal: string;
  productId: string; regionId: string | null;
  qcSubmittedAt: string | null;   // null = parked before 0138's clock existed; said, not aged
  createdBy: string | null;
}

const CONSOLE_LIMIT_MAX = 100;

@Injectable()
export class ListingConsoleReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Tab counts: one GROUP BY over the status index. Every status in the machine appears, zero included —
   *  a tab that exists in the vocabulary but not in the counts would read as a broken screen. */
  async counts(tenantId: string): Promise<Record<ListingStatus, number> & { all: number }> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT status, COUNT(*)::int AS n FROM listings WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY status`,
      [tenantId]);
    const out = Object.fromEntries(LISTING_STATUSES.map((s) => [s, 0])) as Record<ListingStatus, number> & { all: number };
    let all = 0;
    for (const row of r.rows) { out[row.status as ListingStatus] = row.n; all += row.n; }
    out.all = all;
    return out;
  }

  /** The staff list (listing.view_any): every seller's listings, filtered by ONE status from the closed
   *  vocabulary, keyset on (created_at, id) — the cursor dies with any filter change (the 1b lesson; enforced
   *  client-side where the cursor is built, asserted in the console spec). */
  async list(tenantId: string, q: { status?: ListingStatus; cursor?: { c: string; id: string } | null; limit: number }): Promise<ConsoleRow[]> {
    const limit = Math.min(Math.max(q.limit, 1), CONSOLE_LIMIT_MAX);
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `l.tenant_id = $1 AND l.deleted_at IS NULL`;
    if (q.status) where += ` AND l.status = ${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (l.created_at < ${cc} OR (l.created_at = ${cc} AND l.id < ${ci}))`; }
    const lp = p(limit);
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT l.id, l.title, l.status, l.seller_user_id AS "sellerUserId", u.full_name AS "sellerName",
              pr.default_name AS "productName", l.price_minor::text AS "priceMinor", l.currency_code AS "currencyCode",
              l.unit_code AS "unitCode", l.quantity_available::text AS "quantityAvailable", l.quantity_total::text AS "quantityTotal",
              l.sale_type AS "saleType", l.published_at AS "publishedAt", l.created_at AS "createdAt",
              l.qc_submitted_at AS "qcSubmittedAt"
         FROM listings l
         LEFT JOIN users u ON u.id = l.seller_user_id
         LEFT JOIN products pr ON pr.id = l.product_id
        WHERE ${where}
        ORDER BY l.created_at DESC, l.id DESC LIMIT ${lp}`, params);
    return r.rows;
  }

  /** W126's queue: waiting listings OLDEST FIRST — the queue is a promise about waiting time, so it surfaces
   *  the listing that has waited longest, not the newest. No claim column by decision (0138's header). */
  async qcQueue(tenantId: string, limit: number): Promise<QcQueueRow[]> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT l.id, l.title, l.seller_user_id AS "sellerUserId", u.full_name AS "sellerName",
              l.price_minor::text AS "priceMinor", l.currency_code AS "currencyCode", l.unit_code AS "unitCode",
              l.quantity_total::text AS "quantityTotal", l.product_id AS "productId", l.region_id AS "regionId",
              l.qc_submitted_at AS "qcSubmittedAt", l.created_by AS "createdBy"
         FROM listings l
         LEFT JOIN users u ON u.id = l.seller_user_id
        WHERE l.tenant_id = $1 AND l.status = 'pending_approval' AND l.deleted_at IS NULL
        ORDER BY l.qc_submitted_at ASC NULLS FIRST, l.id ASC LIMIT $2`,
      [tenantId, Math.min(Math.max(limit, 1), CONSOLE_LIMIT_MAX)]);
    return r.rows;
  }

  /** W126's KPI row, each figure over exactly the rows that can answer it. `todayStartUtc` is the tenant's
   *  local midnight expressed in UTC (computed by the service from the tenant timezone). */
  async qcKpis(tenantId: string, todayStartUtc: Date): Promise<{
    waiting: number; oldestSubmittedAt: string | null; unclockedWaiting: number;
    approvedToday: number; rejectedToday: number;
    medianDecisionMinutes7d: number | null; decided7d: number;
  }> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending_approval' AND deleted_at IS NULL)::int AS waiting,
         MIN(qc_submitted_at) FILTER (WHERE status = 'pending_approval' AND deleted_at IS NULL) AS oldest,
         COUNT(*) FILTER (WHERE status = 'pending_approval' AND deleted_at IS NULL AND qc_submitted_at IS NULL)::int AS unclocked,
         COUNT(*) FILTER (WHERE status = 'published' AND qc_reviewed_at >= $2)::int AS approved_today,
         COUNT(*) FILTER (WHERE status = 'rejected'  AND qc_reviewed_at >= $2)::int AS rejected_today,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (qc_reviewed_at - qc_submitted_at)) / 60)
            FROM listings
           WHERE tenant_id = $1 AND qc_reviewed_at >= now() - interval '7 days'
             AND qc_submitted_at IS NOT NULL) AS median_min,
         (SELECT COUNT(*)::int FROM listings
           WHERE tenant_id = $1 AND qc_reviewed_at >= now() - interval '7 days'
             AND qc_submitted_at IS NOT NULL) AS decided_7d
       FROM listings WHERE tenant_id = $1`,
      [tenantId, todayStartUtc]);
    const row = r.rows[0];
    return {
      waiting: row.waiting, oldestSubmittedAt: row.oldest ?? null, unclockedWaiting: row.unclocked,
      approvedToday: row.approved_today, rejectedToday: row.rejected_today,
      medianDecisionMinutes7d: row.median_min === null ? null : Math.round(Number(row.median_min)),
      decided7d: row.decided_7d,
    };
  }

  /** W127's "14 previous listings, 0 rejections" — the seller's real record with THIS tenant. */
  async sellerHistory(tenantId: string, sellerUserId: string): Promise<{ previousListings: number; rejections: number }> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE status = 'rejected' OR reject_reason IS NOT NULL)::int AS rej
         FROM listings WHERE tenant_id = $1 AND seller_user_id = $2 AND deleted_at IS NULL`,
      [tenantId, sellerUserId]);
    return { previousListings: r.rows[0].n, rejections: r.rows[0].rej };
  }

  /** W127's review header — one waiting listing with its names joined. Returns null when the id is not this
   *  tenant's or not waiting: the review page reads 404, never a foreign tenant's lot (Law 1). */
  async qcReviewDetail(tenantId: string, id: string): Promise<(QcQueueRow & {
    status: string; productName: string | null; organicClaim: string; saleType: string;
    quantityAvailable: string; minOrderQty: string; harvestDate: string | null;
  }) | null> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT l.id, l.title, l.status, l.seller_user_id AS "sellerUserId", u.full_name AS "sellerName",
              l.price_minor::text AS "priceMinor", l.currency_code AS "currencyCode", l.unit_code AS "unitCode",
              l.quantity_total::text AS "quantityTotal", l.quantity_available::text AS "quantityAvailable",
              l.min_order_qty::text AS "minOrderQty", l.product_id AS "productId", l.region_id AS "regionId",
              l.qc_submitted_at AS "qcSubmittedAt", l.created_by AS "createdBy",
              pr.default_name AS "productName", l.organic_claim AS "organicClaim", l.sale_type AS "saleType",
              l.harvest_date AS "harvestDate"
         FROM listings l
         LEFT JOIN users u ON u.id = l.seller_user_id
         LEFT JOIN products pr ON pr.id = l.product_id
        WHERE l.id = $1 AND l.tenant_id = $2 AND l.deleted_at IS NULL`,
      [id, tenantId]);
    return r.rows[0] ?? null;
  }

  /** The closed rejection vocabulary (0138 seeds; Law 6 — a platform admin extends it with an INSERT). */
  async rejectReasons(tenantId: string): Promise<{ code: string; name: string }[]> {
    const pool = await this.replica.forTenant(tenantId);
    const r = await pool.query(
      `SELECT code, default_name AS name FROM lookup_values
        WHERE type_code = 'listing_reject_reason' AND is_active AND (tenant_id IS NULL OR tenant_id = $1)
        ORDER BY sort_order, code`, [tenantId]);
    return r.rows;
  }
}
