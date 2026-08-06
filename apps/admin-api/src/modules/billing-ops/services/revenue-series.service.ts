// apps/admin-api/src/modules/billing-ops/services/revenue-series.service.ts · the reporting reads behind canon W016
// (PC-56 ADMIN-1d, closes ADMIN-1-Q7). Read-only; nothing here writes or moves money.
//
// THE HONEST NAMES ARE THE WHOLE POINT OF THIS FILE. The canon asks for "MRR movement — 12 months", "plan mix" and
// "cohort retention (net revenue)". Two of those three cannot be computed truthfully from what this platform stores,
// so they are returned as the closest TRUE thing under their real name:
//
//   • `billedByMonth` — invoices ISSUED per month and what has been received against them. This is NOT an MRR series:
//     MRR month-over-month needs subscription history, and the platform keeps one current subscription row per tenant.
//     Reconstructing MRR from `updated_at` would be the same fabrication the W017 page refuses. Invoices are dated
//     facts, so invoices are what the series is made of — and the console labels it "billed", not "MRR".
//   • `planMix` — live subscriptions per plan, annual normalised to monthly by INTEGER division (÷12), exactly as the
//     existing MRR rollup does. This one IS a genuine current-state mix.
//   • `cohortRetention` — tenants per signup quarter and how many still have a live subscription. The canon says "net
//     revenue by signup quarter"; revenue retention on a young book swings 12× on a single annual invoice, so what is
//     returned is TENANTS RETAINED, and the axis says so.
//
// A chart whose label and contents disagree is worse than a simpler chart. That trade is made deliberately here, and
// the day subscription history exists this service is where the real MRR series belongs.
import { Injectable } from '@nestjs/common';
import { BillingRepository } from '../repositories/billing.repository';
import { QuerySeriesDto } from '../dto/billing-ops.dto';

@Injectable()
export class RevenueSeriesService {
  constructor(private readonly repo: BillingRepository) {}

  async series(q: QuerySeriesDto) {
    // three independent reads, run together: one slow one must not serialise behind the others on a dashboard
    const [billed, mix, cohorts] = await Promise.all([
      this.repo.billedByMonth(q.currency, q.months),
      this.repo.planMix(q.currency),
      this.repo.cohortRetention(q.quarters),
    ]);
    return {
      currency: q.currency,
      billedByMonth: billed,
      planMix: mix,
      cohortRetention: cohorts,
      // Stated in the payload, not just in a comment: any consumer of this API is told what these numbers are and are
      // not, so a second console cannot re-label them as MRR by accident.
      basis: {
        billedByMonth: 'invoices_issued_per_month',
        planMix: 'live_subscriptions_normalised_to_monthly_integer_division',
        cohortRetention: 'tenants_with_a_live_subscription_by_signup_quarter',
        mrrSeriesUnavailableBecause: 'the platform stores one current subscription row per tenant, so month-by-month MRR cannot be reconstructed without inventing history',
      },
    };
  }
}
