// apps/admin-api/src/modules/farmer360/repositories/farmer360.repository.ts · W109 SQL (PC-56 ADMIN-SWEEP-b4).
//
// EVERY READ IS KEYED ON ONE user id — this file contains no population sweep and no phone predicate (pinned by
// spec). The reads are the "no new tables" assembly: orders, listings, wallet, dairy, schemes, disputes,
// login_events, risk_scores — each its own small query so the service can name WHICH source failed when it refuses.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { GMV_ORDER_STATUSES } from '../domain/farmer360';

@Injectable()
export class Farmer360Repository {
  constructor(private readonly pool: AdminPool) {}

  /** Search: exact uuid, or name substring (≥2 chars enforced by dto). Never a phone. */
  async search(q: string, limit: number): Promise<any[]> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
    const r = await this.pool.query(
      isUuid
        ? `SELECT id AS "userId", full_name AS "fullName", phone, language_code AS "languageCode", created_at AS "createdAt"
             FROM users WHERE id = $1 LIMIT 1`
        : `SELECT id AS "userId", full_name AS "fullName", phone, language_code AS "languageCode", created_at AS "createdAt"
             FROM users WHERE full_name ILIKE '%' || $1 || '%' AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT $2`,
      isUuid ? [q] : [q, limit]);
    return r.rows;
  }

  async identity(userId: string): Promise<any | null> {
    const r = await this.pool.query(
      `SELECT u.id AS "userId", u.full_name AS "fullName", u.phone, u.language_code AS "languageCode",
              u.created_at AS "createdAt", u.last_active_at AS "lastActiveAt",
              COALESCE((SELECT array_agg(DISTINCT t.name) FROM user_tenant_roles utr JOIN tenants t ON t.id = utr.tenant_id
                         WHERE utr.user_id = u.id AND utr.deleted_at IS NULL), '{}') AS tenants
         FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`, [userId]);
    return r.rows[0] ?? null;
  }

  /** Lifetime GMV as SELLER — full-history by design (it says "lifetime"); idx_orders_seller carries it. */
  async gmv(userId: string): Promise<{ totalMinor: bigint | null; n: number }> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(total_minor), 0)::text AS total, count(*)::int AS n
         FROM orders WHERE seller_user_id = $1 AND status IN ('${GMV_ORDER_STATUSES.join("','")}')`, [userId]);
    const n = Number(r.rows[0]?.n ?? 0);
    return { totalMinor: n === 0 ? null : BigInt(r.rows[0].total), n };
  }

  async publishedListings(userId: string): Promise<{ priceMinor: string; quantityAvailable: string }[]> {
    const r = await this.pool.query(
      `SELECT price_minor::text AS "priceMinor", quantity_available::text AS "quantityAvailable"
         FROM listings WHERE seller_user_id = $1 AND status = 'published' AND deleted_at IS NULL`, [userId]);
    return r.rows;
  }

  /** READ-ONLY cached balance (main account). Law 2 untouched: nothing here writes money. */
  async walletBalance(userId: string): Promise<{ balanceMinor: bigint | null }> {
    const r = await this.pool.query(
      `SELECT cached_balance_minor::text AS bal FROM wallet_accounts
        WHERE owner_kind = 'user' AND owner_user_id = $1 AND account_code = 'main' LIMIT 1`, [userId]);
    return { balanceMinor: r.rows[0] ? BigInt(r.rows[0].bal) : null };
  }

  /** Dairy income, last 30 days of PAID bills, via dairy_memberships (0135's index). Null when no membership —
   *  unknown ≠ zero. */
  async dairyIncome30d(userId: string): Promise<{ totalMinor: bigint | null; memberships: number }> {
    const m = await this.pool.query(
      `SELECT count(*)::int AS n FROM dairy_memberships WHERE farmer_user_id = $1 AND deleted_at IS NULL`, [userId]);
    const memberships = Number(m.rows[0]?.n ?? 0);
    if (memberships === 0) return { totalMinor: null, memberships };
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(mb.net_minor), 0)::text AS total
         FROM milk_bills mb JOIN dairy_memberships dm ON dm.id = mb.membership_id
        WHERE dm.farmer_user_id = $1 AND mb.status = 'paid' AND mb.period_end >= (now() - interval '30 days')::date`, [userId]);
    return { totalMinor: BigInt(r.rows[0].total), memberships };
  }

  /** DBT credits this calendar year. ATTRIBUTED vs total split kept (ADMIN-4b's discipline): a credit with no
   *  application behind it is still money received, but the basis must say the split. */
  async schemeBenefitsYtd(userId: string): Promise<{ totalMinor: bigint | null; n: number; attributed: number }> {
    const r = await this.pool.query(
      `SELECT COALESCE(SUM(amount_minor), 0)::text AS total, count(*)::int AS n,
              count(*) FILTER (WHERE application_id IS NOT NULL)::int AS attributed
         FROM dbt_transfers WHERE user_id = $1 AND credited_on >= date_trunc('year', now())::date`, [userId]);
    const n = Number(r.rows[0]?.n ?? 0);
    return { totalMinor: n === 0 ? null : BigInt(r.rows[0].total), n, attributed: Number(r.rows[0]?.attributed ?? 0) };
  }

  async disputes(userId: string): Promise<{ raised: number; against: number; resolved: number; open: number }> {
    const r = await this.pool.query(
      `SELECT count(*) FILTER (WHERE raised_by = $1)::int AS raised,
              count(*) FILTER (WHERE against_user = $1)::int AS against,
              count(*) FILTER (WHERE status = 'resolved')::int AS resolved,
              count(*) FILTER (WHERE status NOT IN ('resolved','rejected','withdrawn'))::int AS open
         FROM disputes WHERE (raised_by = $1 OR against_user = $1) AND deleted_at IS NULL`, [userId]);
    const x = r.rows[0] ?? {};
    return { raised: Number(x.raised ?? 0), against: Number(x.against ?? 0), resolved: Number(x.resolved ?? 0), open: Number(x.open ?? 0) };
  }

  /** Distinct successful-login days in the last 30 — the one per-user activity register that exists. */
  async activeDays30(userId: string): Promise<number> {
    const r = await this.pool.query(
      `SELECT count(DISTINCT created_at::date)::int AS days FROM login_events
        WHERE user_id = $1 AND succeeded AND created_at > now() - interval '30 days'`, [userId]);
    return Number(r.rows[0]?.days ?? 0);
  }

  async riskScore(userId: string): Promise<{ score: number; band: string } | null> {
    const r = await this.pool.query(
      `SELECT score, band FROM risk_scores WHERE user_id = $1 ORDER BY computed_at DESC LIMIT 1`, [userId]);
    return r.rows[0] ?? null;
  }

  /** The three real registers for the timeline, each bounded and labelled at source. */
  async recentOrders(userId: string, limit: number): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT id, total_minor::text AS "amountMinor", status, created_at AS at FROM orders
        WHERE seller_user_id = $1 ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return r.rows;
  }
  async recentListings(userId: string, limit: number): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT id, title, price_minor::text AS "priceMinor", status, created_at AS at FROM listings
        WHERE seller_user_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`, [userId, limit]);
    return r.rows;
  }
  async recentBenefits(userId: string, limit: number): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT d.id, d.amount_minor::text AS "amountMinor", d.credited_on AS at, s.name AS scheme
         FROM dbt_transfers d LEFT JOIN schemes s ON s.id = d.scheme_id
        WHERE d.user_id = $1 ORDER BY d.credited_on DESC LIMIT $2`, [userId, limit]);
    return r.rows;
  }

  /** 0120's append-only receipt register, report = 'farmer360_profile'. */
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
