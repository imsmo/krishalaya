// apps/admin-api/src/modules/billing-ops/services/scheduled-report.service.ts · manage the platform's scheduled
// reports (PC-56 ADMIN-1e, closes ADMIN-1-Q9; tables in 0095, firing in apps/worker's `scheduled-reports` job).
//
// WHAT THIS SERVICE IS CAREFUL ABOUT:
//   • IT DOES NOT SEND ANYTHING. Creating a schedule records a rule; the worker fires it. A service that also sent
//     "the first one now" would make the create button a send button, which is not what anyone reading the form expects.
//   • THE FIRST RUN IS NEVER IMMEDIATE. `nextRunAt` is computed from now, and the comparison is `<=`, so a schedule
//     created at 09:00 for 07:00 daily runs tomorrow. Getting that wrong would email everyone on every edit.
//   • RESUMING RECOMPUTES THE QUEUE. A schedule paused for a month has a `next_run_at` deep in the past; resuming it
//     without recomputing would fire instantly (and, without the run-period unique index, repeatedly).
//   • DELIVERY IS NOT CLAIMED. There is no email provider in this platform, so the console and the run history say
//     `provider_pending` rather than showing a sent tick. Naming the missing piece is the whole point of the deferral
//     ADMIN-1d made and this wave repays.
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { BillingRepository } from '../repositories/billing.repository';
import { ScheduledReportNotFoundError } from '../domain/billing-ops.errors';
import { assertRecipients, assertCadenceShape, assertHour, nextRunAt, describeSchedule, type Cadence } from '../domain/scheduled-report';
import { CreateScheduleDto, ToggleScheduleDto } from '../dto/billing-ops.dto';

@Injectable()
export class ScheduledReportService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: BillingRepository,
  ) {}

  async list() {
    return { items: await this.repo.listSchedules() };
  }

  async runs(scheduleId: string) {
    const schedule = await this.repo.getSchedule(scheduleId);
    if (!schedule) throw new ScheduledReportNotFoundError(scheduleId);
    return { schedule, runs: await this.repo.listScheduleRuns(scheduleId) };
  }

  async create(actor: AdminRequestContext, dto: CreateScheduleDto) {
    const cadence = dto.cadence as Cadence;
    const hourIst = assertHour(dto.hourIst);
    const weekdayIso = assertCadenceShape(cadence, dto.weekdayIso ?? null);
    const recipients = assertRecipients(dto.recipients);
    const next = nextRunAt(cadence, hourIst, weekdayIso, new Date());
    const id = randomUUID();

    return this.pool.withTx(async (client) => {
      await this.repo.insertSchedule(client, {
        id, report: dto.report, cadence, hourIst, weekdayIso, recipients,
        notes: dto.notes?.trim() || null, nextRunAt: next, actorUserId: actor.userId,
      });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'billing.report_schedule_created', entityType: 'scheduled_report', entityId: id,
        newValue: {
          report: dto.report, cadence, hourIst, weekdayIso, recipients,
          // the human rule, so the audit row reads as a sentence rather than three columns to reassemble
          rule: describeSchedule(cadence, hourIst, weekdayIso),
          firstRunAt: next.toISOString(),
        },
        reason: dto.notes?.trim() || `scheduled ${dto.report}: ${describeSchedule(cadence, hourIst, weekdayIso)}`,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        id, report: dto.report, cadence, hourIst, weekdayIso, recipients, isActive: true,
        nextRunAt: next.toISOString(), rule: describeSchedule(cadence, hourIst, weekdayIso),
      };
    });
  }

  /** Pause or resume. Resuming RECOMPUTES the queue so a long-paused schedule does not fire the moment it wakes. */
  async toggle(actor: AdminRequestContext, id: string, dto: ToggleScheduleDto) {
    const existing = await this.repo.getSchedule(id);
    if (!existing) throw new ScheduledReportNotFoundError(id);
    const active = dto.active !== false;
    const recomputed = active
      ? nextRunAt(String(existing.cadence) as Cadence, Number(existing.hourIst),
        existing.weekdayIso === null ? null : Number(existing.weekdayIso), new Date())
      : null;

    return this.pool.withTx(async (client) => {
      await this.repo.setScheduleActive(client, id, active, recomputed, actor.userId);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: active ? 'billing.report_schedule_resumed' : 'billing.report_schedule_paused',
        entityType: 'scheduled_report', entityId: id,
        oldValue: { isActive: existing.isActive === true, nextRunAt: existing.nextRunAt },
        newValue: { isActive: active, nextRunAt: recomputed?.toISOString() ?? existing.nextRunAt },
        reason: dto.reason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, isActive: active, nextRunAt: recomputed?.toISOString() ?? existing.nextRunAt };
    });
  }
}
