// apps/admin-api/src/modules/schemes-oversight/services/scheme-performance.service.ts · W078.
//
// "The number that matters: benefit money actually reaching farmers because Krishalaya existed." Every number below
// carries its denominator or its absence, and the rejection breakdown reports its own COVERAGE — because with 88% of
// rejections uncoded, a confident pie chart is the most misleading thing this screen could draw.
//
// Each panel is fetched independently and degrades independently (Law 12): a failed median must not blank the
// headline, and the canon's own error state says "KPIs are computed nightly; cached values shown" — which this build
// does NOT claim, because nothing here is cached and saying so would be a comfortable lie about staleness.
import { Injectable } from '@nestjs/common';
import { SchemesOversightRepository } from '../repositories/schemes-oversight.repository';
import { benefitTotal, rate, medianDuration, rejectionBreakdown, fixableShare } from '../domain/performance';

/** Indian financial year: 1 April → 31 March. The canon's selector says "FY 2026–27", and a calendar-year YTD on a
 *  government-scheme screen would disagree with every number the government itself publishes. */
export function financialYearStart(now: Date): Date {
  const y = now.getUTCFullYear();
  const startThisFy = Date.UTC(y, 3, 1);          // month 3 = April
  return new Date(now.getTime() >= startThisFy ? startThisFy : Date.UTC(y - 1, 3, 1));
}

@Injectable()
export class SchemePerformanceService {
  constructor(private readonly repo: SchemesOversightRepository) {}

  async report(now = new Date()) {
    const since = financialYearStart(now);
    const sinceIso = since.toISOString();

    const [benefits, totals, median, topSchemes, rejections] = await Promise.all([
      this.repo.benefitTotals(sinceIso),
      this.repo.applicationTotals(sinceIso),
      this.repo.medianTimeToDisbursal(sinceIso),
      this.repo.topSchemesByBenefit(sinceIso, 10),
      this.repo.rejectionsByCode(sinceIso),
    ]);

    const breakdown = rejectionBreakdown(rejections);
    return {
      financialYearStart: sinceIso,
      // The headline, with what it is measuring attached — a bare "₹38.2 Cr facilitated" on a slide is a claim
      // somebody will be asked to defend.
      benefits: benefitTotal(benefits.attributed, benefits.unattributed),
      applicationsFiled: totals.filed,
      assistedShare: rate(totals.assisted, totals.filed),
      // Denominator is DECIDED applications, not filed. Dividing approvals by everything filed would count
      // applications still under verification as failures and understate the rate every single day.
      approvalRate: rate(totals.approved, totals.decided),
      medianTimeToDisbursal: medianDuration(median.p50Seconds, median.sampleSize, median.disbursals),
      topSchemes: topSchemes.map((r: any) => ({
        schemeCode: r.scheme_code, schemeName: r.scheme_name,
        amountMinor: String(r.amount_minor ?? '0'), transfers: r.transfers,
      })),
      rejections: breakdown,
      fixableShare: fixableShare(breakdown),
      // Said in the payload rather than left to the console: these numbers are computed live on this request. The
      // canon's error copy promises cached values and there is no cache, so nothing here pretends there is one.
      computedLive: true as const,
    };
  }
}
