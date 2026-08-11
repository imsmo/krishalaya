// modules/tenancy/services/plan-change.service.ts · the upgrade that was free (PC-56 TENANT-1d-2).
//
// ---------------------------------------------------------------------------------------------------------------------
// THE FINDING: TENANT-1d BUILT THE ARITHMETIC AND NOTHING WAS EVER WIRED TO IT
// ---------------------------------------------------------------------------------------------------------------------
// TENANT-1d found that an upgrade charged nothing, and closed by building `domain/proration.ts` (the to-the-day
// arithmetic, in bigint, with the canon's rounding direction) and migration 0126 (`subscription_plan_changes`, the four
// `pending_*` columns for a scheduled downgrade, `billing.tax_bp`). Its record says the money plane was built.
//
// **THE PLANE WAS BUILT AND NEVER CONNECTED.** `grep -rn "prorate("` across the monorepo returns the proration test and
// nothing else. `SubscriptionService.changePlan` — the method `POST /v1/subscriptions/:id/change-plan` actually calls, and
// the method the console's own /billing page posts to — still reads, in full:
//
//     sub.changePlan(plan.id, plan.priceFor(sub.toProps().billingCycle));
//     await this.repo.update(tx, sub);
//     await this.audit.write(tx, { ... action: 'subscription.plan_changed' ... });
//
// So the defect TENANT-1d opened with was still live in production: a tenant could move Starter → Professional on day two
// of a cycle, take every Professional capability immediately, and be invoiced ₹0 for the remainder. The downgrade still
// applied the same second. And "a double click cannot charge twice" was true of nothing, because nothing charged once.
//
// A migration and a pure function are not a feature. **The only thing that makes an invoice happen is a call site.**
// ---------------------------------------------------------------------------------------------------------------------
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { BadRequestError, ConflictError, InfraError, NotFoundError } from '../../../shared/errors/app-error';
import { SubscriptionForbiddenError, PlanNotFoundError, PlanNotSubscribableError, SubscriptionNotFoundError } from '../domain/tenancy.errors';
import { PlanRepository } from '../repositories/plan.repository';
import { TenancyActor } from './plan.service';
import { SaasInvoiceService } from './saas-invoice.service';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { PlanChangeRepository } from '../repositories/plan-change.repository';
import { BillingTaxRate } from '../read-models/billing-tax-rate';
import { LimitBreach, ProrationLines, changeIdempotencyKey, limitBreaches, prorate } from '../domain/proration';

/** How long a tenant has to pay an upgrade invoice. W119: "invoiced on upgrade, due in 7 days". */
const DUE_DAYS = 7;

export interface PlanChangePreview {
  subscriptionId: string;
  fromPlan: { id: string; code: string; name: string; priceMinor: string };
  toPlan: { id: string; code: string; name: string; priceMinor: string };
  currencyCode: string;
  periodStart: string;
  periodEnd: string;
  today: string;
  taxBp: number;
  /** True when the platform is invoicing on the shipped default rather than a configured rate. Shown, not hidden. */
  taxUsedDefault: boolean;
  /** True when the rate could not be READ. A preview still renders; a change refuses. */
  taxUnavailable: boolean;
  lines: {
    direction: ProrationLines['direction'];
    daysInPeriod: number;
    daysRemaining: number;
    newPlanChargeMinor: string;
    unusedCreditMinor: string;
    netDueMinor: string;
    taxMinor: string;
    totalDueMinor: string;
    effectiveDate: string;
    scheduled: boolean;
  };
  breaches: LimitBreach[];
  /** What a second identical click would collide with — so the console can post the same key it previewed. */
  idempotencyKey: string;
}

@Injectable()
export class PlanChangeService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly audit: AuditWriter,
    // The REPOSITORY, not PlanService: the service serialises to strings and throws on a missing plan, and this path needs
    // the entity (for `priceFor(cycle)`) and a null it can turn into its own error.
    private readonly plans: PlanRepository,
    private readonly invoices: SaasInvoiceService,
    private readonly subs: SubscriptionRepository,
    private readonly repo: PlanChangeRepository,
    private readonly tax: BillingTaxRate,
  ) {}

  /**
   * What this change would cost, and what it would break. **WRITES NOTHING.**
   *
   * W119's error state is "Couldn't compute proration · No charge was made — proration always previews before any payment",
   * which is only a true sentence if the preview is a separate, read-only act. It is also why the console never posts
   * amounts: it posts a plan id and the key it previewed, and the service recomputes.
   */
  async preview(tenantId: string, actor: TenancyActor, subscriptionId: string, toPlanId: string, today = isoDay(new Date())): Promise<PlanChangePreview> {
    if (!actor.canManageSub) throw new SubscriptionForbiddenError('requires tenant.settings');

    const sub = await this.subs.getById(tenantId, subscriptionId);
    if (!sub) throw new SubscriptionNotFoundError(subscriptionId);
    const s = sub.toProps();

    const [fromPlan, toPlan] = await Promise.all([
      this.plans.getById(tenantId, s.planId),
      this.plans.getById(tenantId, toPlanId),
    ]);
    if (!toPlan) throw new PlanNotFoundError(toPlanId);
    if (!toPlan.isActive) throw new PlanNotSubscribableError();
    if (toPlan.id === s.planId) throw new BadRequestError('already on this plan');
    const to = toPlan.toProps();
    const from = fromPlan?.toProps() ?? null;

    const rate = await this.tax.current();
    const periodStart = isoDay(s.currentPeriodStart);
    const periodEnd = isoDay(s.currentPeriodEnd);

    // **THE CURRENT PRICE IS THE SUBSCRIPTION'S, NOT THE PLAN'S.** `subscriptions.price_minor` is the NEGOTIATED price
    // (0002 says so), so a founding partner on a ₹25,000 anchor deal moving to list-price Professional at ₹19,999 is going
    // DOWN. Reading the plan's list price here would bill them for a change that reduces their bill.
    const lines = prorate({
      fromPriceMinor: s.priceMinor,
      toPriceMinor: toPlan.priceFor(s.billingCycle),
      periodStart, periodEnd, today, taxBp: rate.bp,
    });

    const [limits, usage] = await Promise.all([
      this.repo.planLimits(tenantId, toPlan.id),
      this.repo.liveUsage(tenantId),
    ]);

    return {
      subscriptionId,
      fromPlan: { id: s.planId, code: from?.code ?? '', name: from?.defaultName ?? '', priceMinor: s.priceMinor.toString() },
      toPlan: { id: to.id, code: to.code, name: to.defaultName, priceMinor: toPlan.priceFor(s.billingCycle).toString() },
      currencyCode: s.currencyCode,
      periodStart, periodEnd, today,
      taxBp: rate.bp, taxUsedDefault: rate.usedDefault, taxUnavailable: rate.readFailed,
      lines: {
        direction: lines.direction, daysInPeriod: lines.daysInPeriod, daysRemaining: lines.daysRemaining,
        newPlanChargeMinor: lines.newPlanChargeMinor.toString(),
        unusedCreditMinor: lines.unusedCreditMinor.toString(),
        netDueMinor: lines.netDueMinor.toString(),
        taxMinor: lines.taxMinor.toString(),
        // **THE TOTAL COMES FROM THE TOTAL, NEVER FROM ADDING THE DISPLAYED PARTS.** W119's own printed total (₹6,741 +
        // ₹1,213 = ₹7,954) is its rounded rupee lines summed, while the true total in paise is ₹7,955.48. A console that
        // added the parts would show a tenant a different number from the amount due — two answers to one question.
        totalDueMinor: lines.totalDueMinor.toString(),
        effectiveDate: lines.effectiveDate, scheduled: lines.scheduled,
      },
      breaches: limitBreaches(limits, usage),
      idempotencyKey: changeIdempotencyKey(subscriptionId, toPlan.id, lines.effectiveDate),
    };
  }

  /**
   * Apply the change: an upgrade now and invoiced, a downgrade scheduled for the period end.
   *
   * **THE NUMBERS ARE RECOMPUTED HERE AND THE REQUEST'S ARE IGNORED.** A client that could post the amount due could post
   * a smaller one. The only thing the caller chooses is which plan.
   */
  async change(tenantId: string, actor: TenancyActor, subscriptionId: string, toPlanId: string, opts: { reason?: string; ip?: string | null; today?: string } = {}) {
    if (!actor.canManageSub) throw new SubscriptionForbiddenError('requires tenant.settings');
    const today = opts.today ?? isoDay(new Date());

    // Preview first, outside the transaction: it is all reads, it must not hold the subscription's row lock, and it is the
    // same computation the tenant was shown.
    const p = await this.preview(tenantId, actor, subscriptionId, toPlanId, today);

    // **AN UNREADABLE TAX RATE STOPS AN UPGRADE.** A downgrade bills nothing, so it may proceed. An upgrade raises an
    // invoice, and an invoice carrying a tax figure the platform guessed because a replica was unreachable is a filing a
    // finance team cannot defend — and there is no un-issuing an invoice a tenant has already received.
    if (p.taxUnavailable && p.lines.direction === 'upgrade') {
      throw new InfraError('BILLING_TAX_RATE_UNAVAILABLE', 'the tax rate could not be read, so no invoice was raised — nothing was charged and nothing changed');
    }

    const lines = prorate({
      fromPriceMinor: BigInt(p.fromPlan.priceMinor),
      toPriceMinor: BigInt(p.toPlan.priceMinor),
      periodStart: p.periodStart, periodEnd: p.periodEnd, today, taxBp: p.taxBp,
    });
    const idemKey = changeIdempotencyKey(subscriptionId, toPlanId, lines.effectiveDate);

    return this.uow.run(tenantId, async (tx) => {
      // A second click lands here and finds its own earlier row. Returned as-is — the SAME invoice, the SAME total — which
      // is what "idempotent" has to mean to somebody who double-tapped on a slow connection.
      const already = await this.repo.findByIdempotencyKey(tx, tenantId, idemKey);
      if (already) return { change: already, replayed: true };

      const sub = await this.subs.getForUpdate(tx, tenantId, subscriptionId);
      if (!sub) throw new SubscriptionNotFoundError(subscriptionId);
      const s = sub.toProps();
      if (s.planId === toPlanId) throw new ConflictError('already on this plan');

      const plan = await this.plans.getById(tenantId, toPlanId);
      if (!plan) throw new PlanNotFoundError(toPlanId);

      let invoiceId: string | null = null;
      let appliedAt: Date | null = null;

      if (lines.direction === 'upgrade') {
        // ---- the capability moves now, and the invoice is raised in the SAME transaction -------------------------------
        sub.changePlan(plan.id, BigInt(p.toPlan.priceMinor));
        await this.subs.update(tx, sub);
        // A pending downgrade is cancelled by an upgrade: leaving it would drop the tenant to the old lower plan on the
        // first of the month, days after they paid to move up.
        await this.repo.clearPending(tx, tenantId, subscriptionId);
        appliedAt = new Date();

        if (lines.totalDueMinor > 0n) {
          const inv = await this.invoices.raiseAndIssue(tx, {
            tenantId, subscriptionId, currencyCode: p.currencyCode, taxMinor: lines.taxMinor,
            dueDate: addDays(today, DUE_DAYS),
            // **THE INVOICE CARRIES BOTH LINES, NOT THE NET.** W119 prints the charge and the credit separately, and a
            // tenant reading "₹6,741" with no explanation cannot check it against their own calendar.
            lineItems: [
              { desc: `${p.toPlan.name} · ${lines.daysRemaining} of ${lines.daysInPeriod} days`,
                qty: 1, unitMinor: lines.newPlanChargeMinor, totalMinor: lines.newPlanChargeMinor },
              // **THE CREDIT IS A NEGATIVE LINE, NOT A SMALLER CHARGE.** W119 prints "−₹5,516" as its own row, and a
              // tenant who cannot see the credit cannot check the total against their own calendar.
              ...(lines.unusedCreditMinor > 0n
                ? [{ desc: `Unused ${p.fromPlan.name} credit · ${lines.daysRemaining} days (rounded in your favour)`,
                     qty: 1, unitMinor: -lines.unusedCreditMinor, totalMinor: -lines.unusedCreditMinor }]
                : []),
            ],
            // Not the billing period: two upgrades in one month must both invoice, and a per-period key would swallow the
            // second one silently. The plan-change key is what makes this idempotent.
            periodTag: `pc-${idemKey.slice(0, 24)}`,
          });
          invoiceId = inv?.id ?? null;
        }
      } else {
        // ---- a downgrade is a POINTER, never a clawback ----------------------------------------------------------------
        // W119: "downgrades apply at period end — no clawbacks mid-cycle". The tenant keeps what they paid for until the
        // period ends; that IS the credit, which is why no money moves here and no invoice is raised.
        await this.repo.setPending(tx, tenantId, subscriptionId, {
          planId: plan.id, priceMinor: BigInt(p.toPlan.priceMinor), effectiveDate: lines.effectiveDate,
          reason: opts.reason?.trim() || `scheduled change to ${plan.toProps().defaultName} at period end`,
        });
      }

      const row = await this.repo.insertChange(tx, {
        id: uuidv7(), tenantId, subscriptionId, fromPlanId: s.planId, toPlanId: plan.id,
        lines, fromPriceMinor: BigInt(p.fromPlan.priceMinor), toPriceMinor: BigInt(p.toPlan.priceMinor),
        taxBp: p.taxBp, currencyCode: p.currencyCode, invoiceId, idempotencyKey: idemKey,
        // Recorded AT THE TIME: the counts move daily, and the warning the tenant accepted is part of the decision.
        limitBreaches: p.breaches, actorUserId: actor.userId, reason: opts.reason?.trim() || null, appliedAt,
      });
      // Lost the race inside the same transaction window — the other writer's row is the answer.
      if (!row) {
        const other = await this.repo.findByIdempotencyKey(tx, tenantId, idemKey);
        if (other) return { change: other, replayed: true };
        throw new ConflictError('a plan change for this subscription is already being processed');
      }

      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId,
        action: lines.direction === 'upgrade' ? 'subscription.plan_upgraded' : 'subscription.plan_change_scheduled',
        entityType: 'subscription', entityId: subscriptionId,
        oldValue: { planId: s.planId, priceMinor: s.priceMinor.toString() },
        newValue: {
          planId: plan.id, priceMinor: p.toPlan.priceMinor, direction: lines.direction,
          effectiveDate: lines.effectiveDate, totalDueMinor: lines.totalDueMinor.toString(),
          taxBp: p.taxBp, invoiceId, breaches: p.breaches.length,
        },
        ip: opts.ip ?? null,
      });

      return { change: row, replayed: false };
    }, { userId: actor.userId });
  }

  /** The change history for one subscription — where the chain's "View audit trail" points. */
  async history(tenantId: string, actor: TenancyActor, subscriptionId: string) {
    if (!actor.canManageSub) throw new SubscriptionForbiddenError('requires tenant.settings');
    return this.repo.history(tenantId, subscriptionId);
  }

  /** A scheduled change waiting on this subscription, if any. */
  async pending(tenantId: string, subscriptionId: string) {
    return this.repo.readPending(tenantId, subscriptionId);
  }

  /**
   * Cancel a scheduled downgrade before it applies.
   *
   * Not on W119 — it shows scheduling but never un-scheduling. Built anyway, and this is the reasoning: the alternative to
   * a cancel button is a tenant who changed their mind having to schedule a second change back to the plan they are already
   * on, which the service refuses as "already on this plan". Leaving no way out of a scheduled downgrade would be a trap
   * built out of tidiness.
   */
  async cancelPending(tenantId: string, actor: TenancyActor, subscriptionId: string, ip: string | null) {
    if (!actor.canManageSub) throw new SubscriptionForbiddenError('requires tenant.settings');
    const pending = await this.repo.readPending(tenantId, subscriptionId);
    if (!pending) throw new NotFoundError('no scheduled plan change');
    return this.uow.run(tenantId, async (tx) => {
      await this.repo.clearPending(tx, tenantId, subscriptionId);
      // The plan-change ROW stays. It records that a change was scheduled and, from here on, that it never applied — a
      // history that deleted its own reversals would not be a history.
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId, action: 'subscription.plan_change_cancelled',
        entityType: 'subscription', entityId: subscriptionId,
        oldValue: { pendingPlanId: pending.planId, effectiveDate: pending.effectiveDate }, ip,
      });
      return { cancelled: true, was: pending };
    }, { userId: actor.userId });
  }
}

/** A DATE, in UTC. Billing periods are dates: a tenant in Junagadh and one in Guwahati get the same day count. */
export function isoDay(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return iso;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
