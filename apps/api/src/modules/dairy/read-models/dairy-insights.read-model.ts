// modules/dairy/read-models/dairy-insights.read-model.ts · W172 (Dairy insights) — PC-56 TENANT-6e-1.
//
// A READ model: replica-only, writes nothing, decides nothing. Every judgement comes from `domain/dairy-insights.ts`,
// and every figure W172 shares with another dairy screen is composed from the repository that screen already uses —
// so "184 pourers in the premium band" cannot mean one thing on the quality desk and another here.
//
// THE PAGE IS A UNION, NOT AN OBJECT WITH NULLS. W172 draws six states and five of them are not "the page with some
// fields empty": *"no data yet"*, *"not enough history"*, *"couldn't build insights"*, *"flagged off"* and the ready
// page are mutually exclusive things to look at. Returning a flat object with everything nullable is how a page ends up
// drawing a 90-day chart over four days of pours, so the shape makes that unrepresentable.
//
// WHY THIS SCREEN'S FLAG IS READ HERE AND NOT ON THE ROUTE. `FeatureFlagGuard` answers a disabled feature with 404 —
// deliberately, so an unlicensed feature is invisible rather than "exists but forbidden". That is right for the dairy
// MODULE, which the route still carries. It is wrong for this screen: W172 has a flagged-off STATE with words in it
// (*"insights are not switched on"*), and a 404 is indistinguishable from a mistyped URL. So `dairy` gates the route
// and `dairy_insights` is read here, which is exactly what 0168.5 promised — never a page of zeroes, because a
// cooperative reading "0 L/day" learns that it collected no milk.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { DairyInsightsRepository, MoneyShape } from '../repositories/dairy-insights.repository';
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { PaymentCycle } from '../domain/dairy.events';
import { BONUS_SLABS_FLAG } from '../domain/milk-quality.flags';
import { RateCardsInForce, lowestFatSlabCentiPct, rateCardsInForce } from '../domain/dairy-quality-desk';
import { LitresLostVerdict } from '../domain/bmc';
import {
  DEFAULT_INSIGHT_WINDOW, HistoryVerdict, InsightRanges, InsightWindow, PayoutStreakVerdict, PourerCohorts,
  PremiumTrend, RatePerLitreInsight, ShiftSeries, VolumeInsight,
  historyVerdict, insightRanges, payoutStreakVerdict, pourerCohorts, premiumTrend, ratePerLitreInsight, shiftSeries,
  spoilageVerdict, volumeInsight,
} from '../domain/dairy-insights';

export const INSIGHTS_FLAG = 'dairy_insights';

/**
 * Who is asking, with the verbs ALREADY RESOLVED by `policies/dairy.policies` — the shape every dairy controller on
 * this platform hands its service since 6c-3, and for the same reason: a read model that tested `permissions.includes`
 * itself would silently miss `'*'` (god mode) and would be a second place authorisation is decided.
 *
 * The page needs `dairy.manage` and the controller enforces it. The DRILL-DOWN into one member's record needs
 * `member.view360` on top — 0128's narrowest grant, `tenant_admin` only — which is W172's own restricted state.
 */
export interface InsightsActor { userId: string; canDrillDown: boolean }

export interface DairyInsightsReady {
  kind: 'ready';
  ranges: InsightRanges;
  /** True because `insightRanges` always ends on today, which is a partial day until midnight. Carried explicitly so
   *  the page can say the newest figures include a day still in progress rather than the reader assuming otherwise. */
  endsOnPartialDay: true;
  currencyCode: string;
  minorUnits: number;
  history: HistoryVerdict;
  /** KPI 1 and 2. */
  volume: VolumeInsight;
  ratePerLitre: RatePerLitreInsight;
  /** KPI 3. */
  pourers: PourerCohorts;
  /** KPI 4 — refused, with the substitutes beside it. */
  payoutStreak: PayoutStreakVerdict;
  /** The chart. */
  byShift: ShiftSeries;
  /** *"What moved member ₹/L"*, in the canon's own three parts. */
  premium: PremiumTrend;
  rateCards: RateCardsInForce;
  spoilage: LitresLostVerdict;
  /** The bonus actually paid in the window, which is the only honest way to size the premium's effect on ₹/L. Zero
   *  when the slab flag is off, and then `premium.current.basis` is `would_qualify` and says so. */
  bonusMinor: string;
  slabsApplied: boolean;
  /** W172's restricted state. */
  memberDrillDown: boolean;
}

export type DairyInsightsView =
  | { kind: 'not_enabled'; flag: string }
  /** *"Couldn't build insights"* — with the reference data that is missing named, never a blank page. */
  | { kind: 'unavailable'; missing: readonly string[] }
  | { kind: 'no_data'; ranges: InsightRanges; history: HistoryVerdict; memberDrillDown: boolean }
  | {
      kind: 'not_enough_history'; ranges: InsightRanges; history: HistoryVerdict; memberDrillDown: boolean;
      /** What little there IS, so the page can say "62 pourers so far" instead of nothing at all. */
      pourersSoFar: number;
    }
  | DairyInsightsReady;

@Injectable()
export class DairyInsightsReadModel {
  constructor(
    private readonly repo: DairyInsightsRepository,
    private readonly quality: DairyQualityRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async view(
    tenantId: string,
    actor: InsightsActor,
    opts: { window?: InsightWindow; today?: string; cycle?: PaymentCycle } = {},
  ): Promise<DairyInsightsView> {
    const window = opts.window ?? DEFAULT_INSIGHT_WINDOW;
    return timed(this.metrics, 'dairy.insights', { tenant: tenantId, window: String(window) }, async () => {
      // FAILS CLOSED. A flag store that cannot answer must not let a derived page draw itself: the same rule 5d's desk
      // applies to a safety mechanism applies to an analytics screen, because the reader cannot tell the difference
      // between "we chose to show you this" and "we could not check".
      const enabled = await this.flags.isEnabled(INSIGHTS_FLAG, { tenantId }).catch(() => false);
      if (!enabled) return { kind: 'not_enabled', flag: INSIGHTS_FLAG };

      const memberDrillDown = actor.canDrillDown;

      const today = opts.today ?? (await this.quality.today(tenantId));
      const ranges = insightRanges(today, window);

      // The cycle is derived the way 0155 derives it and 6b-2 reuses it — from the members' own `payment_cycle`
      // preference, dominant first. The same derivation, deliberately: the history gate is measured in cycles, and two
      // dairy screens disagreeing about which fortnight is running would be worse than either being wrong alone.
      const mix = await this.quality.membershipCycleMix(tenantId);
      const cycle: PaymentCycle = opts.cycle ?? ((mix[0]?.paymentCycle as PaymentCycle | undefined) ?? 'fortnightly');

      const firstPourOn = await this.repo.firstPourSince(tenantId, ranges.lookbackFrom);
      const history = historyVerdict({ firstPourOn, today, cycle, searchedFrom: ranges.lookbackFrom });
      if (history.kind === 'no_data') return { kind: 'no_data', ranges, history, memberDrillDown };
      if (history.kind === 'not_enough_history') {
        const cur = await this.repo.windowTotals(tenantId, ranges.current.from, ranges.current.to);
        return { kind: 'not_enough_history', ranges, history, memberDrillDown, pourersSoFar: cur.pourers };
      }

      // Read ONCE and carried, because the premium panel changes meaning with it: with the slabs off nobody was paid a
      // premium and the count is a forecast (6b-2's `earned` / `would_qualify` split).
      const slabsApplied = await this.flags.isEnabled(BONUS_SLABS_FLAG, { tenantId }).catch(() => false);

      const [money, cur, prev, byShiftRows, cohorts, cycles, cards] = await Promise.all([
        this.repo.moneyShape(tenantId),
        this.repo.windowTotals(tenantId, ranges.current.from, ranges.current.to),
        this.repo.windowTotals(tenantId, ranges.previous.from, ranges.previous.to),
        this.repo.dailyByShift(tenantId, ranges.current.from, ranges.current.to),
        this.repo.cohortCounts(tenantId, ranges.current.from, ranges.current.to, ranges.lookbackFrom, ranges.previous.from),
        this.repo.cycleFacts(tenantId, ranges.current.from, ranges.current.to),
        this.quality.cardsInForce(tenantId, today),
      ]);

      // NO GUESSED SCALE, ever — Rule Zero binds a read as tightly as a write. Every headline figure on this page is
      // money per litre, and a currency this platform holds no `minor_units` for cannot be divided into major units
      // without inventing a factor of a hundred. W172 has a state for exactly this.
      if (money === null) {
        return {
          kind: 'unavailable',
          missing: ['tenants.country_code -> countries.currency_code', 'currencies.minor_units'],
        };
      }
      const shape: MoneyShape = money;

      // The slab threshold comes from the CARD, never from this file: 6.5 is what one seed happens to hold, and a
      // cooperative rewarding fat at 6.2 must not read its own screen quoting somebody else's slab (Law 6). Across
      // several animal types the LOWEST fat slab in force is the band a member has to clear to be in the premium band
      // at all — 6b-2's `lowestFatSlabCentiPct`, over every card in force rather than one.
      const slabs = cards.flatMap((c) => c.slabs);
      const minFat = lowestFatSlabCentiPct(slabs);
      const [curPremium, prevPremium] = await Promise.all([
        this.quality.premiumBandCounts(tenantId, ranges.current.from, ranges.current.to, minFat),
        this.quality.premiumBandCounts(tenantId, ranges.previous.from, ranges.previous.to, minFat),
      ]);

      return {
        kind: 'ready',
        ranges,
        endsOnPartialDay: true,
        currencyCode: shape.currencyCode,
        minorUnits: shape.minorUnits,
        history,
        volume: volumeInsight({
          currentMilli: cur.milli, currentDays: ranges.current.days, currentDaysWithPours: cur.daysWithPours,
          previousMilli: prev.milli, previousDays: ranges.previous.days,
        }),
        ratePerLitre: ratePerLitreInsight({
          currentAmountMinor: cur.amountMinor, currentMilli: cur.milli,
          previousAmountMinor: prev.amountMinor, previousMilli: prev.milli,
        }),
        pourers: pourerCohorts({
          active: cohorts.active, newcomers: cohorts.newcomers, winBacks: cohorts.winBacks,
          previousActive: prev.pourers,
        }),
        payoutStreak: payoutStreakVerdict({ cyclesClosed: cycles.closed, cyclesAllBillsApproved: cycles.allBillsApproved }),
        byShift: shiftSeries(ranges.current, byShiftRows),
        premium: premiumTrend({
          slabs, slabsApplied,
          current: { pourers: curPremium.pourers, earnedCount: curPremium.earned, wouldQualifyCount: curPremium.wouldQualify },
          previous: { pourers: prevPremium.pourers, earnedCount: prevPremium.earned, wouldQualifyCount: prevPremium.wouldQualify },
        }),
        rateCards: rateCardsInForce(cards),
        spoilage: spoilageVerdict(),
        bonusMinor: String(cur.bonusMinor),
        slabsApplied,
        memberDrillDown,
      };
    });
  }
}

export type { PayoutStreakVerdict, PourerCohorts, PremiumTrend, RatePerLitreInsight, ShiftSeries, VolumeInsight };
