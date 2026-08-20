// modules/dairy/services/dairy-deduction-assembler.service.ts · PC-56 TENANT-6c-5 · the standing instruction, applied.
//
// W169: *"Deductions above 25% of gross need the member's fresh consent, **not just standing instructions**."*
//
// TENANT-6c-4 built the destinations and left this half named out loud: the cycle passed `deductions: []`, so a
// cadence-built bill carried none and the canon's *"₹1,84,300 this cycle"* was zero on the automatic path. This is
// what fills it — and it fills it ONLY from arrangements the member authorised, capped so the automatic path can
// never produce a bill that needs their fresh consent.
//
// WHAT IT IS NOT: a policy engine. Every judgement it could make — which debt comes first, how much is fair, whether
// to take anything at all — is either the member's (their instalment), the tenant's (the cap, from a setting) or
// nobody's (oldest first, because choosing whose debt a family pays first is not software's decision to make). The
// arithmetic lives in `domain/deduction-plan.ts`, pure and tested at its boundaries; this file is the gathering.
import { Inject, Injectable, Logger } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { LoanService } from '../../fintech/services/loan.service';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { DairyMemberCreditRepository } from '../repositories/dairy-member-credit.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { assemblyCapMinor, DeductionCandidate, DeductionPlan, planDeductions } from '../domain/deduction-plan';

/**
 * The flag the CYCLE's generation pass asks about (0161, default OFF).
 *
 * [PC-56 TENANT-6c-6] A constant, because it now has two readers — the cadence that assembles and W169's console that
 * must tell an operator WHY a fortnight's deductions are all zero. A flag key spelled two ways reads OFF for ever and
 * says nothing about it, which is the quietest possible way to switch a feature off in one place only.
 */
export const DEDUCTION_ASSEMBLY_FLAG = 'dairy_deduction_assembly';

@Injectable()
export class DairyDeductionAssemblerService {
  private readonly log = new Logger(DairyDeductionAssemblerService.name);

  constructor(
    private readonly instructions: DairyDeductionInstructionRepository,
    private readonly credits: DairyMemberCreditRepository,
    private readonly types: DairyDeductionTypeRepository,
    private readonly memberships: DairyMembershipRepository,
    // The fintech module's PUBLIC service, for a READ this module must not write itself (CLAUDE.md's module rule).
    @Inject(LoanService) private readonly loans: LoanService,
  ) {}

  /**
   * What this bill's deduction lines should be, for a gross this large.
   *
   * Returns the PLAN. It writes nothing: `MilkBillService.generate` creates the lines through the same validated path
   * a hand-entered line takes, so there is exactly one place a `milk_bill_deductions` row is born and one place its
   * source is checked. An assembler with its own insert would be a second mechanism over the same fact — this
   * programme's own defect list, twice.
   */
  async assemble(tx: TxContext, tenantId: string, membershipId: string, grossMinor: bigint): Promise<DeductionPlan> {
    const live = await this.instructions.activeForMembership(tx, tenantId, membershipId);
    const { assemblyPct, consentPct } = await this.instructions.assemblyPct(tx, tenantId);
    const cap = assemblyCapMinor(grossMinor, assemblyPct, consentPct);
    if (live.length === 0 || cap <= 0n) {
      // Not a failure and not a warning: a member with no arrangement is a member whose whole cheque is theirs, which
      // is the platform's default and stays it. A cap of zero is a tenant that has switched assembly off by setting.
      return { lines: [], totalMinor: 0n, capMinor: cap, deferred: [] };
    }

    const typeList = await this.types.list(tenantId);
    const byId = new Map(typeList.map((t) => [t.id, t]));
    const candidates: DeductionCandidate[] = [];

    // ---- FEED / INPUT CREDITS (this module's own receivable) --------------------------------------------------
    const creditTypes = live.filter((i) => byId.get(i.typeId)?.destination === 'member_credit');
    if (creditTypes.length > 0) {
      for (const credit of await this.credits.listOutstanding(tenantId, membershipId)) {
        const arrangement = this.arrangementFor(creditTypes, credit.id);
        if (!arrangement) continue;   // an outstanding debt with no arrangement is NOT recovered automatically
        const type = byId.get(arrangement.typeId)!;
        candidates.push({
          typeId: type.id, typeCode: type.code, sourceType: 'dairy_member_credit', sourceId: credit.id,
          outstandingMinor: credit.outstandingMinor, maxPerCycleMinor: arrangement.maxPerCycleMinor,
          since: credit.toProps().issuedOn, id: credit.id,
        });
      }
    }

    // ---- LOANS (the other module's aggregate, through its public service) -------------------------------------
    const loanTypes = live.filter((i) => byId.get(i.typeId)?.destination === 'loan');
    if (loanTypes.length > 0) {
      const membership = await this.memberships.getById(tenantId, membershipId, tx);
      if (membership) {
        for (const loan of await this.loans.milkDeductibleLoans(tx, tenantId, membership.farmerUserId)) {
          const arrangement = this.arrangementFor(loanTypes, loan.id);
          if (!arrangement) continue;
          const type = byId.get(arrangement.typeId)!;
          candidates.push({
            typeId: type.id, typeCode: type.code, sourceType: 'loan', sourceId: loan.id,
            outstandingMinor: loan.outstandingMinor, maxPerCycleMinor: arrangement.maxPerCycleMinor,
            since: loan.disbursedAt, id: loan.id,
          });
        }
      }
    }

    const plan = planDeductions(grossMinor, cap, candidates);
    if (plan.deferred.length > 0) {
      // A partial recovery is a real outcome (a family with one big debt must not have nothing recovered for ever),
      // and it is LOGGED rather than left to be inferred from a total that does not add up — the same ruling
      // TENANT-6c-1 made about stranded pours.
      this.log.log(`dairy deduction assembly capped for membership ${membershipId} (tenant ${tenantId}): took ${plan.totalMinor} of a ${plan.capMinor} cap on a ${grossMinor} gross; ${plan.deferred.length} arrangement(s) partly or wholly deferred to the next cycle: ${plan.deferred.map((d) => `${d.sourceType}:${d.sourceId} wanted ${d.wantedMinor} took ${d.takenMinor}`).join('; ')}`);
    }
    return plan;
  }

  /**
   * The arrangement that authorises THIS source, if any.
   *
   * A source-specific arrangement wins over the blanket one, because a member who said *"₹200 a fortnight on THAT
   * loan"* has said something more precise than *"recover my loans"*, and honouring the general rule over the
   * specific one would take more than they agreed to.
   */
  private arrangementFor(candidatesForType: Array<{ typeId: string; sourceId: string | null; maxPerCycleMinor: bigint | null; covers(typeId: string, sourceId: string): boolean }>, sourceId: string) {
    const specific = candidatesForType.find((i) => i.sourceId === sourceId);
    if (specific) return specific;
    return candidatesForType.find((i) => i.sourceId === null) ?? null;
  }
}
