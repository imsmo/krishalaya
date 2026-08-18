// modules/tenancy/jobs/saas-billing-cycle.job.ts · PC-56 TENANT-4d-4 — the SaaS billing CLOCK.
//
// One job, because the four things W120 describes are one cycle and splitting them across four unscheduled
// classes is how they came to disagree with each other:
//
//   1. RAISE   the renewal invoice for a period that has ended (idempotent per subscription+period, 0146);
//   2. OVERDUE mark owing invoices past their due date (enters the operator's collection queue);
//   3. GRACE   a period that ended with money owed opens a window (subscription → past_due, 0148);
//   4. EXPIRE  and only a window that has CLOSED expires the subscription.
//
// **WHY THIS EXISTS RATHER THAN A REGISTRY ENTRY FOR THE FOUR OLD CLASSES.** TENANT-4d-2 found four job
// classes in this directory that no runtime ran (`grace-period`, `renewal-invoices`, `trial-expiry`,
// `usage-limit-alerts`) and deliberately did NOT wire them, because `GracePeriodJob` expires a subscription
// the moment its period ends and nothing ever rolled a period — so scheduling it would have expired every
// paying tenant on the platform. That is fixed by `Subscription.rollPeriod` + the paid-event handler, and the
// sweep below can now be honest. `GracePeriodJob` is superseded by phase 4 here and is deleted in this wave
// rather than left as a second mechanism over one clock.
//
// `TrialExpiryJob` and `UsageLimitAlertsJob` are STILL not wired, and are named in 0148 rather than smuggled
// in: a trial that ends is a conversion decision with its own screens, and the usage alert is TENANT-4d-1's
// threshold, which needs the notification plane TENANT-4d-5 builds. Wiring a job whose notification goes
// nowhere would be the fake-surface shape this programme refuses.
//
// Bounded per tick, cross-tenant by design (the runner's kv_relay pool), and per-subscription failure is
// isolated — one tenant's bad row never stops the tick, mirroring the isolation ScheduledJobsRunner gives one
// job relative to another and KycExpiryRemindersCadenceJob gives one tenant relative to another.
import { Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import { TxContext } from '../../../core/database/unit-of-work';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { SaasInvoiceRepository } from '../repositories/saas-invoice.repository';
import { SubscriptionService } from '../services/subscription.service';
import { SaasInvoiceService } from '../services/saas-invoice.service';
import { BillingTaxRate } from '../read-models/billing-tax-rate';
import { taxOn } from '../domain/proration';
import { DEFAULT_GRACE_DAYS, graceDaysFrom, sweepAction } from '../domain/billing-grace';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const periodTagOf = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export interface BillingCycleResult {
  raised: number; overdue: number; graced: number; expired: number; waited: number; failed: number;
  /** Set when the tick refused to do anything, with the reason — a tick that does nothing must say why. */
  refused?: 'cadence_flag_off' | 'tax_rate_unreadable';
}

export class SaasBillingCycleJob {
  private readonly log = new Logger(SaasBillingCycleJob.name);

  constructor(
    private readonly subs: SubscriptionRepository,
    private readonly invoices: SaasInvoiceRepository,
    private readonly subscriptions: SubscriptionService,
    private readonly invoiceService: SaasInvoiceService,
    private readonly taxRate: BillingTaxRate,
    /** `saas_billing_cadence` and `saas_billing_grace` (Law 10), read per tick so a kill switch takes effect
     *  on the next tick rather than on the next deploy. */
    private readonly flags: { isEnabled(key: string, ctx?: { tenantId?: string }): Promise<boolean> },
    /** `billing.grace_days` for a tenant. Injected as a reader so this job never touches a settings table. */
    private readonly graceDaysFor: (tenantId: string) => Promise<unknown>,
  ) {}

  async run(pool: Pool, limit = 200, now: Date = new Date()): Promise<BillingCycleResult> {
    const zero: BillingCycleResult = { raised: 0, overdue: 0, graced: 0, expired: 0, waited: 0, failed: 0 };
    if (!(await this.flags.isEnabled('saas_billing_cadence').catch(() => false))) {
      return { ...zero, refused: 'cadence_flag_off' };
    }
    // Resolved ONCE per tick and before anything is raised: a rate that changed mid-run would give two tenants
    // different rates for the same period with no way to tell which was intended (0146 defect 4). An
    // unreadable rate refuses the WHOLE tick, including the sweep — because a tenant must not be moved toward
    // expiry in a tick that could not have billed them in the first place.
    const rate = await this.taxRate.current();
    if (rate.readFailed) return { ...zero, refused: 'tax_rate_unreadable' };
    const graceEnabled = await this.flags.isEnabled('saas_billing_grace').catch(() => false);

    const out = { ...zero };

    // ---- claim the work, cross-tenant, in one bounded transaction ----------------------------------------
    const client = await pool.connect();
    let due: Array<{ tenantId: string; id: string; periodEnd: Date; priceMinor: bigint; currency: string; status: string; cancelAtPeriodEnd: boolean; graceUntil: string | null; owingMinor: bigint }> = [];
    try {
      await client.query('BEGIN');
      const tx: TxContext = { query: (sql, params) => client.query(sql, params as never) as never, tenantId: '', userId: 'system' };
      due = (await this.subs.findPeriodEndedWithDebt(tx, now, limit)).map(({ sub, owingMinor }) => {
        const p = sub.toProps();
        return { tenantId: p.tenantId, id: p.id, periodEnd: p.currentPeriodEnd, priceMinor: p.priceMinor,
          currency: p.currencyCode, status: p.status, cancelAtPeriodEnd: p.cancelAtPeriodEnd,
          graceUntil: p.graceUntil, owingMinor };
      });
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }

    for (const d of due) {
      try {
        // ---- 1. RAISE the renewal invoice for the period that ended --------------------------------------
        // Before the sweep decides anything, so a tenant is never moved toward expiry for a period they were
        // never billed for. Idempotent per (subscription, period) by 0146's unique index.
        if (d.status === 'active' || d.status === 'past_due') {
          const res = await this.invoiceService.raiseRenewal({
            tenantId: d.tenantId, subscriptionId: d.id, currencyCode: d.currency,
            taxMinor: taxOn(d.priceMinor, rate.bp), taxBp: rate.bp,
            dueDate: ymd(d.periodEnd), periodTag: periodTagOf(d.periodEnd),
            lineItems: [{ desc: 'Subscription renewal', qty: 1, unitMinor: d.priceMinor, totalMinor: d.priceMinor }],
          });
          if (res.raised) out.raised++;
        }

        // ---- 3/4. the sweep decides ONE thing per subscription -------------------------------------------
        // Re-read the debt AFTER raising, because raising an invoice is exactly what creates the debt this
        // period. Using the pre-raise figure would let a tenant sit in `nothing_owed` for ever.
        const owing = d.owingMinor > 0n ? d.owingMinor : await this.owingFor(pool, d.id);
        const action = sweepAction({
          status: d.status as never, currentPeriodEnd: d.periodEnd, graceUntil: d.graceUntil,
          cancelAtPeriodEnd: d.cancelAtPeriodEnd, owingMinor: owing, now, graceEnabled,
        });
        if (action.kind === 'enter_grace') {
          const days = graceDaysFrom(await this.graceDaysFor(d.tenantId).catch(() => DEFAULT_GRACE_DAYS));
          if (await this.subscriptions.enterGrace(d.tenantId, d.id, days, now)) out.graced++;
        } else if (action.kind === 'expire') {
          await this.subscriptions.expire(d.tenantId, d.id);
          out.expired++;
        } else {
          out.waited++;
        }
      } catch (err) {
        out.failed++;
        this.log.error(`billing cycle failed for subscription ${d.id}: ${(err as Error)?.message ?? err}`);
      }
    }

    // ---- 2. OVERDUE: owing invoices past their due date -----------------------------------------------
    // ONCE per tick, not once per subscription: this is a cross-tenant finder over invoices, and running it
    // inside the loop above would re-scan the platform's owing invoices for every due subscription. It runs
    // AFTER the loop so an invoice raised this tick with a due date already in the past (a period that ended
    // days ago) is marked overdue in the same tick rather than the next one.
    for (const inv of await this.overdueFor(pool, ymd(now), limit)) {
      try {
        if (await this.invoiceService.markOverdue(inv.tenantId, inv.id)) out.overdue++;
      } catch (err) {
        out.failed++;
        this.log.error(`overdue sweep failed for invoice ${inv.id}: ${(err as Error)?.message ?? err}`);
      }
    }
    return out;
  }

  /** Owing invoices past due, cross-tenant, bounded. The finder already existed and had no scheduled caller. */
  private async overdueFor(pool: Pool, asOf: string, limit: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tx = { query: (sql: string, params?: readonly unknown[]) => client.query(sql, params as never) as never };
      const rows = await this.invoices.findOwingPastDue(tx as never, asOf, limit);
      await client.query('COMMIT');
      return rows;
    } catch (e) { await client.query('ROLLBACK').catch(() => undefined); throw e; } finally { client.release(); }
  }

  /** What one subscription owes right now — read after the raise so this period's own invoice counts. */
  private async owingFor(pool: Pool, subscriptionId: string): Promise<bigint> {
    const r = await pool.query(
      `SELECT COALESCE(SUM(total_minor - paid_minor), 0)::text AS owing
         FROM saas_invoices
        WHERE subscription_id = $1 AND deleted_at IS NULL
          AND status IN ('issued','partially_paid','overdue') AND total_minor > paid_minor`, [subscriptionId]);
    return BigInt((r.rows[0] as { owing: string } | undefined)?.owing ?? '0');
  }
}
