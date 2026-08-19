// modules/dairy/read-models/dairy-counter.read-model.ts · W167 (Dairy — collections), the counter board.
// PC-56 TENANT-6a. A READ model: replica-only, and every judgement comes from `domain/dairy-counter.ts` so the API,
// the console and any export cannot disagree about what a number means.
//
// W167 is the screen an FPO's dairy secretary opens twice a day, and it is about 312 families' milk money. Six of its
// figures are measured and four are claims the platform cannot keep yet — so each arrives as a verdict, with its
// basis or with the inputs it is missing by name.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { DairyCounterRepository } from '../repositories/dairy-counter.repository';
import {
  AccrualVerdict, AnalyzerVerdict, BmcTempVerdict, BoardTotals, CentreShiftRow, CoverageVerdict, CycleWindow,
  FlagSummary, PaydayVerdict, Shift, ShiftClockVerdict,
  accrualVerdict, analyzerVerdict, bmcTempVerdict, boardTotals, coverage, cycleWindow, flagSummary, litresText,
  paydayVerdict, pctText, shiftClockVerdict,
} from '../domain/dairy-counter';
import { PaymentCycle } from '../domain/dairy.events';

/** Law 10, OFF: with the flag off, W167 does not exist — which is the pre-wave state, since there was no dairy screen
 *  in this console at all. */
export const DAIRY_COUNTER_FLAG = 'dairy_counter_board';

export interface CounterCentreRow {
  mccId: string; code: string; name: string;
  litres: string; pours: number; pourers: number; membershipsEnrolled: number;
  fatPct: string | null; snfPct: string | null;
  amountMinor: string;
  flags: number;
  analyzer: AnalyzerVerdict;
  bmc: BmcTempVerdict;
}

export interface CounterBoard {
  day: string;
  shift: Shift;
  /** W167's "evening starts 17:00" — refused: no shift clock exists on this platform. */
  shiftClock: ShiftClockVerdict;
  centres: CounterCentreRow[];
  totals: { litres: string; pours: number; pourers: number; amountMinor: string; flags: number; fatPct: string | null; snfPct: string | null };
  coverage: CoverageVerdict;
  flagSummary: FlagSummary;
  accrual: AccrualVerdict;
  /** The window the accrual covers, and the payday the platform cannot promise. */
  window: CycleWindow;
  payday: PaydayVerdict;
  /** How many members the derived window actually fits — a fortnightly window over a tenant whose members are mostly
   *  weekly is a real answer to the wrong question, and the desk says so instead of averaging preferences. */
  cycleMix: Array<{ paymentCycle: string; members: number }>;
  /** The one promise on this screen that IS enforced end to end. */
  pourUniqueness: 'unique_membership_day_shift';
}

@Injectable()
export class DairyCounterReadModel {
  constructor(
    private readonly repo: DairyCounterRepository,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  /**
   * @param day   a calendar day, or null for the DATABASE's today (never the API process's — a counter stamping
   *              `current_date` and a desk reading a JS date must not disagree about which day a pour belongs to).
   * @param cycle which window to accrue over. Defaults to the tenant's most common membership preference rather than
   *              to a constant: the majority's cycle is the one the dairy secretary is actually working to.
   */
  async board(tenantId: string, opts: { day?: string | null; shift: Shift; cycle?: PaymentCycle | null }): Promise<CounterBoard> {
    return timed(this.metrics, 'dairy.counter_board', { tenant: tenantId, shift: opts.shift }, async () => {
      const day = opts.day ?? (await this.repo.today(tenantId));
      const mix = await this.repo.membershipCycleMix(tenantId);
      const cycle: PaymentCycle = opts.cycle ?? ((mix[0]?.paymentCycle as PaymentCycle | undefined) ?? 'fortnightly');
      const window = cycleWindow(day, cycle);

      const [rows, bmc, flags, accrual, bills, currency] = await Promise.all([
        this.repo.centreShiftRows(tenantId, day, opts.shift),
        this.repo.bmcForCentres(tenantId),
        this.repo.flagsForDay(tenantId, day, opts.shift),
        this.repo.accrual(tenantId, window.from, window.to),
        this.repo.billsInWindow(tenantId, window.from, window.to),
        this.repo.currencyCode(tenantId),
      ]);

      const bmcByMcc = new Map(bmc.map((b) => [b.mccId, b]));
      const totals: BoardTotals = boardTotals(rows);

      return {
        day,
        shift: opts.shift,
        shiftClock: shiftClockVerdict(),
        centres: rows.map((r: CentreShiftRow) => ({
          mccId: r.mccId, code: r.code, name: r.name,
          litres: litresText(r.weightMilliKg),
          pours: r.pours, pourers: r.pourers, membershipsEnrolled: r.membershipsEnrolled,
          fatPct: pctText(r.fatCentiPctWeighted), snfPct: pctText(r.snfCentiPctWeighted),
          amountMinor: r.amountMinor.toString(),
          flags: r.flags,
          analyzer: analyzerVerdict({ model: r.analyzerModel, serial: r.analyzerSerial }),
          bmc: bmcTempVerdict(bmcByMcc.get(r.mccId) ?? { unitId: null, targetC: null, tempC: null, recordedAt: null }),
        })),
        totals: {
          litres: litresText(totals.weightMilliKg),
          pours: totals.pours, pourers: totals.pourers,
          amountMinor: totals.amountMinor.toString(), flags: totals.flags,
          fatPct: pctText(totals.fatCentiPctWeighted), snfPct: pctText(totals.snfCentiPctWeighted),
        },
        coverage: coverage(totals),
        flagSummary: flagSummary(flags),
        accrual: accrualVerdict({
          amountMinor: accrual.amountMinor, currencyCode: currency, window,
          cardsWithBonusRules: accrual.cardsWithBonusRules,
          membersWithPours: accrual.membersWithPours, billsExisting: bills,
        }),
        window,
        payday: paydayVerdict(window),
        cycleMix: mix,
        pourUniqueness: 'unique_membership_day_shift',
      };
    });
  }
}
