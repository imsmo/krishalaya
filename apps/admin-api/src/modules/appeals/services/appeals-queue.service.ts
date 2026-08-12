// apps/admin-api/src/modules/appeals/services/appeals-queue.service.ts · W097's queue + "Take next"
// (PC-56 ADMIN-SWEEP-b1).
//
// "TAKE NEXT" IS THE ASSIGNMENT MECHANISM, AND ITS SHAPE IS THE ≠-REVIEWER RULE MADE PRACTICAL. The queue does not
// let a reviewer pick an appeal (a pickable queue lets a reviewer pick their own case, or the easy ones); it hands
// out the oldest deadline the CALLER IS ALLOWED to judge. Origin is resolved inside the claim's row lock — who made
// the original call is a fact the database must hold BEFORE assignment, because `chk_appeals_reviewer_neq` compares
// columns and a CHECK cannot join. SKIP LOCKED means two operators clicking at once get two different appeals
// rather than one conflict.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { AppealsRepository } from '../repositories/appeals.repository';
import {
  appealSla, claimableBy, takeNextEmpty, parseSubjectRef, reviewerSourceOf,
  APPEAL_SLA_HOURS, type AppealRow, type TakeNextEmpty,
} from '../domain/appeal';
import { AppealNotFoundError } from '../domain/appeals.errors';

/** Candidates examined per click. A claim that walks more than this many disqualified rows in one go is a queue
 *  that is nearly all this reviewer's own decisions — the honest empty state below says so instead. */
const CLAIM_SCAN_LIMIT = 20;

@Injectable()
export class AppealsQueueService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: AppealsRepository,
  ) {}

  private view(a: AppealRow & { displayReviewerId?: string | null }, now: Date, viewer: string | null) {
    return {
      id: a.id, subjectRef: a.subjectRef, subjectAction: a.subjectAction, appellant: a.appellant,
      originalActionRef: a.originalActionRef,
      originalReviewerId: a.displayReviewerId ?? a.originalReviewerId,
      // The canon's "(≠ original ✓)" column: whether the assignment satisfies the rule, judged server-side.
      assignedTo: a.assignedTo,
      assignedNeOriginal: a.assignedTo !== null
        && (a.originalReviewerId === null || a.assignedTo !== a.originalReviewerId),
      status: a.status, slaDueAt: a.slaDueAt,
      sla: a.status === 'pending' ? appealSla(a.slaDueAt, now) : null,
      decisionReason: a.decisionReason, decidedAt: a.decidedAt, createdAt: a.createdAt,
      // What THIS viewer may do with the row, so the console reflects and never grants (Law 6).
      decidableByViewer: viewer !== null && a.status === 'pending' && a.assignedTo === viewer
        && (a.originalReviewerId === null || a.originalReviewerId !== viewer),
      claimableByViewer: viewer !== null
        && claimableBy({ status: a.status, assignedTo: a.assignedTo, originalReviewerId: a.originalReviewerId }, viewer),
      slaHours: APPEAL_SLA_HOURS,
    };
  }

  async list(q: { status: string; cursor?: { k: string; id: string }; limit: number }, viewer: string | null) {
    const now = new Date();
    const rows = await this.repo.listByStatus({ status: q.status, cursor: q.cursor, limit: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    const key = q.status === 'pending' ? last?.slaDueAt : last?.decidedAt;
    const counts = await this.repo.counts();
    return {
      items: page.map((a) => this.view(a, now, viewer)),
      nextCursor: rows.length > q.limit && last && key
        ? Buffer.from(`${key}|${last.id}`).toString('base64') : null,
      counts,
    };
  }

  async get(id: string, viewer: string | null) {
    const a = await this.repo.getById(id);
    if (!a) throw new AppealNotFoundError('no such appeal');
    const subject = parseSubjectRef(a.subjectRef, a.subjectAction);
    const snapshot = subject ? await this.repo.subjectSnapshot(subject.kind, subject.id) : null;
    const notices = await this.repo.noticesForAppeal(id);
    // The decider writes to the appellant IN THIS LANGUAGE — surfaced here so the case page can say so before the
    // decide form, and the languages list so the form offers only labels that can be true.
    const appellant = await this.repo.appellantProfile(a.appellant);
    const languages = await this.repo.activeLanguages();
    return {
      appellantLanguage: appellant?.languageCode ?? null,
      activeLanguages: languages,
      ...this.view(a, new Date(), viewer),
      subjectKind: subject?.kind ?? null,
      subjectId: subject?.id ?? null,
      // null snapshot is a fact the decider must see BEFORE overturning: there may be nothing left to restore.
      subject: snapshot,
      reviewerSource: reviewerSourceOf(a.originalReviewerId ?? (a as any).displayReviewerId ?? null),
      notices,
    };
  }

  /**
   * "Take next". Walks candidates oldest-deadline-first; for each, resolves and PERSISTS the origin inside the row
   * lock, then claims only if the persisted answer still permits this caller. A candidate that resolution reveals
   * as the caller's own decision is left for a colleague — persisting the origin is not wasted work, it is the
   * answer written down for whoever comes next.
   */
  async takeNext(actor: AdminRequestContext): Promise<
    | { claimed: true; appeal: ReturnType<AppealsQueueService['view']> }
    | { claimed: false; empty: TakeNextEmpty }
  > {
    const result = await this.pool.withTx(async (c) => {
      const ids = await this.repo.claimCandidates(c, actor.userId, CLAIM_SCAN_LIMIT);
      for (const id of ids) {
        const a = await this.repo.getForUpdate(c, id);
        if (!a) continue;
        if (a.originalReviewerId === null || a.originalActionRef === null) {
          const origin = await this.repo.resolveOrigin(c, a);
          await this.repo.persistOrigin(c, id, origin);
          a.originalReviewerId = a.originalReviewerId ?? origin.reviewerId;
          a.originalActionRef = a.originalActionRef ?? origin.actionRef;
        }
        if (!claimableBy({ status: a.status, assignedTo: a.assignedTo, originalReviewerId: a.originalReviewerId }, actor.userId)) continue;
        if (!(await this.repo.claim(c, id, actor.userId))) continue;
        await this.audit.write(c, {
          actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
          action: 'moderation.appeal_claimed', entityType: 'appeal', entityId: id,
          oldValue: { assignedTo: null },
          newValue: { assignedTo: actor.userId, originalReviewerId: a.originalReviewerId, originalActionRef: a.originalActionRef },
          reason: 'take next', ip: actor.ip, requestId: actor.requestId || null,
        });
        a.assignedTo = actor.userId;
        return { claimed: true as const, appeal: this.view(a, new Date(), actor.userId) };
      }
      return null;
    });
    if (result) return result;
    // Nothing claimable. Say WHICH nothing — "queue clear" and "everything left is yours to recuse from" are
    // different mornings.
    const counts = await this.repo.unassignedPendingCounts(actor.userId);
    return { claimed: false, empty: takeNextEmpty(counts.total, counts.notOwn) };
  }
}
