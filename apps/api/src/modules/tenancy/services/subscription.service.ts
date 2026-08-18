// modules/tenancy/services/subscription.service.ts
// Tenant subscription use-cases — the QUOTA FOUNDATION: an ACTIVE subscription is what core QuotaService
// resolves a tenant's plan_limits from. subscribe/changePlan/cancel need tenant.settings (the tenant's
// own admin) or plan.manage (platform). Every write: one ACID tx (UoW), status via the machine (Law 5),
// outbox in-tx (Law 4), audit. One LIVE subscription per tenant (guarded under FOR UPDATE). No SaaS money
// moves here (B2B billing via saas_invoices is a separate, deferred flow). No version column → FOR UPDATE.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { Subscription } from '../domain/subscription.entity';
import { DomainEvent, BillingCycle } from '../domain/tenancy.events';
import { SubscriptionNotFoundError, SubscriptionForbiddenError, PlanNotFoundError, PlanNotSubscribableError, AlreadySubscribedError } from '../domain/tenancy.errors';
import { PlanRepository } from '../repositories/plan.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { BillingNoticeService } from './billing-notice.service';
import { graceUntil } from '../domain/billing-grace';
import { SubscribeDto } from '../dto/create-subscription.dto';
import { TenancyActor } from './plan.service';

@Injectable()
export class SubscriptionService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly audit: AuditWriter,
    private readonly plans: PlanRepository,
    private readonly repo: SubscriptionRepository,
    /** PC-56 TENANT-4d-5 — see `flush`. */
    private readonly notice: BillingNoticeService,
  ) {}

  async subscribe(tenantId: string, actor: TenancyActor, idemKey: string, dto: SubscribeDto) {
    if (!actor.canManageSub) throw new SubscriptionForbiddenError('requires tenant.settings');
    return this.idem.remember(idemKey, actor.userId, 'tenancy.subscribe', () =>
      timed(this.metrics, 'tenancy.subscribe', { tenant: tenantId }, async () => {
        const plan = await this.plans.getById(tenantId, dto.planId);
        if (!plan) throw new PlanNotFoundError(dto.planId);
        if (!plan.isActive) throw new PlanNotSubscribableError();
        const price = plan.priceFor(dto.billingCycle as BillingCycle);
        return this.uow.run(tenantId, async (tx) => {
          if (await this.repo.findLiveForTenant(tx, tenantId)) throw new AlreadySubscribedError();
          const sub = Subscription.subscribe({ id: uuidv7(), tenantId, planId: plan.id, billingCycle: dto.billingCycle as BillingCycle, priceMinor: price, currencyCode: plan.currencyCode });
          await this.repo.insert(tx, sub);
          await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'subscription.created', entityType: 'subscription', entityId: sub.id, newValue: { planId: plan.id, billingCycle: dto.billingCycle } });
          await this.flush(tx, tenantId, sub.id, sub.pullEvents());
          return this.serialize(sub);
        }, { userId: actor.userId });
      }));
  }

  /**
   * **REMOVED IN PC-56 TENANT-1d-2 — IT BILLED NOTHING.**
   *
   * This method swapped `plan_id` and `price_minor`, wrote one `subscription.plan_changed` audit line, and charged nothing:
   * every upgrade the platform processed was free, and a downgrade applied the same second, taking away capability the
   * tenant had already paid for. TENANT-1d built the proration arithmetic and 0126's tables to fix exactly that, and this
   * method was never changed — so the defect stayed live behind a route that looked correct.
   *
   * A tenant plan change now goes through `PlanChangeService.change`: preview, recompute, invoice an upgrade with a 7-day
   * due date, schedule a downgrade for the period end, one row in `subscription_plan_changes` keyed for idempotency.
   *
   * Deleted rather than deprecated on purpose. A second path that still compiles is a path something will call.
   */

  async cancel(tenantId: string, actor: TenancyActor, id: string, atPeriodEnd: boolean, ip: string | null) {
    if (!actor.canManageSub) throw new SubscriptionForbiddenError('requires tenant.settings');
    return this.uow.run(tenantId, async (tx) => {
      const sub = await this.repo.getForUpdate(tx, tenantId, id);
      if (!sub) throw new SubscriptionNotFoundError(id);
      sub.cancel(atPeriodEnd);
      await this.repo.update(tx, sub);
      await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'subscription.cancelled', entityType: 'subscription', entityId: id, newValue: { atPeriodEnd }, ip });
      await this.flush(tx, tenantId, id, sub.pullEvents());
      return this.serialize(sub);
    }, { userId: actor.userId });
  }

  /** Worker job: lapse a subscription past its period end. Idempotent (skips non-live / not-yet-due). */
  async expire(tenantId: string, id: string): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const sub = await this.repo.getForUpdate(tx, tenantId, id);
      if (!sub || !sub.expire(new Date())) return;
      await this.repo.update(tx, sub);
      await this.flush(tx, tenantId, id, sub.pullEvents());
    }, { userId: 'system' });
  }

  /**
   * PC-56 TENANT-4d-4 · open the grace window W120 promises. `graceDays` comes from `billing.grace_days` for
   * this tenant (resolved by the caller, which is the only place that may read a setting).
   */
  async enterGrace(tenantId: string, id: string, graceDays: number, now: Date = new Date()): Promise<boolean> {
    return this.uow.run(tenantId, async (tx) => {
      const sub = await this.repo.getForUpdate(tx, tenantId, id);
      if (!sub) return false;
      const until = graceUntil(sub.currentPeriodEnd, graceDays);
      if (!sub.enterGrace(until, now)) return false;
      await this.repo.update(tx, sub);
      await this.audit.write(tx, { tenantId, actorUserId: 'system', action: 'tenancy.subscription_grace_started', entityType: 'subscription', entityId: id, newValue: { graceUntil: until, graceDays }, ip: null });
      await this.flush(tx, tenantId, id, sub.pullEvents());
      return true;
    }, { userId: 'system' });
  }

  /**
   * PC-56 TENANT-4d-4 · **THE ROLL NOTHING EVER DID.** Driven by `tenancy.saas_invoice_paid`, the event that
   * had no subscriber (0148 defect 2). Runs INSIDE the relay's transaction so the period advance and the
   * event that caused it commit together (Law 4), and idempotent: a re-delivered paid event finds the period
   * already rolled past `now` and `rollPeriod` returns false.
   */
  async rollPeriod(tx: TxContext, tenantId: string, id: string, now: Date = new Date()): Promise<boolean> {
    const sub = await this.repo.getForUpdate(tx, tenantId, id);
    if (!sub) return false;
    if (!sub.rollPeriod(now)) return false;
    await this.repo.update(tx, sub);
    await this.flush(tx, tenantId, id, sub.pullEvents());
    this.metrics.inc('tenancy.subscription_renewed', { tenant: tenantId });
    return true;
  }

  /** The tenant's current subscription + its plan limits + current-month usage (the quota dashboard). */
  async getCurrent(tenantId: string) {
    const sub = await this.repo.findLiveForTenant(null, tenantId);
    if (!sub) return { subscription: null, limits: {}, usage: {} };
    const plan = await this.plans.getById(tenantId, sub.planId);
    const usage = await this.repo.readUsage(tenantId);
    const limits: Record<string, string> = {};
    if (plan) for (const [k, v] of Object.entries(plan.limits)) limits[k] = v.toString();
    return { subscription: this.serialize(sub), limits, usage };
  }

  async list(tenantId: string, actor: TenancyActor, q: { box: 'mine' | 'all'; status?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (q.box === 'all' && !actor.canManagePlans) throw new SubscriptionForbiddenError('requires plan.manage');
    const rows = await this.repo.listFor(tenantId, { allTenants: q.box === 'all', status: q.status, cursor: q.cursor, limit: q.limit });
    const items = rows.map((s) => this.serialize(s));
    const last = items[items.length - 1];
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${(last as any).createdAt.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }

  private serialize(s: Subscription) {
    const v = s.toProps();
    return { id: v.id, tenantId: v.tenantId, planId: v.planId, status: v.status, billingCycle: v.billingCycle, priceMinor: v.priceMinor.toString(),
      currencyCode: v.currencyCode, currentPeriodStart: v.currentPeriodStart, currentPeriodEnd: v.currentPeriodEnd, cancelAtPeriodEnd: v.cancelAtPeriodEnd, createdAt: v.createdAt };
  }
  /** PC-56 TENANT-4d-5 · the subscription module's half of the same choke point. `subscription_grace_started`
   *  and `subscription_renewed` are the two events 4d-4 created and left with no subscriber; every other event
   *  flushed here (subscribed, plan_changed, cancelled, expired) is NOT on the notice allow-list and passes
   *  through untouched, which is a decision `NOTIFIED_BILLING_EVENTS` records explicitly rather than by
   *  omission. Expiry in particular: a tenant whose grace window lapsed was told when the window OPENED and
   *  what would happen, and 4d-5 does not add a second message at the moment service stops — that surface is a
   *  screen, not an SMS, and inventing one here would be this wave notifying beyond what any canon promises. */
  private async flush(tx: TxContext, tenantId: string, subscriptionId: string, events: DomainEvent[]) {
    for (const e of events) {
      const payload = await this.notice.enrich(tx, tenantId, e.type, { v: 1, ...e.payload });
      await this.outbox.write(tx, { tenantId, aggregateType: 'subscription', aggregateId: subscriptionId, eventType: e.type, payload });
    }
  }
}
