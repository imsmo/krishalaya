// modules/reviews/repositories/review.repository.ts
// All SQL for the reviews aggregate + the review_eligibility gate. tenant_id in EVERY query (Law 1) +
// RLS. No version column (add_std_columns) → mutations LOCK the row with SELECT … FOR UPDATE. Reads on
// the replica; the public list/summary read only PUBLISHED reviews (idx_reviews_target partial index).
// PC-56 STORE-5a · B2 / B3 (founder D3): + the windows (the three platform settings through `kv_platform_setting`, 0194/0218, with the named
// fallbacks of domain/review-rules.ts — logged, never silent), the eligibility's `expires_at` / `reminded_at`, the review's `edit_locks_at`, the
// author's review for one order, the `review_dimension` vocabulary (labels in the caller's language — the lookups module's translation rule),
// the organisation's name (the preview's), the organisation's own list for its staff, and the reminder pass.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Review, ReviewProps } from '../domain/review.entity';
import { ReviewStatus } from '../domain/review.state';
import { ReviewTargetType } from '../domain/reviews.events';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import { servableTranslation } from '../../../core/database/translation-visibility';
import { positiveInt, REVIEW_EDIT_WINDOW_FALLBACK_H, REVIEW_INVITE_WINDOW_FALLBACK_D, REVIEW_REMINDER_AFTER_FALLBACK_D } from '../domain/review-rules';

/** The three platform settings of the review windows (migration 0218). */
export interface ReviewWindows { editWindowHours: number; inviteWindowDays: number; reminderAfterDays: number }
const WINDOWS_SQL = `SELECT (kv_platform_setting('reviews.edit_window_hours') #>> '{}') AS edit_h, (kv_platform_setting('reviews.invite_window_days') #>> '{}') AS invite_d,
  (kv_platform_setting('reviews.reminder_after_days') #>> '{}') AS remind_d`;
/** One dimension of the vocabulary, named in the caller's language (the lookups module's rule: a servable translation, else the default name). */
export interface ReviewDimension { code: string; label: string; sortOrder: number }
type Q = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };   // eslint-disable-line @typescript-eslint/no-explicit-any

const COLS = `id, tenant_id, order_id, reviewer_user_id, target_type, target_id, stars, sub_ratings, body, tags,
  is_verified_purchase, status, seller_response, seller_responded_at, helpful_count, created_at, ${US_SQL('created_at')} AS created_us, edit_locks_at`;
/** PC-56 HOTFIX-7 · B24: the µs keyset, newest first (the cursor's instant is the database's own print, compared as timestamptz). */
const KEYSET_DESC = (cc: string, ci: string) => ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`;
function toDomain(r: any): Review {
  return Review.rehydrate({
    id: r.id, tenantId: r.tenant_id, orderId: r.order_id, reviewerUserId: r.reviewer_user_id,
    targetType: r.target_type as ReviewTargetType, targetId: r.target_id, stars: r.stars,
    subRatings: r.sub_ratings ?? {}, body: r.body, tags: r.tags ?? [], isVerifiedPurchase: r.is_verified_purchase,
    status: r.status as ReviewStatus, sellerResponse: r.seller_response, sellerRespondedAt: r.seller_responded_at,
    helpfulCount: r.helpful_count, createdAt: r.created_at, createdAtUs: r.created_us ?? null, editLocksAt: r.edit_locks_at ?? null,
  });
}
export interface ReviewListQuery { cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class ReviewRepository {
  private readonly log = new Logger(ReviewRepository.name);
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  // ---- the windows (PC-56 STORE-5a · founder D3) ----
  /** The three settings, from the caller's transaction when given (the relay's — kv_relay holds SELECT on both settings tables since 0218) or
   *  the replica. An absent / malformed setting → its NAMED fallback, said in the log. */
  async windows(tenantId: string, tx?: Q): Promise<ReviewWindows> {
    const r = tx ? await tx.query(WINDOWS_SQL) : await this.replica.forTenant(tenantId).query(WINDOWS_SQL);
    const row = r.rows[0] ?? {};
    const edit = positiveInt(row.edit_h); const invite = positiveInt(row.invite_d); const remind = positiveInt(row.remind_d);
    if (edit === null) this.log.warn(`reviews.edit_window_hours is absent or malformed — using REVIEW_EDIT_WINDOW_FALLBACK_H (${REVIEW_EDIT_WINDOW_FALLBACK_H})`);
    if (invite === null) this.log.warn(`reviews.invite_window_days is absent or malformed — using REVIEW_INVITE_WINDOW_FALLBACK_D (${REVIEW_INVITE_WINDOW_FALLBACK_D})`);
    if (remind === null) this.log.warn(`reviews.reminder_after_days is absent or malformed — using REVIEW_REMINDER_AFTER_FALLBACK_D (${REVIEW_REMINDER_AFTER_FALLBACK_D})`);
    return { editWindowHours: edit ?? REVIEW_EDIT_WINDOW_FALLBACK_H, inviteWindowDays: invite ?? REVIEW_INVITE_WINDOW_FALLBACK_D, reminderAfterDays: remind ?? REVIEW_REMINDER_AFTER_FALLBACK_D };
  }

  // ---- review_eligibility (verified-purchase gate) ----
  /** Recorded by the order-completed handler (runs in the relay tx). Idempotent per order. PC-56 STORE-5a · B3 (founder D3): the window's end
   *  is stamped on insert — the database's own clock (the relay transaction's `now()`) + `reviews.invite_window_days`. */
  async insertEligibility(tx: TxContext, tenantId: string, orderId: string, buyerUserId: string, sellerUserId: string): Promise<void> {
    const w = await this.windows(tenantId, tx);
    await tx.query(
      `INSERT INTO review_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id, expires_at)
       VALUES ($1,$2,$3,$4, now() + make_interval(days => $5::int)) ON CONFLICT (order_id) DO NOTHING`,
      [tenantId, orderId, buyerUserId, sellerUserId, w.inviteWindowDays]);
  }
  /** The (buyer, seller) of a completed order and its window's end, or null if no eligibility was recorded for it. */
  async eligibilityFor(tenantId: string, orderId: string): Promise<{ buyerUserId: string; sellerUserId: string; expiresAt: Date | null } | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT buyer_user_id, seller_user_id, expires_at FROM review_eligibility WHERE tenant_id=$1 AND order_id=$2`, [tenantId, orderId]);
    return r.rows[0] ? { buyerUserId: r.rows[0].buyer_user_id, sellerUserId: r.rows[0].seller_user_id, expiresAt: r.rows[0].expires_at ?? null } : null;
  }
  /** PC-56 STORE-5a · B2: the caller's OWN review of one order (any status), or null. */
  async findMine(tenantId: string, reviewerUserId: string, orderId: string): Promise<Review | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM reviews WHERE tenant_id=$1 AND reviewer_user_id=$2 AND order_id=$3 ORDER BY created_at DESC LIMIT 1`, [tenantId, reviewerUserId, orderId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** PC-56 STORE-5a · B2 (Law 6): the ACTIVE `review_dimension` vocabulary (platform values — the type is not tenant-extendable), each named in
   *  `lang` by a servable translation (core/database/translation-visibility.ts — the lookups module's rule), else its default name. Bounded. */
  async dimensions(tenantId: string, lang: string): Promise<ReviewDimension[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT lv.code, COALESCE(t.text, lv.default_name) AS label, lv.sort_order
         FROM lookup_values lv
         LEFT JOIN translations t ON t.entity_type = 'lookup_value' AND t.entity_id = lv.id AND t.field = 'name' AND t.language_code = $1
          AND ${servableTranslation('t')}
        WHERE lv.type_code = 'review_dimension' AND lv.tenant_id IS NULL AND lv.is_active = true
        ORDER BY lv.sort_order, lv.code LIMIT 50`, [lang]);
    return r.rows.map((x) => ({ code: x.code, label: x.label, sortOrder: x.sort_order }));
  }
  /** PC-56 STORE-5a · B2: the organisation's display name — the preview says where the review publishes (a read of the tenants registry). */
  async organisationName(tenantId: string): Promise<string | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT display_name FROM tenants WHERE id = $1`, [tenantId]);
    return r.rows[0]?.display_name ?? null;
  }

  // ---- review prompts (worker job: reviews/jobs/review-prompts.job.ts) ----
  /** Cross-tenant finder (kv_relay, BYPASSRLS): eligibility rows not yet nudged whose order/booking
   *  completed within the window. Bounded + FOR UPDATE SKIP LOCKED so many workers are safe and one tick
   *  never floods. Runs on the worker's privileged tx. */
  async findDueForPrompt(tx: TxContext, since: Date, limit: number, now: Date = new Date(), tenantIds: string[] | null = null): Promise<Array<{ id: string; tenantId: string; orderId: string; buyerUserId: string; sellerUserId: string }>> {
    // PC-56 STORE-5a · D3: never an invite for a window that has closed; F-11: only in the tenants whose `reviews` flag is ON (when given)
    const r = await tx.query(
      `SELECT id, tenant_id, order_id, buyer_user_id, seller_user_id FROM review_eligibility
        WHERE prompted_at IS NULL AND created_at >= $1 AND (expires_at IS NULL OR expires_at > $3) AND ($4::uuid[] IS NULL OR tenant_id = ANY($4::uuid[]))
        ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED`, [since, limit, now, tenantIds]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, orderId: x.order_id, buyerUserId: x.buyer_user_id, sellerUserId: x.seller_user_id }));
  }
  /** PC-56 STORE-5a · B3 (founder D3) — the ONE reminder's rows (cross-tenant, kv_relay): invited, not yet reminded, invited at least
   *  `afterDays` ago, the window still open, and NO review of the order exists (from either party — one review ends the nudging). Bounded,
   *  FOR UPDATE SKIP LOCKED (many runners are safe; the runner also holds an advisory lock per job name). */
  async findDueForReminder(tx: TxContext, now: Date, afterDays: number, limit: number, tenantIds: string[] | null = null): Promise<Array<{ id: string; tenantId: string; orderId: string; buyerUserId: string; sellerUserId: string }>> {
    const r = await tx.query(
      `SELECT e.id, e.tenant_id, e.order_id, e.buyer_user_id, e.seller_user_id FROM review_eligibility e
        WHERE e.prompted_at IS NOT NULL AND e.reminded_at IS NULL AND e.prompted_at <= $1::timestamptz - make_interval(days => $2::int)
          AND e.expires_at > $1::timestamptz AND ($4::uuid[] IS NULL OR e.tenant_id = ANY($4::uuid[]))
          AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.tenant_id = e.tenant_id AND r.order_id = e.order_id)
        ORDER BY e.expires_at LIMIT $3 FOR UPDATE OF e SKIP LOCKED`, [now, afterDays, limit, tenantIds]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, orderId: x.order_id, buyerUserId: x.buyer_user_id, sellerUserId: x.seller_user_id }));
  }
  /** PC-56 STORE-5a · F-11 — the tenants that have an invite or a reminder due (cross-tenant, kv_relay; bounded): the clock asks each one's
   *  `reviews` flag ONCE and works only in those where it is ON — a store whose reviews are off is never told to "leave a review". */
  async dueTenants(tx: TxContext, since: Date, now: Date): Promise<string[]> {
    const r = await tx.query(
      `SELECT DISTINCT tenant_id::text AS t FROM review_eligibility
        WHERE (prompted_at IS NULL AND created_at >= $1 AND (expires_at IS NULL OR expires_at > $2))
           OR (prompted_at IS NOT NULL AND reminded_at IS NULL AND expires_at > $2)
        LIMIT 1000`, [since, now]);
    return r.rows.map((x: any) => x.t);   // eslint-disable-line @typescript-eslint/no-explicit-any
  }
  /** Stamp the rows the reminder pass just wrote (never picked again — one reminder). */
  async markReminded(tx: TxContext, ids: string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await tx.query(`UPDATE review_eligibility SET reminded_at = $2 WHERE id = ANY($1::uuid[])`, [ids, now]);
  }
  /** Stamp the rows the job just nudged (idempotency marker — they're never picked again). */
  async markPrompted(tx: TxContext, ids: string[], now: Date = new Date()): Promise<void> {
    if (ids.length === 0) return;
    await tx.query(`UPDATE review_eligibility SET prompted_at = $2 WHERE id = ANY($1::uuid[])`, [ids, now]);
  }

  // ---- reviews ----
  async insert(tx: TxContext, rv: Review): Promise<boolean> {
    const p = rv.toProps();
    const res = await tx.query(
      // PC-56 STORE-5a · B2: the lock is stamped with the row, from the SAME instant as its created_at (the service's `now`) — so
      // edit_locks_at − created_at is exactly `reviews.edit_window_hours`
      `INSERT INTO reviews (id, tenant_id, order_id, reviewer_user_id, target_type, target_id, stars, sub_ratings, body, tags, is_verified_purchase, status, edit_locks_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14)
       ON CONFLICT (order_id, reviewer_user_id, target_type, target_id) DO NOTHING`,
      [p.id, p.tenantId, p.orderId, p.reviewerUserId, p.targetType, p.targetId, p.stars, JSON.stringify(p.subRatings),
       p.body, JSON.stringify(p.tags), p.isVerifiedPurchase, p.status, p.editLocksAt ?? null, p.createdAt]);
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
  /** PC-56 STORE-5a · D2: the ORGANISATION's own list for its staff — every review of a seller in this tenant that is live or with the desk
   *  (published · under_moderation · hidden; never removed), keyset (created_at µs, id) DESC. The service serves it to organisation members only. */
  async listForOrganisationStaff(tenantId: string, q: ReviewListQuery): Promise<Review[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND target_type='seller' AND status IN ('published','under_moderation','hidden')`;
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
