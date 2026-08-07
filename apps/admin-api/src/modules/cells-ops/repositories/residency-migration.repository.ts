// apps/admin-api/src/modules/cells-ops/repositories/residency-migration.repository.ts (PC-56 ADMIN-8b)
//
// The four objects 0117 adds: the residency evidence log, the migration pipeline, the scale plan and the provisioning
// checklist. Separate from `CellsRepository` (the map rows) and `MapApprovalRepository` (ADMIN-8's proposal gate) because
// these are the objects the canon deferred BY NAME, and keeping them together makes the deferral legible.
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import type { ViolationDraft, ViolationRow, CountryProfile } from '../domain/residency-evidence';

const VIOLATION_COLS = `id, attempt_kind, subject_type, subject_id, from_country, to_country,
  refused_by, outcome, actor_admin_id, detail, created_at`;

const JOB_COLS = `id, migrating_tenant_id, from_cell_id, from_shard_id, to_cell_id, to_shard_id, status,
  proposal_id, approved_by_admin_id, approved_at, window_start, window_end, preflight, preflight_at,
  freeze_budget_seconds, freeze_started_at, freeze_ended_at, safety_hold_until, source_cleaned_at,
  rollback_reason, failure_detail, created_by_admin_id, created_at`;

function toViolation(r: Record<string, unknown>): ViolationRow {
  return {
    id: String(r.id), attemptKind: String(r.attempt_kind),
    subjectType: String(r.subject_type), subjectId: String(r.subject_id),
    fromCountry: (r.from_country as string | null) ?? null,
    toCountry: (r.to_country as string | null) ?? null,
    refusedBy: String(r.refused_by), outcome: String(r.outcome),
    actorAdminId: (r.actor_admin_id as string | null) ?? null,
    detail: (r.detail ?? {}) as Record<string, unknown>,
    createdAt: String(r.created_at),
  };
}

export interface JobRow {
  id: string; migratingTenantId: string;
  fromCellId: string; fromShardId: string; toCellId: string; toShardId: string;
  status: string; proposalId: string | null;
  approvedByAdminId: string | null; approvedAt: string | null;
  windowStart: string | null; windowEnd: string | null;
  preflight: Record<string, unknown> | null; preflightAt: string | null;
  freezeBudgetSeconds: number; freezeStartedAt: string | null; freezeEndedAt: string | null;
  safetyHoldUntil: string | null; sourceCleanedAt: string | null;
  rollbackReason: string | null; failureDetail: string | null;
  createdByAdminId: string | null; createdAt: string;
}

function toJob(r: Record<string, unknown>): JobRow {
  return {
    id: String(r.id), migratingTenantId: String(r.migrating_tenant_id),
    fromCellId: String(r.from_cell_id), fromShardId: String(r.from_shard_id),
    toCellId: String(r.to_cell_id), toShardId: String(r.to_shard_id),
    status: String(r.status), proposalId: (r.proposal_id as string | null) ?? null,
    approvedByAdminId: (r.approved_by_admin_id as string | null) ?? null,
    approvedAt: (r.approved_at as string | null) ?? null,
    windowStart: (r.window_start as string | null) ?? null,
    windowEnd: (r.window_end as string | null) ?? null,
    preflight: (r.preflight as Record<string, unknown> | null) ?? null,
    preflightAt: (r.preflight_at as string | null) ?? null,
    freezeBudgetSeconds: Number(r.freeze_budget_seconds),
    freezeStartedAt: (r.freeze_started_at as string | null) ?? null,
    freezeEndedAt: (r.freeze_ended_at as string | null) ?? null,
    safetyHoldUntil: (r.safety_hold_until as string | null) ?? null,
    sourceCleanedAt: (r.source_cleaned_at as string | null) ?? null,
    rollbackReason: (r.rollback_reason as string | null) ?? null,
    failureDetail: (r.failure_detail as string | null) ?? null,
    createdByAdminId: (r.created_by_admin_id as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

@Injectable()
export class ResidencyMigrationRepository {
  constructor(private readonly db: AdminPool) {}

  /* ---------------------------------------------------------------------- */
  /* THE EVIDENCE LOG                                                       */
  /* ---------------------------------------------------------------------- */

  /** Record a refused (or lawfully permitted) cross-border attempt.
   *
   *  **DELIBERATELY NOT TAKING A PoolClient.** It writes on its OWN connection, outside whatever transaction the caller is
   *  in — because the caller is about to abort. Recording evidence inside the transaction that rolls back is recording
   *  nothing, and this is the single easiest way to build this table and have it stay empty. 0117's trigger says the same
   *  in its own comment for the same reason. */
  async recordViolation(v: ViolationDraft): Promise<string> {
    const r = await this.db.query(
      `INSERT INTO residency_violations
         (attempt_kind, subject_type, subject_id, from_country, to_country, from_cell_id, to_cell_id,
          refused_by, outcome, actor_admin_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING id`,
      [v.attemptKind, v.subjectType, v.subjectId, v.fromCountry, v.toCountry, v.fromCellId, v.toCellId,
        v.refusedBy, v.outcome, v.actorAdminId, JSON.stringify(v.detail)]);
    return String(r.rows[0].id);
  }

  async listViolations(o: { from: string; to: string; country?: string; cursor?: { c: string; id: string }; limit: number }): Promise<ViolationRow[]> {
    const p: unknown[] = [o.from, o.to];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = 'created_at >= $1 AND created_at < $2';
    if (o.country) { const c = b(o.country); where += ` AND (from_country = ${c} OR to_country = ${c})`; }
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (created_at < ${cc} OR (created_at = ${cc} AND id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT ${VIOLATION_COLS} FROM residency_violations WHERE ${where}
        ORDER BY created_at DESC, id DESC LIMIT ${lp}`, p);
    return r.rows.map(toViolation);
  }

  /** Every row in the window, for the attestation. Capped, and the cap is REPORTED by the caller rather than silently
   *  truncating — an attestation computed over a prefix would assert a negative about attempts it never saw. */
  async violationsForAttestation(from: string, to: string, limit = 10_000): Promise<{ rows: ViolationRow[]; truncated: boolean }> {
    const r = await this.db.query(
      `SELECT ${VIOLATION_COLS} FROM residency_violations
        WHERE created_at >= $1 AND created_at < $2 ORDER BY created_at ASC LIMIT $3`, [from, to, limit + 1]);
    const rows = r.rows.slice(0, limit).map(toViolation);
    return { rows, truncated: r.rows.length > limit };
  }

  /** WHEN THE LOG STARTED. The attestation's coverage check reads this: a window reaching back before the first row is a
   *  window the log cannot speak for, and returning `null` (no rows at all) means it can speak for nothing. */
  async loggingSince(): Promise<string | null> {
    const r = await this.db.query(`SELECT min(created_at) AS since FROM residency_violations`);
    return (r.rows[0]?.since as string | null) ?? null;
  }

  /* ---------------------------------------------------------------------- */
  /* COUNTRY PROFILES                                                       */
  /* ---------------------------------------------------------------------- */

  /** W033's table: one row per country with its profile and its cell posture. */
  async countryProfiles(): Promise<CountryProfile[]> {
    const r = await this.db.query(
      `SELECT c.code, c.default_name, c.regulation_profile, c.regulation_status,
              count(ce.id)::int AS cells,
              count(ce.id) FILTER (WHERE ce.status = 'active')::int AS active_cells,
              COALESCE(sum(ce.placed_count), 0)::int AS placed_tenants,
              COALESCE(bool_and(ce.residency_locked) FILTER (WHERE ce.id IS NOT NULL), true) AS all_locked
         FROM countries c
         LEFT JOIN cells ce ON ce.country_code = c.code AND ce.deleted_at IS NULL
        WHERE c.deleted_at IS NULL
        GROUP BY c.code, c.default_name, c.regulation_profile, c.regulation_status
        ORDER BY c.code`);
    return r.rows.map((x) => ({
      code: String(x.code), name: String(x.default_name),
      regulationProfile: (x.regulation_profile as string | null) ?? null,
      regulationStatus: String(x.regulation_status),
      cells: Number(x.cells), activeCells: Number(x.active_cells),
      placedTenants: Number(x.placed_tenants), allLocked: x.all_locked === true,
    }));
  }

  async setCountryProfile(c: PoolClient, code: string, v: { profile: string; status: string; note: string | null }): Promise<boolean> {
    const r = await c.query(
      `UPDATE countries SET regulation_profile = $2, regulation_status = $3, regulation_note = $4, updated_at = now()
        WHERE code = $1 AND deleted_at IS NULL`,
      [code, v.profile, v.status, v.note]);
    return (r.rowCount ?? 0) > 0;
  }

  /* ---------------------------------------------------------------------- */
  /* THE MIGRATION PIPELINE                                                 */
  /* ---------------------------------------------------------------------- */

  async listJobs(o: { status?: string; cursor?: { c: string; id: string }; limit: number }): Promise<JobRow[]> {
    const p: unknown[] = [];
    const b = (v: unknown) => { p.push(v); return `$${p.length}`; };
    let where = '1=1';
    if (o.status) where += ` AND status = ${b(o.status)}`;
    if (o.cursor) {
      const cc = b(o.cursor.c); const ci = b(o.cursor.id);
      where += ` AND (created_at < ${cc} OR (created_at = ${cc} AND id < ${ci}))`;
    }
    const lp = b(o.limit);
    const r = await this.db.query(
      `SELECT ${JOB_COLS} FROM migration_jobs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, p);
    return r.rows.map(toJob);
  }

  async getJob(id: string): Promise<JobRow | null> {
    const r = await this.db.query(`SELECT ${JOB_COLS} FROM migration_jobs WHERE id = $1`, [id]);
    return r.rows[0] ? toJob(r.rows[0]) : null;
  }

  async getJobForUpdate(c: PoolClient, id: string): Promise<JobRow | null> {
    const r = await c.query(`SELECT ${JOB_COLS} FROM migration_jobs WHERE id = $1 FOR UPDATE`, [id]);
    return r.rows[0] ? toJob(r.rows[0]) : null;
  }

  async insertJob(c: PoolClient, v: {
    tenantId: string; fromCellId: string; fromShardId: string; toCellId: string; toShardId: string;
    windowStart: string | null; windowEnd: string | null; createdByAdminId: string;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO migration_jobs
         (migrating_tenant_id, from_cell_id, from_shard_id, to_cell_id, to_shard_id, window_start, window_end, created_by_admin_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [v.tenantId, v.fromCellId, v.fromShardId, v.toCellId, v.toShardId, v.windowStart, v.windowEnd, v.createdByAdminId]);
    return String(r.rows[0].id);
  }

  async recordPreflight(c: PoolClient, id: string, preflight: Record<string, unknown>): Promise<void> {
    await c.query(
      `UPDATE migration_jobs SET preflight = $2::jsonb, preflight_at = now(), updated_at = now() WHERE id = $1`,
      [id, JSON.stringify(preflight)]);
  }

  /** The checker's approval, conditional on the job still being queued and unapproved. */
  async approveJob(c: PoolClient, id: string, adminId: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE migration_jobs SET approved_by_admin_id = $2, approved_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'queued' AND approved_by_admin_id IS NULL`, [id, adminId]);
    return (r.rowCount ?? 0) > 0;
  }

  async setJobStatus(c: PoolClient, id: string, from: string, to: string, extra: { rollbackReason?: string; failureDetail?: string; safetyHoldUntil?: string } = {}): Promise<boolean> {
    const r = await c.query(
      `UPDATE migration_jobs
          SET status = $3,
              rollback_reason = COALESCE($4, rollback_reason),
              failure_detail = COALESCE($5, failure_detail),
              safety_hold_until = COALESCE($6, safety_hold_until),
              updated_at = now()
        WHERE id = $1 AND status = $2`,
      [id, from, to, extra.rollbackReason ?? null, extra.failureDetail ?? null, extra.safetyHoldUntil ?? null]);
    return (r.rowCount ?? 0) > 0;
  }

  async addStep(c: PoolClient, v: { jobId: string; step: string; outcome: string; evidence: Record<string, unknown>; detail: string | null }): Promise<void> {
    await c.query(
      `INSERT INTO migration_job_steps (job_id, step, outcome, evidence, detail, finished_at)
       VALUES ($1,$2,$3,$4::jsonb,$5, CASE WHEN $3 = 'running' THEN NULL ELSE now() END)`,
      [v.jobId, v.step, v.outcome, JSON.stringify(v.evidence), v.detail]);
  }

  async jobSteps(jobId: string): Promise<Array<{ step: string; outcome: string; evidence: Record<string, unknown>; detail: string | null; startedAt: string; finishedAt: string | null }>> {
    const r = await this.db.query(
      `SELECT step, outcome, evidence, detail, started_at, finished_at
         FROM migration_job_steps WHERE job_id = $1 ORDER BY started_at ASC, id ASC`, [jobId]);
    return r.rows.map((x) => ({
      step: String(x.step), outcome: String(x.outcome),
      evidence: (x.evidence ?? {}) as Record<string, unknown>,
      detail: (x.detail as string | null) ?? null,
      startedAt: String(x.started_at), finishedAt: (x.finished_at as string | null) ?? null,
    }));
  }

  /** The current placement, so a job can be built from where the tenant actually is rather than from what a form said. */
  async placementOf(tenantId: string): Promise<{ cellId: string; shardId: string; countryCode: string } | null> {
    const r = await this.db.query(
      `SELECT p.cell_id, p.shard_id, c.country_code
         FROM tenant_placements p JOIN cells c ON c.id = p.cell_id
        WHERE p.placed_tenant_id = $1 AND p.deleted_at IS NULL`, [tenantId]);
    const x = r.rows[0];
    return x ? { cellId: String(x.cell_id), shardId: String(x.shard_id), countryCode: String(x.country_code) } : null;
  }

  async cellCountry(cellId: string): Promise<{ countryCode: string; residencyLocked: boolean; status: string } | null> {
    const r = await this.db.query(
      `SELECT country_code, residency_locked, status FROM cells WHERE id = $1 AND deleted_at IS NULL`, [cellId]);
    const x = r.rows[0];
    return x ? { countryCode: String(x.country_code), residencyLocked: x.residency_locked === true, status: String(x.status) } : null;
  }

  /* ---------------------------------------------------------------------- */
  /* THE PLAN                                                               */
  /* ---------------------------------------------------------------------- */

  async listPlanSteps(): Promise<Array<{
    id: string; cellId: string | null; targetCode: string | null; action: string;
    addsCapacity: number | null; triggerSpec: Record<string, unknown>; status: string;
    gateReason: string | null; notes: string | null; createdAt: string;
  }>> {
    const r = await this.db.query(
      `SELECT id, cell_id, target_code, action, adds_capacity, trigger_spec, status, gate_reason, notes, created_at
         FROM scale_plan_steps ORDER BY created_at DESC, id DESC LIMIT 200`);
    return r.rows.map((x) => ({
      id: String(x.id), cellId: (x.cell_id as string | null) ?? null,
      targetCode: (x.target_code as string | null) ?? null, action: String(x.action),
      addsCapacity: x.adds_capacity == null ? null : Number(x.adds_capacity),
      triggerSpec: (x.trigger_spec ?? {}) as Record<string, unknown>,
      status: String(x.status), gateReason: (x.gate_reason as string | null) ?? null,
      notes: (x.notes as string | null) ?? null, createdAt: String(x.created_at),
    }));
  }

  async insertPlanStep(c: PoolClient, v: {
    cellId: string | null; targetCode: string | null; action: string; addsCapacity: number | null;
    triggerSpec: Record<string, unknown>; status: string; gateReason: string | null; notes: string | null;
    createdByAdminId: string;
  }): Promise<string> {
    const r = await c.query(
      `INSERT INTO scale_plan_steps
         (cell_id, target_code, action, adds_capacity, trigger_spec, status, gate_reason, notes, created_by_admin_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING id`,
      [v.cellId, v.targetCode, v.action, v.addsCapacity, JSON.stringify(v.triggerSpec), v.status, v.gateReason, v.notes, v.createdByAdminId]);
    return String(r.rows[0].id);
  }

  /* ---------------------------------------------------------------------- */
  /* PROVISIONING                                                           */
  /* ---------------------------------------------------------------------- */

  async listProvisioningRuns(): Promise<Array<{
    id: string; targetCode: string; countryCode: string; status: string;
    steps: Record<string, unknown>; createdCellId: string | null;
    smokeOutcome: string | null; smokeAt: string | null;
    createdByAdminId: string | null; openedByAdminId: string | null; openedAt: string | null; createdAt: string;
  }>> {
    const r = await this.db.query(
      `SELECT id, target_code, country_code, status, steps, created_cell_id, smoke_outcome, smoke_at,
              created_by_admin_id, opened_by_admin_id, opened_at, created_at
         FROM cell_provisioning_runs ORDER BY created_at DESC, id DESC LIMIT 100`);
    return r.rows.map((x) => ({
      id: String(x.id), targetCode: String(x.target_code), countryCode: String(x.country_code),
      status: String(x.status), steps: (x.steps ?? {}) as Record<string, unknown>,
      createdCellId: (x.created_cell_id as string | null) ?? null,
      smokeOutcome: (x.smoke_outcome as string | null) ?? null,
      smokeAt: (x.smoke_at as string | null) ?? null,
      createdByAdminId: (x.created_by_admin_id as string | null) ?? null,
      openedByAdminId: (x.opened_by_admin_id as string | null) ?? null,
      openedAt: (x.opened_at as string | null) ?? null,
      createdAt: String(x.created_at),
    }));
  }

  async insertProvisioningRun(c: PoolClient, v: { targetCode: string; countryCode: string; createdByAdminId: string }): Promise<string> {
    const r = await c.query(
      `INSERT INTO cell_provisioning_runs (target_code, country_code, created_by_admin_id)
       VALUES ($1,$2,$3) RETURNING id`, [v.targetCode, v.countryCode, v.createdByAdminId]);
    return String(r.rows[0].id);
  }

  async updateProvisioningStep(c: PoolClient, id: string, step: string, done: Record<string, unknown>, status: string): Promise<boolean> {
    const r = await c.query(
      `UPDATE cell_provisioning_runs
          SET steps = COALESCE(steps, '{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb),
              status = $4, updated_at = now()
        WHERE id = $1 AND status NOT IN ('open', 'abandoned')`,
      [id, step, JSON.stringify(done), status]);
    return (r.rowCount ?? 0) > 0;
  }

  async recordSmoke(c: PoolClient, id: string, outcome: string, detail: Record<string, unknown>): Promise<boolean> {
    const r = await c.query(
      `UPDATE cell_provisioning_runs
          SET smoke_outcome = $2, smoke_detail = $3::jsonb, smoke_at = now(),
              status = CASE WHEN $2 = 'passed' THEN 'ready' ELSE 'smoke' END, updated_at = now()
        WHERE id = $1 AND status NOT IN ('open', 'abandoned')`,
      [id, outcome, JSON.stringify(detail)]);
    return (r.rowCount ?? 0) > 0;
  }
}
