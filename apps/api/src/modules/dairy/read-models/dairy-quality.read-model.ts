// modules/dairy/read-models/dairy-quality.read-model.ts · W168 (Milk quality desk) composed (PC-56 TENANT-6b-2).
//
// A pure read: this desk decides nothing. Its whole job is to say, for one cycle, what the milk was like, which pours
// are held and why, what the rate card promises, and — where the canon asserts something the software does not do — to
// say that instead of filling the gap in.
//
// The cycle is DERIVED the same way TENANT-6a's counter board derives it (from the members' own `payment_cycle`
// preference, because no cycle record exists on this platform), and deliberately through the SAME function: two dairy
// screens disagreeing about which fortnight is running would be worse than either being wrong on its own.
import { Inject, Injectable } from '@nestjs/common';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { DairyQualityRepository } from '../repositories/dairy-quality.repository';
import { MilkQualityReviewRepository } from '../repositories/milk-quality-review.repository';
import { cycleWindow, CycleWindow } from '../domain/dairy-counter';
import { PaymentCycle } from '../domain/dairy.events';
import { BONUS_SLABS_FLAG } from '../domain/milk-quality.flags';
import {
  CycleQuality, FlagProtocol, PremiumBandVerdict, RateCardsInForce, WorkedExample,
  cycleQuality, flagProtocol, kgOf, litresOf, lowestFatSlabCentiPct, maskMemberCode, pctOf, premiumBand,
  rateCardsInForce, workedExample,
} from '../domain/dairy-quality-desk';
import { ReviewStatus } from '../domain/milk-quality.state';

export const QUALITY_DESK_FLAG = 'dairy_quality_desk';

/** One flagged pour as the panel shows it — the member MASKED, because W168 masks them. */
export interface QualityFlagRow {
  reviewId: string;
  collectionId: string;
  collectedOn: string;
  shift: string;
  mccCode: string | null;
  memberCodeMasked: string | null;
  status: ReviewStatus;
  holdState: string;
  waterFlag: boolean;
  reasons: string[];
  densityAtFlag: string | null;
  fatPctAtFlag: string | null;
  snfPctAtFlag: string | null;
  litres: string | null;
  amountWithheldMinor: string;
  sampleSealed: boolean;
  memberPresent: boolean | null;
  retestAt: string | null;
  decidedAt: string | null;
  priorReviews90d: number;
  committeeReviewRequired: boolean;
}

export interface QualityDeskView {
  window: CycleWindow;
  currencyCode: string;
  /** W168's first two tiles, plus the stability claim it makes on the second one. */
  cycle: {
    fatPct: string | null;
    snfPct: string | null;
    litres: string;
    days: number;
    stability: CycleQuality['stability'];
  };
  /** *"buffalo routes"* — the herd this cycle's milk actually came from. */
  animalMix: Array<{ animalType: string; pours: number }>;
  /** W168's third tile: *"Flags this cycle 4 · 3 water_flag · 1 starch — all resolved or in review"*. */
  flags: {
    total: number;
    byStatus: Record<string, number>;
    byReason: Record<string, number>;
    withheldMinor: string;
    /** The canon's own claim, checked: every flag either decided or still under review. It can only be false if a
     *  review is `open` with nothing recorded against it, which is exactly the state an operator must see. */
    allResolvedOrInReview: boolean;
    openCount: number;
  };
  premiumBand: PremiumBandVerdict;
  /** Whether the tenant has actually switched the slabs on — the thing that decides what the tile above MEANS. */
  slabsApplied: boolean;
  rateCards: RateCardsInForce;
  /** The line-by-line arithmetic W168 promises the farmer, computed from this tenant's own card and a real pour. */
  example: (WorkedExample & { cardId: string; fatKg: string; snfKg: string; fromRealPour: boolean }) | null;
  /** The working queue: pours whose money is held right now, newest first. */
  openFlags: QualityFlagRow[];
  protocol: FlagProtocol;
  /** W168's subtitle promise, true as of TENANT-6b-1 and true structurally: the hold is on the POUR. */
  quarantineScope: 'pour';
}

@Injectable()
export class DairyQualityReadModel {
  constructor(
    private readonly repo: DairyQualityRepository,
    private readonly reviews: MilkQualityReviewRepository,
    private readonly flags: FlagsService,
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {}

  async view(tenantId: string, opts: { day?: string | null; cycle?: PaymentCycle | null }): Promise<QualityDeskView> {
    return timed(this.metrics, 'dairy.quality_desk', { tenant: tenantId }, async () => {
      const day = opts.day ?? (await this.repo.today(tenantId));
      const mix = await this.repo.membershipCycleMix(tenantId);
      const cycle: PaymentCycle = opts.cycle ?? ((mix[0]?.paymentCycle as PaymentCycle | undefined) ?? 'fortnightly');
      const window = cycleWindow(day, cycle);

      // The flag is read ONCE and carried, because every figure below changes meaning with it: with the slabs off, the
      // premium band is a forecast and the worked example must not include a bonus nobody is paying.
      const slabsApplied = await this.flags.isEnabled(BONUS_SLABS_FLAG, { tenantId });

      const [daily, cards, animalMix, counts, openReviews] = await Promise.all([
        this.repo.dailyQuality(tenantId, window.from, window.to),
        this.repo.cardsInForce(tenantId, day),
        this.repo.animalMix(tenantId, window.from, window.to),
        this.reviews.countsForWindow(tenantId, window.from, window.to),
        this.reviews.listFor(tenantId, { status: 'open_any', from: window.from, to: window.to, limit: 20 }),
      ]);

      const q = cycleQuality(daily);
      const inForce = rateCardsInForce(cards);

      // The premium band is measured against the card the tenant's BIGGEST herd is actually on, because a cooperative
      // with buffalo and cow cards has two different bands and one tile; the animal mix names which one is being shown.
      const leadAnimal = animalMix[0]?.animalType ?? cards[0]?.animalType ?? null;
      const leadGroup = inForce.byAnimal.find((g) => g.animalType === leadAnimal) ?? inForce.byAnimal[0] ?? null;
      const leadCard = leadGroup ? leadGroup.cards.find((c) => c.id === leadGroup.effectiveId) ?? leadGroup.cards[0] : null;
      const slabs = leadCard?.slabs ?? [];
      const minFat = lowestFatSlabCentiPct(slabs);
      const band = await this.repo.premiumBandCounts(tenantId, window.from, window.to, minFat);

      // The worked example uses a REAL pour where one exists (the window's biggest on that card), so the arithmetic is
      // one a farmer here could recognise. Where the cycle is empty it falls back to the canon's own 7.1 L @ 6.8/9.1 and
      // SAYS it is illustrative — an example is still worth showing on an empty desk, but not worth passing off as data.
      let example: QualityDeskView['example'] = null;
      if (leadCard) {
        const real = await this.repo.exemplarPour(tenantId, window.from, window.to, leadCard.id);
        const src = real ?? { weightMilliKg: 7_100n, fatCentiPct: 680n, snfCentiPct: 910n };
        const w = workedExample({ card: leadCard, ...src, slabsApplied });
        example = { ...w, cardId: leadCard.id, fatKg: kgOf(w.fatKgMilli), snfKg: kgOf(w.snfKgMilli), fromRealPour: real !== null };
      }

      const openFlags = await Promise.all(openReviews.map(async (r) => {
        const j = r.toJSON();
        const ctx = await this.repo.reviewContext(tenantId, j.membershipId, j.mccId);
        return {
          reviewId: j.id, collectionId: j.collectionId, collectedOn: j.collectedOn, shift: j.shift,
          mccCode: ctx.mccCode,
          memberCodeMasked: ctx.memberCode ? maskMemberCode(ctx.memberCode) : null,
          status: j.status as ReviewStatus, holdState: j.holdState,
          waterFlag: j.waterFlag, reasons: j.reasons,
          densityAtFlag: j.densityAtFlag, fatPctAtFlag: j.fatPctAtFlag, snfPctAtFlag: j.snfPctAtFlag,
          litres: null,
          amountWithheldMinor: j.amountWithheldMinor, sampleSealed: j.sampleSealed,
          memberPresent: j.memberPresent, retestAt: j.retestAt, decidedAt: j.decidedAt,
          priorReviews90d: j.priorReviews90d, committeeReviewRequired: j.committeeReviewRequired,
        } satisfies QualityFlagRow;
      }));

      const openCount = Number(counts.byStatus.open ?? 0);
      return {
        window,
        currencyCode: openReviews[0]?.toJSON().currencyCode ?? 'INR',
        cycle: {
          fatPct: q.fatCentiPctWeighted === null ? null : pctOf(q.fatCentiPctWeighted),
          snfPct: q.snfCentiPctWeighted === null ? null : pctOf(q.snfCentiPctWeighted),
          litres: litresOf(q.weightMilliKg),
          days: q.days,
          stability: q.stability,
        },
        animalMix,
        flags: {
          total: counts.total,
          byStatus: counts.byStatus,
          byReason: counts.byReason,
          withheldMinor: counts.withheldMinor.toString(),
          // W168 says "all resolved or in review". A review that has been RE-TESTED is in review; one still `open` with
          // nothing recorded is not, and that is the number the operator is being asked to act on.
          allResolvedOrInReview: openCount === 0,
          openCount,
        },
        premiumBand: premiumBand({
          slabs, slabsApplied,
          pourers: band.pourers, earnedCount: band.earned, wouldQualifyCount: band.wouldQualify,
        }),
        slabsApplied,
        rateCards: inForce,
        example,
        openFlags,
        protocol: flagProtocol(),
        quarantineScope: 'pour',
      };
    });
  }
}
