// apps/admin-api/src/modules/moderation-queue/services/report-queue.service.ts · W092 (PC-56 ADMIN-5f).
//
// The cross-tenant report queue and the platform's decision on a report. The decision is recorded in
// `handled_by_admin_id` — the column 0112 added — because `handled_by` is an FK to the FARMER table and a platform
// operator has no row in it. Both handlers are real and a decided report names exactly one.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { ModerationQueueRepository } from '../repositories/moderation-queue.repository';
import {
  triageOrder, priorityOf, reportSla, buildDecision, assertDecidable, handlerOf, reportsOnSubject,
  isSafetyDeskReason, SUBJECT_TYPES, REPORT_SLA_HOURS, PLATFORM_OUTCOMES,
} from '../domain/report-triage';
import { assertLanguage, APPEAL_PATH } from '../domain/listing-hold';
import { ModerationSubjectNotFoundError } from '../domain/moderation-queue.errors';
import type { DecideReportDto, QueryReportsDto } from '../dto/moderation-queue.dto';

@Injectable()
export class ReportQueueService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: ModerationQueueRepository,
  ) {}

  async queue(q: Omit<QueryReportsDto, 'cursor'> & { cursor?: { c: string; id: string } }) {
    const now = new Date();
    const rows = await this.repo.listOpenReports({ subjectType: q.subjectType, cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    // Triage-ordered AFTER paging, which is a real limitation and is labelled: the keyset is oldest-first for
    // stability, so a safety-desk report on page 3 is not lifted onto page 1. The `safetyDeskWaiting` count is read
    // across the whole open set so the desk is told it exists even when the page does not show it.
    return {
      items: triageOrder(page, now).map((r) => ({
        ...r,
        priority: priorityOf(r, now),
        sla: reportSla(r.createdAt, now),
        safetyDesk: isSafetyDeskReason(r.reasonCode),
        reportsOnSubject: reportsOnSubject(r.reportsOnSubject),
        handler: handlerOf(r),
      })),
      nextCursor: rows.length > q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      orderedWithinPageOnly: true,
      slaHours: REPORT_SLA_HOURS,
      subjectTypes: [...SUBJECT_TYPES],
      outcomes: [...PLATFORM_OUTCOMES],
      openTotal: await this.repo.openReportCount(),
    };
  }

  /** Decide a report as the PLATFORM. */
  async decide(actor: AdminRequestContext, id: string, dto: DecideReportDto) {
    const langs = await this.repo.activeLanguages();
    return this.pool.withTx(async (c) => {
      const r = await this.repo.getReportForUpdate(c, id);
      if (!r) throw new ModerationSubjectNotFoundError('no such report');
      assertDecidable(r);
      const decision = buildDecision(dto);
      const language = assertLanguage(dto.languageCode, langs);
      await this.repo.decideReport(c, id, {
        status: decision.status,
        // A dismissal records NO action_taken. Writing 'none' would put a value in a column whose whole purpose is to
        // name what was done, and the status already says nothing was.
        actionTaken: decision.status === 'actioned' ? decision.outcome : null,
        adminId: actor.userId,
      });
      // W092: "Reporters hear back on every report — even dismissals get a respectful explanation." System-filed
      // reports have no reporter and are exempt; there is nobody to tell.
      if (r.reporterUserId) {
        await this.repo.queueNotice(c, {
          tenantId: r.tenantId, reportId: id, recipientKind: 'reporter', recipientUserId: r.reporterUserId,
          body: decision.outcomeNote, languageCode: language, appealPath: APPEAL_PATH,
          idempotencyKey: `modnotice:report:${id}:reporter`,
        });
      }
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: `moderation.report_${decision.status}`, entityType: 'moderation_report', entityId: id,
        oldValue: { status: r.status },
        newValue: {
          status: decision.status, actionTaken: decision.status === 'actioned' ? decision.outcome : null,
          handledByAdminId: actor.userId, reporterNotified: !!r.reporterUserId,
        },
        reason: decision.outcomeNote, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, status: decision.status, reporterNotified: !!r.reporterUserId };
    });
  }
}
