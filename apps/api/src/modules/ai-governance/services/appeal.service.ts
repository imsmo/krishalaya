// modules/ai-governance/services/appeal.service.ts · submit + "my appeals" (PC-56 ADMIN-SWEEP-b1, W097's
// farmer-facing half).
//
// SUBMIT IS ONE ACID TX: the ownership read, the insert with the 48h clock, the audit row and the outbox event live
// or die together (Law 4). The dedupe is the database's (0132's partial unique index), so a retried tap from a
// village network is a no-op with the SAME shape the first tap returned — not an error a farmer has to interpret.
//
// THE NOTE RIDES IN THE AUDIT ROW, NOT THE APPEALS TABLE. 0067's filed shape has no note column, and W097's queue
// does not draw one; what the farmer wrote still must not be dropped, so it is recorded where the reviewer's detail
// view already reads. Adding a column to a canon-filed shape for convenience is how schema drift starts.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { AiGovernancePublisher } from '../events/ai-governance.publisher';
import { AppealRepository } from '../repositories/appeal.repository';
import {
  assertAppealableAction, buildSubjectRef, subjectIdFor, AppealNotYoursError, APPEAL_SLA_HOURS,
} from '../domain/appeal-submit';
import type { SubmitAppealDto } from '../dto/submit-appeal.dto';

export const APPEAL_SUBMITTED_EVENT = 'moderation.appeal_submitted';

@Injectable()
export class AppealService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly publisher: AiGovernancePublisher,
    private readonly repo: AppealRepository,
  ) {}

  /** File an appeal. Any authenticated user, about a decision that hit THEM — ownership is the authorization. */
  async submit(tenantId: string, actor: { userId: string }, dto: SubmitAppealDto, ip: string | null) {
    return timed(this.metrics, 'ai.appeal.submit', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const action = assertAppealableAction(dto.subjectAction);
        const subjectId = subjectIdFor(action, dto.subjectId, actor.userId);

        // OWNERSHIP, refused as 404 (enumeration defence — the reviews module's precedent). account_restricted
        // needs no read: the subject is the caller by construction.
        if (action === 'listing_removed' && !(await this.repo.ownsListing(tx, tenantId, subjectId, actor.userId))) {
          throw new AppealNotYoursError();
        }
        if (action === 'review_hidden' && !(await this.repo.ownsReview(tx, tenantId, subjectId, actor.userId))) {
          throw new AppealNotYoursError();
        }

        const subjectRef = buildSubjectRef(action, subjectId);
        const inserted = await this.repo.insertDeduped(tx, { subjectRef, subjectAction: action, appellant: actor.userId });
        if (!inserted) {
          this.metrics.inc('ai.appeal.duplicate');
          return { id: null, deduped: true, slaHours: APPEAL_SLA_HOURS };
        }

        await this.audit.write(tx, {
          tenantId, actorUserId: actor.userId, action: 'appeal.submitted', entityType: 'appeal',
          entityId: inserted.id, newValue: { subjectRef, subjectAction: action, slaDueAt: inserted.slaDueAt },
          reason: dto.note?.trim() || null, ip,
        });
        // The platform moderation desk works from the queue, but a queue nobody is told about is a queue somebody
        // checks out of habit — the event is what the ops notifier consumes (same rail as ModerationFiled).
        await this.publisher.publish(tx, tenantId, 'appeal', inserted.id,
          [{ type: APPEAL_SUBMITTED_EVENT, payload: { appealId: inserted.id, subjectRef, subjectAction: action, slaDueAt: inserted.slaDueAt } }]);

        this.metrics.inc('ai.appeal.submitted');
        return { id: inserted.id, deduped: false, slaDueAt: inserted.slaDueAt, slaHours: APPEAL_SLA_HOURS };
      }, { userId: actor.userId }));
  }

  /** The farmer's own register — decided appeals carry their reasoning here as well as in the notice. */
  async listMine(tenantId: string, actor: { userId: string }, q: { cursor?: { c: string; id: string }; limit: number }) {
    return this.uow.run(tenantId, async (tx) => {
      const rows = await this.repo.listMine(tx, { appellant: actor.userId, cursor: q.cursor, limit: q.limit + 1 });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page,
        nextCursor: rows.length > q.limit && last
          ? Buffer.from(`${last.createdAt instanceof Date ? last.createdAt.toISOString() : last.createdAt}|${last.id}`).toString('base64') : null,
      };
    }, { userId: actor.userId });
  }
}

/** Re-exported so the controller's cursor decode stays next to its encode. */
export function decodeAppealCursor(c?: string): { c: string; id: string } | undefined {
  if (!c) return undefined;
  const [cc, id] = Buffer.from(c, 'base64').toString().split('|');
  return cc && id ? { c: cc, id } : undefined;
}
