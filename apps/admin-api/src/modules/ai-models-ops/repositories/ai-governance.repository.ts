// apps/admin-api/src/modules/ai-models-ops/repositories/ai-governance.repository.ts (PC-56 ADMIN-7)
//
// Separate from `AiModelRepository`, which owns the registry row and predates this wave. This one owns the three things
// ADMIN-7 adds: the fairness audit record, the cross-tenant review queue, and the inference reads W084 and W085 need.
//
// EVERY READ HERE IS CROSS-TENANT (Law 11 — god-mode). `ai_models` is a global registry, `ai_inferences` spans every
// tenant, and `ai_review_queue` is tenant-scoped with RLS that kv_admin bypasses. That is the correct behaviour for a
// platform AI Ops officer and it is why `ai.review` had to be its own owner permission rather than borrowed from the
// tenant realm.
//
// ADMIN-API DOES NOT WRITE `ai_inferences`. 0115 grants SELECT and revokes the rest: the log is append-only (0014 revokes
// UPDATE and DELETE from every app role) and the ONE mutation a review decision implies — marking an inference
// `was_overridden` — belongs to apps/api, which owns the tenant unit of work. See `markOverridden` for why that is a
// deliberate refusal rather than an omission.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import type { AuditRow } from '../domain/fairness-gate';
import type { CaseRow } from '../domain/review-case';
import type { GroupTally } from '../domain/slice-measurement';

const AUDIT_COLS = `id, model_id, window_start, window_end, sample_size, slices,
  max_gap_pp::text AS max_gap_pp, verdict, verdict_note, audited_by_admin_id,
  slices_approved_by_admin_id, slices_approved_at, created_at`;

const CASE_COLS = `id, tenant_id, inference_id::text AS inference_id, queue_kind, priority, status,
  reviewer_user_id, reviewer_admin_id, claimed_at, decision_note, resolved_at, created_at`;

function toAudit(r: Record<string, unknown>): AuditRow {
  return {
    id: String(r.id),
    modelId: String(r.model_id),
    windowStart: String(r.window_start),
    windowEnd: String(r.window_end),
    sampleSize: Number(r.sample_size),
    slices: (r.slices ?? {}) as AuditRow['slices'],
    // `numeric` crosses as a string from `pg`. Through `Number` here and not `parseFloat`: a gap is a small decimal
    // where float precision is not in question, unlike money — and pretending otherwise would put bigint ceremony
    // around a percentage.
    maxGapPp: Number(r.max_gap_pp),
    verdict: String(r.verdict),
    verdictNote: (r.verdict_note as string | null) ?? null,
    auditedByAdminId: (r.audited_by_admin_id as string | null) ?? null,
    slicesApprovedByAdminId: (r.slices_approved_by_admin_id as string | null) ?? null,
    slicesApprovedAt: (r.slices_approved_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

const MODEL_COLS = `id, code, version, status, confidence_threshold::text AS confidence_threshold, fairness_audit,
  created_at, proposed_status, proposed_by_admin_id, proposed_at, proposal_reason,
  promoted_on_audit_id, promoted_by_admin_id, promoted_at, canary_percent`;

function toModelRow(r: Record<string, unknown>) {
  return {
    id: String(r.id), code: String(r.code), version: String(r.version), status: String(r.status),
    confidenceThreshold: r.confidence_threshold == null ? null : Number(r.confidence_threshold),
    fairnessAudit: r.fairness_audit ?? null,
    createdAt: String(r.created_at),
    proposedStatus: (r.proposed_status as string | null) ?? null,
    proposedByAdminId: (r.proposed_by_admin_id as string | null) ?? null,
    proposedAt: (r.proposed_at as string | null) ?? null,
    proposalReason: (r.proposal_reason as string | null) ?? null,
    promotedOnAuditId: (r.promoted_on_audit_id as string | null) ?? null,
    promotedByAdminId: (r.promoted_by_admin_id as string | null) ?? null,
    promotedAt: (r.promoted_at as string | null) ?? null,
    canaryPercent: r.canary_percent == null ? null : Number(r.canary_percent),
  };
}

function toCase(r: Record<string, unknown>): CaseRow {
  return {
    id: String(r.id),
    tenantId: (r.tenant_id as string | null) ?? null,
    inferenceId: (r.inference_id as string | null) ?? null,
    queueKind: String(r.queue_kind),
    priority: Number(r.priority),
    status: String(r.status),
    reviewerUserId: (r.reviewer_user_id as string | null) ?? null,
    reviewerAdminId: (r.reviewer_admin_id as string | null) ?? null,
    claimedAt: (r.claimed_at as string | null) ?? null,
    decisionNote: (r.decision_note as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

@Injectable()
export class AiGovernanceRepository {
  constructor(private readonly db: AdminPool) {}

  /* ---------------------------------------------------------------------- */
  /* FAIRNESS AUDITS — W085, and the gate                                   */
  /* ---------------------------------------------------------------------- */

  /** The NEWEST audit for a model version. What the gate reads, and nothing else.
   *
   *  Not "the newest passing audit": a model with a failing June audit and a passing March one is a model that got worse,
   *  and letting the older row authorise a promotion would turn the gate into a search for the most convenient evidence. */
  async newestAudit(modelId: string): Promise<AuditRow | null> {
    const r = await this.db.query(
      `SELECT ${AUDIT_COLS} FROM ai_fairness_audits
        WHERE model_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 1`, [modelId]);
    return r.rows[0] ? toAudit(r.rows[0]) : null;
  }

  /** The same read inside a transaction, so the gate is evaluated against the state the promotion commits over. On a
   *  gate this consequential a read outside the transaction that acts on it is a read against a stale snapshot. */
  async newestAuditTx(c: PoolClient, modelId: string): Promise<AuditRow | null> {
    const r = await c.query(
      `SELECT ${AUDIT_COLS} FROM ai_fairness_audits
        WHERE model_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT 1`, [modelId]);
    return r.rows[0] ? toAudit(r.rows[0]) : null;
  }

  async auditHistory(modelId: string, limit = 20): Promise<AuditRow[]> {
    const r = await this.db.query(
      `SELECT ${AUDIT_COLS} FROM ai_fairness_audits
        WHERE model_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC LIMIT $2`, [modelId, limit]);
    return r.rows.map(toAudit);
  }

  /** W085's board: the newest audit per model, with the model's identity beside it. */
  async latestAuditPerModel(limit = 100): Promise<Array<AuditRow & { code: string; version: string; status: string }>> {
    const r = await this.db.query(
      `SELECT DISTINCT ON (a.model_id) ${AUDIT_COLS.split(', ').map((c) => (c.includes(' AS ') ? `a.${c}` : `a.${c}`)).join(', ')},
              m.code, m.version, m.status
         FROM ai_fairness_audits a
         JOIN ai_models m ON m.id = a.model_id
        WHERE a.deleted_at IS NULL AND m.deleted_at IS NULL
        ORDER BY a.model_id, a.created_at DESC, a.id DESC
        LIMIT $1`, [limit]);
    return r.rows.map((x) => ({ ...toAudit(x), code: String(x.code), version: String(x.version), status: String(x.status) }));
  }

  /** Models with NO audit at all. **This is the census that matters most on W085**, because it is currently every model
   *  on the platform — and a fairness board that only listed audited models would show an empty table and imply there was
   *  nothing to worry about. `status` is carried so the console can mark the ones already in production, which are the
   *  violations of `ck_ai_model_production_needs_audit` that migration deliberately landed NOT VALID over. */
  async modelsWithoutAudit(): Promise<Array<{ id: string; code: string; version: string; status: string; fairnessAudit: unknown }>> {
    const r = await this.db.query(
      `SELECT m.id, m.code, m.version, m.status, m.fairness_audit
         FROM ai_models m
        WHERE m.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM ai_fairness_audits a WHERE a.model_id = m.id AND a.deleted_at IS NULL)
        ORDER BY m.status, m.code, m.version`);
    return r.rows.map((x) => ({
      id: String(x.id), code: String(x.code), version: String(x.version), status: String(x.status),
      fairnessAudit: x.fairness_audit ?? null,
    }));
  }

  async insertAudit(c: PoolClient, a: {
    modelId: string; windowStart: string; windowEnd: string; sampleSize: number;
    slices: Record<string, unknown>; maxGapPp: number; verdict: string; verdictNote: string | null;
    method: Record<string, unknown>; auditedByAdminId: string | null;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO ai_fairness_audits
         (model_id, window_start, window_end, sample_size, slices, max_gap_pp, verdict, verdict_note, method, audited_by_admin_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9::jsonb,$10) RETURNING id`,
      [a.modelId, a.windowStart, a.windowEnd, a.sampleSize, JSON.stringify(a.slices), a.maxGapPp,
        a.verdict, a.verdictNote, JSON.stringify(a.method), a.auditedByAdminId]);
    return String(r.rows[0].id);
  }

  /** The DPO's sign-off on the slice definitions — the ONLY UPDATE this table permits, and 0115 grants it column by
   *  column so the grant itself enforces what may be touched. */
  async approveSlices(c: PoolClient, auditId: string, dpoAdminId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE ai_fairness_audits
          SET slices_approved_by_admin_id = $2, slices_approved_at = now(), updated_at = now()
        WHERE id = $1 AND slices_approved_by_admin_id IS NULL`,
      [auditId, dpoAdminId]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ---------------------------------------------------------------------- */
  /* THE SLICE TALLIES — what the audit is computed from                     */
  /* ---------------------------------------------------------------------- */

  /** Per-group decision and override counts for one model over a window.
   *
   *  THREE SEPARATE QUERIES RATHER THAN ONE GROUPING CUBE, on purpose: each slice partitions the same population on a
   *  different key, a CUBE would return a sparse matrix this code would have to unpick, and three index-served aggregates
   *  are cheaper to read and to reason about than one clever one. `idx_ai_inferences_tenant` serves the first.
   *
   *  `confidence_band` buckets to one decimal. Deciles and not ventiles because W081's distribution chart is drawn in
   *  ten bars, and a slice measured at a finer resolution than the screen shows would produce gaps nobody could locate. */
  async sliceTallies(modelId: string, from: string, to: string): Promise<{
    tenant: GroupTally[]; subject: GroupTally[]; confidence_band: GroupTally[];
  }> {
    const [byTenant, bySubject, byBand] = await Promise.all([
      this.db.query(
        `SELECT COALESCE(tenant_id::text, 'platform') AS grp, count(*)::text AS n,
                (count(*) FILTER (WHERE was_overridden))::text AS ov
           FROM ai_inferences
          WHERE model_id = $1 AND created_at >= $2 AND created_at < $3
          GROUP BY 1`, [modelId, from, to]),
      this.db.query(
        `SELECT subject_type AS grp, count(*)::text AS n,
                (count(*) FILTER (WHERE was_overridden))::text AS ov
           FROM ai_inferences
          WHERE model_id = $1 AND created_at >= $2 AND created_at < $3
          GROUP BY 1`, [modelId, from, to]),
      this.db.query(
        `SELECT COALESCE(to_char(floor(confidence * 10) / 10, '0.0'), 'unscored') AS grp, count(*)::text AS n,
                (count(*) FILTER (WHERE was_overridden))::text AS ov
           FROM ai_inferences
          WHERE model_id = $1 AND created_at >= $2 AND created_at < $3
          GROUP BY 1`, [modelId, from, to]),
    ]);
    const map = (rows: Array<Record<string, unknown>>): GroupTally[] => rows.map((x) => ({
      group: String(x.grp), decisions: Number(x.n), overridden: Number(x.ov),
    }));
    return { tenant: map(byTenant.rows), subject: map(bySubject.rows), confidence_band: map(byBand.rows) };
  }

  /** W079's tiles and W085's override table: totals per model over a window. */
  async modelStats(from: string, to: string): Promise<Array<{
    modelId: string; code: string; version: string; status: string; total: number; overridden: number; belowThreshold: number;
  }>> {
    const r = await this.db.query(
      `SELECT m.id, m.code, m.version, m.status,
              count(i.id)::text AS total,
              (count(i.id) FILTER (WHERE i.was_overridden))::text AS overridden,
              (count(i.id) FILTER (WHERE i.confidence IS NOT NULL
                                     AND m.confidence_threshold IS NOT NULL
                                     AND i.confidence < m.confidence_threshold))::text AS below
         FROM ai_models m
         LEFT JOIN ai_inferences i
                ON i.model_id = m.id AND i.created_at >= $1 AND i.created_at < $2
        WHERE m.deleted_at IS NULL
        GROUP BY m.id, m.code, m.version, m.status
        ORDER BY m.code, m.version`, [from, to]);
    return r.rows.map((x) => ({
      modelId: String(x.id), code: String(x.code), version: String(x.version), status: String(x.status),
      total: Number(x.total), overridden: Number(x.overridden), belowThreshold: Number(x.below),
    }));
  }

  /** W087's review-load calculation: the confidence histogram for one model. Deciles, matching `sliceTallies`. */
  async confidenceHistogram(modelId: string, from: string, to: string): Promise<Array<{ floor: number; count: number }>> {
    const r = await this.db.query(
      `SELECT (floor(confidence * 10) / 10)::text AS floor, count(*)::text AS n
         FROM ai_inferences
        WHERE model_id = $1 AND created_at >= $2 AND created_at < $3 AND confidence IS NOT NULL
        GROUP BY 1 ORDER BY 1`, [modelId, from, to]);
    return r.rows.map((x) => ({ floor: Number(x.floor), count: Number(x.n) }));
  }

  /* ---------------------------------------------------------------------- */
  /* W084 · THE DECISION EXPLORER                                           */
  /* ---------------------------------------------------------------------- */

  /** `ai_inferences` is `PARTITION BY RANGE (created_at)`, so the window is not optional and the service enforces its
   *  span before this is called — the same rule ADMIN-6 applied to the ledger explorer, where an unbounded range is a
   *  scan of every partition and W084's own "Couldn't query partition" state was describing a defect rather than a limit.
   *
   *  **`input_ref` IS NEVER SELECTED.** 0013's comment on that column is "pointers, never raw PII" and W084 repeats it in
   *  its subtitle — but a pointer set is still a map of which farmer's photograph went to which model, and the explorer's
   *  job is to show WHAT was decided, not to hand out the inputs. `output` IS selected, because the decision is the
   *  point; it is what the model concluded rather than what it was given. */
  async listInferences(o: {
    from: string; to: string; modelId?: string; tenantId?: string; overriddenOnly?: boolean;
    cursor?: { c: string; id: string }; limit: number;
  }): Promise<Array<{
    id: string; createdAt: string; modelId: string; code: string; version: string;
    subjectType: string; subjectId: string; output: unknown; confidence: number | null;
    wasOverridden: boolean; overrideReason: string | null; tenantId: string | null;
  }>> {
    const p: unknown[] = [o.from, o.to];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'i.created_at >= $1 AND i.created_at < $2';
    if (o.modelId) where += ` AND i.model_id = ${b(o.modelId)}`;
    if (o.tenantId) where += ` AND i.tenant_id = ${b(o.tenantId)}`;
    if (o.overriddenOnly) where += ' AND i.was_overridden';
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (i.created_at < ${cc} OR (i.created_at = ${cc} AND i.id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT i.id::text AS id, i.created_at, i.model_id, i.subject_type, i.subject_id,
              i.output, i.confidence::text AS confidence, i.was_overridden, i.override_reason, i.tenant_id,
              m.code, m.version
         FROM ai_inferences i
         LEFT JOIN ai_models m ON m.id = i.model_id
        WHERE ${where}
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT ${lp}`, p);
    return r.rows.map((x) => ({
      id: String(x.id), createdAt: String(x.created_at), modelId: String(x.model_id),
      code: String(x.code ?? 'unknown'), version: String(x.version ?? ''),
      subjectType: String(x.subject_type), subjectId: String(x.subject_id),
      output: x.output ?? null,
      confidence: x.confidence == null ? null : Number(x.confidence),
      wasOverridden: x.was_overridden === true,
      overrideReason: (x.override_reason as string | null) ?? null,
      tenantId: (x.tenant_id as string | null) ?? null,
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* W082 + W083 · THE CROSS-TENANT REVIEW QUEUE                            */
  /* ---------------------------------------------------------------------- */

  /** Priority then age, across every tenant. `idx_ai_queue_platform` (0115) serves it; `idx_ai_queue_claim` (0029) leads
   *  with `tenant_id` and cannot. */
  async listCases(o: {
    status?: string; queueKind?: string; tenantId?: string;
    cursor?: { pr: number; c: string; id: string }; limit: number;
  }): Promise<CaseRow[]> {
    const p: unknown[] = [];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'deleted_at IS NULL';
    if (o.status) where += ` AND status = ${b(o.status)}`;
    else where += " AND status IN ('pending','in_review')";
    if (o.queueKind) where += ` AND queue_kind = ${b(o.queueKind)}`;
    if (o.tenantId) where += ` AND tenant_id = ${b(o.tenantId)}`;
    if (o.cursor) {
      const pr = b(o.cursor.pr); const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (priority > ${pr} OR (priority = ${pr} AND (created_at > ${cc} OR (created_at = ${cc} AND id > ${ci}))))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT ${CASE_COLS} FROM ai_review_queue WHERE ${where}
        ORDER BY priority ASC, created_at ASC, id ASC LIMIT ${lp}`, p);
    return r.rows.map(toCase);
  }

  /** Counts across the WHOLE open queue, for W079's tile and W082's chips. Read separately from the page, because a desk
   *  told only about what happens to be on screen misses things when the list is long — ADMIN-5f's rule. */
  async caseCensus(): Promise<{ status: string; queueKind: string; n: number; oldest: string | null }[]> {
    const r = await this.db.query(
      `SELECT status, queue_kind, count(*)::text AS n, min(created_at) AS oldest
         FROM ai_review_queue
        WHERE deleted_at IS NULL AND status IN ('pending','in_review')
        GROUP BY status, queue_kind`);
    return r.rows.map((x) => ({
      status: String(x.status), queueKind: String(x.queue_kind), n: Number(x.n),
      oldest: (x.oldest as string | null) ?? null,
    }));
  }

  async getCase(id: string): Promise<CaseRow | null> {
    const r = await this.db.query(`SELECT ${CASE_COLS} FROM ai_review_queue WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toCase(r.rows[0]) : null;
  }

  async getCaseForUpdate(c: PoolClient, id: string): Promise<CaseRow | null> {
    const r = await c.query(
      `SELECT ${CASE_COLS} FROM ai_review_queue WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toCase(r.rows[0]) : null;
  }

  /** Claim a case for a platform reviewer.
   *
   *  The conditional WHERE is the concurrency control, not decoration: two officers pressing "Take next" on the same case
   *  would otherwise both succeed and the second would overwrite the first's name on a decision they did not make. A
   *  STALE claim may be taken over — `claimed_at` older than the window, or NULL, which is every case that reached
   *  `in_review` before 0115 existed. */
  async claimCase(c: PoolClient, id: string, adminId: string, staleBefore: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE ai_review_queue
          SET status = 'in_review', reviewer_admin_id = $2, reviewer_user_id = NULL,
              claimed_at = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
          AND status IN ('pending','in_review')
          AND (status = 'pending' OR reviewer_admin_id = $2 OR claimed_at IS NULL OR claimed_at < $3)`,
      [id, adminId, staleBefore]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Record the decision. Conditional on this admin still holding it. */
  async decideCase(c: PoolClient, id: string, adminId: string, status: 'accepted' | 'rejected', note: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE ai_review_queue
          SET status = $3, decision_note = $4, resolved_at = now(), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND status = 'in_review' AND reviewer_admin_id = $2`,
      [id, adminId, status, note]);
    return (r.rowCount ?? 0) > 0;
  }

  /** THE INFERENCE IS NOT MARKED FROM HERE, AND THAT IS THE POINT.
   *
   *  A rejected case means the human disagreed with the model, which should set `ai_inferences.was_overridden` — the
   *  figure W085's whole override analysis is built on. 0115 grants admin-api SELECT on `ai_inferences` and revokes
   *  UPDATE, because that table is append-only for every application role (0014) and a god-mode realm that could edit it
   *  could edit the record of what the platform's models decided.
   *
   *  So the override flag is set by apps/api, which owns the tenant unit of work and already has
   *  `POST /v1/ai/inferences/:id/override`. The consequence is honest and stated on screen: **a platform officer's
   *  rejection is recorded on the CASE and does not yet flip the inference's flag** — so W085's override rate under-counts
   *  platform-side rejections. ADMIN-7-Q8: the executor that settles a platform decision through to the inference, on
   *  ADMIN-2d's claim-then-settle pattern. Naming it beats either faking the write or granting the realm a power it
   *  should not have. */
  async platformDecisionsAwaitingInferenceFlag(): Promise<number> {
    const r = await this.db.query(
      `SELECT count(*)::text AS n
         FROM ai_review_queue q
        WHERE q.deleted_at IS NULL AND q.status = 'rejected' AND q.reviewer_admin_id IS NOT NULL
          AND q.inference_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM ai_inferences i
                       WHERE i.id = q.inference_id AND i.created_at = q.inference_created_at
                         AND i.was_overridden = false)`);
    return Number(r.rows[0]?.n ?? '0');
  }

  /* ---------------------------------------------------------------------- */
  /* THE PROMOTION PROPOSAL                                                 */
  /* ---------------------------------------------------------------------- */

  /** The registry row INCLUDING the columns 0115 added.
   *
   *  A separate read from `AiModelRepository.getById` on purpose. That repository's `COLS` and the `AiModel` entity
   *  predate this wave and know nothing about proposals — and widening the entity to carry them would push the
   *  governance lifecycle into a class whose only previous job was the registry row. **I first wrote the service reading
   *  `model.toProps()` cast to a Record and pulling `proposedStatus` out of it, which would have been `undefined` every
   *  time: a maker-checker rule reading a field that does not exist reads as "nothing proposed" and refuses everything,
   *  or worse, reads as "no maker" and lets one person approve their own promotion through the shared helper's
   *  unknown-initiator escape.** Caught by the type cast being the only thing that made it compile, which is exactly what
   *  a cast to `Record<string, unknown>` buys and why it was the wrong tool. */
  async modelRow(id: string): Promise<{
    id: string; code: string; version: string; status: string; confidenceThreshold: number | null;
    fairnessAudit: unknown; createdAt: string;
    proposedStatus: string | null; proposedByAdminId: string | null; proposedAt: string | null; proposalReason: string | null;
    promotedOnAuditId: string | null; promotedByAdminId: string | null; promotedAt: string | null;
    canaryPercent: number | null;
  } | null> {
    const r = await this.db.query(`SELECT ${MODEL_COLS} FROM ai_models WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rows[0] ? toModelRow(r.rows[0]) : null;
  }

  async modelRowForUpdate(c: PoolClient, id: string) {
    const r = await c.query(`SELECT ${MODEL_COLS} FROM ai_models WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
    return r.rows[0] ? toModelRow(r.rows[0]) : null;
  }

  async proposeTransition(c: PoolClient, id: string, to: string, adminId: string, reason: string, canaryPercent: number | null): Promise<boolean> {
    const r = await c.query(
      `UPDATE ai_models
          SET proposed_status = $2, proposed_by_admin_id = $3, proposed_at = now(),
              proposal_reason = $4, canary_percent = COALESCE($5, canary_percent), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND proposed_status IS NULL`,
      [id, to, adminId, reason, canaryPercent]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Apply an approved transition. The audit id is written in the SAME statement as the status, so
   *  `ck_ai_model_production_needs_audit` is satisfied at the moment production is set rather than a statement later —
   *  two UPDATEs would leave a window in which the constraint was violated inside the transaction. */
  async applyTransition(c: PoolClient, id: string, to: string, approverAdminId: string, auditId: string | null, canaryPercent: number | null): Promise<boolean> {
    const r = await c.query(
      `UPDATE ai_models
          SET status = $2,
              promoted_by_admin_id = $3, promoted_at = now(),
              promoted_on_audit_id = CASE WHEN $2 = 'production' THEN $4 ELSE promoted_on_audit_id END,
              canary_percent = CASE WHEN $2 = 'canary' THEN $5 ELSE NULL END,
              proposed_status = NULL, proposed_by_admin_id = NULL, proposed_at = NULL, proposal_reason = NULL,
              updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND proposed_status = $2`,
      [id, to, approverAdminId, auditId, canaryPercent]);
    return (r.rowCount ?? 0) > 0;
  }

  async withdrawProposal(c: PoolClient, id: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE ai_models
          SET proposed_status = NULL, proposed_by_admin_id = NULL, proposed_at = NULL, proposal_reason = NULL,
              updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL AND proposed_status IS NOT NULL`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  /** W088's alert strip and W079's overview: transitions awaiting a checker, across the registry. */
  async awaitingChecker(limit = 5): Promise<Array<{ id: string; code: string; version: string; status: string; proposedStatus: string; proposedByAdminId: string | null; proposedAt: string; reason: string | null }>> {
    const r = await this.db.query(
      `SELECT id, code, version, status, proposed_status, proposed_by_admin_id, proposed_at, proposal_reason
         FROM ai_models
        WHERE deleted_at IS NULL AND proposed_status IS NOT NULL
        ORDER BY proposed_at ASC LIMIT $1`, [limit]);
    return r.rows.map((x) => ({
      id: String(x.id), code: String(x.code), version: String(x.version), status: String(x.status),
      proposedStatus: String(x.proposed_status),
      proposedByAdminId: (x.proposed_by_admin_id as string | null) ?? null,
      proposedAt: String(x.proposed_at), reason: (x.proposal_reason as string | null) ?? null,
    }));
  }

  /** A model's promotion provenance — the audit it was granted production on, by id. What makes "why is this model in
   *  production" answerable with a row rather than with a column's current value. */
  async promotionProvenance(id: string): Promise<{ auditId: string | null; promotedAt: string | null; promotedByAdminId: string | null; canaryPercent: number | null } | null> {
    const r = await this.db.query(
      `SELECT promoted_on_audit_id, promoted_at, promoted_by_admin_id, canary_percent
         FROM ai_models WHERE id = $1 AND deleted_at IS NULL`, [id]);
    const x = r.rows[0];
    if (!x) return null;
    return {
      auditId: (x.promoted_on_audit_id as string | null) ?? null,
      promotedAt: (x.promoted_at as string | null) ?? null,
      promotedByAdminId: (x.promoted_by_admin_id as string | null) ?? null,
      canaryPercent: x.canary_percent == null ? null : Number(x.canary_percent),
    };
  }
}
