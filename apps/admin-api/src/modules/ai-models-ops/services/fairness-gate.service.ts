// apps/admin-api/src/modules/ai-models-ops/services/fairness-gate.service.ts · W085 + W088 (PC-56 ADMIN-7).
//
// THE GATE, AND THE AUDIT THAT FEEDS IT. `ModelRegistryService.promote` is left in place and this service takes over the
// transition path — deliberately additive rather than a rewrite, because that service is the only code that has ever
// written this registry and replacing it wholesale in the wave that adds a gate would mix two risks.
import { Injectable, Logger } from '@nestjs/common';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import type { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { AiGovernanceRepository } from '../repositories/ai-governance.repository';
import { AiModelRepository } from '../repositories/ai-model.repository';
import {
  assertPromotable, canApprove, gateRefusal, legacyAuditShape, productionGate, scoreAudit,
  transitionNeedsFairnessGate, AUDIT_MAX_AGE_DAYS, MAX_SLICE_GAP_PP, type GateResult,
} from '../domain/fairness-gate';
import {
  buildSlices, sampleSize, AVAILABLE_SLICES, CANON_SLICES_NOT_YET_MEASURABLE, PROXY_BASIS, PROXY_CAVEATS,
} from '../domain/slice-measurement';
import { assertCanaryStep, evaluateGates, nextCanaryStep, promotionAdvice, rollbackSignal } from '../domain/rollout';
import { assertTransition, type ModelStatus } from '../domain/ai-model.state';
import { AiGovernanceRefusedError, AiModelNotFoundError } from '../domain/ai-models.errors';

/** How far back an audit looks. 30 days matches the window the unwired job used and W085's "Override analysis (30d)",
 *  and it is long enough that a small tenant's slice can clear the group floor. */
export const AUDIT_WINDOW_DAYS = 30;

@Injectable()
export class FairnessGateService {
  private readonly log = new Logger(FairnessGateService.name);

  constructor(
    private readonly pool: AdminPool,
    private readonly repo: AiGovernanceRepository,
    private readonly models: AiModelRepository,
    private readonly audit: AdminAuditWriter,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* W085 · THE BOARD                                                       */
  /* ---------------------------------------------------------------------- */

  /** The fairness board, and **the unaudited models are the headline of it.**
   *
   *  A board listing only audited models would today be empty and would imply there was nothing to worry about. The
   *  unaudited list is currently every model on the platform, and the ones already in `production` are the rows that
   *  violate `ck_ai_model_production_needs_audit` — which 0115 landed NOT VALID precisely so this screen could show them
   *  rather than the migration refusing to apply until somebody cleared the backlog.
   */
  async board() {
    const [audited, unaudited] = await Promise.all([
      this.repo.latestAuditPerModel(),
      this.repo.modelsWithoutAudit(),
    ]);
    const now = Date.now();

    return {
      audited: audited.map((a) => {
        const gate = productionGate(a, now);
        return {
          modelId: a.modelId, code: a.code, version: a.version, status: a.status,
          auditId: a.id, verdict: a.verdict, maxGapPp: a.maxGapPp, sampleSize: a.sampleSize,
          slices: a.slices, verdictNote: a.verdictNote,
          slicesApproved: !!a.slicesApprovedByAdminId,
          auditedAt: a.createdAt,
          gateOpen: gate.open,
          gateReason: gate.open ? null : gate.reason,
        };
      }),
      // Split so the console can lead with the worst case: a model in production with no audit at all.
      unaudited: unaudited.map((m) => ({
        modelId: m.id, code: m.code, version: m.version, status: m.status,
        inProduction: m.status === 'production',
        // WHAT THE OLD COLUMN ACTUALLY HOLDS, reported as what it is. `usage_rollup` means the column contains an
        // override-rate summary with no slices in it — a number that looks like diligence and measures something else.
        legacyColumn: legacyAuditShape(m.fairnessAudit),
      })),
      policy: {
        maxSliceGapPp: MAX_SLICE_GAP_PP,
        auditMaxAgeDays: AUDIT_MAX_AGE_DAYS,
        // The proxy and its biases travel WITH every figure, so no screen can print a gap without being able to print
        // what the gap is made of.
        proxyBasis: PROXY_BASIS,
        proxyCaveats: [...PROXY_CAVEATS],
        measurableSlices: [...AVAILABLE_SLICES],
        canonSlicesNotYetMeasurable: [...CANON_SLICES_NOT_YET_MEASURABLE],
      },
      // ADMIN-7-Q8 made visible: platform-side rejections that have not reached the inference log, so a reader knows the
      // override rate under-counts rather than discovering it later.
      platformDecisionsAwaitingFlag: await this.repo.platformDecisionsAwaitingInferenceFlag(),
    };
  }

  /** One model's audit history — W085's "was 6.8pp" comparison, which needs more than one row and is the reason the
   *  audit is a table rather than a column. */
  async history(modelId: string) {
    const m = await this.models.getById(modelId);
    if (!m) throw new AiModelNotFoundError(modelId);
    const rows = await this.repo.auditHistory(modelId);
    return {
      model: m.toJSON(),
      audits: rows.map((a) => ({
        id: a.id, verdict: a.verdict, maxGapPp: a.maxGapPp, sampleSize: a.sampleSize,
        slices: a.slices, verdictNote: a.verdictNote, auditedAt: a.createdAt,
        auditedByAdminId: a.auditedByAdminId,
        slicesApproved: !!a.slicesApprovedByAdminId, slicesApprovedAt: a.slicesApprovedAt,
        windowStart: a.windowStart, windowEnd: a.windowEnd,
      })),
      // Newest-first, so index 0 is what the gate reads. Stated in the response rather than left for the client to infer
      // from an ordering it did not choose.
      gateReadsAuditId: rows[0]?.id ?? null,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* RUNNING AN AUDIT                                                       */
  /* ---------------------------------------------------------------------- */

  /** W085's "Schedule audit", performed now rather than scheduled.
   *
   *  **THE VERDICT IS DERIVED FROM THE MEASUREMENTS AND IS NOT A REQUEST FIELD.** A caller that could pass
   *  `verdict: 'pass'` could pass it over a 40pp gap, and this verdict is the only thing between a skewed model and
   *  production. Same rule as ADMIN-6b's preflight and ADMIN-5f's value-at-stake: what gates a control is computed
   *  server-side, always.
   */
  async runAudit(actor: AdminRequestContext, modelId: string) {
    const model = await this.models.getById(modelId);
    if (!model) throw new AiModelNotFoundError(modelId);

    const to = new Date();
    const from = new Date(to.getTime() - AUDIT_WINDOW_DAYS * 86_400_000);
    const tallies = await this.repo.sliceTallies(modelId, from.toISOString(), to.toISOString());
    const slices = buildSlices(tallies);
    const n = sampleSize(tallies);

    if (Object.keys(slices).length === 0) {
      // `ck_afa_slices_present` would refuse the INSERT anyway; refusing here gives the operator a sentence instead of a
      // constraint violation, and says the true thing — there is nothing to audit yet, which is W081's shadow-model
      // empty state.
      throw new AiGovernanceRefusedError(
        `no inferences were recorded for this model version in the last ${AUDIT_WINDOW_DAYS} days, so there is nothing `
        + 'to measure. A model must carry traffic — as shadow or canary — before it can be audited.');
    }

    const scored = scoreAudit(slices);
    const auditId = await this.pool.withTx(async (c) => {
      const id = await this.repo.insertAudit(c, {
        modelId,
        windowStart: from.toISOString(),
        windowEnd: to.toISOString(),
        sampleSize: n,
        slices,
        maxGapPp: scored.maxGapPp,
        verdict: scored.verdict,
        // `ck_afa_note` requires ≥20 characters on anything but a pass, and `scoreAudit` always produces one for those.
        verdictNote: scored.verdict === 'pass' ? null : scored.note,
        method: {
          basis: PROXY_BASIS,
          caveats: [...PROXY_CAVEATS],
          slicesMeasured: Object.keys(slices),
          slicesNotMeasurable: CANON_SLICES_NOT_YET_MEASURABLE.map((s) => s.slice),
          windowDays: AUDIT_WINDOW_DAYS,
          policyGapPp: MAX_SLICE_GAP_PP,
        },
        auditedByAdminId: actor.userId,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ai.fairness.audited', entityType: 'ai_model', entityId: modelId,
        newValue: { auditId: id, verdict: scored.verdict, maxGapPp: scored.maxGapPp, sampleSize: n, worstSlice: scored.worstSlice },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return id;
    });

    if (scored.verdict === 'fail') {
      this.log.warn(`fairness audit FAILED for model ${modelId}: ${scored.maxGapPp}pp on ${scored.worstSlice}`);
    }
    return {
      auditId, verdict: scored.verdict, maxGapPp: scored.maxGapPp, worstSlice: scored.worstSlice,
      thinSlices: scored.thinSlices, sampleSize: n, slices, note: scored.note,
      // The audit does not gate anything until the DPO signs off the slice definitions — said here so an operator who
      // just ran a passing audit is not surprised by a closed gate.
      slicesApproved: false,
      nextStep: 'the slice definitions need DPO sign-off before this audit can gate a promotion',
    };
  }

  /** The DPO's sign-off on the slice definitions.
   *
   *  A SEPARATE ACT FROM THE AUDIT, and W085's restricted state says why: "slice definitions are reviewed by the DPO
   *  (protected attributes)". Measuring accuracy by gender means processing gender. An audit that chose its own
   *  protected attributes would be a privacy decision made by whoever wrote the query, which is the shape of mistake
   *  ADMIN-4b spent a wave on.
   */
  async approveSlices(actor: AdminRequestContext, auditId: string) {
    return this.pool.withTx(async (c) => {
      const moved = await this.repo.approveSlices(c, auditId, actor.userId);
      if (!moved) {
        throw new AiGovernanceRefusedError(
          'this audit\'s slice definitions were already signed off, or the audit does not exist. A sign-off is not '
          + 're-recorded — the first one is the one that counts.');
      }
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ai.fairness.slices_approved', entityType: 'ai_fairness_audit', entityId: auditId,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { auditId, slicesApproved: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* W088 · THE ROLLOUT                                                     */
  /* ---------------------------------------------------------------------- */

  /** The rollout view: where the model is, what the gates say, and what nobody measures. */
  async rollout(actor: AdminRequestContext, modelId: string) {
    // The row rather than the entity: `AiModel` predates this wave and carries none of 0115's columns.
    const row = await this.repo.modelRow(modelId);
    if (!row) throw new AiModelNotFoundError(modelId);

    const to = new Date();
    const from = new Date(to.getTime() - 7 * 86_400_000);
    const stats = await this.repo.modelStats(from.toISOString(), to.toISOString());
    const mine = stats.find((s) => s.modelId === modelId) ?? { total: 0, overridden: 0, belowThreshold: 0 };

    const createdAt = Date.parse(row.createdAt);
    const ageDays = Number.isNaN(createdAt) ? NaN : Math.floor((Date.now() - createdAt) / 86_400_000);

    const gates = evaluateGates({ decisions: mine.total, overridden: mine.overridden, ageDays });
    const newest = await this.repo.newestAudit(modelId);
    const gate = productionGate(newest, Date.now());
    const provenance = await this.repo.promotionProvenance(modelId);

    return {
      model: {
        id: row.id, code: row.code, version: row.version, status: row.status,
        confidenceThreshold: row.confidenceThreshold, createdAt: row.createdAt,
        proposedStatus: row.proposedStatus, proposedByAdminId: row.proposedByAdminId,
        proposedAt: row.proposedAt, proposalReason: row.proposalReason,
        legacyFairnessColumn: legacyAuditShape(row.fairnessAudit),
      },
      canaryPercent: provenance?.canaryPercent ?? null,
      nextCanaryStep: nextCanaryStep(provenance?.canaryPercent ?? null),
      gates,
      advice: promotionAdvice(gates),
      fairnessGate: this.serialiseGate(gate),
      // W088: "Auto-rollback armed". IT IS ARMED BY POLICY AND BY NO RUNNING CODE, and the response says so — claiming an
      // automatic rollback that no process performs would be a status recording an act nobody does, for the fifth time.
      rollback: {
        signal: rollbackSignal({ decisions: mine.total, overridden: mine.overridden }),
        enforced: false,
        note: 'the rollback criteria are evaluated on read and NOTHING performs a rollback automatically (ADMIN-7-Q6)',
      },
      window: { from: from.toISOString(), to: to.toISOString(), decisions: mine.total, overridden: mine.overridden },
      provenance,
      awaitingChecker: await this.repo.awaitingChecker(),
      canApprove: canApprove({
        proposedStatus: row.proposedStatus,
        proposedByAdminId: row.proposedByAdminId,
        viewerAdminId: actor.userId,
        gate,
      }),
    };
  }

  /** Propose a transition (the maker half). */
  async propose(actor: AdminRequestContext, modelId: string, to: string, reason: string, canaryPercent?: number) {
    if (to === 'canary') {
      if (canaryPercent === undefined) {
        throw new AiGovernanceRefusedError(
          'a canary needs a traffic share. Until this wave nothing stored one, so "canary 10%" on four screens was a '
          + 'number in a mockup — a canary without a share is a status with no meaning.');
      }
      assertCanaryStep(canaryPercent);
    }
    if (reason.trim().length < 20) {
      throw new AiGovernanceRefusedError(
        'a transition proposal needs at least 20 characters of reasoning; the checker reads it and nothing else '
        + 'explains why this model should move');
    }

    return this.pool.withTx(async (c) => {
      const row = await this.repo.modelRowForUpdate(c, modelId);
      if (!row) throw new AiModelNotFoundError(modelId);
      // The state machine is consulted here as well as at approval, so a proposal that could never be approved is
      // refused at the point somebody makes it rather than after a colleague has been fetched. `assertTransition` is the
      // module's authoritative lifecycle owner (Law 5) and is called directly rather than through the entity, which this
      // path no longer loads.
      assertTransition(row.status as ModelStatus, to as ModelStatus);
      const moved = await this.repo.proposeTransition(c, modelId, to, actor.userId, reason.trim(), canaryPercent ?? null);
      if (!moved) {
        throw new AiGovernanceRefusedError(
          'this model already has a transition awaiting a checker. Withdraw it first — two open proposals on one model '
          + 'would let a checker approve the one nobody meant.');
      }
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ai.model.transition_proposed', entityType: 'ai_model', entityId: modelId,
        newValue: { to, canaryPercent: canaryPercent ?? null }, reason: reason.trim(),
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { modelId, proposedStatus: to, canaryPercent: canaryPercent ?? null };
    });
  }

  /** Approve a transition (the checker half) — **the gate**.
   *
   *  ONE TRANSACTION: the model row is locked, the audit is re-read INSIDE it, the gate is evaluated, the two-person rule
   *  is asserted, the status moves with the audit id in the same statement, and the audit row is written. An approval that
   *  committed without its audit row would be an authorisation nobody can be shown to have given.
   */
  async approve(actor: AdminRequestContext, modelId: string) {
    const result = await this.pool.withTx(async (c) => {
      const row = await this.repo.modelRowForUpdate(c, modelId);
      if (!row) throw new AiModelNotFoundError(modelId);
      const { proposedStatus, proposedByAdminId } = row;

      let gate: GateResult | null = null;
      let auditId: string | null = null;
      if (proposedStatus && transitionNeedsFairnessGate(proposedStatus)) {
        const newest = await this.repo.newestAuditTx(c, modelId);
        gate = productionGate(newest, Date.now());
        if (gate.open) auditId = gate.auditId;
      }

      assertPromotable({
        currentStatus: row.status,
        proposedStatus,
        proposedByAdminId,
        approverAdminId: actor.userId,
        gate,
      });

      const canaryPercent = row.canaryPercent;
      const moved = await this.repo.applyTransition(c, modelId, proposedStatus as string, actor.userId, auditId, canaryPercent);
      if (!moved) {
        throw new AiGovernanceRefusedError(
          'this proposal was decided by another operator while you were reviewing it — reload to see who and when');
      }

      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: proposedStatus === 'retired' ? 'ai.model.retired' : 'ai.model.promoted',
        entityType: 'ai_model', entityId: modelId,
        oldValue: { status: row.status },
        // THE AUDIT ID IS IN THE AUDIT ROW. "Why is this model in production" is answerable from the trail alone, with a
        // row id rather than a column's current value — which is the whole reason the gate points at a record.
        newValue: { status: proposedStatus, fairnessAuditId: auditId, canaryPercent },
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { modelId, status: proposedStatus, fairnessAuditId: auditId };
    });

    if (result.status === 'production') {
      this.log.warn(`model ${modelId} promoted to PRODUCTION on fairness audit ${result.fairnessAuditId} by ${actor.userId}`);
    }
    return result;
  }

  async withdraw(actor: AdminRequestContext, modelId: string) {
    return this.pool.withTx(async (c) => {
      const moved = await this.repo.withdrawProposal(c, modelId);
      if (!moved) throw new AiGovernanceRefusedError('there is no open proposal on this model');
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'ai.model.transition_withdrawn', entityType: 'ai_model', entityId: modelId,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { modelId, proposedStatus: null };
    });
  }

  private serialiseGate(g: GateResult) {
    return g.open
      ? { open: true as const, auditId: g.auditId, maxGapPp: g.maxGapPp, auditedAt: g.auditedAt, refusal: null }
      : { open: false as const, reason: g.reason, refusal: gateRefusal(g) };
  }
}
