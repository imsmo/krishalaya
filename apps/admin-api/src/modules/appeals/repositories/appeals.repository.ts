// apps/admin-api/src/modules/appeals/repositories/appeals.repository.ts · W097 (PC-56 ADMIN-SWEEP-b1).
//
// SQL only — the rules live in domain/, the transactions in services/. Three tables get their FIRST writers here
// (`appeals` UPDATE, `moderation_review_lessons`, plus the appeal-origin notice rows), and two get one more reader.
//
// ORIGIN RESOLUTION IS ONE PIECE OF SQL USED TWO WAYS. The queue must DISPLAY "Original reviewer" for rows nobody
// has claimed, and the claim must PERSIST it (the ≠-reviewer CHECK compares columns, not joins). A display that
// computed one answer and a claim that persisted another would make the queue lie about who is disqualified, so
// both call the same resolver; the claim is simply the one that writes the answer down.
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { RISK_WINDOW_DAYS, REVERSAL_EVENT_CODE } from '../domain/appeal-subjects';
import type { AppealRow } from '../domain/appeal';

const APPEAL_COLS = `a.id, a.subject_ref AS "subjectRef", a.subject_action AS "subjectAction", a.appellant,
       a.original_action_ref AS "originalActionRef", a.original_reviewer_id AS "originalReviewerId",
       a.assigned_to AS "assignedTo", a.status, a.sla_due_at AS "slaDueAt",
       a.decision_reason AS "decisionReason", a.decided_at AS "decidedAt", a.created_at AS "createdAt"`;

export interface ResolvedOrigin { reviewerId: string | null; actionRef: string | null }

@Injectable()
export class AppealsRepository {
  constructor(private readonly pool: AdminPool) {}

  /* ============================ reads ============================ */

  /** Pending: oldest DEADLINE first (W097's "SLA left ▴", served by idx_appeals_status_sla). Decided: newest
   *  decision first — that is the "View history" reading order. Both keyset. */
  async listByStatus(q: { status: string; cursor?: { k: string; id: string }; limit: number }): Promise<(AppealRow & { displayReviewerId: string | null })[]> {
    const pending = q.status === 'pending';
    const key = pending ? 'a.sla_due_at' : 'a.decided_at';
    const cmp = pending ? '>' : '<';
    const p: unknown[] = [q.status];
    let w = `a.status = $1 AND a.deleted_at IS NULL`;
    if (q.cursor) {
      p.push(q.cursor.k, q.cursor.id);
      w += ` AND (${key} ${cmp} $2 OR (${key} = $2 AND a.id ${cmp} $3))`;
    }
    p.push(q.limit);
    const r = await this.pool.query(
      `SELECT ${APPEAL_COLS}, COALESCE(a.original_reviewer_id, o.reviewer_id) AS "displayReviewerId"
         FROM appeals a
         LEFT JOIN LATERAL (${ORIGIN_SQL}) o ON a.original_reviewer_id IS NULL
        WHERE ${w}
        ORDER BY ${key} ${pending ? 'ASC' : 'DESC'}, a.id ${pending ? 'ASC' : 'DESC'}
        LIMIT $${p.length}`, p);
    return r.rows;
  }

  async counts(): Promise<{ pending: number; upheld: number; overturned: number }> {
    const r = await this.pool.query(
      `SELECT status, count(*)::int AS n FROM appeals WHERE deleted_at IS NULL GROUP BY status`);
    const by: Record<string, number> = {};
    for (const row of r.rows as Array<{ status: string; n: number }>) by[row.status] = row.n;
    return { pending: by.pending ?? 0, upheld: by.upheld ?? 0, overturned: by.overturned ?? 0 };
  }

  async getById(id: string): Promise<(AppealRow & { displayReviewerId: string | null }) | null> {
    const r = await this.pool.query(
      `SELECT ${APPEAL_COLS}, COALESCE(a.original_reviewer_id, o.reviewer_id) AS "displayReviewerId"
         FROM appeals a
         LEFT JOIN LATERAL (${ORIGIN_SQL}) o ON a.original_reviewer_id IS NULL
        WHERE a.id = $1 AND a.deleted_at IS NULL`, [id]);
    return r.rows[0] ?? null;
  }

  async getForUpdate(c: PoolClient, id: string): Promise<AppealRow | null> {
    const r = await c.query(
      `SELECT ${APPEAL_COLS} FROM appeals a WHERE a.id = $1 AND a.deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ?? null;
  }

  /** The subject as it stands NOW — what the detail page shows next to the appeal, and what the overturn's restore
   *  step consults. Shape varies by kind; null means the object is gone entirely. */
  async subjectSnapshot(kind: 'listing' | 'review' | 'account', id: string): Promise<Record<string, unknown> | null> {
    if (kind === 'listing') {
      const r = await this.pool.query(
        `SELECT id, tenant_id AS "tenantId", title, status, seller_user_id AS "sellerUserId" FROM listings WHERE id = $1`, [id]);
      return r.rows[0] ?? null;
    }
    if (kind === 'review') {
      const r = await this.pool.query(
        `SELECT id, tenant_id AS "tenantId", status, reviewer_user_id AS "reviewerUserId", stars FROM reviews WHERE id = $1`, [id]);
      return r.rows[0] ?? null;
    }
    const r = await this.pool.query(
      `SELECT user_id AS "userId", tenant_id AS "tenantId", score, band FROM risk_scores WHERE user_id = $1
        ORDER BY computed_at DESC LIMIT 1`, [id]);
    return r.rows[0] ?? null;
  }

  /** Notices already queued for this appeal — the detail page's delivery honesty line. */
  async noticesForAppeal(appealId: string): Promise<any[]> {
    const r = await this.pool.query(
      `SELECT id, recipient_kind AS "recipientKind", recipient_user_id AS "recipientUserId", status, detail,
              language_code AS "languageCode", settled_at AS "settledAt", attempts
         FROM moderation_action_notices WHERE appeal_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`, [appealId]);
    return r.rows;
  }

  async appellantProfile(userId: string): Promise<{ languageCode: string; fullName: string | null } | null> {
    const r = await this.pool.query(
      `SELECT language_code AS "languageCode", full_name AS "fullName" FROM users WHERE id = $1`, [userId]);
    return r.rows[0] ?? null;
  }

  /** Same read the moderation queue uses, for the same reason: the language list is DATA. */
  async activeLanguages(): Promise<string[]> {
    const r = await this.pool.query(`SELECT code FROM languages WHERE is_active ORDER BY code`);
    return r.rows.map((x: any) => x.code);
  }

  /* ============================ claim ("Take next") ============================ */

  /** Candidate ids in deadline order, excluding rows already known to be the actor's own original decision. Rows
   *  with UNRESOLVED origin are included — the caller resolves each inside the row lock and re-checks, because the
   *  disqualification must be judged on the persisted answer, not the display join. */
  async claimCandidates(c: PoolClient, actorId: string, limit: number): Promise<string[]> {
    const r = await c.query(
      `SELECT id FROM appeals
        WHERE status = 'pending' AND assigned_to IS NULL AND deleted_at IS NULL
          AND (original_reviewer_id IS NULL OR original_reviewer_id <> $1)
        ORDER BY sla_due_at, id
        LIMIT $2
        FOR UPDATE SKIP LOCKED`, [actorId, limit]);
    return (r.rows as Array<{ id: string }>).map((x) => x.id);
  }

  /** Resolve who made the original call (and its uuid-addressable ref) for one appeal row. */
  async resolveOrigin(c: PoolClient, a: Pick<AppealRow, 'id' | 'subjectRef' | 'subjectAction' | 'appellant'>): Promise<ResolvedOrigin> {
    const r = await c.query(
      `SELECT o.reviewer_id AS "reviewerId", o.action_ref AS "actionRef"
         FROM appeals a LEFT JOIN LATERAL (${ORIGIN_SQL}) o ON true
        WHERE a.id = $1`, [a.id]);
    const row = r.rows[0] ?? {};
    return { reviewerId: row.reviewerId ?? null, actionRef: row.actionRef ?? null };
  }

  /** Persist the resolved origin (idempotent — only fills blanks, never rewrites an answer already recorded). */
  async persistOrigin(c: PoolClient, id: string, o: ResolvedOrigin): Promise<void> {
    await c.query(
      `UPDATE appeals SET original_reviewer_id = COALESCE(original_reviewer_id, $2),
                          original_action_ref = COALESCE(original_action_ref, $3), updated_at = now()
        WHERE id = $1`, [id, o.reviewerId, o.actionRef]);
  }

  /** The claim itself. The WHERE re-states every precondition so a row that changed since the candidate scan simply
   *  claims nothing; `chk_appeals_reviewer_neq` (0067) is the backstop underneath this, not the enforcement. */
  async claim(c: PoolClient, id: string, actorId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE appeals SET assigned_to = $2, updated_at = now(), updated_by = $2
        WHERE id = $1 AND status = 'pending' AND assigned_to IS NULL AND deleted_at IS NULL
          AND (original_reviewer_id IS NULL OR original_reviewer_id <> $2)`, [id, actorId]);
    return (r.rowCount ?? 0) === 1;
  }

  /** The two figures the honest empty state needs (domain/takeNextEmpty). */
  async unassignedPendingCounts(actorId: string): Promise<{ total: number; notOwn: number }> {
    const r = await this.pool.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE original_reviewer_id IS NULL OR original_reviewer_id <> $1)::int AS "notOwn"
         FROM appeals WHERE status = 'pending' AND assigned_to IS NULL AND deleted_at IS NULL`, [actorId]);
    return { total: Number(r.rows[0]?.total ?? 0), notOwn: Number(r.rows[0]?.notOwn ?? 0) };
  }

  /* ============================ decide ============================ */

  async decide(c: PoolClient, id: string, v: { status: 'upheld' | 'overturned'; reason: string }): Promise<void> {
    await c.query(
      `UPDATE appeals SET status = $2, decision_reason = $3, decided_at = now(), updated_at = now()
        WHERE id = $1`, [id, v.status, v.reason]);
  }

  /* ---------------- overturn effect 1 · restore the subject ---------------- */

  /** Un-archive — the exact inverse of applyRemoval (0112). Guarded on status so a listing the seller re-published
   *  through some future path, or that was never archived, reports 'nothing to do' instead of being stomped. */
  async restoreListing(c: PoolClient, id: string, actor: string): Promise<'restored' | 'not_archived' | 'gone'> {
    const cur = await c.query(`SELECT status FROM listings WHERE id = $1 FOR UPDATE`, [id]);
    if (!cur.rows[0]) return 'gone';
    if (cur.rows[0].status !== 'archived') return 'not_archived';
    await c.query(
      `UPDATE listings SET status = 'published', updated_by = $2, updated_at = now() WHERE id = $1`, [id, actor]);
    return 'restored';
  }

  /** hidden → published, the transition the reviews state machine allows; 'removed' is terminal there and stays
   *  terminal here — an overturn does not resurrect what the state machine says is gone. */
  async restoreReview(c: PoolClient, id: string, actor: string): Promise<'restored' | 'not_hidden' | 'gone'> {
    const cur = await c.query(`SELECT status FROM reviews WHERE id = $1 FOR UPDATE`, [id]);
    if (!cur.rows[0]) return 'gone';
    if (cur.rows[0].status !== 'hidden') return 'not_hidden';
    await c.query(
      `UPDATE reviews SET status = 'published', updated_by = $2, updated_at = now() WHERE id = $1`, [id, actor]);
    return 'restored';
  }

  /* ---------------- overturn effect 2 · reverse the risk event, heal the score ---------------- */

  /** The negative event behind the appealed action: matched by the order/action ref it was recorded against, or by
   *  its own id (account restrictions appeal the event itself). Already-reversed events are excluded so a second
   *  appeal over the same history cannot double-credit the score. */
  async findReversibleEvent(c: PoolClient, v: { userId: string; ref: string | null }): Promise<{ id: string; tenantId: string | null; eventCode: string; weight: number } | null> {
    if (!v.ref) return null;
    const r = await c.query(
      `SELECT e.id, e.tenant_id AS "tenantId", e.event_code AS "eventCode", e.weight
         FROM risk_events e
        WHERE e.user_id = $1 AND e.weight < 0 AND (e.id = $2 OR e.reference_id = $2)
          AND NOT EXISTS (SELECT 1 FROM risk_events r2
                           WHERE r2.user_id = $1 AND r2.reference_type = 'appeal' AND r2.meta->>'reverses' = e.id::text)
        ORDER BY e.created_at DESC LIMIT 1`, [v.userId, v.ref]);
    return r.rows[0] ?? null;
  }

  async recordReversal(c: PoolClient, v: { userId: string; tenantId: string | null; weight: number; appealId: string; reversesEventId: string }): Promise<void> {
    await c.query(
      `INSERT INTO risk_events (id, tenant_id, user_id, event_code, weight, reference_type, reference_id, meta)
       VALUES (uuid_generate_v7(), $1, $2, $3, $4, 'appeal', $5, jsonb_build_object('reverses', $6::text))`,
      [v.tenantId, v.userId, REVERSAL_EVENT_CODE, v.weight, v.appealId, v.reversesEventId]);
  }

  /** The 180-day weighted sum AFTER the reversal row above — the same window and aggregation the nightly recompute
   *  uses (RISK_SCORE_SOURCE), read inside this transaction so the heal is immediate, not eventual. */
  async weightedRiskTotal(c: PoolClient, userId: string, tenantId: string | null): Promise<number> {
    const r = await c.query(
      `SELECT COALESCE(SUM(weight), 0)::int AS total FROM risk_events
        WHERE user_id = $1 AND tenant_id IS NOT DISTINCT FROM $2
          AND created_at > now() - ($3 || ' days')::interval`, [userId, tenantId, String(RISK_WINDOW_DAYS)]);
    return Number(r.rows[0]?.total ?? 0);
  }

  async writeHealedScore(c: PoolClient, v: { userId: string; tenantId: string | null; score: number; band: string; appealId: string }): Promise<boolean> {
    const r = await c.query(
      `UPDATE risk_scores SET score = $3, band = $4,
              factors = factors || jsonb_build_object('healed_by_appeal', $5::text), computed_at = now()
        WHERE user_id = $1 AND tenant_id IS NOT DISTINCT FROM $2`, [v.userId, v.tenantId, v.score, v.band, v.appealId]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ---------------- overturn/uphold effect 3 · the notice ---------------- */

  async queueAppealNotice(c: PoolClient, v: { appealId: string; tenantId: string; recipientUserId: string; body: string; languageCode: string; appealPath: string }): Promise<void> {
    await c.query(
      `INSERT INTO moderation_action_notices
         (tenant_id, appeal_id, recipient_kind, recipient_user_id, body, language_code, appeal_path, idempotency_key)
       VALUES ($1, $2, 'subject_owner', $3, $4, $5, $6, $7)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [v.tenantId, v.appealId, v.recipientUserId, v.body, v.languageCode, v.appealPath,
       `appealnotice:${v.appealId}:subject_owner`]);
  }

  /** The tenant whose spine carries the notice — from the subject, because users are global (0003: no tenant_id). */
  async noticeTenantFor(c: PoolClient, kind: 'listing' | 'review' | 'account', subjectId: string, appellant: string): Promise<string | null> {
    if (kind === 'listing') {
      const r = await c.query(`SELECT tenant_id FROM listings WHERE id = $1`, [subjectId]);
      return r.rows[0]?.tenant_id ?? null;
    }
    if (kind === 'review') {
      const r = await c.query(`SELECT tenant_id FROM reviews WHERE id = $1`, [subjectId]);
      return r.rows[0]?.tenant_id ?? null;
    }
    const r = await c.query(
      `SELECT tenant_id FROM risk_scores WHERE user_id = $1 AND tenant_id IS NOT NULL ORDER BY computed_at DESC LIMIT 1`, [appellant]);
    return r.rows[0]?.tenant_id ?? null;
  }

  /* ---------------- overturn effect 4 · the lesson ---------------- */

  async insertLesson(c: PoolClient, v: { appealId: string; reviewerId: string | null; reviewerSource: 'human' | 'system'; subjectAction: string; originalActionRef: string | null; lesson: string; decidedBy: string }): Promise<void> {
    await c.query(
      `INSERT INTO moderation_review_lessons
         (appeal_id, reviewer_id, reviewer_source, subject_action, original_action_ref, lesson, decided_by_admin_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (appeal_id) DO NOTHING`,
      [v.appealId, v.reviewerId, v.reviewerSource, v.subjectAction, v.originalActionRef, v.lesson, v.decidedBy]);
  }
}

/**
 * WHO MADE THE ORIGINAL CALL, per subject kind — one LATERAL, correlated on the outer `appeals a`.
 *
 * listing_removed    → the latest 'remove' moderation order for the listing (its id is uuid-addressable: it is what
 *                      the −40 risk event was recorded against, 0112).
 * account_restricted → the latest negative risk event on the appellant is the ACTION; the accountable human, if one
 *                      exists, is the latest band-change audit actor (trust.band_changed, ADMIN-5d) — audit_log ids
 *                      are bigserial and cannot be an action_ref, so the event id carries that role.
 * review_hidden      → the tenant moderator recorded by review.hide in the shared audit_log; no uuid-addressable
 *                      action object exists (hides score nothing, 0112), so action_ref stays NULL — which the
 *                      overturn's reverse step reads, honestly, as nothing-to-reverse.
 */
const ORIGIN_SQL = `
  SELECT * FROM (
    SELECT
      CASE a.subject_action
        WHEN 'listing_removed' THEN
          (SELECT o1.actor_admin_id FROM listing_moderation_orders o1
            WHERE o1.action = 'remove' AND o1.listing_id = NULLIF(split_part(a.subject_ref, ':', 2), '')::uuid
            ORDER BY o1.created_at DESC LIMIT 1)
        WHEN 'review_hidden' THEN
          (SELECT l.actor_user_id FROM audit_log l
            WHERE l.entity_type = 'review' AND l.action = 'review.hide'
              AND l.entity_id = NULLIF(split_part(a.subject_ref, ':', 2), '')::uuid
            ORDER BY l.created_at DESC LIMIT 1)
        WHEN 'account_restricted' THEN
          (SELECT l.actor_user_id FROM audit_log l
            WHERE l.entity_type = 'risk_score' AND l.action = 'trust.band_changed' AND l.entity_id = a.appellant
            ORDER BY l.created_at DESC LIMIT 1)
      END AS reviewer_id,
      CASE a.subject_action
        WHEN 'listing_removed' THEN
          (SELECT o2.id FROM listing_moderation_orders o2
            WHERE o2.action = 'remove' AND o2.listing_id = NULLIF(split_part(a.subject_ref, ':', 2), '')::uuid
            ORDER BY o2.created_at DESC LIMIT 1)
        WHEN 'account_restricted' THEN
          (SELECT e.id FROM risk_events e
            WHERE e.user_id = a.appellant AND e.weight < 0 AND e.reference_type IS DISTINCT FROM 'appeal'
            ORDER BY e.created_at DESC LIMIT 1)
        ELSE NULL
      END AS action_ref
  ) resolved`;
