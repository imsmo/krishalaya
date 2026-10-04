// modules/insights/repositories/report.repository.ts · PC-56 TENANT-SW-f · W196 — the tenant report store (0202): saved definitions
// (tenant rows own-only, platform rows read-only — RLS + `trg_srd_moves`), runs, the frozen results a run read, and schedules. Every
// query names the tenant (Law 1); writes happen in the caller's unit of work as kv_app.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import type { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { usSql } from '../domain/insights';
import type { ReportRunStatus } from '../domain/report-run.state';

export interface DefinitionRow {
  id: string; tenantId: string | null; scope: 'tenant' | 'platform'; slug: string; title: string; datasetCode: string | null; metric: string | null;
  dimensions: string[]; measures: string[]; rangeDays: number | null; createdBy: string | null; archivedAt: string | null; archiveReason: string | null;
  createdAt: string; createdUs: string; updatedAt: string;
}
export interface RunRow {
  id: string; tenantId: string; definitionId: string | null; scheduleId: string | null; datasetCode: string; dimensions: string[]; measures: string[];
  fromDay: string; toDay: string; requestedBy: string; status: ReportRunStatus; rowCount: number | null; exportJobId: string | null; statementMs: number | null;
  statementTimeout: string | null; watermark: string | null; errorCode: string | null; errorDetail: string | null; queuedAt: string; queuedUs: string;
  startedAt: string | null; finishedAt: string | null;
}
export interface ScheduleRow {
  id: string; tenantId: string; definitionId: string; cadence: 'daily' | 'weekly' | 'monthly'; weekdayIso: number | null; monthDay: number | null; timeIst: string;
  recipientRoles: string[]; active: boolean; nextRunAt: string; lastRunAt: string | null; lastRunId: string | null; createdBy: string; deactivatedAt: string | null;
  deactivateReason: string | null; createdAt: string; createdUs: string;
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const day = (v: unknown) => (v == null ? '' : (typeof v === 'string' ? v.slice(0, 10) : new Date(v as Date).toISOString().slice(0, 10)));
const DEF_COLS = `id, tenant_id, slug, title, dataset_code, metric, dimensions, measures, range_days, created_by_user_id, created_by_admin_id, archived_at, archive_reason,
  created_at, updated_at, ${usSql('created_at')} AS us`;
const RUN_COLS = `id, tenant_id, definition_id, schedule_id, dataset_code, dimensions, measures, from_day::text AS from_day, to_day::text AS to_day, requested_by, status,
  row_count, export_job_id, statement_ms, statement_timeout, watermark, error_code, error_detail, queued_at, started_at, finished_at, ${usSql('queued_at')} AS us`;
const SCH_COLS = `id, tenant_id, definition_id, cadence, weekday_iso, month_day, to_char(time_ist, 'HH24:MI') AS time_ist, recipient_roles, active, next_run_at, last_run_at,
  last_run_id, created_by, deactivated_at, deactivate_reason, created_at, ${usSql('created_at')} AS us`;

@Injectable()
export class ReportRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private db(tenantId: string, tx?: SqlExecutor | null): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ───────── definitions ───────── */
  async definitions(tenantId: string, cursor: { us: string; id: string } | null, limit: number, includeArchived: boolean): Promise<DefinitionRow[]> {
    const p: unknown[] = [tenantId, limit + 1];
    let c = '';
    if (cursor) { p.push(cursor.us, cursor.id); c = `AND (created_at < $3::timestamptz OR (created_at = $3::timestamptz AND id < $4::uuid))`; }
    const r = await this.db(tenantId).query(
      `SELECT ${DEF_COLS} FROM saved_report_definitions
        WHERE (tenant_id = $1 OR tenant_id IS NULL) AND deleted_at IS NULL ${includeArchived ? '' : 'AND archived_at IS NULL'} ${c}
        ORDER BY created_at DESC, id DESC LIMIT $2`, p);
    return r.rows.map(toDef);
  }
  async definition(tenantId: string, id: string, tx?: SqlExecutor | null): Promise<DefinitionRow | null> {
    const r = await this.db(tenantId, tx).query(`SELECT ${DEF_COLS} FROM saved_report_definitions WHERE id = $2 AND (tenant_id = $1 OR tenant_id IS NULL) AND deleted_at IS NULL`, [tenantId, id]);
    return r.rows[0] ? toDef(r.rows[0]) : null;
  }
  async insertDefinition(tx: TxContext, d: { id: string; tenantId: string; slug: string; title: string; datasetCode: string; dimensions: string[]; measures: string[]; rangeDays: number; by: string }): Promise<void> {
    await tx.query(
      `INSERT INTO saved_report_definitions (id, tenant_id, slug, title, dataset_code, dimensions, measures, range_days, created_by_user_id, created_by, bucket, window_days, currency_code)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7::text[],$8,$9,$9,'day',$8,'INR')`,
      [d.id, d.tenantId, d.slug, d.title, d.datasetCode, d.dimensions, d.measures, d.rangeDays, d.by]);
  }
  async archiveDefinition(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<number> {
    const r = await tx.query(
      `UPDATE saved_report_definitions SET archived_at = now(), archived_by = $3, archive_reason = $4, updated_at = now(), updated_by = $3
        WHERE id = $2 AND tenant_id = $1 AND archived_at IS NULL`, [tenantId, id, by, reason]);
    return r.rowCount ?? 0;
  }

  /* ───────── runs ───────── */
  async insertRun(tx: TxContext, r: { id: string; tenantId: string; definitionId: string | null; scheduleId: string | null; datasetCode: string; dimensions: string[]; measures: string[]; from: string; to: string; requestedBy: string }): Promise<void> {
    await tx.query(
      `INSERT INTO report_runs (id, tenant_id, definition_id, schedule_id, dataset_code, dimensions, measures, from_day, to_day, requested_by)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7::text[],$8::date,$9::date,$10)`,
      [r.id, r.tenantId, r.definitionId, r.scheduleId, r.datasetCode, r.dimensions, r.measures, r.from, r.to, r.requestedBy]);
  }
  async run(tenantId: string, id: string, tx?: SqlExecutor | null, forUpdate = false): Promise<RunRow | null> {
    const r = await this.db(tenantId, tx).query(`SELECT ${RUN_COLS} FROM report_runs WHERE tenant_id = $1 AND id = $2${forUpdate ? ' FOR UPDATE SKIP LOCKED' : ''}`, [tenantId, id]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }
  async runs(tenantId: string, cursor: { us: string; id: string } | null, limit: number): Promise<RunRow[]> {
    const p: unknown[] = [tenantId, limit + 1];
    let c = '';
    if (cursor) { p.push(cursor.us, cursor.id); c = `AND (queued_at < $3::timestamptz OR (queued_at = $3::timestamptz AND id < $4::uuid))`; }
    const r = await this.db(tenantId).query(`SELECT ${RUN_COLS} FROM report_runs WHERE tenant_id = $1 ${c} ORDER BY queued_at DESC, id DESC LIMIT $2`, p);
    return r.rows.map(toRun);
  }
  async queuedIds(tenantId: string, limit: number, tx: SqlExecutor): Promise<string[]> {
    const r = await tx.query(`SELECT id FROM report_runs WHERE tenant_id = $1 AND status = 'queued' ORDER BY queued_at, id LIMIT $2`, [tenantId, limit]);
    return r.rows.map((x: any) => x.id as string);
  }
  async setRun(tx: TxContext, tenantId: string, id: string, patch: Partial<{ status: ReportRunStatus; rowCount: number | null; exportJobId: string | null; statementMs: number | null; statementTimeout: string | null;
    watermark: string | null; errorCode: string | null; errorDetail: string | null; started: boolean; finished: boolean }>): Promise<void> {
    const sets: string[] = []; const p: unknown[] = [tenantId, id];
    const add = (col: string, v: unknown) => { p.push(v); sets.push(`${col} = $${p.length}`); };
    if (patch.status !== undefined) add('status', patch.status);
    if (patch.rowCount !== undefined) add('row_count', patch.rowCount);
    if (patch.exportJobId !== undefined) add('export_job_id', patch.exportJobId);
    if (patch.statementMs !== undefined) add('statement_ms', patch.statementMs);
    if (patch.statementTimeout !== undefined) add('statement_timeout', patch.statementTimeout);
    if (patch.watermark !== undefined) add('watermark', patch.watermark);
    if (patch.errorCode !== undefined) add('error_code', patch.errorCode);
    if (patch.errorDetail !== undefined) add('error_detail', patch.errorDetail);
    if (patch.started) sets.push('started_at = now()');
    if (patch.finished) sets.push('finished_at = now()');
    sets.push('updated_at = now()');
    const r = await tx.query(`UPDATE report_runs SET ${sets.join(', ')} WHERE tenant_id = $1 AND id = $2`, p);
    if ((r.rowCount ?? 0) !== 1) throw new Error(`report run ${id}: update lost`);
  }
  async insertResult(tx: TxContext, tenantId: string, runId: string, header: string[], rows: string[][]): Promise<void> {
    await tx.query(`INSERT INTO report_run_results (run_id, tenant_id, header, rows) VALUES ($1,$2,$3::text[],$4::jsonb)`, [runId, tenantId, header, JSON.stringify(rows)]);
  }
  async result(tenantId: string, runId: string, tx?: SqlExecutor | null): Promise<{ header: string[]; rows: string[][] } | null> {
    const r = await this.db(tenantId, tx).query(`SELECT header, rows FROM report_run_results WHERE tenant_id = $1 AND run_id = $2`, [tenantId, runId]);
    return r.rows[0] ? { header: r.rows[0].header as string[], rows: r.rows[0].rows as string[][] } : null;
  }

  /* ───────── schedules ───────── */
  async insertSchedule(tx: TxContext, s: { id: string; tenantId: string; definitionId: string; cadence: string; weekdayIso: number | null; monthDay: number | null; timeIst: string; roles: string[]; nextRunAt: Date; by: string }): Promise<void> {
    await tx.query(
      `INSERT INTO report_schedules (id, tenant_id, definition_id, cadence, weekday_iso, month_day, time_ist, recipient_roles, next_run_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::time,$8::text[],$9,$10)`,
      [s.id, s.tenantId, s.definitionId, s.cadence, s.weekdayIso, s.monthDay, s.timeIst, s.roles, s.nextRunAt, s.by]);
  }
  async schedule(tenantId: string, id: string, tx?: SqlExecutor | null): Promise<ScheduleRow | null> {
    const r = await this.db(tenantId, tx).query(`SELECT ${SCH_COLS} FROM report_schedules WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    return r.rows[0] ? toSch(r.rows[0]) : null;
  }
  async schedules(tenantId: string, cursor: { us: string; id: string } | null, limit: number): Promise<ScheduleRow[]> {
    const p: unknown[] = [tenantId, limit + 1];
    let c = '';
    if (cursor) { p.push(cursor.us, cursor.id); c = `AND (created_at < $3::timestamptz OR (created_at = $3::timestamptz AND id < $4::uuid))`; }
    const r = await this.db(tenantId).query(`SELECT ${SCH_COLS} FROM report_schedules WHERE tenant_id = $1 ${c} ORDER BY created_at DESC, id DESC LIMIT $2`, p);
    return r.rows.map(toSch);
  }
  async dueSchedules(tenantId: string, now: Date, tx: SqlExecutor): Promise<ScheduleRow[]> {
    const r = await tx.query(`SELECT ${SCH_COLS} FROM report_schedules WHERE tenant_id = $1 AND active AND next_run_at <= $2 ORDER BY next_run_at, id LIMIT 20 FOR UPDATE SKIP LOCKED`, [tenantId, now]);
    return r.rows.map(toSch);
  }
  async advanceSchedule(tx: TxContext, tenantId: string, id: string, next: Date, runId: string): Promise<void> {
    await tx.query(`UPDATE report_schedules SET next_run_at = $3, last_run_at = now(), last_run_id = $4, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [tenantId, id, next, runId]);
  }
  async deactivateSchedule(tx: TxContext, tenantId: string, id: string, by: string, reason: string): Promise<number> {
    const r = await tx.query(`UPDATE report_schedules SET active = false, deactivated_by = $3, deactivated_at = now(), deactivate_reason = $4, updated_at = now()
                               WHERE tenant_id = $1 AND id = $2 AND active`, [tenantId, id, by, reason]);
    return r.rowCount ?? 0;
  }
  /** Active users of this tenant holding any of the roles — a scheduled run's recipients (capped). */
  async usersWithRoles(tenantId: string, roles: readonly string[], tx: SqlExecutor): Promise<string[]> {
    const r = await tx.query(
      `SELECT DISTINCT utr.user_id FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
        WHERE utr.tenant_id = $1 AND utr.is_active AND utr.deleted_at IS NULL AND ro.code = ANY($2::text[]) ORDER BY utr.user_id LIMIT 50`, [tenantId, [...roles]]);
    return r.rows.map((x: any) => x.user_id as string);
  }
  async rolesOf(tenantId: string, userId: string, tx: SqlExecutor): Promise<string[]> {
    const r = await tx.query(`SELECT ro.code FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id WHERE utr.tenant_id = $1 AND utr.user_id = $2 AND utr.is_active AND utr.deleted_at IS NULL`, [tenantId, userId]);
    return r.rows.map((x: any) => x.code as string);
  }
  async tenantSlug(tenantId: string, tx: SqlExecutor): Promise<string> {
    const r = await tx.query(`SELECT slug FROM tenants WHERE id = $1`, [tenantId]);
    return String(r.rows[0]?.slug ?? tenantId);
  }
  async userName(tenantId: string, userId: string, tx: SqlExecutor): Promise<string | null> {
    void tenantId;
    const r = await tx.query(`SELECT full_name FROM users WHERE id = $1`, [userId]);
    return r.rows[0]?.full_name ?? null;
  }
}

function toDef(x: any): DefinitionRow {
  return { id: x.id, tenantId: x.tenant_id ?? null, scope: x.tenant_id ? 'tenant' : 'platform', slug: x.slug, title: x.title, datasetCode: x.dataset_code ?? null, metric: x.metric ?? null,
    dimensions: x.dimensions ?? [], measures: x.measures ?? [], rangeDays: x.range_days ?? null, createdBy: x.created_by_user_id ?? x.created_by_admin_id ?? null,
    archivedAt: iso(x.archived_at), archiveReason: x.archive_reason ?? null, createdAt: iso(x.created_at) as string, createdUs: x.us, updatedAt: iso(x.updated_at) as string };
}
function toRun(x: any): RunRow {
  return { id: x.id, tenantId: x.tenant_id, definitionId: x.definition_id ?? null, scheduleId: x.schedule_id ?? null, datasetCode: x.dataset_code, dimensions: x.dimensions ?? [],
    measures: x.measures ?? [], fromDay: day(x.from_day), toDay: day(x.to_day), requestedBy: x.requested_by, status: x.status, rowCount: x.row_count ?? null,
    exportJobId: x.export_job_id ?? null, statementMs: x.statement_ms ?? null, statementTimeout: x.statement_timeout ?? null, watermark: x.watermark ?? null,
    errorCode: x.error_code ?? null, errorDetail: x.error_detail ?? null, queuedAt: iso(x.queued_at) as string, queuedUs: x.us, startedAt: iso(x.started_at), finishedAt: iso(x.finished_at) };
}
function toSch(x: any): ScheduleRow {
  return { id: x.id, tenantId: x.tenant_id, definitionId: x.definition_id, cadence: x.cadence, weekdayIso: x.weekday_iso ?? null, monthDay: x.month_day ?? null, timeIst: x.time_ist,
    recipientRoles: x.recipient_roles ?? [], active: x.active === true, nextRunAt: iso(x.next_run_at) as string, lastRunAt: iso(x.last_run_at), lastRunId: x.last_run_id ?? null,
    createdBy: x.created_by, deactivatedAt: iso(x.deactivated_at), deactivateReason: x.deactivate_reason ?? null, createdAt: iso(x.created_at) as string, createdUs: x.us };
}
