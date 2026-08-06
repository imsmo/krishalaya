// apps/admin-api/src/modules/billing-ops/services/renewal-visibility.service.ts · VISIBILITY over the SaaS renewal run
// (PC-56 ADMIN-1d — ADMIN-1-Q4, deliberately rescoped).
//
// WHAT ADMIN-1 GOT WRONG, RECORDED HERE BECAUSE IT MATTERS. The ADMIN-1 survey queued Q4 as "run-billing-cycle
// trigger — missing". It is not missing: `apps/api/src/modules/tenancy/jobs/renewal-invoices.job.ts` IS the billing
// cycle, the worker runs it, and it is idempotent per (subscription, billing period). Building a "run the cycle"
// button in admin-api would have created a SECOND invoice generator in a second app — and the failure mode of two
// invoice generators is double-billing real tenants, which is about the worst bug this platform could ship.
//
// So this service adds no writer. It answers the two questions an operator actually has:
//   • preview() — what WOULD the next run bill, and which of those are already invoiced (the job skips those, and
//     showing the skips is the difference between "40 tenants will be billed" and "40 tenants, 6 already done");
//   • recentActivity() — what the run has been doing, read from the AUDIT LEDGER, which the job itself writes and
//     therefore cannot drift from.
//
// If a manual trigger is ever genuinely wanted, the right shape is admin-api ENQUEUEING the existing job (one
// generator, one code path), not re-implementing it. That is written down here so the next person does not re-open
// the cheap option.
import { Injectable } from '@nestjs/common';
import { BillingRepository } from '../repositories/billing.repository';
import { QueryRenewalPreviewDto } from '../dto/billing-ops.dto';

@Injectable()
export class RenewalVisibilityService {
  constructor(private readonly repo: BillingRepository) {}

  async preview(q: QueryRenewalPreviewDto) {
    const through = q.through ?? new Date().toISOString().slice(0, 10);
    const [due, activity] = await Promise.all([
      this.repo.renewalDuePreview(through, q.limit),
      this.repo.recentRenewalRuns(q.days),
    ]);
    const billable = due.filter((d) => !d.alreadyInvoiced);
    // Summed per currency, never across: adding INR to USD would be a number that means nothing, and this endpoint
    // has no business inventing a rate (Law 2).
    const totals = new Map<string, bigint>();
    for (const d of billable) {
      totals.set(d.currency, (totals.get(d.currency) ?? 0n) + BigInt(d.priceMinor));
    }
    return {
      through,
      dueCount: due.length,
      billableCount: billable.length,
      alreadyInvoicedCount: due.length - billable.length,
      totalsByCurrency: [...totals.entries()].map(([currency, minor]) => ({ currency, amountMinor: minor.toString() })),
      due,
      recentActivity: activity,
      // said in the payload so no console can present this as a trigger
      note: 'read-only preview: the renewal run itself is the worker job in apps/api (idempotent per subscription and period)',
    };
  }
}
