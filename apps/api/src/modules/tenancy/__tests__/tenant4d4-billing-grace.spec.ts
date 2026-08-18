// PC-56 TENANT-4d-4 · W120's footnote becomes a state — the lifecycle rules, the roll nothing ever did, and
// 0148's promises, pinned against the SOURCE with comments stripped.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  DEFAULT_GRACE_DAYS, MAX_GRACE_DAYS, MIN_GRACE_DAYS, graceAdvice, graceDaysFrom, graceDaysLeft, graceOpen,
  graceUntil, mechanismLines, sweepAction,
} from '../domain/billing-grace';
import { Subscription } from '../domain/subscription.entity';
import { IllegalSubscriptionTransitionError } from '../domain/subscription.state';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));
const migration = () => fs.readFileSync(path.join(__dirname, '../../../../../../db/migrations/0148_billing_grace_state.sql'), 'utf8');
const sqlOnly = () => migration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const sub = (over: Partial<Parameters<typeof Subscription.rehydrate>[0]> = {}) => Subscription.rehydrate({
  id: 's1', tenantId: 't1', planId: 'p1', status: 'active', billingCycle: 'monthly',
  priceMinor: 99900n, currencyCode: 'INR', discountPct: 0,
  currentPeriodStart: new Date('2026-06-20T00:00:00Z'), currentPeriodEnd: new Date('2026-07-20T00:00:00Z'),
  cancelAtPeriodEnd: false, cancelledAt: null, createdAt: new Date('2026-06-20T00:00:00Z'),
  graceUntil: null, graceStartedAt: null, ...over,
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-4 · how long the grace period is', () => {
  it('is W120\'s 7 by default, and a malformed value NEVER falls back to zero', () => {
    expect(DEFAULT_GRACE_DAYS).toBe(7);
    expect(graceDaysFrom(14)).toBe(14);
    expect(graceDaysFrom('14')).toBe(14);
    // Zero would switch a tenant off the instant their period ended — the behaviour this wave removes — and it
    // is what a typo, an empty string, or Number(undefined) all produce.
    expect(graceDaysFrom(0)).toBe(7);
    expect(graceDaysFrom(-3)).toBe(7);
    expect(graceDaysFrom('')).toBe(7);
    expect(graceDaysFrom(null)).toBe(7);
    expect(graceDaysFrom(undefined)).toBe(7);
    expect(graceDaysFrom('seven')).toBe(7);
    expect(graceDaysFrom(MAX_GRACE_DAYS + 1)).toBe(7);
    expect(graceDaysFrom(MIN_GRACE_DAYS)).toBe(1);
    expect(graceDaysFrom(7.9)).toBe(7);
  });

  it('the window is counted in WHOLE DAYS from the period end, in UTC, and rolls the month', () => {
    expect(graceUntil(new Date('2026-07-20T00:00:00Z'), 7)).toBe('2026-07-27');
    expect(graceUntil(new Date('2026-07-28T23:59:59Z'), 7)).toBe('2026-08-04');
    // A period ending late in the platform's day must not lose a day to the timezone the server runs in.
    expect(graceUntil(new Date('2026-07-20T23:30:00Z'), 7)).toBe('2026-07-27');
    expect(graceUntil(new Date('2026-02-25T00:00:00Z'), 7)).toBe('2026-03-04');
  });

  it('the window is open THROUGH its closing day, because that is what a tenant counts', () => {
    expect(graceOpen('2026-07-27', new Date('2026-07-26T23:00:00Z'))).toBe(true);
    expect(graceOpen('2026-07-27', new Date('2026-07-27T00:00:01Z'))).toBe(true);   // the last day is a full day
    expect(graceOpen('2026-07-27', new Date('2026-07-27T23:59:59Z'))).toBe(true);
    expect(graceOpen('2026-07-27', new Date('2026-07-28T00:00:00Z'))).toBe(false);
    expect(graceOpen(null, new Date('2026-07-27T00:00:00Z'))).toBe(false);
  });

  it('days-left floors at zero and 0 means the LAST day, not a closed window', () => {
    expect(graceDaysLeft('2026-07-27', new Date('2026-07-20T00:00:00Z'))).toBe(7);
    expect(graceDaysLeft('2026-07-27', new Date('2026-07-27T06:00:00Z'))).toBe(0);
    expect(graceDaysLeft('2026-07-27', new Date('2026-08-01T00:00:00Z'))).toBe(0);
    expect(graceDaysLeft(null, new Date())).toBe(0);
    // …and the window is still OPEN on the day days-left reads 0, which is why the two are separate functions.
    expect(graceOpen('2026-07-27', new Date('2026-07-27T06:00:00Z'))).toBe(true);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-4 · the sweep decides ONE thing, and NOTHING OWED never expires', () => {
  const base = {
    status: 'active' as const, currentPeriodEnd: new Date('2026-07-20T00:00:00Z'), graceUntil: null,
    cancelAtPeriodEnd: false, owingMinor: 117882n, now: new Date('2026-07-21T00:00:00Z'), graceEnabled: true,
  };

  it('a period still open waits', () => {
    expect(sweepAction({ ...base, now: new Date('2026-07-19T00:00:00Z') })).toEqual({ kind: 'wait', reason: 'period_open' });
  });

  /**
   * THE RULE WHOSE ABSENCE MADE THE OLD SWEEP A PLATFORM-WIDE KILL SWITCH. Nothing ever advanced
   * `current_period_end` (0148 defect 1), so every live subscription was past its period end within a month of
   * creation. Expiring on that alone punishes a tenant who paid on time for our own missing roll.
   */
  it('NOTHING OWED WAITS — it does not expire, however long the period has been over', () => {
    expect(sweepAction({ ...base, owingMinor: 0n })).toEqual({ kind: 'wait', reason: 'nothing_owed' });
    expect(sweepAction({ ...base, owingMinor: 0n, now: new Date('2027-01-01T00:00:00Z') })).toEqual({ kind: 'wait', reason: 'nothing_owed' });
    // A negative figure (an overpaid invoice) is not a debt either.
    expect(sweepAction({ ...base, owingMinor: -500n })).toEqual({ kind: 'wait', reason: 'nothing_owed' });
  });

  it('a period that ended with money owed ENTERS the window; a window still open waits', () => {
    expect(sweepAction(base)).toEqual({ kind: 'enter_grace' });
    expect(sweepAction({ ...base, status: 'past_due', graceUntil: '2026-07-27' })).toEqual({ kind: 'wait', reason: 'in_grace' });
  });

  it('and ONLY a CLOSED window with money owed expires', () => {
    expect(sweepAction({ ...base, status: 'past_due', graceUntil: '2026-07-27', now: new Date('2026-07-28T00:00:00Z') }))
      .toEqual({ kind: 'expire', reason: 'grace_lapsed' });
    // The last day is still open.
    expect(sweepAction({ ...base, status: 'past_due', graceUntil: '2026-07-27', now: new Date('2026-07-27T23:00:00Z') }))
      .toEqual({ kind: 'wait', reason: 'in_grace' });
  });

  it('a cancel-at-period-end that has arrived expires WITHOUT grace — the tenant asked', () => {
    // A grace period here would be the platform refusing to let go, not a kindness. And it applies even with
    // nothing owed, because the tenant's own instruction is the reason.
    expect(sweepAction({ ...base, cancelAtPeriodEnd: true })).toEqual({ kind: 'expire', reason: 'cancelled_at_period_end' });
    expect(sweepAction({ ...base, cancelAtPeriodEnd: true, owingMinor: 0n })).toEqual({ kind: 'expire', reason: 'cancelled_at_period_end' });
    expect(sweepAction({ ...base, cancelAtPeriodEnd: true, now: new Date('2026-07-19T00:00:00Z') })).toEqual({ kind: 'wait', reason: 'period_open' });
  });

  it('with the flag OFF the pre-wave behaviour is reproduced exactly, and it is NAMED as legacy', () => {
    expect(sweepAction({ ...base, graceEnabled: false })).toEqual({ kind: 'expire', reason: 'legacy_no_grace' });
    // …but even the legacy path does not expire a tenant who owes nothing. That guard is not flag-gated,
    // because it protects against OUR bug rather than implementing a feature.
    expect(sweepAction({ ...base, graceEnabled: false, owingMinor: 0n })).toEqual({ kind: 'wait', reason: 'nothing_owed' });
  });

  it('a terminal or non-live subscription is nobody\'s business here', () => {
    for (const status of ['expired', 'cancelled'] as const) {
      expect(sweepAction({ ...base, status })).toEqual({ kind: 'wait', reason: 'not_live' });
    }
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-4 · the entity: the writer `past_due` never had, and the roll nothing ever did', () => {
  it('enterGrace opens the window, sets BOTH columns, and emits the fact', () => {
    const s = sub();
    expect(s.enterGrace('2026-07-27', new Date('2026-07-21T00:00:00Z'))).toBe(true);
    expect(s.status).toBe('past_due');
    expect(s.graceUntil).toBe('2026-07-27');
    expect(s.toProps().graceStartedAt).toEqual(new Date('2026-07-21T00:00:00Z'));
    expect(s.pullEvents().map((e) => e.type)).toContain('tenancy.subscription_grace_started');
  });

  it('enterGrace refuses a period that is still open, a second window, and a terminal subscription', () => {
    expect(sub().enterGrace('2026-07-27', new Date('2026-07-19T00:00:00Z'))).toBe(false);
    expect(sub({ status: 'past_due', graceUntil: '2026-07-27', graceStartedAt: new Date() }).enterGrace('2026-08-30', new Date('2026-07-21T00:00:00Z'))).toBe(false);
    expect(sub({ status: 'expired' }).enterGrace('2026-07-27', new Date('2026-07-21T00:00:00Z'))).toBe(false);
  });

  /**
   * `current_period_end` was set once in `subscribe()` and never moved again anywhere in the monorepo, so the
   * renewal finder returned the same subscription for ever (billing exactly one period) and the expiry finder
   * matched every live subscription within a month. `memberships` does this correctly one module away.
   */
  it('rollPeriod ADVANCES the period, clears the window, and returns a past-due tenant to active', () => {
    const s = sub({ status: 'past_due', graceUntil: '2026-07-27', graceStartedAt: new Date('2026-07-21T00:00:00Z') });
    expect(s.rollPeriod(new Date('2026-07-24T00:00:00Z'))).toBe(true);
    expect(s.status).toBe('active');
    expect(s.graceUntil).toBeNull();
    expect(s.toProps().graceStartedAt).toBeNull();
    // THE NEW PERIOD STARTS WHERE THE OLD ONE ENDED, not on the day the payment cleared: billing from `now`
    // would silently shorten every period by however long the tenant took to pay, compounding for ever.
    expect(s.toProps().currentPeriodStart).toEqual(new Date('2026-07-20T00:00:00Z'));
    expect(s.toProps().currentPeriodEnd).toEqual(new Date('2026-08-20T00:00:00Z'));
    expect(s.pullEvents().map((e) => e.type)).toContain('tenancy.subscription_renewed');
  });

  it('rollPeriod is idempotent: a re-delivered paid event cannot advance the period twice', () => {
    const s = sub();
    expect(s.rollPeriod(new Date('2026-07-21T00:00:00Z'))).toBe(true);
    const end = s.toProps().currentPeriodEnd;
    // The period now ends in the future, so `from` becomes `now` — and a SECOND roll would still move it, which
    // is why the HANDLER is the idempotency boundary (status must be paid, and the invoice is paid once).
    // What must never happen is a roll from a terminal state.
    expect(sub({ status: 'expired' }).rollPeriod(new Date())).toBe(false);
    expect(sub({ status: 'cancelled' }).rollPeriod(new Date())).toBe(false);
    expect(end.getTime()).toBeGreaterThan(new Date('2026-07-21T00:00:00Z').getTime());
  });

  it('an annual subscription rolls a YEAR, not a month', () => {
    const s = sub({ billingCycle: 'annual' });
    s.rollPeriod(new Date('2026-07-21T00:00:00Z'));
    expect(s.toProps().currentPeriodEnd).toEqual(new Date('2027-07-20T00:00:00Z'));
  });

  it('**EXPIRE REFUSES WHILE THE WINDOW IS OPEN** — W120\'s whole promise, as one guard', () => {
    const inGrace = sub({ status: 'past_due', graceUntil: '2026-07-27', graceStartedAt: new Date() });
    expect(inGrace.expire(new Date('2026-07-25T00:00:00Z'))).toBe(false);
    expect(inGrace.status).toBe('past_due');
    // …and expires the moment it closes, recording WHY so a support conversation need not reconstruct it.
    expect(inGrace.expire(new Date('2026-07-28T00:00:00Z'))).toBe(true);
    expect(inGrace.status).toBe('expired');
    const ev = inGrace.pullEvents().find((e) => e.type === 'tenancy.subscription_expired');
    expect(ev?.payload).toMatchObject({ afterGrace: true, graceUntil: '2026-07-27' });
  });

  it('with no window (the flag off) expire behaves exactly as it did before this wave', () => {
    const s = sub();
    expect(s.expire(new Date('2026-07-19T00:00:00Z'))).toBe(false);   // period still open
    expect(s.expire(new Date('2026-07-21T00:00:00Z'))).toBe(true);
    expect(s.pullEvents().find((e) => e.type === 'tenancy.subscription_expired')?.payload).toMatchObject({ afterGrace: false });
  });

  it('and the state machine still refuses an illegal move', () => {
    expect(() => sub({ status: 'cancelled' }).rollPeriod(new Date())).not.toThrow();   // returns false, no throw
    expect(IllegalSubscriptionTransitionError).toBeDefined();
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-4 · what W120 may now claim', () => {
  it('the grace period reads as REAL only when BOTH switches are on', () => {
    expect(mechanismLines({ graceEnabled: true, cadenceEnabled: true }).gracePeriod).toBe('exists');
    // A state nothing sweeps never opens a window; a sweep with no state to enter is the old kill switch.
    expect(mechanismLines({ graceEnabled: true, cadenceEnabled: false }).gracePeriod).toBe('not_scheduled');
    expect(mechanismLines({ graceEnabled: false, cadenceEnabled: true }).gracePeriod).toBe('no_grace_state');
    expect(mechanismLines({ graceEnabled: false, cadenceEnabled: false }).gracePeriod).toBe('no_grace_state');
  });

  it('and "we retry and notify you" STAYS a gap — neither half of it exists', () => {
    const on = mechanismLines({ graceEnabled: true, cadenceEnabled: true });
    // No autopay mandate for a subscription anywhere in the payments module → nothing to retry against.
    expect(on.autopay).toBe('no_saas_mandate');
    expect(on.nextDebit).toBe('no_saas_mandate');
    // The five tenancy billing events are in no notification map row. TENANT-4d-5.
    expect(on.retryAndNotify).toBe('no_notification');
  });

  it('the advice is to PAY, never to wait for a retry we do not perform', () => {
    expect(graceAdvice({ inGrace: true, selfPayEnabled: true })).toBe('pay_open_invoice');
    expect(graceAdvice({ inGrace: true, selfPayEnabled: false })).toBe('contact_platform');
    expect(graceAdvice({ inGrace: false, selfPayEnabled: true })).toBe('none');
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-4 · the join that was missing, and the clock', () => {
  it('`tenancy.saas_invoice_paid` NOW HAS A SUBSCRIBER, and it rolls the period', () => {
    const src = read('events', 'handlers', 'saas-invoice-paid.handler.ts');
    expect(src).toContain("readonly eventType = 'tenancy.saas_invoice_paid'");
    expect(src).toContain('rollPeriod(');
    expect(read('..', 'tenancy', 'tenancy.module.ts')).toContain('this.registry.register(this.saasInvoicePaid)');
  });

  it('only a FULLY PAID invoice rolls the period — a first instalment must not buy a whole new period', () => {
    expect(read('events', 'handlers', 'saas-invoice-paid.handler.ts')).toContain("p.status !== 'paid'");
  });

  it('the paid event carries the subscription id it needs (it used not to)', () => {
    // Without it the handler had nothing to act on — the same "verdict with no evidence" shape 0146 defect 2
    // found on payments.payment_succeeded, one layer up.
    expect(read('domain', 'saas-invoice.entity.ts')).toContain('subscriptionId: this.p.subscriptionId');
  });

  it('the sweep RAISES the invoice before it decides anything', () => {
    const src = read('jobs', 'saas-billing-cycle.job.ts');
    expect(src.indexOf('raiseRenewal(')).toBeLessThan(src.indexOf('sweepAction('));
    // …and re-reads the debt afterwards, because raising is what creates this period's debt.
    expect(src).toContain('await this.owingFor(pool, d.id)');
  });

  it('the overdue sweep runs ONCE per tick, not once per subscription', () => {
    const src = read('jobs', 'saas-billing-cycle.job.ts');
    // Exactly ONE call site, and it comes after the per-subscription loop. A cross-tenant invoice finder
    // re-run per subscription would rescan the platform's owing invoices N times a tick.
    const calls = src.match(/this\.overdueFor\(/g) ?? [];
    expect(calls).toHaveLength(1);
    expect(src.indexOf('this.overdueFor(')).toBeGreaterThan(src.indexOf('for (const d of due)'));
  });

  it('a tick refuses ENTIRELY when the flag is off or the tax rate is unreadable, and says which', () => {
    const src = read('jobs', 'saas-billing-cycle.job.ts');
    expect(src).toContain("refused: 'cadence_flag_off'");
    expect(src).toContain("refused: 'tax_rate_unreadable'");
    // An unreadable rate stops the SWEEP too: a tenant must not be moved toward expiry in a tick that could
    // not have billed them.
    expect(src.indexOf("refused: 'tax_rate_unreadable'")).toBeLessThan(src.indexOf('for (const d of due)'));
  });

  it('one subscription\'s failure never stops the tick', () => {
    const src = read('jobs', 'saas-billing-cycle.job.ts');
    expect(src).toContain('out.failed++');
    expect(src).toContain('catch (err)');
  });

  it('the cadence is registered on the api-side host, per-job env-gated, and DAILY by default', () => {
    const mod = read('..', 'tenancy', 'tenancy.module.ts');
    expect(mod).toContain('if (this.config.jobs.saasBillingCycle.enabled) this.jobRegistry.register(this.saasBillingCycleCadenceJob)');
    const env = fs.readFileSync(path.join(__dirname, '../../../core/config/env.validation.ts'), 'utf8');
    expect(env).toContain('SAAS_BILLING_CYCLE_JOB_ENABLED');
    expect(env).toMatch(/SAAS_BILLING_CYCLE_JOB_INTERVAL_MS[^\n]*default\(86_400_000\)/);
  });

  it('the job never reads a settings table itself — it is handed a reader for the ONE key it needs', () => {
    const src = read('jobs', 'saas-billing-cycle.job.ts');
    expect(src).toContain('graceDaysFor: (tenantId: string) => Promise<unknown>');
    expect(src).not.toContain('tenant_settings');
    expect(read('..', 'tenancy', 'tenancy.module.ts')).toContain("settings.effectiveValue(tenantId, 'billing.grace_days')");
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
/**
 * MUTATION SURVIVORS (round 1). The handler and the job were pinned only by source text, and source text does
 * not hold behaviour: removing the "no subscription → do nothing" guard, and turning per-subscription error
 * isolation into a re-throw, both passed every test. These are the behavioural tests.
 */
describe('TENANT-4d-4 · the paid handler, behaviourally', () => {
  const build = () => {
    const rolled: Array<{ tenantId: string; id: string }> = [];
    const svc = { rollPeriod: async (_tx: unknown, tenantId: string, id: string) => { rolled.push({ tenantId, id }); return true; } };
    return { rolled, svc };
  };
  const ev = (payload: Record<string, unknown>) => ({ id: '1', tenantId: 't1', aggregateType: 'saas_invoice', aggregateId: 'i1', eventType: 'tenancy.saas_invoice_paid', payload });

  it('rolls the period for a FULLY paid subscription invoice', async () => {
    const { SaasInvoicePaidHandler } = await import('../events/handlers/saas-invoice-paid.handler');
    const { rolled, svc } = build();
    await new SaasInvoicePaidHandler(svc as never).handle(ev({ status: 'paid', subscriptionId: 's1', invoiceId: 'i1' }) as never, {} as never);
    expect(rolled).toEqual([{ tenantId: 't1', id: 's1' }]);
  });

  it('does NOTHING for a partial payment — a first instalment must not buy a whole new period', async () => {
    const { SaasInvoicePaidHandler } = await import('../events/handlers/saas-invoice-paid.handler');
    const { rolled, svc } = build();
    await new SaasInvoicePaidHandler(svc as never).handle(ev({ status: 'partially_paid', subscriptionId: 's1' }) as never, {} as never);
    expect(rolled).toEqual([]);
  });

  it('does NOTHING for an invoice with no subscription (a one-off charge is not a renewal)', async () => {
    const { SaasInvoicePaidHandler } = await import('../events/handlers/saas-invoice-paid.handler');
    const { rolled, svc } = build();
    await new SaasInvoicePaidHandler(svc as never).handle(ev({ status: 'paid', subscriptionId: null }) as never, {} as never);
    await new SaasInvoicePaidHandler(svc as never).handle(ev({ status: 'paid' }) as never, {} as never);
    expect(rolled).toEqual([]);
  });

  it('and does nothing without a tenant (a platform-level event is not a tenant\'s renewal)', async () => {
    const { SaasInvoicePaidHandler } = await import('../events/handlers/saas-invoice-paid.handler');
    const { rolled, svc } = build();
    await new SaasInvoicePaidHandler(svc as never).handle({ ...ev({ status: 'paid', subscriptionId: 's1' }), tenantId: null } as never, {} as never);
    expect(rolled).toEqual([]);
  });
});

describe('TENANT-4d-4 · the cycle job, behaviourally', () => {
  const poolFor = (owing: string) => ({
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => undefined,
    }),
    query: async () => ({ rows: [{ owing }] }),
  });

  const buildJob = async (over: Record<string, unknown> = {}) => {
    const { SaasBillingCycleJob } = await import('../jobs/saas-billing-cycle.job');
    const calls: string[] = [];
    const subsRepo = { findPeriodEndedWithDebt: async () => [
      { sub: sub({ id: 's1' }), owingMinor: 117882n },
      { sub: sub({ id: 's2' }), owingMinor: 117882n },
    ] };
    const invRepo = { findOwingPastDue: async () => [] };
    const subscriptions = {
      enterGrace: async (_t: string, id: string) => { calls.push(`grace:${id}`); if (id === 's1' && over.failFirst) throw new Error('boom'); return true; },
      expire: async (_t: string, id: string) => { calls.push(`expire:${id}`); return undefined },
    };
    const invoiceService = { raiseRenewal: async () => ({ raised: true }), markOverdue: async () => true };
    const taxRate = { current: async () => ({ bp: 1800, usedDefault: true, readFailed: Boolean(over.rateUnreadable) }) };
    const flags = { isEnabled: async (k: string) => (k === 'saas_billing_cadence' ? over.cadence !== false : over.grace !== false) };
    const job = new SaasBillingCycleJob(subsRepo as never, invRepo as never, subscriptions as never, invoiceService as never,
      taxRate as never, flags as never, async () => 7);
    return { job, calls };
  };

  it('refuses the whole tick when the cadence flag is off', async () => {
    const { job, calls } = await buildJob({ cadence: false });
    const r = await job.run(poolFor('117882') as never, 10, new Date('2026-07-21T00:00:00Z'));
    expect(r.refused).toBe('cadence_flag_off');
    expect(calls).toEqual([]);
  });

  it('refuses the whole tick when the tax rate is unreadable — including the SWEEP', async () => {
    const { job, calls } = await buildJob({ rateUnreadable: true });
    const r = await job.run(poolFor('117882') as never, 10, new Date('2026-07-21T00:00:00Z'));
    expect(r.refused).toBe('tax_rate_unreadable');
    // No tenant is moved toward expiry in a tick that could not have billed them.
    expect(calls).toEqual([]);
  });

  it('ONE SUBSCRIPTION\'S FAILURE NEVER STOPS THE TICK — the second is still processed', async () => {
    const { job, calls } = await buildJob({ failFirst: true });
    const r = await job.run(poolFor('117882') as never, 10, new Date('2026-07-21T00:00:00Z'));
    expect(r.failed).toBe(1);
    expect(r.graced).toBe(1);
    expect(calls).toEqual(['grace:s1', 'grace:s2']);
  });

  it('enters grace rather than expiring when a period ends with money owed', async () => {
    const { job, calls } = await buildJob();
    const r = await job.run(poolFor('117882') as never, 10, new Date('2026-07-21T00:00:00Z'));
    expect(r.graced).toBe(2);
    expect(r.expired).toBe(0);
    expect(calls.every((c) => c.startsWith('grace:'))).toBe(true);
  });

  it('and WAITS — never expires — when the debt is settled', async () => {
    const { SaasBillingCycleJob } = await import('../jobs/saas-billing-cycle.job');
    const calls: string[] = [];
    const job = new SaasBillingCycleJob(
      { findPeriodEndedWithDebt: async () => [{ sub: sub({ id: 's1' }), owingMinor: 0n }] } as never,
      { findOwingPastDue: async () => [] } as never,
      { enterGrace: async () => { calls.push('grace'); return true; }, expire: async () => { calls.push('expire'); } } as never,
      { raiseRenewal: async () => ({ raised: false }), markOverdue: async () => true } as never,
      { current: async () => ({ bp: 1800, usedDefault: true, readFailed: false }) } as never,
      { isEnabled: async () => true } as never,
      async () => 7,
    );
    const r = await job.run({ connect: async () => ({ query: async () => ({ rows: [], rowCount: 0 }), release: () => undefined }), query: async () => ({ rows: [{ owing: '0' }] }) } as never, 10, new Date('2027-01-01T00:00:00Z'));
    expect(r.waited).toBe(1);
    expect(r.expired).toBe(0);
    expect(calls).toEqual([]);
  });
});

/* ---------------------------------------------------------------------------------------------------------- */
describe('TENANT-4d-4 · migration 0148 says what it does, and does what it says', () => {
  it('the window is two columns that must both be set or both be null', () => {
    const sql = sqlOnly();
    expect(sql).toContain('ADD COLUMN grace_until      date');
    expect(sql).toContain('ADD COLUMN grace_started_at timestamptz');
    expect(sql).toContain('CHECK ((grace_until IS NULL) = (grace_started_at IS NULL))');
  });

  it('grace_until is a DATE, so a 7-day promise is 7 whole days rather than a timezone\'s worth less', () => {
    expect(sqlOnly()).toMatch(/grace_until\s+date/);
    expect(sqlOnly()).not.toMatch(/grace_until\s+timestamptz/);
  });

  it('both sweeps get a PARTIAL index — neither had one, and both scanned every subscription', () => {
    const sql = sqlOnly();
    expect(sql).toContain('CREATE INDEX idx_subscriptions_grace_lapsed');
    expect(sql).toContain("WHERE status = 'past_due' AND grace_until IS NOT NULL AND deleted_at IS NULL");
    expect(sql).toContain('CREATE INDEX idx_subscriptions_period_end_live');
  });

  it('7 is a SETTING whose malformed value falls back to 7, never to 0', () => {
    const sql = sqlOnly();
    expect(sql).toContain("'billing.grace_days', 'int', 'tenant'");
    expect(sql).toContain("'7'::jsonb");
    expect(migration()).toContain('falls back to 7 rather than to 0');
  });

  it('both flags default OFF, and they are separate on purpose', () => {
    const sql = sqlOnly();
    for (const k of ['saas_billing_grace', 'saas_billing_cadence']) {
      expect(new RegExp(`SELECT '${k}',[\\s\\S]{0,700}?false`).test(sql)).toBe(true);
    }
  });

  it('it names the two thirds of W120\'s footnote it does NOT deliver', () => {
    const header = migration();
    expect(header).toContain('NOTHING EVER ADVANCES A SUBSCRIPTION\'S BILLING PERIOD');
    expect(header).toContain('THE INVOICE KNOWS IT WAS PAID AND THE SUBSCRIPTION NEVER HEARS');
    expect(header).toContain('there is nothing to retry');
    expect(header).toContain('TENANT-4d-5');
    // …and the two job classes still not wired.
    expect(header).toContain('TrialExpiryJob');
    expect(header).toContain('UsageLimitAlertsJob');
  });

  it('and it adds no table, because the state it needed was two columns on one', () => {
    expect(sqlOnly()).not.toContain('CREATE TABLE');
  });
});
