// modules/reviews/repositories/review.repository.ts
// All SQL for the reviews aggregate + the review_eligibility gate. tenant_id in EVERY query (Law 1) +
// RLS. No version column (add_std_columns) → mutations LOCK the row with SELECT … FOR UPDATE. Reads on
// the replica; the public list/summary read only PUBLISHED reviews (idx_reviews_target partial index).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Review, ReviewProps } from '../domain/review.entity';
import { ReviewStatus } from '../domain/review.state';
import { ReviewTargetType } from '../domain/reviews.events';
import { US_SQL } from '../../../shared/pagination/us-keyset';

const COLS = `id, tenant_id, order_id, reviewer_user_id, target_type, target_id, stars, sub_ratings, body, tags,
  is_verified_purchase, status, seller_response, seller_responded_at, helpful_count, created_at, ${US_SQL('created_at')} AS created_us`;
/** PC-56 HOTFIX-7 · B24: the µs keyset, newest first (the cursor's instant is the database's own print, compared as timestamptz). */
const KEYSET_DESC = (cc: string, ci: string) => ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`;
function toDomain(r: any): Review {
  return Review.rehydrate({
    id: r.id, tenantId: r.tenant_id, orderId: r.order_id, reviewerUserId: r.reviewer_user_id,
    targetType: r.target_type as ReviewTargetType, targetId: r.target_id, stars: r.stars,
    subRatings: r.sub_ratings ?? {}, body: r.body, tags: r.tags ?? [], isVerifiedPurchase: r.is_verified_purchase,
    status: r.status as ReviewStatus, sellerResponse: r.seller_response, sellerRespondedAt: r.seller_responded_at,
    helpfulCount: r.helpful_count, createdAt: r.created_at, createdAtUs: r.created_us ?? null,
  });
}
export interface ReviewListQuery { cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class ReviewRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- review_eligibility (verified-purchase gate) ----
  /** Recorded by the order-completed handler (runs in the relay tx). Idempotent per order. */
  async insertEligibility(tx: TxContext, tenantId: string, orderId: string, buyerUserId: string, sellerUserId: string): Promise<void> {
    await tx.query(
      `INSERT INTO review_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id)
       VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`,
      [tenantId, orderId, buyerUserId, sellerUserId]);
  }
  /** The (buyer, seller) of a completed order, or null if the reviewer isn't eligible for it. */
  async eligibilityFor(tenantId: string, orderId: string): Promise<{ buyerUserId: string; sellerUserId: string } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT buyer_user_id, seller_user_id FROM review_eligibility WHERE tenant_id=$1 AND order_id=$2`, [tenantId, orderId]);
    return r.rows[0] ? { buyerUserId: r.rows[0].buyer_user_id, sellerUserId: r.rows[0].seller_user_id } : null;
  }

  // ---- review prompts (worker job: reviews/jobs/review-prompts.job.ts) ----
  /** Cross-tenant finder (kv_relay, BYPASSRLS): eligibility rows not yet nudged whose order/booking
   *  completed within the window. Bounded + FOR UPDATE SKIP LOCKED so many workers are safe and one tick
   *  never floods. Runs on the worker's privileged tx. */
  async findDueForPrompt(tx: TxContext, since: Date, limit: number): Promise<Array<{ id: string; tenantId: string; orderId: string; buyerUserId: string; sellerUserId: string }>> {
    const r = await tx.query(
      `SELECT id, tenant_id, order_id, buyer_user_id, seller_user_id FROM review_eligibility
        WHERE prompted_at IS NULL AND created_at >= $1
        ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [since, limit]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, orderId: x.order_id, buyerUserId: x.buyer_user_id, sellerUserId: x.seller_user_id }));
  }
  /** Stamp the rows the job just nudged (idempotency marker — they're never picked again). */
  async markPrompted(tx: TxContext, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.query(`UPDATE review_eligibility SET prompted_at=now() WHERE id = ANY($1::uuid[])`, [ids]);
  }

  // ---- reviews ----
  async insert(tx: TxContext, rv: Review): Promise<boolean> {
    const p = rv.toProps();
    const res = await tx.query(
      `INSERT INTO reviews (id, tenant_id, order_id, reviewer_user_id, target_type, target_id, stars, sub_ratings, body, tags, is_verified_purchase, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12)
       ON CONFLICT (order_id, reviewer_user_id, target_type, target_id) DO NOTHING`,
      [p.id, p.tenantId, p.orderId, p.reviewerUserId, p.targetType, p.targetId, p.stars, JSON.stringify(p.subRatings),
       p.body, JSON.stringify(p.tags), p.isVerifiedPurchase, p.status]);
    return (res.rowCount ?? 0) > 0;
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Review | null> {
    const r = await tx.query(`SELECT ${COLS} FROM reviews WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<Review | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM reviews WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** No version column → unconditional update within the FOR UPDATE-locked tx. */
  async update(tx: TxContext, rv: Review): Promise<void> {
    const p = rv.toProps();
    await tx.query(
      `UPDATE reviews SET stars=$3, sub_ratings=$4::jsonb, body=$5, tags=$6::jsonb, status=$7,
         seller_response=$8, seller_responded_at=$9, updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
      [p.id, p.tenantId, p.stars, JSON.stringify(p.subRatings), p.body, JSON.stringify(p.tags), p.status, p.sellerResponse, p.sellerRespondedAt]);
  }

  /** PUBLIC list of a target's published reviews. Keyset (created_at DESC, id DESC) — never OFFSET. */
  async listForTarget(tenantId: string, targetType: string, targetId: string, q: ReviewListQuery): Promise<Review[]> {
    const params: unknown[] = [tenantId, targetType, targetId];
    let where = `tenant_id=$1 AND target_type=$2 AND target_id=$3 AND status='published'`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) where += KEYSET_DESC(p(q.cursor.c), p(q.cursor.id));
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM reviews WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** The caller's OWN authored reviews (any status). */
  async listForReviewer(tenantId: string, reviewerUserId: string, q: ReviewListQuery): Promise<Review[]> {
    const params: unknown[] = [tenantId, reviewerUserId];
    let where = `tenant_id=$1 AND reviewer_user_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) where += KEYSET_DESC(p(q.cursor.c), p(q.cursor.id));
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM reviews WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** PC-56 HOTFIX-7 · B5: the ORGANISATION's public list — every PUBLISHED review of a seller in this tenant (tenant-keyed: no person uuid is
   *  needed or served). Keyset (created_at µs, id) DESC over idx_reviews_target's leading columns' sibling — bounded by the caller's limit. */
  async listForOrganisation(tenantId: string, q: ReviewListQuery): Promise<Review[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND target_type='seller' AND status='published'`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) where += KEYSET_DESC(p(q.cursor.c), p(q.cursor.id));
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM reviews WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** PC-56 HOTFIX-7 · B5: the ORGANISATION's aggregate — published seller-target reviews in this tenant (the organisation page's own rule). */
  async summaryForOrganisation(tenantId: string): Promise<{ count: number; avgStars: number; histogram: Record<string, number> }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS n, COALESCE(avg(stars),0)::numeric(3,2) AS avg, stars FROM reviews
        WHERE tenant_id=$1 AND target_type='seller' AND status='published' GROUP BY ROLLUP (stars)`, [tenantId]);
    return rollup(r.rows);
  }
  /** PC-56 HOTFIX-7 · B5: does this person hold an ORGANISATION role in this tenant (an active role other than `customer`) — the HOTFIX-6 staff
   *  test, read from the database, never from the token. A cross-module READ of identity's tables (reads may cross, repositories may not). */
  async isOrgMember(tenantId: string, userId: string): Promise<boolean> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT 1 FROM user_tenant_roles utr JOIN roles rr ON rr.id = utr.role_id
        WHERE utr.user_id = $2 AND utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL AND rr.code <> 'customer' LIMIT 1`, [tenantId, userId]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Aggregate rating rollup for a target (published only). Computed read — no per-review write amplification. */
  async summaryForTarget(tenantId: string, targetType: string, targetId: string): Promise<{ count: number; avgStars: number; histogram: Record<string, number> }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS n, COALESCE(avg(stars),0)::numeric(3,2) AS avg, stars FROM reviews
        WHERE tenant_id=$1 AND target_type=$2 AND target_id=$3 AND status='published' GROUP BY ROLLUP (stars)`,
      [tenantId, targetType, targetId]);
    return rollup(r.rows);
  }
}

function rollup(rows: any[]): { count: number; avgStars: number; histogram: Record<string, number> } {   // eslint-disable-line @typescript-eslint/no-explicit-any
  let count = 0; let avgStars = 0; const histogram: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const row of rows) {
    if (row.stars == null) { count = row.n; avgStars = Number(row.avg); }
    else histogram[String(row.stars)] = row.n;
  }
  return { count, avgStars, histogram };
}
