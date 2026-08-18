// modules/tenancy/__tests__/tenant.service.spec.ts · pure-domain unit tests: the subscription state
// machine (Law 5) + the Plan and Subscription aggregates. The services' UoW/outbox/quota link are
// covered by the integration spec.
import { canTransition, isLive, grantsQuota, SUBSCRIPTION_STATUSES, SubscriptionStatus } from '../domain/subscription.state';
import { Plan } from '../domain/plan.entity';
import { Subscription } from '../domain/subscription.entity';
import { TenancyEventType } from '../domain/tenancy.events';
import { InvalidPlanError, InvalidSubscriptionError, SubscriptionNotLiveError } from '../domain/tenancy.errors';

const NOW = new Date('2026-06-01T00:00:00Z');
const plan = (over: any = {}) => Plan.create({ id: 'pl1', code: 'growth', defaultName: 'Growth', countryCode: 'IN', currencyCode: 'INR', monthlyPriceMinor: 99900n, annualPriceMinor: 999000n, limits: { max_orders_month: 1000n, max_farmers: -1n }, ...over });
const sub = (cycle: any = 'monthly') => Subscription.subscribe({ id: 's1', tenantId: 't1', planId: 'pl1', billingCycle: cycle, priceMinor: 99900n, currencyCode: 'INR', now: NOW });

describe('subscription.state machine', () => {
  it('allows documented transitions, forbids illegal ones; only active grants quota', () => {
    expect(canTransition('trialing', 'active')).toBe(true);
    expect(canTransition('active', 'past_due')).toBe(true);
    expect(canTransition('past_due', 'active')).toBe(true);
    expect(canTransition('cancelled', 'active')).toBe(false);
    expect(isLive('paused')).toBe(true); expect(isLive('expired')).toBe(false);
    // PC-56 TENANT-4d-1: a trial now carries the limits of the plan it is a trial of. This assertion used to
    // read `grantsQuota('trialing') === false`, which meant a trialing tenant escaped every plan limit while
    // W115 sells "14 days free" ON A CHOSEN PLAN — and a fresh trial is the cheapest place to mine a
    // platform, so the exemption was backwards. `past_due` keeps its limits too (still on the plan, inside
    // the grace period); `paused`/`cancelled`/`expired` do not, because no plan is in force to limit.
    expect(grantsQuota('active')).toBe(true);
    expect(grantsQuota('trialing')).toBe(true);
    expect(grantsQuota('past_due')).toBe(true);
    expect(grantsQuota('paused')).toBe(false);
    expect(grantsQuota('cancelled')).toBe(false);
    expect(grantsQuota('expired')).toBe(false);
  });
  it('covers every status', () => { for (const s of SUBSCRIPTION_STATUSES) expect(() => canTransition(s, 'expired' as SubscriptionStatus)).not.toThrow(); });
});

describe('Plan', () => {
  it('validates code/name/country/currency/prices/limits; priceFor honours cycle', () => {
    expect(() => plan({ code: 'A' })).toThrow(InvalidPlanError);
    expect(() => plan({ countryCode: 'IND' })).toThrow(InvalidPlanError);
    expect(() => plan({ monthlyPriceMinor: -1n })).toThrow(InvalidPlanError);
    expect(() => plan({ limits: { 'BAD CODE': 1n } })).toThrow(InvalidPlanError);
    expect(() => plan({ limits: { x: -2n } })).toThrow(InvalidPlanError);   // < -1
    const p = plan();
    expect(p.priceFor('monthly')).toBe(99900n); expect(p.priceFor('annual')).toBe(999000n);
    expect(p.limits.max_orders_month).toBe(1000n); expect(p.limits.max_farmers).toBe(-1n);   // -1 = unlimited
  });
});

describe('Subscription', () => {
  it('subscribe starts active (quota applies) + sets a period + emits subscribed', () => {
    const s = sub('monthly');
    expect(s.status).toBe('active'); expect(grantsQuota(s.status)).toBe(true);
    expect(s.currentPeriodEnd.getTime()).toBeGreaterThan(NOW.getTime());
    expect(s.pullEvents().map((e) => e.type)).toContain(TenancyEventType.Subscribed);
  });
  it('changePlan switches plan + re-prices; rejects negative price', () => {
    const s = sub(); s.pullEvents();
    s.changePlan('pl2', 49900n);
    expect(s.toProps().planId).toBe('pl2'); expect(s.toProps().priceMinor).toBe(49900n);
    expect(s.pullEvents().map((e) => e.type)).toContain(TenancyEventType.PlanChanged);
    expect(() => s.changePlan('pl3', -1n)).toThrow(InvalidSubscriptionError);
  });
  it('cancel-now is terminal; cancel-at-period-end stays live; expire only after period end', () => {
    const a = sub(); a.cancel(false); expect(a.status).toBe('cancelled');
    expect(() => a.cancel(false)).toThrow(SubscriptionNotLiveError);
    const b = sub(); b.cancel(true); expect(b.status).toBe('active'); expect(b.toProps().cancelAtPeriodEnd).toBe(true);
    const c = sub('monthly'); c.pullEvents();
    expect(c.expire(NOW)).toBe(false);                                       // not yet due
    expect(c.expire(new Date(c.currentPeriodEnd.getTime() + 86400_000))).toBe(true);
    expect(c.status).toBe('expired');
  });
});
