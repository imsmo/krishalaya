// apps/admin-api/src/modules/support-oversight/services/coaching.service.ts · CSAT REVIEW + COACHING
// (PC-56 ADMIN-2c, closes ADMIN-2-Q1's review half and ADMIN-2-Q6).
//
// The rules live in `domain/coaching.ts`; this file is about TRANSACTIONS, AUDIT and REFUSALS THAT NEED A DATABASE.
//
// EVERY WRITE HERE IS AUDITED IN ITS OWN TRANSACTION (Law 4), and that matters more than usual: these rows are
// statements about a named person's performance, so "who wrote this and when" must be as durable as the row itself. An
// audit write that could fail separately would leave an unattributable note about somebody's job.
//
// THE REFUSAL WORTH READING is coachingFromReview(): the platform will not create a coaching record off a verdict that
// blamed a PROCESS, a PRODUCT, or a payment provider. Coaching an agent because a bank was down is punishing somebody
// for the weather, and the fact that a form allowed it would not make it less wrong. The option is refused rather than
// hidden, because the refusal is the thing worth saying.
import { Injectable } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import {
  assertReview, assertCoaching, assertSettlement, verdictSupportsCoaching, verdictExoneratesAgent,
  isEventKind, splitByReviewed, verdictShares, CSAT_VERDICTS, COACHING_KINDS,
  type CsatVerdict,
} from '../domain/coaching';
import { InvalidCoachingError, CoachingNotFoundError, CsatResponseNotFoundError } from '../domain/support-oversight.errors';
import type { ReviewCsatDto, CreateCoachingDto, SettleCoachingDto } from '../dto/support-oversight.dto';

/** Ratings at or below this are the review queue's default scope. 3 is deliberate: a 3 out of 5 is not a compliment, and
 *  a queue that only surfaces 1s and 2s teaches a desk that mediocre is fine. */
export const REVIEW_SCORE_CEILING = 3;
const QUEUE_LIMIT = 50;
const LIST_LIMIT = 100;

@Injectable()
export class CoachingService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: SupportOversightRepository,
  ) {}

  /* ------------------------------------------------------------------ reading */

  /**
   * The review queue: low ratings NOBODY HAS JUDGED, keyset-paged.
   *
   * Deliberately not "all low ratings". The backlog a lead needs is the unjudged ones — a queue that re-shows work a
   * colleague finished ten minutes ago is a queue people stop trusting, and the count at the top would conflate "bad
   * week" with "nobody looked", which are different problems with different fixes.
   */
  async reviewQueue(q: { maxScore?: number; cursor?: string; limit?: number }) {
    const maxScore = Math.min(Math.max(q.maxScore ?? REVIEW_SCORE_CEILING, 1), 5);
    const limit = Math.min(Math.max(q.limit ?? QUEUE_LIMIT, 1), QUEUE_LIMIT);
    const cursor = parseCursor(q.cursor);
    const rows = await this.repo.csatAwaitingReview({ maxScore, cursor, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1] as { ratedAt?: string; id?: string } | undefined;
    return {
      items: page,
      maxScore,
      nextCursor: rows.length > limit && last?.ratedAt && last?.id ? `${last.ratedAt}|${last.id}` : null,
      // said on the payload, not just the screen: some of these timestamps are 0099's backfill estimates
      ratedAtNote: 'Rows flagged ratedAtIsEstimated have no recorded rating time — the value is the ticket\'s resolution or creation time (migration 0099 backfill).',
    };
  }

  /** One rating, everything known about it, and everything already concluded — the drill-in behind the queue. */
  async response(id: string) {
    const response = await this.repo.csatResponse(id);
    if (!response) throw new CsatResponseNotFoundError(id);
    const [reviews, ticketHistory, coaching] = await Promise.all([
      this.repo.csatReviewsFor(id),
      this.repo.csatHistoryForTicket(String(response.ticketId)),
      this.repo.listCoaching({ agentUserId: (response.ratedAgentUserId as string) ?? undefined, limit: 20 }),
    ]);
    return {
      response,
      reviews,
      // every rating this ticket ever had. Before 0099 a reopen deleted the previous one, so a rating that IMPROVED
      // after the desk fixed something was invisible — which is the single most useful thing a lead can see here.
      ticketHistory,
      // this agent's coaching record, so a lead judging a rating knows whether somebody has already acted
      agentCoaching: response.ratedAgentUserId ? coaching : [],
      verdicts: CSAT_VERDICTS,
      coachingKinds: COACHING_KINDS,
    };
  }

  /** Verdict mix for a window, as counts AND shares — or null shares when nothing has been reviewed. */
  async verdictSummary(fromIso: string, toIso: string) {
    const counts = await this.repo.csatVerdictCounts(fromIso, toIso);
    return {
      counts,
      // null, never a row of zeroes: "no low score has been reviewed" is not "every review concluded 0%"
      shares: verdictShares(counts),
      basis: 'Counted by when the REVIEW was filed, not when the rating was given — a verdict belongs to the week somebody made the judgement.',
    };
  }

  /** Coaching records, newest first. */
  async coachingList(q: { agentUserId?: string; tenantId?: string }) {
    const items = await this.repo.listCoaching({ agentUserId: q.agentUserId, tenantId: q.tenantId, limit: LIST_LIMIT });
    return {
      items,
      // named so no reader mistakes a dismissal for an intervention
      note: 'Includes dismissals. A recorded decision NOT to intervene is deliberately kept: without it the ledger shows every intervention and none of the judgements not to act.',
    };
  }

  /* ------------------------------------------------------------------ writing */

  /**
   * File a verdict on a rating. One transaction, one audit row.
   *
   * The rating must EXIST and must still be readable — checked before the write rather than relying on a foreign-key
   * violation, because a 404 an operator can read beats a 500 they cannot.
   */
  async review(actor: AdminRequestContext, responseId: string, dto: ReviewCsatDto) {
    const existing = await this.repo.csatResponse(responseId);
    if (!existing) throw new CsatResponseNotFoundError(responseId);
    const review = assertReview({ responseId, verdict: dto.verdict, finding: dto.finding });

    return this.pool.withTx(async (client) => {
      const inserted = await this.repo.insertCsatReview(client, {
        responseId, reviewerAdminId: actor.userId, verdict: review.verdict, finding: review.finding,
      });
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.csat_reviewed', entityType: 'support_csat_response', entityId: responseId,
        oldValue: null,
        newValue: { verdict: review.verdict, score: existing.score, ticketId: existing.ticketId, duplicate: inserted === null },
        reason: review.finding, ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        id: inserted?.id ?? null,
        // a repeat submission of the same verdict is not a second judgement — 0099's unique index deduped it, and
        // saying so beats reporting success twice
        recorded: inserted !== null,
        verdict: review.verdict,
        // whether coaching is a coherent NEXT step, stated so the console does not have to guess
        coachingAvailable: verdictSupportsCoaching(review.verdict),
        exoneratesAgent: verdictExoneratesAgent(review.verdict),
      };
    });
  }

  /**
   * Create a coaching record (a session, a note, or a dismissal).
   *
   * THE REFUSAL: if the record cites a review, that review's verdict must actually blame the agent. A verdict of
   * `product_at_fault` followed by a coaching session is the platform holding somebody responsible for a thing it has
   * already concluded was not their fault, and the record would outlive everybody's memory of the contradiction.
   * `signal_dismissed` is exempt — dismissing a signal after ANY verdict is coherent, including after one that
   * exonerated the agent, which is precisely when a lead should be recording that they looked and stopped.
   */
  async createCoaching(actor: AdminRequestContext, dto: CreateCoachingDto) {
    const coaching = assertCoaching({
      kind: dto.kind, agentUserId: dto.agentUserId, tenantId: dto.tenantId,
      rationale: dto.rationale, scheduledFor: dto.scheduledFor ?? null,
      signalNote: dto.signalNote ?? null,
      csatResponseId: dto.csatResponseId ?? null, csatReviewId: dto.csatReviewId ?? null,
    });

    // the cited signal must be real (rule 4 in the domain header) — a dangling id would make the record unexplainable
    if (coaching.csatResponseId) {
      const r = await this.repo.csatResponse(coaching.csatResponseId);
      if (!r) throw new CsatResponseNotFoundError(coaching.csatResponseId);
      if (String(r.tenantId) !== coaching.tenantId) {
        throw new InvalidCoachingError('the cited rating belongs to a different tenant');
      }
    }
    if (coaching.csatReviewId && coaching.csatResponseId && coaching.kind !== 'signal_dismissed') {
      const reviews = await this.repo.csatReviewsFor(coaching.csatResponseId);
      const cited = reviews.find((r) => String(r.id) === coaching.csatReviewId);
      if (!cited) throw new InvalidCoachingError('the cited review does not belong to the cited rating');
      const verdict = String(cited.verdict) as CsatVerdict;
      if (!verdictSupportsCoaching(verdict)) {
        throw new InvalidCoachingError(
          `this review concluded ${verdict}, which is not a finding about the agent — coaching somebody for it would contradict the platform's own verdict`);
      }
    }

    return this.pool.withTx(async (client) => {
      const created = await this.repo.insertCoaching(client, {
        tenantId: coaching.tenantId, agentUserId: coaching.agentUserId, authorAdminId: actor.userId,
        kind: coaching.kind, status: coaching.status, rationale: coaching.rationale,
        signalNote: coaching.signalNote, csatResponseId: coaching.csatResponseId,
        csatReviewId: coaching.csatReviewId, scheduledFor: coaching.scheduledFor,
      });
      // point the review at what it produced, so the two records cannot disagree about whether anybody followed up
      if (coaching.csatReviewId) await this.repo.linkReviewCoaching(client, coaching.csatReviewId, created.id);
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: coaching.kind === 'signal_dismissed' ? 'support.signal_dismissed' : 'support.coaching_created',
        entityType: 'support_coaching_record', entityId: created.id,
        oldValue: null,
        newValue: {
          kind: coaching.kind, status: coaching.status, agentUserId: coaching.agentUserId,
          tenantId: coaching.tenantId, scheduledFor: coaching.scheduledFor,
          csatResponseId: coaching.csatResponseId,
        },
        reason: coaching.rationale, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id: created.id, kind: coaching.kind, status: coaching.status, scheduledFor: coaching.scheduledFor };
    });
  }

  /**
   * Record what happened to a scheduled session.
   *
   * The repository's UPDATE is guarded on the row still being `scheduled`, so a zero row count means somebody else
   * settled it first — reported as a 409, not silently swallowed. Two leads must not be able to overwrite each other's
   * account of the same conversation, and an outcome must never be rewritten once filed.
   */
  async settleCoaching(actor: AdminRequestContext, id: string, dto: SettleCoachingDto) {
    const before = await this.repo.coachingById(id);
    if (!before) throw new CoachingNotFoundError(id);
    if (!isEventKind(before.kind as any)) {
      throw new InvalidCoachingError(`a ${before.kind} is not a session — there is nothing to settle`);
    }
    if (before.status !== 'scheduled') {
      throw new InvalidCoachingError(`this session is already ${before.status} and its record cannot be rewritten`);
    }
    const settlement = assertSettlement({ status: dto.status, outcome: dto.outcome ?? null });

    return this.pool.withTx(async (client) => {
      const changed = await this.repo.settleCoaching(client, {
        id, status: settlement.status, outcome: settlement.outcome, heldAt: settlement.heldAt,
      });
      if (changed === 0) {
        // somebody settled it between the read and the write
        throw new InvalidCoachingError('this session was settled by somebody else a moment ago — reload to see their account of it');
      }
      await this.audit.write(client, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'support.coaching_settled', entityType: 'support_coaching_record', entityId: id,
        oldValue: { status: before.status },
        newValue: { status: settlement.status, heldAt: settlement.heldAt },
        reason: settlement.outcome ?? `session ${settlement.status}`,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: settlement.status, heldAt: settlement.heldAt };
    });
  }

  /** Ratings split into judged and unjudged, for the insights header. Pure, but exposed here so the console does not
   *  reimplement the split and drift from the queue's definition of "awaiting". */
  static split = splitByReviewed;
}

/** `<iso>|<uuid>` — the same cursor shape the rest of this realm uses. Malformed cursors are DROPPED rather than
 *  rejected: a stale link should show page one, not an error page. */
function parseCursor(raw?: string): { at: string; id: string } | undefined {
  if (!raw) return undefined;
  const [at, id] = raw.split('|');
  if (!at || !id) return undefined;
  if (Number.isNaN(Date.parse(at))) return undefined;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return { at, id };
}
