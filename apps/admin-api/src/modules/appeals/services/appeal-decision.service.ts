// apps/admin-api/src/modules/appeals/services/appeal-decision.service.ts · the decision, and the four-write
// overturn as ONE transaction (PC-56 ADMIN-SWEEP-b1, W097 + W1953–W1955).
//
// HALF THIS CONTRACT IS WORSE THAN NONE OF IT. An overturn that republishes the listing but leaves the −40 event
// standing leaves a farmer flagged for something the platform admitted it got wrong; one that heals the score but
// never tells them leaves a person who thinks they are still guilty. So all four effects run inside ONE tx with the
// status flip and the audit row — a crash anywhere rolls back everything, and a retry finds `pending` and simply
// runs again. Idempotency is layered: the status flip guards the whole (a decided appeal refuses re-decision), the
// notice key and the lesson's UNIQUE(appeal_id) guard their own rows, and the reversal excludes already-reversed
// events — so no path double-credits, double-notifies, or double-blames.
//
// AND EVERY EFFECT REPORTS WHAT ACTUALLY HAPPENED. 'done' | 'nothing_to_do' | 'subject_gone', recorded in the audit
// row and returned to the console — because "restored" and "there was nothing left to restore" printed identically
// is exactly the claim-with-nothing-behind-it this program keeps finding.
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { AppealsRepository } from '../repositories/appeals.repository';
import {
  assertDecidable, assertDecisionReason, parseSubjectRef, reviewerSourceOf, AppealRuleError,
  type AppealRow, type EffectOutcome,
} from '../domain/appeal';
import { healedScore, healedBand } from '../domain/appeal-subjects';
import {
  AppealNotFoundError, AppealNotDecidableError, InvalidAppealDecisionError, AppealSubjectUnresolvableError,
} from '../domain/appeals.errors';
// Pure domain reuse across module boundaries, deliberately: the language rule and its sentence must not fork — two
// copies of "the label must be true" is how one of them stops being true.
import { assertLanguage } from '../../moderation-queue/domain/listing-hold';
import type { DecideAppealDto } from '../dto/appeals.dto';

/** Same deep link every removal notice has carried since 0112 — the appellant already knows this path. */
const APPEAL_PATH = '/help/appeal' as const;

@Injectable()
export class AppealDecisionService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: AppealsRepository,
  ) {}

  async decide(actor: AdminRequestContext, id: string, dto: DecideAppealDto) {
    return this.pool.withTx(async (c) => {
      const a = await this.repo.getForUpdate(c, id);
      if (!a) throw new AppealNotFoundError('no such appeal');
      // Late-filed rows may predate origin resolution (claim usually did this; a directly-assigned test fixture may
      // not have). The ≠ rule must be judged on the resolved answer.
      if (a.originalReviewerId === null || a.originalActionRef === null) {
        const origin = await this.repo.resolveOrigin(c, a);
        await this.repo.persistOrigin(c, id, origin);
        a.originalReviewerId = a.originalReviewerId ?? origin.reviewerId;
        a.originalActionRef = a.originalActionRef ?? origin.actionRef;
      }
      let reason: string;
      try {
        assertDecidable(a, actor.userId);
        reason = assertDecisionReason(dto.reason);
      } catch (e) {
        if (e instanceof AppealRuleError) {
          throw e.code === 'APPEAL_REASON_TOO_SHORT' ? new InvalidAppealDecisionError(e) : new AppealNotDecidableError(e);
        }
        throw e;
      }

      const subject = parseSubjectRef(a.subjectRef, a.subjectAction);
      if (!subject) {
        throw new AppealSubjectUnresolvableError(
          `subject_ref '${a.subjectRef}' does not name a ${a.subjectAction} subject — this appeal was mis-filed and needs engineering, not a decision`);
      }

      // The operator writes the reason IN the appellant's language (the case page shows which); the label is
      // validated against the active-language list so it cannot claim a language the spine cannot render.
      const language = assertLanguage(dto.languageCode, await this.repo.activeLanguages());

      const effects: EffectOutcome[] = dto.outcome === 'overturned'
        ? await this.runOverturn(c, a, subject, reason, actor.userId)
        : [];

      // BOTH outcomes owe the appellant the reasoning, in their language (W097: "every closed appeal shows its
      // reasoning to the appellant — even upheld ones"). Queued here, settled by the apps/api executor — the row
      // never claims delivery the spine has not made.
      const noticeTenant = await this.repo.noticeTenantFor(c, subject.kind, subject.id, a.appellant);
      if (noticeTenant) {
        // The operator's words, verbatim — including the apology on an overturn, which the confirm step requires
        // them to write rather than having a machine append one in a language the reason might not share.
        await this.repo.queueAppealNotice(c, {
          appealId: id, tenantId: noticeTenant, recipientUserId: a.appellant,
          body: reason, languageCode: language, appealPath: APPEAL_PATH,
        });
        effects.push({ effect: 'notify_appellant', state: 'done', detail: `queued in ${language}` });
      } else {
        effects.push({
          effect: 'notify_appellant', state: 'nothing_to_do',
          detail: 'no tenant context resolves for this subject, and the notification spine is tenant-scoped — nobody was notified',
        });
      }

      await this.repo.decide(c, id, { status: dto.outcome, reason });

      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: dto.outcome === 'overturned' ? 'moderation.appeal_overturned' : 'moderation.appeal_upheld',
        entityType: 'appeal', entityId: id,
        oldValue: { status: 'pending', assignedTo: a.assignedTo, originalReviewerId: a.originalReviewerId },
        newValue: { status: dto.outcome, effects },
        reason, ip: actor.ip, requestId: actor.requestId || null,
      });

      return { ok: true, id, outcome: dto.outcome, effects };
    });
  }

  /** The four writes. Every effect is ATTEMPTED and every outcome NAMED; nothing is skipped silently. */
  private async runOverturn(
    c: PoolClient, a: AppealRow, subject: { kind: 'listing' | 'review' | 'account'; id: string },
    reason: string, actorId: string,
  ): Promise<EffectOutcome[]> {
    const effects: EffectOutcome[] = [];

    // ---- 1. restore the subject ----
    if (subject.kind === 'listing') {
      const r = await this.repo.restoreListing(c, subject.id, actorId);
      effects.push(
        r === 'restored' ? { effect: 'restore_subject', state: 'done', detail: 'listing republished' }
        : r === 'gone' ? { effect: 'restore_subject', state: 'subject_gone', detail: 'the listing no longer exists; nothing was republished' }
        : { effect: 'restore_subject', state: 'nothing_to_do', detail: 'the listing is not archived (already restored or re-listed); left as it stands' });
    } else if (subject.kind === 'review') {
      const r = await this.repo.restoreReview(c, subject.id, actorId);
      effects.push(
        r === 'restored' ? { effect: 'restore_subject', state: 'done', detail: 'review republished' }
        : r === 'gone' ? { effect: 'restore_subject', state: 'subject_gone', detail: 'the review no longer exists; nothing was republished' }
        : { effect: 'restore_subject', state: 'nothing_to_do', detail: 'the review is not hidden (removed is terminal in the reviews state machine); left as it stands' });
    } else {
      // Access heals through the score below — restoring the band by hand would fight the recompute one write later.
      effects.push({ effect: 'restore_subject', state: 'done', detail: 'access heals with the score (effect 2); no separate subject row to restore' });
    }

    // ---- 2. reverse the risk event so the score heals — NOW, in this tx, not at the next nightly recompute ----
    const event = await this.repo.findReversibleEvent(c, { userId: a.appellant, ref: a.originalActionRef });
    if (event) {
      await this.repo.recordReversal(c, {
        userId: a.appellant, tenantId: event.tenantId, weight: -event.weight, appealId: a.id, reversesEventId: event.id,
      });
      const total = await this.repo.weightedRiskTotal(c, a.appellant, event.tenantId);
      const score = healedScore(total);
      const band = healedBand(score);
      const wrote = await this.repo.writeHealedScore(c, { userId: a.appellant, tenantId: event.tenantId, score, band, appealId: a.id });
      effects.push({
        effect: 'reverse_risk_event', state: 'done',
        detail: wrote
          ? `${event.eventCode} (${event.weight}) reversed; score recomputed to ${score} (${band})`
          : `${event.eventCode} (${event.weight}) reversed; no score row existed to rewrite — the next scored event starts clean`,
      });
    } else {
      effects.push({
        effect: 'reverse_risk_event', state: 'nothing_to_do',
        detail: 'no unreversed negative risk event is recorded behind this action (holds and hides score nothing) — the score was never harmed',
      });
    }

    // ---- 4. the lesson (effect 3, the notice, is queued by decide() for both outcomes) ----
    await this.repo.insertLesson(c, {
      appealId: a.id, reviewerId: a.originalReviewerId, reviewerSource: reviewerSourceOf(a.originalReviewerId),
      subjectAction: a.subjectAction, originalActionRef: a.originalActionRef,
      lesson: reason, decidedBy: actorId,
    });
    effects.push({
      effect: 'coach_reviewer', state: 'done',
      detail: a.originalReviewerId
        ? 'lesson recorded against the original reviewer (errors are learning, not blame — W055)'
        : 'the original call was systemic — lesson recorded against the rule, not a person',
    });

    return effects;
  }
}
