// apps/admin-api/src/modules/ai-models-ops/services/ai-review.service.ts · W079, W082, W083, W084 (PC-56 ADMIN-7).
//
// The human-in-the-loop queue AS A PLATFORM OFFICER SEES IT — cross-tenant, which is what `platform_ai_ops` is for and
// why `ai.review` had to be its own owner permission rather than borrowed from the tenant realm. W082's own restricted
// state names it.
import { Injectable, Logger } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import type { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { AiGovernanceRepository } from '../repositories/ai-governance.repository';
import {
  assertClaimable, assertDecidable, buildDecision, census, claimState, holdsListings, triageOrder,
  CLAIM_STALE_AFTER_MS, type CaseRow, type Decision,
} from '../domain/review-case';
import { reviewLoadDelta, capacityVerdict } from '../domain/rollout';
import { AiGovernanceRefusedError } from '../domain/ai-models.errors';

/** W084's window. `ai_inferences` is partitioned monthly and the explorer's own error state says older months need the
 *  export path rather than a live scan — so this is a refusal, not a suggestion. The same 31 days ADMIN-6 set on the
 *  ledger explorer, and for the identical reason: an unbounded range is a scan of every partition. */
export const MAX_INFERENCE_WINDOW_DAYS = 31;

@Injectable()
export class AiReviewService {
  private readonly log = new Logger(AiReviewService.name);

  constructor(
    private readonly pool: AdminPool,
    private readonly repo: AiGovernanceRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* W079 · THE OVERVIEW                                                    */
  /* ---------------------------------------------------------------------- */

  /** W079's four tiles: inferences today, sent to human review, override rate, queue depth. */
  async overview() {
    const to = new Date();
    const from = new Date(to.getTime() - 86_400_000);
    const [stats, censusRows, awaiting] = await Promise.all([
      this.repo.modelStats(from.toISOString(), to.toISOString()),
      this.repo.caseCensus(),
      this.repo.awaitingChecker(),
    ]);

    const total = stats.reduce((a, s) => a + s.total, 0);
    const overridden = stats.reduce((a, s) => a + s.overridden, 0);
    const below = stats.reduce((a, s) => a + s.belowThreshold, 0);

    const byKind: Record<string, number> = {};
    let pending = 0; let inReview = 0; let oldest: string | null = null;
    for (const r of censusRows) {
      byKind[r.queueKind] = (byKind[r.queueKind] ?? 0) + r.n;
      if (r.status === 'pending') {
        pending += r.n;
        if (r.oldest && (oldest === null || r.oldest < oldest)) oldest = r.oldest;
      } else inReview += r.n;
    }

    return {
      // EACH TILE CARRIES ITS OWN KNOWN/UNKNOWN. "0 inferences today" and "the inference log has no rows for today"
      // render identically as a number and mean opposite things — the first is a quiet Sunday, the second is a recording
      // path that has stopped. 0113 found exactly this collapse on the recon board and it is the third wave running that
      // the shape has come up.
      inferences: total > 0 ? { known: true as const, value: total } : { known: false as const, reason: 'no_rows_today' },
      sentToReview: { known: true as const, value: below, ofTotal: total },
      overrideRate: total > 0
        ? { known: true as const, value: Math.round((overridden / total) * 10000) / 10000 }
        : { known: false as const, reason: 'no_rows_today' },
      queue: {
        pending,
        inReview,
        // NULL for an empty queue rather than 0: zero would read as "a case arrived this second", which is the opposite
        // of "there is nothing waiting".
        oldestPendingMinutes: oldest ? Math.max(0, Math.floor((Date.now() - Date.parse(oldest)) / 60_000)) : null,
        byKind,
        holdsListings: holdsListings(byKind),
      },
      models: stats.map((s) => ({
        modelId: s.modelId, code: s.code, version: s.version, status: s.status,
        inferences24h: s.total, overridden: s.overridden, belowThreshold: s.belowThreshold,
      })),
      awaitingChecker: awaiting,
      // W079's "Non-negotiables (policy)" panel is DECORATIVE on the canon and is returned as data here rather than
      // hard-coded in the page, so the console cannot drift from the policy it prints. Recorded as PARITY-DECOR.
      policy: [
        'ai_never_rejects_alone',
        'every_inference_audited_pointers_only',
        'fairness_audit_before_production',
        'farmer_facing_ai_is_labelled',
      ],
    };
  }

  /* ---------------------------------------------------------------------- */
  /* W082 · THE QUEUE                                                       */
  /* ---------------------------------------------------------------------- */

  async listCases(actor: AdminRequestContext, q: { status?: string; queueKind?: string; tenantId?: string; cursor?: string; limit: number }) {
    const cursor = decodeCaseCursor(q.cursor);
    const rows = await this.repo.listCases({ ...q, cursor, limit: q.limit });
    // The SQL already orders by (priority, created_at, id) so the keyset is stable; `triageOrder` is applied over the
    // page anyway because it is the single definition of "what a reviewer should look at next" and a page ordered by the
    // database and displayed by a different rule is a bug waiting for somebody to change one of them.
    const ordered = triageOrder(rows);
    const last = ordered[ordered.length - 1];
    const censusRows = await this.repo.caseCensus();
    const byKind: Record<string, number> = {};
    for (const r of censusRows) byKind[r.queueKind] = (byKind[r.queueKind] ?? 0) + r.n;

    const now = Date.now();
    return {
      items: ordered.map((c) => ({
        ...serialiseCase(c),
        claim: claimState(c, actor.userId, now),
      })),
      nextCursor: ordered.length === q.limit && last
        ? Buffer.from(`${last.priority}|${last.createdAt}|${last.id}`).toString('base64') : null,
      // Counts across the WHOLE open queue, not this page — ADMIN-5f's rule, and here it matters because a `fraud_flag`
      // case holds a farmer's listing off the market while it waits.
      census: { byKind, holdsListings: holdsListings(byKind) },
      // The ordering caveat, stated: triage applies within a page.
      note: 'priority then oldest-first; the census counts every open case, the list is one page',
    };
  }

  /** W083. One case, with the AI's proposal and the claim state. */
  async getCase(actor: AdminRequestContext, id: string) {
    const c = await this.repo.getCase(id);
    if (!c) return null;
    // Reading a case is an audited act: it names a farmer, their listing and a fraud suspicion. Same reasoning as
    // ADMIN-5e auditing reads of the audit trail and ADMIN-6b auditing reads of a settlement statement.
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'ai.review.case_read', entityType: 'ai_review_queue', entityId: id,
      newValue: { queueKind: c.queueKind, tenantId: c.tenantId }, ip: actor.ip, requestId: actor.requestId || null,
    });
    return {
      ...serialiseCase(c),
      claim: claimState(c, actor.userId, Date.now()),
      // W083 shows "Context the model can't see" and "Cross-checks" (Mandi Pulse, a prior tenant decision). NOT BUILT and
      // said so: the mandi cross-check would read `mandi_prices` through the subject, which is the same per-subject-type
      // join `district` needs (ADMIN-7-Q4), and inventing a cross-check panel that ran no checks would be a reassurance
      // with nothing behind it — the exact defect this plane keeps producing.
      crossChecks: { available: false, reason: 'cross_check_sources_not_wired' },
    };
  }

  /** Take the case (W082's "Take next (priority)" and W083's implicit claim). */
  async claim(actor: AdminRequestContext, id: string) {
    return this.pool.withTx(async (tx) => {
      const c = await this.repo.getCaseForUpdate(tx, id);
      if (!c) throw new AiGovernanceRefusedError('no such review case');
      assertClaimable(c, actor.userId, Date.now());
      const staleBefore = new Date(Date.now() - CLAIM_STALE_AFTER_MS).toISOString();
      const moved = await this.repo.claimCase(tx, id, actor.userId, staleBefore);
      if (!moved) {
        throw new AiGovernanceRefusedError(
          'another reviewer took this case while you were looking at it. Cases are single-owner so two people cannot '
          + 'reach conflicting decisions on the same farmer\'s listing.');
      }
      await this.audit.write(tx, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ai.review.claimed', entityType: 'ai_review_queue', entityId: id,
        newValue: { queueKind: c.queueKind }, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { id, status: 'in_review' as const };
    });
  }

  /** Decide the case.
   *
   *  **REJECT MEANS THE HUMAN DISAGREED WITH THE MODEL.** The flag that records that lives on `ai_inferences`, which this
   *  realm may only read (0115 grants SELECT and revokes the rest, because the log is append-only for every application
   *  role). So the decision is recorded on the CASE and the inference's `was_overridden` is NOT set from here — which
   *  means W085's override rate under-counts platform-side rejections until ADMIN-7-Q8's executor exists. That is said in
   *  the response and shown on the board, rather than being papered over by granting this realm a write it should not
   *  have.
   */
  async decide(actor: AdminRequestContext, id: string, decision: Decision, note: string) {
    const outcome = buildDecision(decision, note);
    return this.pool.withTx(async (tx) => {
      const c = await this.repo.getCaseForUpdate(tx, id);
      if (!c) throw new AiGovernanceRefusedError('no such review case');
      assertDecidable({ status: c.status, note, decision });
      if (c.reviewerAdminId !== actor.userId) {
        throw new AiGovernanceRefusedError(
          'this case is held by another reviewer, so you cannot decide it. Take it over first if they have stepped away.');
      }

      const moved = await this.repo.decideCase(tx, id, actor.userId, outcome.status, outcome.note);
      if (!moved) {
        throw new AiGovernanceRefusedError('this case was decided by another operator while you were reviewing it');
      }
      await this.audit.write(tx, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: decision === 'accept' ? 'ai.review.accepted' : 'ai.review.rejected',
        entityType: 'ai_review_queue', entityId: id,
        // The NOTE is the record here, not a courtesy: W085's whole override analysis is built out of these sentences.
        newValue: { queueKind: c.queueKind, note: outcome.note, marksOverridden: outcome.marksOverridden },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return {
        id, status: outcome.status,
        inferenceFlagged: false,
        note: outcome.marksOverridden
          ? 'the case is recorded as rejected; the inference\'s override flag is set by apps/api and is not yet wired '
            + 'for platform-side decisions (ADMIN-7-Q8)'
          : null,
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* W084 · THE DECISION EXPLORER                                           */
  /* ---------------------------------------------------------------------- */

  /** THE WINDOW IS ENFORCED AND THE QUERY IS NOT SENT WHEN IT IS BREACHED. `ai_inferences` is partitioned monthly, so an
   *  unbounded range is a full scan of every partition — and W084's own "Couldn't query partition · older months need the
   *  signed-export path, not a live scan" state was describing a defect rather than a limit. Same rule ADMIN-6 applied to
   *  the ledger explorer. */
  window(from?: string, to?: string): { from: string; to: string; maxDays: number } {
    const end = to ? new Date(to) : new Date();
    const start = from ? new Date(from) : new Date(end.getTime() - 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AiGovernanceRefusedError('the window dates could not be read');
    }
    if (end <= start) throw new AiGovernanceRefusedError('the window ends before it starts');
    const days = (end.getTime() - start.getTime()) / 86_400_000;
    if (days > MAX_INFERENCE_WINDOW_DAYS) {
      throw new AiGovernanceRefusedError(
        `the inference log is partitioned by month, so a live query is limited to ${MAX_INFERENCE_WINDOW_DAYS} days. `
        + 'A wider range needs the export path — this request was not sent rather than run as a scan of every partition.');
    }
    return { from: start.toISOString(), to: end.toISOString(), maxDays: MAX_INFERENCE_WINDOW_DAYS };
  }

  async listInferences(actor: AdminRequestContext, q: {
    from?: string; to?: string; modelId?: string; tenantId?: string; overriddenOnly?: boolean;
    cursor?: string; limit: number;
  }) {
    const w = this.window(q.from, q.to);
    const cursor = decodeCursor(q.cursor);
    const rows = await this.repo.listInferences({
      from: w.from, to: w.to, modelId: q.modelId, tenantId: q.tenantId,
      overriddenOnly: q.overriddenOnly, cursor, limit: q.limit,
    });
    const last = rows[rows.length - 1];
    await this.audit.log({
      actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
      action: 'ai.inferences.queried', entityType: 'ai_inferences', entityId: null,
      newValue: { from: w.from, to: w.to, modelId: q.modelId ?? null, overriddenOnly: !!q.overriddenOnly },
      ip: actor.ip, requestId: actor.requestId || null,
    });
    return {
      items: rows,
      nextCursor: rows.length === q.limit && last
        ? Buffer.from(`${last.createdAt}|${last.id}`).toString('base64') : null,
      window: w,
      // `input_ref` is NEVER selected. 0013's comment on the column is "pointers, never raw PII" and W084 repeats it —
      // but a pointer set is still a map of which farmer's photograph went to which model, and this screen's job is to
      // show what was DECIDED. Said in the response so nobody adds it later thinking it was an oversight.
      inputsWithheld: true,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* W087's THRESHOLD HALF                                                  */
  /* ---------------------------------------------------------------------- */

  /** "Raising photo_grading to 0.82 adds ≈412 cases/day to the review queue — confirm reviewer capacity."
   *
   *  THE REAL HALF OF W087. The prompt store is DELTA-020 and does not exist (the canon's own banner says so), but the
   *  threshold lives on `ai_models` and its review-load consequence is computable from the confidence histogram — which
   *  is the substance of that screen: a threshold edit changes WHO GETS HUMAN REVIEW, and an operator who cannot see that
   *  number is choosing blind.
   */
  async thresholdImpact(modelId: string, proposed: number, headroomPerDay?: number) {
    const row = await this.repo.modelRow(modelId);
    if (!row) throw new AiGovernanceRefusedError('no such model');
    if (!(proposed >= 0 && proposed <= 1)) {
      throw new AiGovernanceRefusedError('a confidence threshold is a probability in [0,1]');
    }

    const to = new Date();
    const from = new Date(to.getTime() - 86_400_000);
    const histogram = await this.repo.confidenceHistogram(modelId, from.toISOString(), to.toISOString());
    const delta = reviewLoadDelta(histogram, row.confidenceThreshold, proposed);

    return {
      modelId, code: row.code, version: row.version,
      current: row.confidenceThreshold,
      proposed,
      // NULL rather than 0 when there is no histogram or no current threshold: "this change adds no cases" and "we have
      // no data to say" are opposite statements, and a threshold raised on the strength of the first when the second is
      // true is how a review desk silently falls behind on farmers' listings.
      delta,
      capacity: delta ? capacityVerdict(delta.perWindow, headroomPerDay ?? null) : 'unknown',
      // There is no reviewer-capacity record on this platform, so headroom is whatever the operator supplied or unknown —
      // and unknown is rendered as a caution, never as a clearance. ADMIN-7-Q7.
      headroomSource: headroomPerDay === undefined ? 'not_recorded' : 'supplied_by_operator',
      window: { from: from.toISOString(), to: to.toISOString(), basis: '24h' },
      histogram,
      // W087's prompt half, named rather than mocked.
      promptStore: { available: false, delta: 'DELTA-020', note: 'no versioned prompt/config store exists; prompts ship with service releases' },
    };
  }
}

function serialiseCase(c: CaseRow) {
  return {
    id: c.id, tenantId: c.tenantId, inferenceId: c.inferenceId, queueKind: c.queueKind,
    priority: c.priority, status: c.status,
    // BOTH reviewer columns, so the console can say WHICH REALM decided. `ck_ai_review_one_reviewer` makes exactly one
    // non-null on a resolved case, and showing a platform decision as a tenant's would be a forgery.
    reviewerUserId: c.reviewerUserId, reviewerAdminId: c.reviewerAdminId,
    claimedAt: c.claimedAt, decisionNote: c.decisionNote, resolvedAt: c.resolvedAt, createdAt: c.createdAt,
  };
}

function decodeCursor(c?: string): { c: string; id: string } | undefined {
  if (!c) return undefined;
  const [ts, id] = Buffer.from(c, 'base64').toString('utf8').split('|');
  return ts && id ? { c: ts, id } : undefined;
}

function decodeCaseCursor(c?: string): { pr: number; c: string; id: string } | undefined {
  if (!c) return undefined;
  const [pr, ts, id] = Buffer.from(c, 'base64').toString('utf8').split('|');
  const n = Number(pr);
  // A non-finite priority in a cursor is a corrupt cursor. Starting from priority 0 would silently show the reviewer the
  // top of the queue as though it were their next page.
  return Number.isFinite(n) && ts && id ? { pr: n, c: ts, id } : undefined;
}

// `census` is re-exported for the spec, which pins the tile arithmetic directly rather than through the service's I/O.
export { census };
