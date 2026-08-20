// modules/dairy/read-models/dairy-cycle-console.read-model.ts · W169 (Dairy payout cycles) composed · PC-56 TENANT-6c-6.
//
// THE SCREEN THE LAST FIVE WAVES WERE FOR. 6c-1 gave the cycle a row, 6c-2 the preview and the member's dispute, 6c-3
// the second signature, 6c-4 the deduction's destination, 6c-5 the standing instruction that fills it — and every one
// of those acts was reachable only by hand: the cycle routes have existed since 6c-2 and **the SDK has never had a
// method for one**, so no client on this platform could list a cycle, preview it or approve it.
//
// A pure read that decides nothing about money and everything about what an operator is told:
//   • the ACTS carry their refusal (flag / permission / stage / maker-checker), resolved here, so no button 403s;
//   • the register is one CYCLE's bills, biggest gross first — the filter `MilkBillRepository.listFor` has accepted
//     since 0157 and no DTO ever exposed;
//   • an OPEN cycle reports the ACCRUAL (TENANT-6a's reader, not a second one) and says plainly that no bill exists
//     yet, because this platform builds a bill when the window SHUTS while W169 draws 312 drafts mid-cycle;
//   • the consent line is the TENANT's setting and not the canon's 25%, printed beside the assembly cap that keeps the
//     automatic path below it;
//   • and the two things W169 promises that nothing implements — the payout BATCH (*"one bank trip"*) and a cycle that
//     reaches `paid` — are named, never drawn.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { BillCycleNotFoundError, DairyForbiddenError } from '../domain/dairy.errors';
import { DairyBillCycleRepository } from '../repositories/dairy-bill-cycle.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';
import { MilkBillDeductionRepository } from '../repositories/milk-bill-deduction.repository';
import { MilkBillDisputeRepository } from '../repositories/milk-bill-dispute.repository';
import { DairyDeductionInstructionRepository } from '../repositories/dairy-deduction-instruction.repository';
import { DairyDeductionTypeRepository } from '../repositories/dairy-deduction-type.repository';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import { DairyCycleConsoleRepository, CycleBillRow } from '../repositories/dairy-cycle-console.repository';
import { CYCLE_CLOSE_FLAG } from '../jobs/dairy-cycle-close.cadence-job';
import { DEDUCTION_ASSEMBLY_FLAG } from '../services/dairy-deduction-assembler.service';
import { maskMemberCode } from '../domain/dairy-quality-desk';
import {
  ActVerdict, ConsentLine, CycleStage, DisputeVerdict, PaydayVerdict, approveAct, billVerdict, consentLine,
  cycleStage, disputeVerdict, elapsedDays, litresFromMilli, milliFromLitres, pageTotals, paydayVerdict, periodDays,
  previewAct,
} from '../domain/dairy-cycle-console';

export const CYCLE_PREVIEW_FLAG = 'dairy_cycle_preview';
export const CYCLE_APPROVE_FLAG = 'dairy_cycle_approve';

/** One row of W169's register, as the screen shows it. */
export interface CycleConsoleRow {
  billId: string;
  membershipId: string;
  memberName: string | null;
  /** MASKED, the way W168 masks it and W169 draws it (`AND2-••02`) — the code is the counter identifier. */
  memberCodeMasked: string;
  mccCode: string | null;
  litres: string;
  /** *"13.6 L/day this cycle"* — over the days this bill covers, null when the period is unusable. */
  litresPerDay: string | null;
  /** *"30d avg 14.2"* — over the days the member actually poured, with that count beside it. */
  avg30d: string | null;
  avg30dDays: number;
  grossMinor: string;
  deductionsMinor: string;
  netMinor: string;
  /** Itemised, because W169 promises *"each line itemised"* and a member *"sees every deduction"*. */
  deductions: Array<{ typeCode: string | null; typeName: string | null; amountMinor: string; lines: number; applied: number; unsupportedReason: string | null }>;
  status: string;
  /** Set once the member has been shown the bill — the 24h clock 6c-2 both writes and enforces. */
  disputeWindowEnds: string | null;
  openDisputes: number;
  /** This bill cannot pay until the member is asked again (6c-4's rule, at this tenant's threshold). */
  needsFreshConsent: boolean;
  /** The member objected and the payment proceeds anyway — below the line, 6c-4's ruling. Shown, never buried. */
  memberRefusedBelowLine: boolean;
}

export interface CycleSummary {
  id: string;
  paymentCycle: string;
  periodStart: string;
  periodEnd: string;
  closesAt: string;
  payday: string;
  status: string;
  stage: CycleStage;
  previewedAt: string | null;
  previewedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  billsGeneratedAt: string | null;
  billCounts: Record<string, number>;
  billsTotal: number;
}

export interface CycleConsoleView {
  currencyCode: string;
  /** The DATABASE's today, so *"accrued to 13 Jul"* is the server's date and not a browser's. */
  today: string;
  cycle: CycleSummary;
  /** Newest first — the picker, so an operator can open last fortnight without knowing an id. */
  cycles: Array<{ id: string; paymentCycle: string; periodStart: string; periodEnd: string; status: string; payday: string; billsTotal: number }>;
  /** W169's first tile. `accruedMinor` is measured from PRICED POURS and is the only figure an open cycle has. */
  accrual: { amountMinor: string; membersWithPours: number; days: number; billsExisting: number; bonusRulesIgnored: boolean };
  /** W169's third tile: measured from the lines, by type. */
  deductions: { totalMinor: string; byTypeCode: Record<string, string>; needingConsent: number; assemblyOn: boolean };
  /** W169's second tile — recorded since 0157, with the batch that does not exist named. */
  payday: PaydayVerdict;
  /** W169's fourth tile, over the PREVIOUS cycle: *"Last cycle disputes 2 / 309"*. */
  lastCycle: { id: string; periodStart: string; periodEnd: string; disputes: DisputeVerdict } | null;
  /** The whole cycle, not the page. */
  totals: { bills: number; grossMinor: string; deductionsMinor: string; netMinor: string; litres: string };
  page: { rows: CycleConsoleRow[]; nextCursor: string | null; totals: ReturnType<typeof pageTotals> };
  consent: ConsentLine;
  acts: { preview: ActVerdict; approve: ActVerdict };
  /** Whether the cadence that closes cycles and builds bills is switched on for this tenant at all. */
  cadenceOn: boolean;
  /** The disputes still open across THIS cycle — *"disputed pauses one bill, never the cycle."* */
  openDisputes: number;
}

export interface CycleConsoleActor { userId: string; canManage: boolean; canCloseSettlement: boolean }

@Injectable()
export class DairyCycleConsoleReadModel {
  constructor(
    @Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider,
    private readonly cycles: DairyBillCycleRepository,
    private readonly bills: MilkBillRepository,
    private readonly console_: DairyCycleConsoleRepository,
    private readonly deductions: MilkBillDeductionRepository,
    private readonly disputes: MilkBillDisputeRepository,
    private readonly instructions: DairyDeductionInstructionRepository,
    private readonly types: DairyDeductionTypeRepository,
    private readonly counter: DairyCounterRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async view(tenantId: string, actor: CycleConsoleActor, q: { cycleId?: string; cursor?: { gross: string; id: string } | null; limit?: number; direction?: 'desc' | 'asc' }): Promise<CycleConsoleView> {
    return timed(this.metrics, 'dairy.cycle_console', { tenant: tenantId }, async () => {
      // The same refusal `DairyBillCycleService.list` makes, made HERE too. The route carries
      // `@RequirePermissions(dairy.manage)`, so this is defence in depth rather than the only gate — but a read-model
      // that trusts its caller's claim about their own permissions is one wiring mistake away from showing 312
      // families' income to whoever asks (and every other read in this module checks).
      if (!actor.canManage) throw new DairyForbiddenError('requires dairy.manage');
      const limit = Math.min(Math.max(q.limit ?? 25, 1), 100);
      const x = this.replica.forTenant(tenantId);

      // The picker first: it is also how "no cycleId" resolves, and how the PREVIOUS cycle for the disputes tile is
      // found — by window order, never by "the second row of whatever came back".
      const recent = await this.cycles.listFor(tenantId, { limit: 24 });
      const cycle = q.cycleId
        ? (await this.cycles.byId(x, tenantId, q.cycleId)) ?? (() => { throw new BillCycleNotFoundError(q.cycleId as string); })()
        : defaultCycle(recent);
      if (!cycle) {
        // NOT an error and not an empty table: a cooperative with no cycle row has either never had a member pour or
        // has the cadence switched off, and those are different sentences. W169's own empty state.
        return this.emptyView(tenantId, actor);
      }

      const c = cycle.toProps();
      const prev = recent.find((r) => r.toProps().periodEnd < c.periodStart && r.toProps().paymentCycle === c.paymentCycle) ?? null;

      const [today, counts, dedTotals, typeList, currencyCode, accrual, billsExisting, settings, previewOn, approveOn, cadenceOn, assemblyOn] = await Promise.all([
        this.cycles.today(x),
        this.bills.statusCountsForCycle(tenantId, c.id),
        this.deductions.cycleTotals(tenantId, c.id),
        this.types.list(tenantId),
        this.counter.currencyCode(tenantId),
        this.counter.accrual(tenantId, c.periodStart, c.periodEnd),
        this.counter.billsInWindow(tenantId, c.periodStart, c.periodEnd),
        this.instructions.assemblyPct(x, tenantId),
        this.flags.isEnabled(CYCLE_PREVIEW_FLAG, { tenantId }),
        this.flags.isEnabled(CYCLE_APPROVE_FLAG, { tenantId }),
        this.flags.isEnabled(CYCLE_CLOSE_FLAG, { tenantId }),
        this.flags.isEnabled(DEDUCTION_ASSEMBLY_FLAG, { tenantId }),
      ]);

      const billsTotal = Object.values(counts).reduce((a, b) => a + b, 0);
      const stage = cycleStage(c.status, billsTotal);
      const openDisputes = counts.disputed ?? 0;

      const [page, totals, lastDisputes, lastBills] = await Promise.all([
        this.console_.bills(tenantId, c.id, { limit, cursor: q.cursor ?? null, direction: q.direction }),
        this.console_.totals(tenantId, c.id),
        prev ? this.disputes.countsForCycle(tenantId, prev.id) : Promise.resolve(null),
        prev ? this.bills.statusCountsForCycle(tenantId, prev.id) : Promise.resolve(null),
      ]);

      const avg = await this.console_.avg30d(tenantId, page.rows.map((r) => r.membershipId), c.periodEnd);
      const byTypeId = new Map(typeList.map((t) => [t.id, t]));
      const days = c.status === 'open' ? elapsedDays(c.periodStart, c.periodEnd, today) : periodDays(c.periodStart, c.periodEnd);

      const rows: CycleConsoleRow[] = page.rows.map((r) => this.row(r, { byTypeId, avg, consentPct: settings.consentPct, days }));

      return {
        currencyCode,
        today,
        cycle: {
          id: c.id, paymentCycle: c.paymentCycle, periodStart: c.periodStart, periodEnd: c.periodEnd,
          closesAt: c.closesAt.toISOString(), payday: c.payday, status: c.status, stage,
          previewedAt: c.previewedAt?.toISOString() ?? null, previewedBy: c.previewedBy,
          approvedAt: c.approvedAt?.toISOString() ?? null, approvedBy: c.approvedBy,
          billsGeneratedAt: c.billsGeneratedAt?.toISOString() ?? null,
          billCounts: counts, billsTotal,
        },
        cycles: recent.map((r) => {
          const p = r.toProps();
          return { id: p.id, paymentCycle: p.paymentCycle, periodStart: p.periodStart, periodEnd: p.periodEnd, status: p.status, payday: p.payday, billsTotal: p.billsGenerated ?? 0 };
        }),
        accrual: {
          amountMinor: accrual.amountMinor.toString(),
          membersWithPours: accrual.membersWithPours,
          days,
          billsExisting,
          // The bonus W168 promises and the pricing engine has never applied. Carried onto THIS screen because the
          // accrual it qualifies is the number an operator compares the bills against — TENANT-6a's finding, restated
          // where the money is agreed rather than only where the milk is weighed.
          bonusRulesIgnored: accrual.cardsWithBonusRules > 0,
        },
        deductions: {
          totalMinor: dedTotals.totalMinor.toString(),
          byTypeCode: dedTotals.byType,
          needingConsent: totals.needingConsent,
          assemblyOn,
        },
        payday: paydayVerdict(c.payday, counts),
        lastCycle: prev && lastDisputes
          ? {
            id: prev.id, periodStart: prev.toProps().periodStart, periodEnd: prev.toProps().periodEnd,
            disputes: disputeVerdict(lastDisputes, Object.values(lastBills ?? {}).reduce((a, b) => a + b, 0)),
          }
          : null,
        totals: {
          bills: totals.bills, grossMinor: totals.grossMinor, deductionsMinor: totals.deductionsMinor,
          netMinor: totals.netMinor, litres: litresFromMilli(totals.litresMilli),
        },
        page: {
          rows,
          nextCursor: page.nextCursor ? Buffer.from(`${page.nextCursor.gross}|${page.nextCursor.id}`).toString('base64') : null,
          totals: pageTotals(page.rows),
        },
        consent: consentLine(settings.consentPct, settings.assemblyPct),
        acts: {
          preview: previewAct({
            stage, flagOn: previewOn, canManage: actor.canManage, canCloseSettlement: actor.canCloseSettlement,
            pending: counts.draft ?? 0, billsBuilt: c.billsGeneratedAt !== null, openDisputes,
            previewedBy: c.previewedBy, userId: actor.userId,
          }),
          approve: approveAct({
            stage, flagOn: approveOn, canManage: actor.canManage, canCloseSettlement: actor.canCloseSettlement,
            pending: counts.previewed ?? 0, billsBuilt: c.billsGeneratedAt !== null, openDisputes,
            previewedBy: c.previewedBy, userId: actor.userId,
          }),
        },
        cadenceOn,
        openDisputes,
      };
    });
  }

  /** One register row: the bill, its member, its itemisation, and the two averages W169 prints beside the name. */
  private row(r: CycleBillRow, ctx: {
    byTypeId: Map<string, { code: string; name: string; unsupportedReason: string | null }>;
    avg: Map<string, { litresMilli: bigint; days: number }>;
    consentPct: number;
    days: number;
  }): CycleConsoleRow {
    const a = ctx.avg.get(r.membershipId) ?? null;
    const v = billVerdict({
      grossMinor: BigInt(r.grossMinor), deductionsMinor: BigInt(r.deductionsMinor), consentPct: ctx.consentPct,
      consentOnFile: consentOnFile(r), totalLitresMilli: milliFromLitres(r.totalLitres), days: ctx.days,
      litres30dMilli: a?.litresMilli ?? null, days30d: a?.days ?? 0,
    });
    return {
      billId: r.id,
      membershipId: r.membershipId,
      memberName: r.memberName,
      memberCodeMasked: maskMemberCode(r.memberCode),
      mccCode: r.mccCode,
      litres: r.totalLitres,
      litresPerDay: v.litresPerDayMilli === null ? null : litresFromMilli(v.litresPerDayMilli),
      avg30d: v.avg30dMilli === null ? null : litresFromMilli(v.avg30dMilli),
      avg30dDays: a?.days ?? 0,
      grossMinor: r.grossMinor,
      deductionsMinor: r.deductionsMinor,
      netMinor: r.netMinor,
      deductions: r.byTypeId.map((d) => {
        const t = ctx.byTypeId.get(d.typeId) ?? null;
        return {
          // A line whose type is not in the vocabulary READ is shown as unknown rather than dropped: a deduction that
          // vanishes from the itemisation is money the member cannot see, which is the whole thing 6c-4 closed.
          typeCode: t?.code ?? null, typeName: t?.name ?? null,
          amountMinor: d.amountMinor, lines: d.lines, applied: d.applied,
          unsupportedReason: t?.unsupportedReason ?? null,
        };
      }),
      status: r.status,
      disputeWindowEnds: r.disputeWindowEnds?.toISOString() ?? null,
      openDisputes: r.openDisputes,
      needsFreshConsent: v.needsFreshConsent,
      memberRefusedBelowLine: v.memberRefusedBelowLine,
    };
  }

  /**
   * A tenant with no cycle row at all. The acts are still resolved (so the screen can say *why* nothing can be
   * pressed) and the cadence flag is still reported, because "the clock is off" is the actual answer here far more
   * often than "nobody poured".
   */
  private async emptyView(tenantId: string, actor: CycleConsoleActor): Promise<CycleConsoleView> {
    const x = this.replica.forTenant(tenantId);
    const [today, currencyCode, settings, previewOn, approveOn, cadenceOn, assemblyOn] = await Promise.all([
      this.cycles.today(x),
      this.counter.currencyCode(tenantId),
      this.instructions.assemblyPct(x, tenantId),
      this.flags.isEnabled(CYCLE_PREVIEW_FLAG, { tenantId }),
      this.flags.isEnabled(CYCLE_APPROVE_FLAG, { tenantId }),
      this.flags.isEnabled(CYCLE_CLOSE_FLAG, { tenantId }),
      this.flags.isEnabled(DEDUCTION_ASSEMBLY_FLAG, { tenantId }),
    ]);
    const act = { stage: 'accruing' as CycleStage, flagOn: false, canManage: actor.canManage, canCloseSettlement: actor.canCloseSettlement, pending: 0, billsBuilt: false, openDisputes: 0, previewedBy: null, userId: actor.userId };
    return {
      currencyCode, today,
      cycle: {
        id: '', paymentCycle: '', periodStart: '', periodEnd: '', closesAt: '', payday: '', status: 'none',
        stage: 'accruing', previewedAt: null, previewedBy: null, approvedAt: null, approvedBy: null,
        billsGeneratedAt: null, billCounts: {}, billsTotal: 0,
      },
      cycles: [],
      accrual: { amountMinor: '0', membersWithPours: 0, days: 0, billsExisting: 0, bonusRulesIgnored: false },
      deductions: { totalMinor: '0', byTypeCode: {}, needingConsent: 0, assemblyOn },
      payday: { payday: '', batchBuilt: false, paid: 0, awaitingPayment: 0 },
      lastCycle: null,
      totals: { bills: 0, grossMinor: '0', deductionsMinor: '0', netMinor: '0', litres: '0.000' },
      page: { rows: [], nextCursor: null, totals: pageTotals([]) },
      consent: consentLine(settings.consentPct, settings.assemblyPct),
      acts: { preview: previewAct({ ...act, flagOn: previewOn }), approve: approveAct({ ...act, flagOn: approveOn }) },
      cadenceOn,
      openDisputes: 0,
    };
  }
}

/**
 * WHICH FORTNIGHT THE SCREEN OPENS ON.
 *
 * Not simply the newest row. `ensureCycles` keeps the window that just ended AND the one running now, so "newest"
 * is the cycle that opened this morning — empty by design, with every act refused — while the fortnight the operator
 * came to preview sits one row down. A dairy secretary opening this screen on a Thursday means the cycle that closed
 * on Wednesday night.
 *
 * So: the newest cycle with work still to do (`closed` or `previewed`), and the newest row otherwise — a cooperative
 * whose fortnight is fully approved is genuinely looking at the one now accruing.
 */
function defaultCycle<T extends { toProps(): { status: string } }>(recent: T[]): T | null {
  return recent.find((c) => {
    const s = c.toProps().status;
    return s === 'closed' || s === 'previewed';
  }) ?? recent[0] ?? null;
}

/** The member's latest word, mapped onto the three states that mean different things at the payment. */
function consentOnFile(r: CycleBillRow): 'granted_current' | 'granted_stale' | 'refused' | null {
  if (r.consentGranted === null) return null;
  if (!r.consentGranted) return 'refused';
  return r.consentMatchesFigures ? 'granted_current' : 'granted_stale';
}
