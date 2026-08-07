// apps/admin-api/src/modules/trust-safety/services/risk-rules.service.ts · W095 (PC-56 ADMIN-5d).
//
// THE SEVENTH MAKER-CHECKER SITE, and the only one on the platform where the second signature is not the strongest
// control. The strongest is the DRY RUN: a colleague signing off "dispute_lost −12 → −15" learns almost nothing from
// the sentence, and everything from the line under it that says 312 people drop a band and 41 of them — 28 holding
// perishable stock — start waiting 48 hours for their money.
import { Injectable } from '@nestjs/common';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminRequestContext } from '../../../core/auth/admin-auth.guard';
import { isSecondPerson } from '../../../core/approval/two-person-rule';
import { TrustSafetyRepository } from '../repositories/trust-safety.repository';
import {
  assertProposedWeight, assertDryRun, assertApprovable, approvalState, weightDrift, ruleCoverage, bandLadderDrift,
  isDryRunFresh, PRODUCER_SOURCE, DRY_RUN_MAX_AGE_HOURS,
} from '../domain/risk-rules';
import { InvalidRiskRuleChangeError, TrustSubjectNotFoundError } from '../domain/trust-safety.errors';
import type { ProposeWeightDto, ApproveWeightDto, WithdrawProposalDto } from '../dto/trust-safety.dto';

const EVENT_WINDOW_DAYS = 30;   // W095's "Fired 30d" column

@Injectable()
export class RiskRulesService {
  constructor(
    private readonly pool: AdminPool,
    private readonly audit: AdminAuditWriter,
    private readonly repo: TrustSafetyRepository,
  ) {}

  /** The rules board.
   *
   *  `drift`, `coverage` and `ladderDrift` are returned alongside the rows rather than behind a separate "diagnostics"
   *  call, because a reader who does not fetch them is looking at a table of numbers the platform does not obey. On
   *  this screen the drift is not a footnote about the data — it IS the state of the risk system.
   */
  async board(viewer: string | null) {
    const now = new Date();
    const rules = await this.repo.listRules();
    let counts: Map<string, number> | null = null;
    try {
      counts = await this.repo.eventCounts(EVENT_WINDOW_DAYS);
    } catch {
      // Degrade, never die (Law 12). A failed count must not take down the editor — but it must not silently become
      // a column of zeros either, which is why `ruleCoverage` is given null and reports `countsUnavailable`.
      counts = null;
    }
    return {
      windowDays: EVENT_WINDOW_DAYS,
      producerSource: PRODUCER_SOURCE,
      dryRunMaxAgeHours: DRY_RUN_MAX_AGE_HOURS,
      rules: rules.map((r) => {
        const s = approvalState(r, now);
        return {
          eventCode: r.eventCode, weight: r.weight, notes: r.notes, isActive: r.isActive,
          firedCount: counts ? (counts.get(r.eventCode) ?? 0) : null,
          proposal: r.proposedWeight === null ? null : {
            weight: r.proposedWeight, proposedBy: r.proposedBy, proposedAt: r.proposedAt,
            checkedBy: r.checkedBy, checkedAt: r.checkedAt,
            dryRun: r.dryRunAt ? {
              at: r.dryRunAt, bandDrops: r.dryRunBandDrops, newRestricted: r.dryRunNewRestricted,
              population: r.dryRunPopulation,
              fresh: isDryRunFresh(new Date(r.dryRunAt), now),
            } : null,
            approvalState: s,
            // Maker-checker BY ABSENCE: the console draws the Approve control only when this is true.
            approveOfferable: s.ok && isSecondPerson(r.proposedBy, viewer),
          },
        };
      }),
      drift: weightDrift(rules),
      coverage: ruleCoverage(rules, counts),
      ladderDrift: bandLadderDrift(),
    };
  }

  async propose(actor: AdminRequestContext, eventCode: string, dto: ProposeWeightDto) {
    return this.pool.withTx(async (c) => {
      const r = await this.repo.getRuleForUpdate(c, eventCode);
      if (!r) throw new TrustSubjectNotFoundError(`no risk rule for event code '${eventCode}'`);
      if (!r.isActive) throw new InvalidRiskRuleChangeError('this rule is not active; reactivating it is a separate decision');
      const proposed = assertProposedWeight(r.weight, dto.proposedWeight);
      const dry = assertDryRun({
        bandDrops: dto.dryRun.bandDrops, newRestricted: dto.dryRun.newRestricted,
        population: dto.dryRun.population, computedAt: new Date(dto.dryRun.computedAt),
      });
      // A dry run submitted already stale is refused here rather than at approval, so the proposer fixes it while
      // they are still at the screen instead of a colleague discovering it tomorrow.
      if (!isDryRunFresh(dry.computedAt, new Date())) {
        throw new InvalidRiskRuleChangeError(
          `that dry run is older than ${DRY_RUN_MAX_AGE_HOURS}h (or dated in the future) — re-run it against the current population`);
      }
      await this.repo.saveProposal(c, {
        eventCode, proposedWeight: proposed, proposedBy: actor.userId,
        bandDrops: dry.bandDrops, newRestricted: dry.newRestricted, population: dry.population, computedAt: dry.computedAt,
      });
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'trust.risk_weight_proposed', entityType: 'risk_rule', entityId: eventCode,
        oldValue: { weight: r.weight },
        newValue: { proposedWeight: proposed, dryRun: { ...dry, computedAt: dry.computedAt.toISOString() } },
        reason: dto.changeReason, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, from: r.weight, to: proposed };
    });
  }

  async approve(actor: AdminRequestContext, eventCode: string, dto: ApproveWeightDto) {
    return this.pool.withTx(async (c) => {
      const r = await this.repo.getRuleForUpdate(c, eventCode);
      if (!r) throw new TrustSubjectNotFoundError(`no risk rule for event code '${eventCode}'`);
      // Throws on: no proposal, no dry run, a stale dry run, already approved, or the proposer approving themselves.
      const { from, to } = assertApprovable(r, actor.userId, new Date());
      await this.repo.applyProposal(c, eventCode, actor.userId);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'trust.risk_weight_approved', entityType: 'risk_rule', entityId: eventCode,
        oldValue: { weight: from },
        newValue: {
          weight: to, proposedBy: r.proposedBy,
          dryRun: { at: r.dryRunAt, bandDrops: r.dryRunBandDrops, newRestricted: r.dryRunNewRestricted, population: r.dryRunPopulation },
        },
        reason: dto.note, ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true, from, to };
    });
  }

  async withdraw(actor: AdminRequestContext, eventCode: string, dto: WithdrawProposalDto) {
    return this.pool.withTx(async (c) => {
      const r = await this.repo.getRuleForUpdate(c, eventCode);
      if (!r) throw new TrustSubjectNotFoundError(`no risk rule for event code '${eventCode}'`);
      if (r.proposedWeight === null) throw new InvalidRiskRuleChangeError('there is no proposal to withdraw');
      if (r.checkedBy) throw new InvalidRiskRuleChangeError('this proposal has been approved and cannot be withdrawn');
      await this.repo.withdrawProposal(c, eventCode, actor.userId);
      await this.audit.write(c, {
        actorUserId: actor.userId, actorRole: actor.roles[0] ?? null,
        action: 'trust.risk_weight_withdrawn', entityType: 'risk_rule', entityId: eventCode,
        oldValue: { proposedWeight: r.proposedWeight }, reason: dto.reason,
        ip: actor.ip, requestId: actor.requestId || null,
      });
      return { ok: true };
    });
  }
}
