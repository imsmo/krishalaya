// modules/tenancy/services/plan-usage.service.ts · W118's meters and the pause it promises
// (PC-56 TENANT-4d-1).
//
// This service is the tenancy module's PUBLIC answer to "may one more member be added?" — the module
// blueprint's allowance: identity calls this service, never tenancy's repositories.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, type TxContext } from '../../../core/database/unit-of-work';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { DomainError } from '../../../shared/errors/app-error';
import { PlanUsageRepository } from '../repositories/plan-usage.repository';
import {
  ASSERTED_BUT_UNPRICED, PLAN_METRICS, additionVerdict, alertThresholdPct, meterState, meterVerdict,
  metricDef, planLabel, projectLimit, statusBearsQuota,
  type MeterState, type MeterVerdict, type Projection,
} from '../domain/plan-usage';

export const ENFORCEMENT_FLAG = 'plan_limit_enforcement';
const MEMBER_METRIC = 'members';

/** W118: "at 100% new additions pause (existing operations never do)". The refusal names the limit and the
 *  count, so an operator reads "5,000 of 5,000 members on Growth" rather than "forbidden". */
export class PlanMemberLimitReachedError extends DomainError {
  constructor(used: number, limit: number) {
    super('PLAN_MEMBER_LIMIT_REACHED', `This plan allows ${limit} members and ${used} are in use — upgrade to add more`, 409, { used, limit, metric: MEMBER_METRIC });
  }
}

export interface MeterView {
  code: string;
  shape: 'stock' | 'flow';
  state: MeterState;
  verdict: MeterVerdict;
  limitCode: string | null;
  enforcedBy: string | null;
}

export interface PlanUsageView {
  planName: string | null;
  planLabel: string | null;
  planVersion: number | null;
  subscriptionStatus: string | null;
  /** Does the tenant's CURRENT status carry the plan's limits at all? A trial does now (see the domain). */
  limitsApply: boolean;
  thresholdPct: number;
  enforcementOn: boolean;
  meters: MeterView[];
  projection: Projection;
  /** The metrics thirteen modules already gate on and NO plan prices — surfaced so the gap is visible in the
   *  product, not only in a migration header. */
  unpricedGatedMetrics: readonly string[];
}

@Injectable()
export class PlanUsageService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly repo: PlanUsageRepository,
    private readonly flags: FlagsService,
  ) {}

  /** W118 whole. Each reading is taken independently so one unreadable meter cannot blank the screen. */
  async overview(tenantId: string): Promise<PlanUsageView> {
    const [plan, members, seats, flows, thresholdRaw, enforcementOn, history] = await Promise.all([
      this.repo.planLimits(tenantId),
      this.repo.memberCount(tenantId).catch(() => null),
      this.repo.staffSeatCount(tenantId).catch(() => null),
      this.repo.flowCounters(tenantId).catch(() => ({} as Record<string, number>)),
      this.repo.alertThresholdSetting(tenantId).catch(() => null),
      this.flags.isEnabled(ENFORCEMENT_FLAG, { tenantId }).catch(() => false),
      this.repo.memberHistory(tenantId).catch(() => []),
    ]);

    const thresholdPct = alertThresholdPct(thresholdRaw);
    const used = (code: string): number | null => {
      const def = metricDef(code);
      if (!def || def.source === 'none') return null;
      if (code === MEMBER_METRIC) return members;
      if (code === 'staff_seats') return seats;
      return def.limitCode ? (flows[def.limitCode] ?? null) : null;
    };

    const meters: MeterView[] = PLAN_METRICS.map((def) => {
      const input = {
        code: def.code,
        usedValue: used(def.code),
        limitValue: def.limitCode ? (plan.limits[def.limitCode] ?? null) : null,
      };
      return {
        code: def.code,
        shape: def.shape,
        state: meterState(input, enforcementOn),
        verdict: meterVerdict(input, thresholdPct),
        limitCode: def.limitCode,
        enforcedBy: def.enforcedBy,
      };
    });

    return {
      planName: plan.planName,
      planLabel: plan.planName ? planLabel(plan.planName, plan.planVersion) : null,
      planVersion: plan.planVersion,
      subscriptionStatus: plan.status,
      limitsApply: !!plan.status && statusBearsQuota(plan.status),
      thresholdPct,
      enforcementOn,
      meters,
      projection: projectLimit(history, plan.limits.max_farmers ?? null),
      unpricedGatedMetrics: ASSERTED_BUT_UNPRICED,
    };
  }

  /** THE PAUSE. Called by identity before a member is attached to a tenant, inside that write's own
   *  transaction — so the count the refusal cites is the count as of the write. With the flag OFF this
   *  returns without refusing and says so in the verdict, which is what the screen already told the tenant.
   *  Existing members, orders, payouts and cycles are never touched: only the addition pauses. */
  async assertMemberSeatAvailable(tx: TxContext, tenantId: string): Promise<ReturnType<typeof additionVerdict>> {
    const enforcementOn = await this.flags.isEnabled(ENFORCEMENT_FLAG, { tenantId }).catch(() => false);
    const def = metricDef(MEMBER_METRIC)!;
    const { limitValue, status } = await this.repo.planLimitForUpdate(tx, tenantId, def.limitCode!);
    // A subscription whose status does not carry quota (cancelled, expired, paused) is not the place to
    // start refusing member adds — the tenant's billing state is a billing problem, and blocking their
    // roster over it would be the hostage-taking W118 explicitly rules out.
    if (!status || !statusBearsQuota(status)) return { kind: 'allow' };
    const usedValue = await this.repo.memberCountForUpdate(tx, tenantId);
    const verdict = additionVerdict({ usedValue, limitValue }, enforcementOn);
    if (verdict.kind === 'refuse') throw new PlanMemberLimitReachedError(verdict.used, verdict.limit);
    return verdict;
  }

  /** W115's three cards: the plans this country may actually choose, newest version of each. */
  async choosablePlans(countryCode: string) {
    return this.repo.choosablePlans((countryCode || 'IN').toUpperCase());
  }

  /** Convenience for callers outside a transaction (the console's own pre-check, so the UI can withhold an
   *  "Add member" control rather than let it fail). */
  async memberSeatState(tenantId: string): Promise<{ used: number; limit: number | null; state: MeterState }> {
    const [plan, used] = await Promise.all([this.repo.planLimits(tenantId), this.repo.memberCount(tenantId)]);
    const limit = plan.limits.max_farmers ?? null;
    const enforcementOn = await this.flags.isEnabled(ENFORCEMENT_FLAG, { tenantId }).catch(() => false);
    return { used, limit, state: meterState({ code: MEMBER_METRIC, usedValue: used, limitValue: limit }, enforcementOn) };
  }

  /** Used by the tests and by any caller that needs a tx of its own. */
  async withTx<T>(tenantId: string, userId: string, fn: (tx: TxContext) => Promise<T>): Promise<T> {
    return this.uow.run(tenantId, fn, { userId });
  }
}
