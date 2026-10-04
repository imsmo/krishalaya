// modules/insights/services/report.service.ts · PC-56 TENANT-SW-f · W196 + W2738–W2740 — the tenant report builder.
//
//   catalogue          the allow-list (datasets · dimensions · measures · who may run each), the bounds, the plane's registered datasets
//   definitions        save (tenant row) · archive (with a reason; final) · list (own + platform, read-only)
//   runs               request (≤ 92 days, allow-listed, the auditor only its realm's datasets) → queued; the registered job reads it
//   schedules          daily | weekly | monthly at an IST time to tenant roles; deactivate (with a reason; final)
//
// Every request is audited (`report.run` with the definition and the range; `report.definition_saved|archived`,
// `report.schedule_created|deactivated`). The run itself (`ReportRunner.execute`) reads under `SET LOCAL statement_timeout = '60s'`,
// refuses `ROW_CAP` beyond 50,000 rows, freezes what it read and queues the watermarked CSV on the 6e-2 plane in the same transaction.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { uuidv7 } from '../../../core/database/uuid.util';
import { ExportPlaneService, EXPORT_PLANE_FLAG } from '../../../core/exports-plane/export-plane.service';
import { DATASET_REGISTRY, DatasetRegistry } from '../../../core/exports-plane/dataset.registry';
import { gateRefusal } from '../../../shared/errors/db-gate';
import {
  REPORT_DATASETS, MAX_RANGE_DAYS, ROW_CAP, STATEMENT_TIMEOUT, MAX_DIMENSIONS, MAX_MEASURES, RECIPIENT_ROLES, resolveSpec, checkRange, compileRunSql, runHeader,
  watermarkLines, nextRunAt, checkSchedule, relativeRange, datasetByCode, ScheduleCadence, DatasetDef,
} from '../domain/report-builder';
import { addDays } from '../domain/civil-days';
import { assertTransition } from '../domain/report-run.state';
import { InsightsRefusedError, REFUSED, refused, encodeUsCursor, decodeUsCursor } from '../domain/insights';
import { ReportRepository, RunRow } from '../repositories/report.repository';

export const REPORTS_FLAG = 'insights_reports';
export const REPORT_RUN_DATASET = 'report_run';
export const REPORT_READY_EVENT = 'insights.report_ready';
export const REPORT_REASON_MIN = 10;
export interface ReportActor { userId: string; permissions: ReadonlySet<string>; roles: readonly string[]; ip?: string | null }

const has = (a: ReportActor, p: string) => a.permissions.has(p) || a.permissions.has('*');
const isAuditor = (a: ReportActor) => a.roles.includes('auditor');
function rethrowGate(e: unknown): never {
  const g = gateRefusal(e);
  if (g) throw new InsightsRefusedError(g.code, g.message, g.code === 'PLATFORM_DEFINITION_READ_ONLY' ? 403 : 409);
  throw e;
}

@Injectable()
export class ReportService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(DATASET_REGISTRY) private readonly registry: DatasetRegistry,
    private readonly repo: ReportRepository,
    private readonly audit: AuditWriter,
    private readonly flags: FlagsService,
  ) {}

  /** May this actor run this dataset? `report.run` + the dataset's read verb; an auditor only the 9c realm's datasets. */
  permitted(a: ReportActor, d: DatasetDef): { ok: true } | { ok: false; code: string } {
    if (!has(a, 'report.run')) return { ok: false, code: 'FORBIDDEN' };
    if (!has(a, d.permission)) return { ok: false, code: 'FORBIDDEN' };
    if (isAuditor(a) && !d.auditor) return { ok: false, code: 'AUDITOR_DATASET_NOT_PERMITTED' };
    return { ok: true };
  }

  catalogue(a: ReportActor) {
    return {
      datasets: REPORT_DATASETS.map((d) => ({ code: d.code, dimensions: d.dimensions.map((x) => x.key), measures: d.measures.map((m) => ({ key: m.key, kind: m.kind })),
        currencyDimension: d.currencyDim ?? null, unitDimension: d.unitDim ?? null, auditorRealm: d.auditor, permitted: this.permitted(a, d).ok,
        refusal: this.permitted(a, d).ok ? null : (this.permitted(a, d) as { code: string }).code, planeDataset: d.planeDataset ?? null })),
      bounds: { maxRangeDays: MAX_RANGE_DAYS, rowCap: ROW_CAP, statementTimeout: STATEMENT_TIMEOUT, maxDimensions: MAX_DIMENSIONS, maxMeasures: MAX_MEASURES },
      replica: refused(REFUSED.analyticsReplica), memberDimension: refused(REFUSED.memberDimension), signed: refused(REFUSED.signedExport),
      watermarked: true, audited: true, recipientRoles: [...RECIPIENT_ROLES],
      /** The 6e-2 plane's registered datasets, as the registry holds them at boot (the report file itself is `report_run`). */
      planeRegistry: this.registry.codes().sort(),
    };
  }

  /* ─────────────────────────── definitions ─────────────────────────── */
  async definitions(tenantId: string, q: { cursor?: string; limit?: number; archived?: boolean }) {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const rows = await this.repo.definitions(tenantId, decodeUsCursor(q.cursor), limit, q.archived === true);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { items: page.map((d) => ({ ...d, readOnly: d.scope === 'platform', runnable: d.scope === 'tenant' || !!d.datasetCode })),
      nextCursor: rows.length > limit && last ? encodeUsCursor(last.createdUs, last.id) : null };
  }
  async definition(tenantId: string, id: string) {
    const d = await this.repo.definition(tenantId, id);
    if (!d) throw new InsightsRefusedError('REPORT_DEFINITION_NOT_FOUND', 'Report definition not found', 404);
    return { ...d, readOnly: d.scope === 'platform', runnable: d.scope === 'tenant' || !!d.datasetCode };
  }

  async saveDefinition(tenantId: string, a: ReportActor, key: string, dto: { title: string; datasetCode: string; dimensions: string[]; measures: string[]; rangeDays: number }) {
    const spec = resolveSpec({ datasetCode: dto.datasetCode, dimensions: dto.dimensions, measures: dto.measures });
    if (!spec.ok) throw new InsightsRefusedError(spec.code, `The definition is not on the allow-list (${spec.code}${spec.key ? `: ${spec.key}` : ''})`, 422);
    if (!Number.isInteger(dto.rangeDays) || dto.rangeDays < 1 || dto.rangeDays > MAX_RANGE_DAYS) throw new InsightsRefusedError('RANGE_TOO_WIDE', `A report covers at most ${MAX_RANGE_DAYS} days`, 422);
    const p = this.permitted(a, spec.spec.dataset);
    if (!p.ok) throw new InsightsRefusedError(p.code, 'You may not report on this dataset', 403);
    return this.idem.remember(key, a.userId, 'report.definition_save', () => this.uow.run(tenantId, async (tx) => {
      const id = uuidv7(); const slug = `t-${id.replace(/-/g, '').slice(-12)}`;
      try { await this.repo.insertDefinition(tx, { id, tenantId, slug, title: dto.title.trim(), datasetCode: dto.datasetCode, dimensions: dto.dimensions, measures: dto.measures, rangeDays: dto.rangeDays, by: a.userId }); }
      catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'report.definition_saved', entityType: 'saved_report_definition', entityId: id,
        newValue: { title: dto.title.trim(), dataset: dto.datasetCode, dimensions: dto.dimensions, measures: dto.measures, rangeDays: dto.rangeDays }, ip: a.ip ?? null });
      return { id, slug };
    }, { userId: a.userId }));
  }

  async archiveDefinition(tenantId: string, a: ReportActor, key: string, id: string, reasonRaw: string) {
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < REPORT_REASON_MIN) throw new InsightsRefusedError('REASON_REQUIRED', `Say why, in at least ${REPORT_REASON_MIN} characters`, 422);
    return this.idem.remember(key, a.userId, 'report.definition_archive', () => this.uow.run(tenantId, async (tx) => {
      const d = await this.repo.definition(tenantId, id, tx);
      if (!d) throw new InsightsRefusedError('REPORT_DEFINITION_NOT_FOUND', 'Report definition not found', 404);
      if (d.scope === 'platform') throw new InsightsRefusedError('PLATFORM_DEFINITION_READ_ONLY', 'A platform report definition is read-only to a cooperative', 403);
      if (d.archivedAt) throw new InsightsRefusedError('REPORT_DEFINITION_ARCHIVED', 'This definition is already archived', 409);
      try { await this.repo.archiveDefinition(tx, tenantId, id, a.userId, reason); } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'report.definition_archived', entityType: 'saved_report_definition', entityId: id,
        oldValue: { archivedAt: null }, newValue: { archived: true }, reason, ip: a.ip ?? null });
      return { id, archived: true };
    }, { userId: a.userId }));
  }

  /* ─────────────────────────── runs ─────────────────────────── */
  async requestRun(tenantId: string, a: ReportActor, key: string, dto: { definitionId?: string; datasetCode?: string; dimensions?: string[]; measures?: string[]; from?: string; to?: string }, now = new Date()) {
    let def: Awaited<ReturnType<ReportRepository['definition']>> = null;
    if (dto.definitionId) {
      def = await this.repo.definition(tenantId, dto.definitionId);
      if (!def) throw new InsightsRefusedError('REPORT_DEFINITION_NOT_FOUND', 'Report definition not found', 404);
      if (def.archivedAt) throw new InsightsRefusedError('REPORT_DEFINITION_ARCHIVED', 'This definition is archived', 409);
      if (!def.datasetCode) throw new InsightsRefusedError('PLATFORM_DEFINITION_NOT_RUNNABLE', 'This platform definition is a platform-wide metric — it cannot run on one cooperative', 409);
    }
    const datasetCode = def?.datasetCode ?? dto.datasetCode ?? '';
    const spec = resolveSpec({ datasetCode, dimensions: def?.dimensions ?? dto.dimensions ?? [], measures: def?.measures ?? dto.measures ?? [] });
    if (!spec.ok) throw new InsightsRefusedError(spec.code, `Not on the allow-list (${spec.code}${spec.key ? `: ${spec.key}` : ''})`, 422);
    const range = dto.from && dto.to ? { from: dto.from, to: dto.to } : def?.rangeDays ? relativeRange(def.rangeDays, now) : null;
    if (!range) throw new InsightsRefusedError('DATE_INVALID', 'Give From and To (IST days)', 422);
    const rc = checkRange(range.from, range.to);
    if (!rc.ok) throw new InsightsRefusedError(rc.code, rc.code === 'RANGE_TOO_WIDE' ? `A report covers at most ${MAX_RANGE_DAYS} days — narrow From/To` : 'From/To are not a valid range', 422, { maxRangeDays: MAX_RANGE_DAYS });
    const p = this.permitted(a, spec.spec.dataset);
    if (!p.ok) throw new InsightsRefusedError(p.code, p.code === 'AUDITOR_DATASET_NOT_PERMITTED' ? 'The auditor realm runs only its own datasets (orders, settlements)' : 'You may not report on this dataset', 403);
    if (spec.spec.dataset.flag && !(await this.flags.isEnabled(spec.spec.dataset.flag, { tenantId }).catch(() => false))) throw new InsightsRefusedError('DATASET_DISABLED', `This dataset's module is switched off (${spec.spec.dataset.flag})`, 409);
    if (!(await this.flags.isEnabled(EXPORT_PLANE_FLAG, { tenantId }).catch(() => false))) throw new InsightsRefusedError('EXPORT_PLANE_OFF', 'The export plane is switched off for this cooperative — a report file cannot be made', 409);
    const dims = spec.spec.dimensions.map((x) => x.key); const meas = spec.spec.measures.map((m) => m.key);
    return this.idem.remember(key, a.userId, 'report.run', () => this.uow.run(tenantId, async (tx) => {
      const id = uuidv7();
      try { await this.repo.insertRun(tx, { id, tenantId, definitionId: def?.id ?? null, scheduleId: null, datasetCode, dimensions: dims, measures: meas, from: range.from, to: range.to, requestedBy: a.userId }); }
      catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'report.run', entityType: 'report_run', entityId: id,
        newValue: { definitionId: def?.id ?? null, dataset: datasetCode, dimensions: dims, measures: meas, implied: spec.spec.implied, from: range.from, to: range.to, days: rc.days }, ip: a.ip ?? null });
      return { id, status: 'queued' as const, datasetCode, dimensions: dims, measures: meas, from: range.from, to: range.to, implied: spec.spec.implied };
    }, { userId: a.userId }));
  }

  async runs(tenantId: string, q: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const rows = await this.repo.runs(tenantId, decodeUsCursor(q.cursor), limit);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { items: page, nextCursor: rows.length > limit && last ? encodeUsCursor(last.queuedUs, last.id) : null };
  }
  async run(tenantId: string, id: string): Promise<RunRow> {
    const r = await this.repo.run(tenantId, id);
    if (!r) throw new InsightsRefusedError('REPORT_RUN_NOT_FOUND', 'Report run not found', 404);
    return r;
  }

  /* ─────────────────────────── schedules ─────────────────────────── */
  async schedules(tenantId: string, q: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
    const rows = await this.repo.schedules(tenantId, decodeUsCursor(q.cursor), limit);
    const page = rows.slice(0, limit); const last = page[page.length - 1];
    return { items: page, nextCursor: rows.length > limit && last ? encodeUsCursor(last.createdUs, last.id) : null };
  }

  async createSchedule(tenantId: string, a: ReportActor, key: string, dto: { definitionId: string; cadence: ScheduleCadence; weekdayIso?: number | null; monthDay?: number | null; timeIst: string; recipientRoles: string[] }, now = new Date()) {
    const shape = { cadence: dto.cadence, weekdayIso: dto.weekdayIso ?? null, monthDay: dto.monthDay ?? null, timeIst: dto.timeIst };
    if (!checkSchedule(shape).ok) throw new InsightsRefusedError('SCHEDULE_SHAPE', 'Daily, weekly (a weekday) or monthly (a day 1–28) at an IST time HH:MM', 422);
    const roles = [...new Set(dto.recipientRoles)];
    if (roles.length === 0 || roles.length > 5 || roles.some((r) => !(RECIPIENT_ROLES as readonly string[]).includes(r))) throw new InsightsRefusedError('SCHEDULE_RECIPIENTS', 'Recipients are one to five of the tenant roles offered', 422);
    return this.idem.remember(key, a.userId, 'report.schedule_create', () => this.uow.run(tenantId, async (tx) => {
      const d = await this.repo.definition(tenantId, dto.definitionId, tx);
      if (!d) throw new InsightsRefusedError('REPORT_DEFINITION_NOT_FOUND', 'Report definition not found', 404);
      if (d.scope === 'platform') throw new InsightsRefusedError('PLATFORM_DEFINITION_READ_ONLY', 'Schedule your own definitions; a platform definition is read-only', 403);
      if (d.archivedAt) throw new InsightsRefusedError('REPORT_DEFINITION_ARCHIVED', 'This definition is archived', 409);
      const ds = datasetByCode(d.datasetCode ?? '');
      if (!ds || !this.permitted(a, ds).ok) throw new InsightsRefusedError('FORBIDDEN', 'You may not report on this dataset', 403);
      const id = uuidv7(); const next = nextRunAt(shape, now);
      try { await this.repo.insertSchedule(tx, { id, tenantId, definitionId: d.id, cadence: shape.cadence, weekdayIso: shape.weekdayIso, monthDay: shape.monthDay, timeIst: shape.timeIst, roles, nextRunAt: next, by: a.userId }); }
      catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'report.schedule_created', entityType: 'report_schedule', entityId: id,
        newValue: { definitionId: d.id, ...shape, recipientRoles: roles, nextRunAt: next.toISOString() }, ip: a.ip ?? null });
      return { id, nextRunAt: next.toISOString() };
    }, { userId: a.userId }));
  }

  async deactivateSchedule(tenantId: string, a: ReportActor, key: string, id: string, reasonRaw: string) {
    const reason = (reasonRaw ?? '').trim();
    if (reason.length < REPORT_REASON_MIN) throw new InsightsRefusedError('REASON_REQUIRED', `Say why, in at least ${REPORT_REASON_MIN} characters`, 422);
    return this.idem.remember(key, a.userId, 'report.schedule_deactivate', () => this.uow.run(tenantId, async (tx) => {
      const s = await this.repo.schedule(tenantId, id, tx);
      if (!s) throw new InsightsRefusedError('REPORT_SCHEDULE_NOT_FOUND', 'Schedule not found', 404);
      if (!s.active) throw new InsightsRefusedError('REPORT_SCHEDULE_FINAL', 'This schedule is already off', 409);
      try { await this.repo.deactivateSchedule(tx, tenantId, id, a.userId, reason); } catch (e) { rethrowGate(e); }
      await this.audit.write(tx, { tenantId, actorUserId: a.userId, action: 'report.schedule_deactivated', entityType: 'report_schedule', entityId: id,
        oldValue: { active: true }, newValue: { active: false }, reason, ip: a.ip ?? null });
      return { id, active: false };
    }, { userId: a.userId }));
  }
}

/**
 * THE RUN — what the registered job does per tenant, in kv_app's unit of work. Public so the live spec can drive one run.
 */
@Injectable()
export class ReportRunner {
  private readonly log = new Logger(ReportRunner.name);
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    private readonly repo: ReportRepository,
    private readonly audit: AuditWriter,
    private readonly flags: FlagsService,
    private readonly plane: ExportPlaneService,
  ) {}

  /** Due schedules become queued runs (audited as report.run, actor = the schedule's author), each schedule advanced to its next IST time. */
  async materialiseDue(tenantId: string, now = new Date()): Promise<number> {
    return this.uow.run(tenantId, async (tx) => {
      const due = await this.repo.dueSchedules(tenantId, now, tx);
      let made = 0;
      for (const s of due) {
        const next = nextRunAt({ cadence: s.cadence, weekdayIso: s.weekdayIso, monthDay: s.monthDay, timeIst: s.timeIst }, now);
        const d = await this.repo.definition(tenantId, s.definitionId, tx);
        const id = uuidv7();
        if (!d || d.archivedAt || !d.datasetCode || !d.rangeDays) { await this.repo.advanceSchedule(tx, tenantId, s.id, next, id); continue; }
        const range = relativeRange(d.rangeDays, now);
        await this.repo.insertRun(tx, { id, tenantId, definitionId: d.id, scheduleId: s.id, datasetCode: d.datasetCode, dimensions: d.dimensions, measures: d.measures, from: range.from, to: range.to, requestedBy: s.createdBy });
        await this.audit.write(tx, { tenantId, actorUserId: s.createdBy, action: 'report.run', entityType: 'report_run', entityId: id,
          newValue: { definitionId: d.id, scheduleId: s.id, dataset: d.datasetCode, dimensions: d.dimensions, measures: d.measures, from: range.from, to: range.to }, reason: `schedule ${s.id}` });
        await this.repo.advanceSchedule(tx, tenantId, s.id, next, id);
        made++;
      }
      return made;
    }, { userId: undefined });
  }

  async runQueued(tenantId: string, max = 5): Promise<{ ran: number; ready: number; refused: number; failed: number }> {
    const ids = await this.uow.run(tenantId, (tx) => this.repo.queuedIds(tenantId, max, tx), { userId: undefined });
    const out = { ran: 0, ready: 0, refused: 0, failed: 0 };
    for (const id of ids) {
      const r = await this.execute(tenantId, id);
      if (r === 'skipped') continue;
      out.ran++; out[r]++;
    }
    return out;
  }

  /** One run: claim → read under the 60 s statement timeout → freeze → queue the watermarked file — or refuse / fail with a code. */
  async execute(tenantId: string, runId: string, now = new Date()): Promise<'ready' | 'refused' | 'failed' | 'skipped'> {
    // 1. CLAIM (own short transaction), with the checks that can change between asking and running
    const claim = await this.uow.run(tenantId, async (tx) => {
      const run = await this.repo.run(tenantId, runId, tx, true);
      if (!run || run.status !== 'queued') return null;
      const spec = resolveSpec({ datasetCode: run.datasetCode, dimensions: run.dimensions, measures: run.measures });
      const refuse = async (code: string, detail: string) => { assertTransition('queued', 'refused'); await this.repo.setRun(tx, tenantId, runId, { status: 'refused', errorCode: code, errorDetail: detail, finished: true }); return 'refused' as const; };
      if (!spec.ok) return refuse(spec.code, 'the definition is no longer on the allow-list');
      if (spec.spec.dataset.flag && !(await this.flags.isEnabled(spec.spec.dataset.flag, { tenantId }).catch(() => false))) return refuse('DATASET_DISABLED', `module flag ${spec.spec.dataset.flag} is off`);
      const roles = await this.repo.rolesOf(tenantId, run.requestedBy, tx);
      if (roles.includes('auditor') && !spec.spec.dataset.auditor) return refuse('AUDITOR_DATASET_NOT_PERMITTED', 'the requester holds the auditor role');
      assertTransition('queued', 'running');
      await this.repo.setRun(tx, tenantId, runId, { status: 'running', started: true });
      return { run, spec: spec.spec, roles };
    }, { userId: undefined });
    if (claim === null) return 'skipped';
    if (claim === 'refused') return 'refused';
    const { run, spec } = claim;
    const sql = compileRunSql(spec, ROW_CAP);
    const toExclusive = addDays(run.toDay, 1);

    // 2. THE READ, under the statement timeout, and everything it decides, in ONE transaction
    try {
      return await this.uow.run(tenantId, async (tx) => {
        await tx.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
        const observed = String((await tx.query<{ s: string }>(`SELECT current_setting('statement_timeout') AS s`)).rows[0]?.s ?? '');
        const t0 = Date.now();
        const r = await tx.query<Record<string, unknown>>(sql, [tenantId, run.fromDay, toExclusive]);
        const ms = Date.now() - t0;
        if (r.rows.length > ROW_CAP) {
          assertTransition('running', 'refused');
          await this.repo.setRun(tx, tenantId, runId, { status: 'refused', errorCode: 'ROW_CAP', errorDetail: `more than ${ROW_CAP} rows — narrow the range or drop a dimension`, statementMs: ms, statementTimeout: observed, finished: true });
          return 'refused' as const;
        }
        const header = runHeader(spec);
        const rows = r.rows.map((x) => header.map((h) => (x[h] == null ? '' : String(x[h]))));
        const slug = await this.repo.tenantSlug(tenantId, tx);
        const name = await this.repo.userName(tenantId, run.requestedBy, tx);
        const lines = watermarkLines({ tenantId, tenantSlug: slug, requestedBy: run.requestedBy, requesterName: name, generatedAt: now, runId, definitionId: run.definitionId,
          datasetCode: run.datasetCode, from: run.fromDay, to: run.toDay, rowCount: rows.length, dimensions: header.slice(0, spec.dimensions.length), measures: spec.measures.map((m) => m.key) });
        await this.repo.insertResult(tx, tenantId, runId, header, rows);
        const job = await this.plane.enqueueInTx(tx, tenantId, run.requestedBy, { datasetCode: REPORT_RUN_DATASET, params: { runId } });
        if (job.kind === 'off') {
          assertTransition('running', 'failed');
          await this.repo.setRun(tx, tenantId, runId, { status: 'failed', errorCode: 'EXPORT_PLANE_OFF', errorDetail: 'the export plane is off for this cooperative', statementMs: ms, statementTimeout: observed, finished: true });
          return 'failed' as const;
        }
        assertTransition('running', 'ready');
        await this.repo.setRun(tx, tenantId, runId, { status: 'ready', rowCount: rows.length, exportJobId: job.jobId, statementMs: ms, statementTimeout: observed,
          watermark: lines.map(([k, v]) => `${k}\t${v}`).join('\n'), finished: true });
        if (run.scheduleId) {
          const s = await this.repo.schedule(tenantId, run.scheduleId, tx);
          const recipients = s ? await this.repo.usersWithRoles(tenantId, s.recipientRoles, tx) : [];
          if (recipients.length) {
            await this.outbox.write(tx, { tenantId, aggregateType: 'report_run', aggregateId: runId, eventType: REPORT_READY_EVENT,
              payload: { v: 1, runId, scheduleId: run.scheduleId, exportJobId: job.jobId, dataset: run.datasetCode, rows: String(rows.length), recipientUserIds: recipients } });
          }
        }
        return 'ready' as const;
      }, { userId: run.requestedBy, retries: 0 });
    } catch (e) {
      const code = (e as { code?: string })?.code === '57014' ? 'STATEMENT_TIMEOUT' : 'QUERY_FAILED';
      this.log.warn(`report run ${runId} ${code}: ${(e as Error).message}`);
      await this.uow.run(tenantId, async (tx) => {
        assertTransition('running', 'failed');
        await this.repo.setRun(tx, tenantId, runId, { status: 'failed', errorCode: code, errorDetail: code === 'STATEMENT_TIMEOUT' ? `the statement ran past ${STATEMENT_TIMEOUT} — narrow the range or drop a dimension` : (e as Error).message.slice(0, 300), statementTimeout: STATEMENT_TIMEOUT, finished: true });
      }, { userId: undefined });
      return 'failed';
    }
  }
}
