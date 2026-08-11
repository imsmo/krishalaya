// modules/tenancy/__tests__/tenant1d2-plan-change-wiring.spec.ts · the call site that did not exist (PC-56 TENANT-1d-2).
//
// TENANT-1d built `domain/proration.ts` and migration 0126 and closed with the record "the money plane built". The plane was
// never CONNECTED: `prorate()` had exactly one caller in the whole monorepo — its own test — and the route the console posts
// to still swapped the price and billed nothing.
//
// **SO THIS SUITE IS MOSTLY GUARDS, BECAUSE THE VALUE-LEVEL TESTS ALREADY PASSED WHILE EVERY UPGRADE WAS FREE.**
// `tenant1d-proration.spec.ts` is a good suite: 15 mutants, 15 killed, the tax arithmetic pinned at bigint magnitudes. It
// could not see the defect, because a pure function is correct whether or not anything calls it. The guards below fail when
// the WIRING goes, which is the failure that actually happened.
import * as fs from 'fs';
import * as path from 'path';
import { PlanChangeService, addDays, isoDay } from '../services/plan-change.service';
import { BillingTaxRate, DEFAULT_TAX_BP } from '../read-models/billing-tax-rate';
import { prorate } from '../domain/proration';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
/** Comments have corrupted a batch of verdicts before (TENANT-1c). Every source guard scans CODE. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE WIRING                                                                                                        */
/* ---------------------------------------------------------------------------------------------------------------- */

describe('TENANT-1d-2 · the arithmetic has a caller in the application', () => {
  it('prorate() is called from a SERVICE, not only from a test', () => {
    // The exact check that would have caught the whole defect in one line.
    const svc = stripComments(read('services/plan-change.service.ts'));
    expect(svc).toContain('prorate(');
    expect(svc).toContain('limitBreaches(');
    expect(svc).toContain('changeIdempotencyKey(');
  });

  it('the free path is GONE from SubscriptionService, not merely bypassed', () => {
    // A second path that still compiles is a path something will call — the admin-api realm has its own operator-side
    // change, and a tenant-side one left in place would have been re-wired by the next person who found the route.
    const sub = stripComments(read('services/subscription.service.ts'));
    expect(sub).not.toMatch(/async changePlan\s*\(/);
  });

  it('the tenant route posts to PlanChangeService', () => {
    const ctl = stripComments(read('controllers/v1/subscriptions.controller.ts'));
    const change = ctl.slice(ctl.indexOf("@Post(':id/change-plan')"), ctl.indexOf("@Get(':id/plan-changes')"));
    expect(change).toContain('this.planChange.change(');
    expect(change).not.toContain('this.subscriptions.changePlan(');
  });

  it('the preview route is a GET — previewing must not be able to charge', () => {
    const ctl = stripComments(read('controllers/v1/subscriptions.controller.ts'));
    expect(ctl).toMatch(/@Get\(':id\/plan-preview'\)/);
    // W119: "No charge was made — proration always previews before any payment."
    const preview = ctl.slice(ctl.indexOf("@Get(':id/plan-preview')"), ctl.indexOf("@Post(':id/change-plan')"));
    expect(preview).toContain('this.planChange.preview(');
  });

  it('preview() writes nothing: no transaction, no insert, no invoice', () => {
    const svc = stripComments(read('services/plan-change.service.ts'));
    const fn = svc.slice(svc.indexOf('async preview('), svc.indexOf('async change('));
    for (const forbidden of ['uow.run(', 'insertChange(', 'raiseAndIssue(', 'setPending(', 'audit.write(']) {
      expect(fn).not.toContain(forbidden);
    }
  });

  it('the change is one transaction that invoices INSIDE it (Law 4)', () => {
    const svc = stripComments(read('services/plan-change.service.ts'));
    const fn = svc.slice(svc.indexOf('async change('), svc.indexOf('async history('));
    const tx = fn.indexOf('this.uow.run(');
    expect(tx).toBeGreaterThan(-1);
    // Every write happens after the transaction opens: the plan move, the invoice, the change row and the audit line.
    for (const inside of ['raiseAndIssue(', 'insertChange(', 'audit.write(', 'setPending(']) {
      expect(fn.indexOf(inside)).toBeGreaterThan(tx);
    }
  });

  it('the scheduled downgrade has a sweep that RUNS — a registered worker job, not an unregistered class', () => {
    // 0126's index comment calls itself "the worker's sweep" and there was no sweep. And the four api-side tenancy job
    // classes are registered nowhere, so a fifth would also never have run.
    const root = path.join(__dirname, '..', '..', '..', '..', '..');
    const registry = fs.readFileSync(path.join(root, 'worker', 'src', 'registry.ts'), 'utf8');
    // **THE ARRAY, NOT THE FILE.** The first version of this assertion searched the whole file and was satisfied by the
    // IMPORT line — so deleting the job from `JOBS` left the guard green and the sweep dead. That is the "count call sites,
    // not imports" lesson, on its own record, caught here by a mutation for the second time in this programme.
    const jobsArray = /export const JOBS: Job\[\] = \[([\s\S]*?)\];/.exec(registry)?.[1] ?? '';
    expect(jobsArray.length).toBeGreaterThan(0);
    expect(jobsArray).toContain('pendingPlanChangeJob');
    const job = fs.readFileSync(path.join(root, 'worker', 'src', 'jobs', 'pending-plan-change.job.ts'), 'utf8');
    const code = stripComments(job);
    // It must move the plan AND clear the pointer in one statement, or a re-run applies twice / a downgrade is lost.
    expect(code).toMatch(/SET plan_id = pending_plan_id[\s\S]*pending_plan_id = NULL/);
    expect(code).toContain('pending_plan_id IS NOT NULL');
    // And it must tell the tenant, because capability changing overnight without notice is how an FPO loses auctions.
    expect(code).toContain('tenancy.plan_change_applied');
  });

  it('no amount can be posted by a client', () => {
    const dto = stripComments(read('dto/create-subscription.dto.ts'));
    const schema = /export const ChangePlanSchema = z\.object\(\{([^}]*)\}\)/.exec(dto)?.[1] ?? '';
    expect(schema).toContain('planId');
    for (const money of ['minor', 'amount', 'total', 'price']) expect(schema.toLowerCase()).not.toContain(money);
    // `.strict()` is what refuses an unexpected field rather than ignoring it.
    expect(dto).toContain('.strict()');
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE BREACH WARNING HAD NO SOURCE OF TRUTH                                                                         */
/* ---------------------------------------------------------------------------------------------------------------- */

describe('TENANT-1d-2 · usage is counted live, not read from a counter nobody increments', () => {
  const repoSrc = () => stripComments(read('repositories/plan-change.repository.ts'));

  it('liveUsage counts roles, and does not touch usage_counters', () => {
    // `SubscriptionService.readUsage` reads `usage_counters`, and NOTHING calls `QuotaService.increment` for max_farmers or
    // max_staff — only warehouses, scheme applications and farming contracts consume quota. Using that table would have
    // returned {} and made W119's heads-up ("1,284 members and 7 staff — over Starter's limits") unprintable for ever.
    const fn = repoSrc().slice(repoSrc().indexOf('async liveUsage('), repoSrc().indexOf('async planLimits('));
    expect(fn).toContain('FROM user_tenant_roles');
    expect(fn).not.toContain('usage_counters');
    expect(fn).toContain('max_farmers');
    expect(fn).toContain('max_staff');
  });

  it('the service passes the LIVE usage into the breach check', () => {
    const svc = stripComments(read('services/plan-change.service.ts'));
    expect(svc).toContain('this.repo.liveUsage(');
    expect(svc).not.toContain('readUsage(');
  });

  it('a breach never blocks — the API keeps that decision in one named function', () => {
    const dom = stripComments(read('domain/proration.ts'));
    expect(dom).toContain('export function breachBlocksChange');
    // Dropping 784 members to enforce a price would destroy the register those members' payouts depend on.
    const fn = dom.slice(dom.indexOf('export function breachBlocksChange'));
    expect(fn).toMatch(/return false/);
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE TAX RATE                                                                                                      */
/* ---------------------------------------------------------------------------------------------------------------- */

describe('TENANT-1d-2 · the tax rate is read, and an unreadable one stops an invoice', () => {
  const rate = (rows: unknown[] | Error) => {
    const pools = {
      replica: () => ({
        query: async () => {
          if (rows instanceof Error) throw rows;
          return { rows } as never;
        },
      }),
    };
    return new BillingTaxRate(pools as never);
  };

  it('reads a platform override', async () => {
    const r = await rate([{ value: 700, is_default: false }]).current();
    expect(r).toEqual({ bp: 700, usedDefault: false, readFailed: false });
  });

  it('falls back to the shipped default when no override exists — normal, not an error', async () => {
    const r = await rate([{ value: '1800', is_default: true }]).current();
    expect(r.bp).toBe(DEFAULT_TAX_BP);
    expect(r.usedDefault).toBe(true);
    expect(r.readFailed).toBe(false);
  });

  it('a zero rate is honoured — a zero-rated jurisdiction is real', async () => {
    const r = await rate([{ value: 0, is_default: false }]).current();
    expect(r.bp).toBe(0);
    expect(r.readFailed).toBe(false);
  });

  it('a MISSING definition is a read failure, never a tax-free tenant', async () => {
    const r = await rate([]).current();
    expect(r.readFailed).toBe(true);
    expect(r.bp).toBe(DEFAULT_TAX_BP);
  });

  it.each([['nonsense'], [-1], [10_001], [null], [{}]])('a malformed rate (%p) is a read failure', async (bad) => {
    const r = await rate([{ value: bad, is_default: false }]).current();
    expect(r.readFailed).toBe(true);
  });

  it('a failure is NOT cached — the next read picks up a rate that has come back', async () => {
    // **THE MUTATION THAT FOUND THIS**: caching the failure passed a test that only asserted `readFailed` twice, because a
    // cached failure is still a failure. The property that matters is RECOVERY: a replica back after two seconds must not
    // leave the platform refusing upgrades for the rest of the minute.
    let attempt = 0;
    const pools = { replica: () => ({ query: async () => {
      attempt++;
      if (attempt === 1) throw new Error('replica down');
      return { rows: [{ value: 700, is_default: false }] } as never;
    } }) };
    const svc = new BillingTaxRate(pools as never);
    expect((await svc.current()).readFailed).toBe(true);
    const second = await svc.current();
    expect(second.readFailed).toBe(false);
    expect(second.bp).toBe(700);
  });

  it('a missing DEFINITION is reported as such, not as a malformed value', async () => {
    // Also a mutation: skipping the `!row` branch reaches the same refusal by a different route, so the verdict was
    // identical and the OPERATOR ADVICE was not — "0126 may not be applied" and "not a usable integer" send somebody to
    // different places. The distinction is the whole value of the log line, so it is asserted.
    const logged: string[] = [];
    const svc = rate([]);
    (svc as unknown as { log: { error(m: string): void } }).log = { error: (m: string) => { logged.push(m); } };
    const r = await svc.current();
    expect(r.readFailed).toBe(true);
    expect(logged.join(' ')).toContain('0126');
  });

  it('the service refuses to invoice an upgrade on an unreadable rate', () => {
    const svc = stripComments(read('services/plan-change.service.ts'));
    const fn = svc.slice(svc.indexOf('async change('), svc.indexOf('async history('));
    expect(fn).toContain('taxUnavailable');
    expect(fn).toContain('BILLING_TAX_RATE_UNAVAILABLE');
    // A downgrade bills nothing, so it may proceed: the refusal is scoped to the direction that raises an invoice.
    expect(fn).toMatch(/taxUnavailable[\s\S]{0,120}direction === 'upgrade'/);
  });
});

/* ---------------------------------------------------------------------------------------------------------------- */
/* THE MONEY ITSELF — W119's OWN INVOICE                                                                             */
/* ---------------------------------------------------------------------------------------------------------------- */

describe('TENANT-1d-2 · the invoice the screen prints', () => {
  const JULY = { periodStart: '2026-07-01', periodEnd: '2026-07-31', today: '2026-07-13', taxBp: 1800 };
  const GROWTH = 899900n; const PROFESSIONAL = 1999900n;

  it('the total is NOT the sum of the displayed rupee lines', () => {
    const p = prorate({ ...JULY, fromPriceMinor: GROWTH, toPriceMinor: PROFESSIONAL });
    // W119 prints ₹6,741 + ₹1,213 = ₹7,954, which is its own rounded lines added up.
    const displayed = BigInt(Math.floor(Number(p.netDueMinor) / 100) * 100) + BigInt(Math.floor(Number(p.taxMinor) / 100) * 100);
    expect(p.totalDueMinor).not.toBe(displayed);
    // The amount due is the paise total, and it is what the console renders.
    expect(p.totalDueMinor).toBe(p.netDueMinor + p.taxMinor);
  });

  it('an upgrade on the last day of a period still charges a day, not zero', () => {
    const p = prorate({ ...JULY, today: '2026-07-31', fromPriceMinor: GROWTH, toPriceMinor: PROFESSIONAL });
    expect(p.daysRemaining).toBe(1);
    expect(p.totalDueMinor > 0n).toBe(true);
  });

  it('a downgrade charges nothing and is scheduled for the day after the period ends', () => {
    const p = prorate({ ...JULY, fromPriceMinor: PROFESSIONAL, toPriceMinor: GROWTH });
    expect(p.direction).toBe('downgrade');
    expect(p.totalDueMinor).toBe(0n);
    expect(p.scheduled).toBe(true);
    expect(p.effectiveDate).toBe('2026-08-01');   // W119: "Downgrade takes effect 01 Aug"
  });
});

describe('TENANT-1d-2 · the invoice due date', () => {
  it('is 7 days out — W119: "invoiced on upgrade, due in 7 days"', () => {
    expect(addDays('2026-07-13', 7)).toBe('2026-07-20');
    const svc = stripComments(read('services/plan-change.service.ts'));
    expect(svc).toContain('const DUE_DAYS = 7');
    expect(svc).toContain('addDays(today, DUE_DAYS)');
  });

  it('crosses a month end correctly', () => {
    expect(addDays('2026-07-28', 7)).toBe('2026-08-04');
  });

  it('a malformed date is returned unchanged rather than becoming NaN', () => {
    expect(addDays('not-a-date', 7)).toBe('not-a-date');
  });

  it('isoDay takes the DATE, never the instant — a billing period is not a timestamp', () => {
    expect(isoDay(new Date('2026-07-13T23:45:00.000Z'))).toBe('2026-07-13');
    expect(isoDay('2026-07-13T00:00:00.000Z')).toBe('2026-07-13');
  });
});

describe('TENANT-1d-2 · the service exists and exposes the whole surface', () => {
  it('every method the console needs', () => {
    for (const m of ['preview', 'change', 'history', 'pending', 'cancelPending']) {
      expect(typeof (PlanChangeService.prototype as unknown as Record<string, unknown>)[m]).toBe('function');
    }
  });

  it('a replay returns the earlier row rather than raising a second invoice', () => {
    const svc = stripComments(read('services/plan-change.service.ts'));
    const fn = svc.slice(svc.indexOf('async change('), svc.indexOf('async history('));
    expect(fn).toContain('findByIdempotencyKey(');
    expect(fn).toContain('replayed: true');
    // The lookup happens BEFORE any write, or the second click would invoice and then discover the collision.
    expect(fn.indexOf('findByIdempotencyKey(')).toBeLessThan(fn.indexOf('raiseAndIssue('));
  });

  it('an upgrade clears any pending downgrade', () => {
    // Leaving it would drop the tenant to the old lower plan on the first of the month, days after they paid to move up.
    const svc = stripComments(read('services/plan-change.service.ts'));
    const fn = svc.slice(svc.indexOf("if (lines.direction === 'upgrade')"), svc.indexOf('} else {'));
    expect(fn).toContain('clearPending(');
  });
});
