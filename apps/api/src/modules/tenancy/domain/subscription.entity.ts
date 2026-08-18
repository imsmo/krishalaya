// modules/tenancy/domain/subscription.entity.ts
// Subscription aggregate — a tenant's subscription to a plan; the ACTIVE one drives that tenant's
// quotas (core QuotaService). Pure domain: price in bigint minor units, status transitions ONLY via the
// state machine (Law 5). No SaaS money moves here (B2B billing via saas_invoices is a separate, deferred
// flow). No version column → the service locks the row FOR UPDATE.
import { SubscriptionStatus, assertTransition, isLive } from './subscription.state';
import { graceOpen } from './billing-grace';
import { TenancyEventType, DomainEvent, BillingCycle } from './tenancy.events';
import { InvalidSubscriptionError, SubscriptionNotLiveError } from './tenancy.errors';

export interface SubscriptionProps {
  id: string; tenantId: string; planId: string; status: SubscriptionStatus; billingCycle: BillingCycle;
  priceMinor: bigint; currencyCode: string; discountPct: number; currentPeriodStart: Date; currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean; cancelledAt: Date | null; createdAt: Date;
  /** PC-56 TENANT-4d-4 · the grace window (0148). Both null or both set — a window nobody opened, and one
   *  that never closes, are both refused by `ck_subscription_grace_pair`. */
  graceUntil: string | null; graceStartedAt: Date | null;
}
function nextPeriodEnd(from: Date, cycle: BillingCycle): Date {
  const d = new Date(from.getTime());
  if (cycle === 'annual') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export class Subscription {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: SubscriptionProps) {}

  /** Activate a tenant on a plan. Starts 'active' so quotas apply immediately (trial flows are future). */
  static subscribe(input: { id: string; tenantId: string; planId: string; billingCycle: BillingCycle; priceMinor: bigint; currencyCode: string; discountPct?: number; now?: Date }): Subscription {
    const now = input.now ?? new Date();
    if (input.priceMinor < 0n) throw new InvalidSubscriptionError('price cannot be negative');
    const s = new Subscription({ id: input.id, tenantId: input.tenantId, planId: input.planId, status: 'active', billingCycle: input.billingCycle,
      priceMinor: input.priceMinor, currencyCode: input.currencyCode, discountPct: input.discountPct ?? 0, currentPeriodStart: now, currentPeriodEnd: nextPeriodEnd(now, input.billingCycle),
      cancelAtPeriodEnd: false, cancelledAt: null, createdAt: now, graceUntil: null, graceStartedAt: null });
    s.events.push({ type: TenancyEventType.Subscribed, payload: { subscriptionId: s.props.id, tenantId: s.props.tenantId, planId: s.props.planId, billingCycle: s.props.billingCycle } });
    return s;
  }
  static rehydrate(props: SubscriptionProps): Subscription { return new Subscription(props); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get planId() { return this.props.planId; }
  get status() { return this.props.status; }
  get currentPeriodEnd() { return this.props.currentPeriodEnd; }
  get graceUntil() { return this.props.graceUntil; }
  get billingCycle() { return this.props.billingCycle; }
  toProps(): Readonly<SubscriptionProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Switch to a different plan (price re-quoted by the service). Keeps the period; quotas follow the new plan. */
  changePlan(newPlanId: string, newPriceMinor: bigint): void {
    if (!isLive(this.props.status)) throw new SubscriptionNotLiveError(this.props.status);
    if (newPriceMinor < 0n) throw new InvalidSubscriptionError('price cannot be negative');
    const from = this.props.planId;
    this.props.planId = newPlanId; this.props.priceMinor = newPriceMinor;
    if (this.props.status !== 'active') { assertTransition(this.props.status, 'active'); this.props.status = 'active'; }
    this.events.push({ type: TenancyEventType.PlanChanged, payload: { subscriptionId: this.props.id, fromPlanId: from, toPlanId: newPlanId } });
  }

  /** Cancel now (status cancelled) or at period end (stays active until the grace job expires it). */
  cancel(atPeriodEnd: boolean, now: Date = new Date()): void {
    if (!isLive(this.props.status)) throw new SubscriptionNotLiveError(this.props.status);
    this.props.cancelledAt = now;
    if (atPeriodEnd) { this.props.cancelAtPeriodEnd = true; this.events.push({ type: TenancyEventType.SubscriptionCancelled, payload: { subscriptionId: this.props.id, atPeriodEnd: true } }); return; }
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled';
    this.events.push({ type: TenancyEventType.SubscriptionCancelled, payload: { subscriptionId: this.props.id, atPeriodEnd: false } });
  }

  /**
   * PC-56 TENANT-4d-4 · **THE WRITER `past_due` NEVER HAD.** The status has existed since 0002, the state
   * machine has allowed `active → past_due` all along, `isLive` selects it, `findLiveForTenant` selects it,
   * `plan-compare` reads it, and TENANT-4d-1 made `grantsQuota` honour it precisely so a tenant inside the
   * grace period keeps its plan limits. Every consumer was built; no producer ever was.
   *
   * Opens the window W120 promises: service continues, quotas continue, and the subscription is marked as
   * owing. `graceUntilDate` is computed by the caller from `billing.grace_days` for that tenant.
   */
  enterGrace(graceUntilDate: string, now: Date = new Date()): boolean {
    if (this.props.status === 'past_due') return false;                  // already in a window
    if (!isLive(this.props.status)) return false;
    if (this.props.currentPeriodEnd.getTime() > now.getTime()) return false;   // period still open
    assertTransition(this.props.status, 'past_due');
    this.props.status = 'past_due';
    this.props.graceUntil = graceUntilDate;
    this.props.graceStartedAt = now;
    this.events.push({ type: TenancyEventType.SubscriptionGraceStarted, payload: {
      subscriptionId: this.props.id, tenantId: this.props.tenantId, graceUntil: graceUntilDate,
      periodEnd: this.props.currentPeriodEnd.toISOString().slice(0, 10),
    } });
    return true;
  }

  /**
   * PC-56 TENANT-4d-4 · **THE ROLL NOTHING EVER DID.** `current_period_end` was set once in `subscribe()`
   * and never moved again anywhere in the monorepo — so every tenant's period end passed and stayed passed,
   * the renewal finder returned the same subscription for ever (billing exactly one period), and the expiry
   * finder matched every live subscription within a month of creation. `memberships` does this correctly one
   * module away (`UserMembership.renew()`); the SaaS subscription never got it.
   *
   * Driven by `tenancy.saas_invoice_paid` — the event that had no subscriber. Closes any grace window and
   * returns a past-due subscription to active, because the bill it was past due on is settled.
   */
  rollPeriod(now: Date = new Date()): boolean {
    if (this.props.status !== 'active' && this.props.status !== 'past_due') return false;
    // **THE GUARD PC-56 TENANT-4d-4 CLAIMED AND DID NOT WRITE (fixed in TENANT-4d-5).** Its own header said "a
    // re-delivered paid event finds the period already rolled and `rollPeriod` returns false", and so did
    // `SubscriptionService.rollPeriod`'s and `SaasInvoicePaidHandler`'s. Nothing in the method implemented it:
    // after a roll the status is `active` and the period end is in the FUTURE, which the old code read as
    // "paid early" and rolled again from `now`. The outbox relay is explicitly at-least-once ("handlers MUST be
    // idempotent") and quarantines an event whose handler set throws, so a re-delivery was not hypothetical —
    // and 4d-5 puts a SECOND handler (the notification fanout) on this same event inside the same transaction,
    // which is exactly what turns a rare re-delivery into a routine one. Each replay granted the tenant another
    // full billing period for nothing.
    //
    // AND IT REFUSES A PERIOD THAT IS STILL OPEN, which is the same bug wearing different clothes.
    // `PlanChangeService` raises a mid-cycle proration invoice against the subscription; paying it fired this
    // method with the period still running and rolled it — a tenant who UPGRADED got a free month. The renewal
    // invoice is only ever raised after a period has ended (see SaasBillingCycleJob phase 1), so requiring the
    // period to have ended costs the legitimate path nothing and closes both.
    if (this.props.currentPeriodEnd.getTime() > now.getTime()) return false;
    // The new period starts where the old one ENDED, not at `now`: billing a tenant from the day their
    // payment cleared would silently shorten every period by however long they took to pay, and a tenant
    // who paid four days late would lose four days of every subsequent period, compounding for ever.
    const from = this.props.currentPeriodEnd;
    this.props.currentPeriodStart = from;
    this.props.currentPeriodEnd = nextPeriodEnd(from, this.props.billingCycle);
    this.props.graceUntil = null;
    this.props.graceStartedAt = null;
    if (this.props.status === 'past_due') { assertTransition('past_due', 'active'); this.props.status = 'active'; }
    this.events.push({ type: TenancyEventType.SubscriptionRenewed, payload: {
      subscriptionId: this.props.id, tenantId: this.props.tenantId,
      periodStart: this.props.currentPeriodStart.toISOString().slice(0, 10),
      periodEnd: this.props.currentPeriodEnd.toISOString().slice(0, 10),
    } });
    return true;
  }

  /**
   * Worker job: lapse a subscription past its period end (or a cancel-at-period-end that has arrived).
   *
   * PC-56 TENANT-4d-4 adds ONE guard, and it is the whole point of the wave: **a subscription inside an open
   * grace window is never expired.** W120 promises "nothing switches off for 7 days"; before this guard the
   * job named for the grace period switched things off on day zero. One mechanism, guarded here rather than
   * two code paths in the caller — and with the `saas_billing_grace` flag OFF nothing ever writes
   * `grace_until`, so this guard never fires and the behaviour is exactly what it was.
   */
  expire(now: Date = new Date()): boolean {
    if (!isLive(this.props.status)) return false;
    if (this.props.currentPeriodEnd.getTime() > now.getTime()) return false;
    if (graceOpen(this.props.graceUntil, now)) return false;
    assertTransition(this.props.status, 'expired');
    this.props.status = 'expired';
    this.events.push({ type: TenancyEventType.SubscriptionExpired, payload: {
      subscriptionId: this.props.id, tenantId: this.props.tenantId,
      // WHY it expired, so a support conversation does not have to reconstruct it from timestamps.
      afterGrace: this.props.graceUntil !== null, graceUntil: this.props.graceUntil,
    } });
    return true;
  }
}
