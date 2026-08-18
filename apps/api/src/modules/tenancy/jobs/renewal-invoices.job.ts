// modules/tenancy/jobs/renewal-invoices.job.ts
// Worker job (kv_relay): the SaaS RENEWAL BILLING RUN. Finds active subscriptions at/near their period end and
// raises + issues ONE renewal invoice each (the bill the tenant must pay to continue). Claims across tenants,
// bounded per tick; idempotent per (subscription, billing period) — since 0146 that promise is kept by a UNIQUE
// INDEX rather than by a `LIKE` read, so two overlapping ticks can no longer both insert. The invoice's line is
// the subscription's recorded price (bigint minor units) — NO money moves here (collection is god-mode
// billing-ops). NOT a DI provider — apps/worker instantiates it with the kv_relay Pool.
//
// **THIS JOB IS IN NO WORKER REGISTRY.** `apps/worker/src/registry.ts` lists neither this job nor
// GracePeriodJob, TrialExpiryJob or UsageLimitAlertsJob, though each header says the worker instantiates it. So
// as shipped, no renewal invoice is ever raised for any tenant. Wiring it is TENANT-4d-3, and deliberately not
// this wave: the same clock that would start billing also drives `GracePeriodJob`, which EXPIRES a subscription
// the moment its period ends, and W120 promises "nothing switches off for 7 days". Scheduling the cadence
// before the grace state exists would start switching live tenants off on day zero.
//
// TAX (0146 defect 4). This job used to pass `taxMinor: 0n`, so every renewal invoice was issued tax-free while
// an UPGRADE invoice through PlanChangeService carried GST from the same setting. W120's own open invoice says
// "(incl. GST)". The rate is now resolved once per tick from `billing.tax_bp` (the read-model TENANT-1d-2 built
// for exactly this) and frozen onto each invoice. **If the rate cannot be READ, this job raises NOTHING.** A
// tenant's invoice must not carry a tax figure the platform guessed because a replica was unreachable, and
// there is no way to un-issue an invoice a tenant has already seen — the same refusal PlanChangeService makes.
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { SaasInvoiceService } from '../services/saas-invoice.service';
import { BillingTaxRate } from '../read-models/billing-tax-rate';
// The SAME function TENANT-1d-2 wrote for the upgrade invoice, not a second copy of it: an upgrade and a renewal
// must never round a paisa differently on the same rate, and the only way to promise that is one call site's
// worth of arithmetic shared by both.
import { taxOn } from '../domain/proration';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const periodTag = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export class RenewalInvoicesJob {
  constructor(
    private readonly systemPool: Pool,
    private readonly subs: SubscriptionRepository,
    private readonly invoices: SaasInvoiceService,
    private readonly taxRate: BillingTaxRate,
  ) {}

  /** `through` defaults to now: bill subscriptions whose period ends on/before it. */
  async run(limit = 200, through: Date = new Date()): Promise<{ raised: number; skipped: number; failed: number; refused?: 'tax_rate_unreadable' }> {
    // Resolved BEFORE any invoice is created, and once for the tick: a rate that changed mid-run would give two
    // tenants different rates for the same period with no way to tell which was intended.
    const rate = await this.taxRate.current();
    if (rate.readFailed) return { raised: 0, skipped: 0, failed: 0, refused: 'tax_rate_unreadable' };

    const client = await this.systemPool.connect();
    let due: Array<{ tenantId: string; subscriptionId: string; priceMinor: bigint; currency: string; periodEnd: Date }> = [];
    try {
      await client.query('BEGIN');
      const tx: TxContext = { query: (sql, params) => client.query(sql, params as any) as any, tenantId: '', userId: 'system' };
      due = (await this.subs.findDueToRenew(tx, through, limit)).map((s) => { const p = s.toProps(); return { tenantId: p.tenantId, subscriptionId: p.id, priceMinor: p.priceMinor, currency: p.currencyCode, periodEnd: p.currentPeriodEnd }; });
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }

    let raised = 0, skipped = 0, failed = 0;
    for (const d of due) {
      try {
        const res = await this.invoices.raiseRenewal({
          tenantId: d.tenantId, subscriptionId: d.subscriptionId, currencyCode: d.currency,
          taxMinor: taxOn(d.priceMinor, rate.bp), taxBp: rate.bp,
          dueDate: ymd(d.periodEnd), periodTag: periodTag(d.periodEnd),
          lineItems: [{ desc: 'Subscription renewal', qty: 1, unitMinor: d.priceMinor, totalMinor: d.priceMinor }],
        });
        if (res.raised) raised++; else skipped++;
      } catch { failed++; }
    }
    return { raised, skipped, failed };
  }
}
