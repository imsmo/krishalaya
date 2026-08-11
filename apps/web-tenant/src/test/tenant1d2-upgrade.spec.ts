// apps/web-tenant/src/test/tenant1d2-upgrade.spec.ts · W119's compare table and invoice panel (PC-56 TENANT-1d-2).
//
// The theme: **the screen and the invoice must never disagree**. Every case below is a number the page must refuse to
// invent — a total added up from rounded parts, a "0" where the canon prints "—", an "Upgrade now" button on a change that
// reduces the tenant's bill.
import * as fs from 'fs';
import * as path from 'path';
import type { ComparePlan, PlanChangePreview, PlanCompareView } from '@krishalaya/sdk-js';
import {
  actionLabel, breachSummary, canConfirm, directionOf, featureCell, invoiceRows, isUnlimited, limitCell,
  offerablePlans, pendingNotice, showsCustomPricingNotice, taxPct,
} from '../features/billing/upgrade';
import { en } from '../i18n/en';
import { hi } from '../i18n/hi';
import { gu } from '../i18n/gu';

const T = {
  t(key: string, vars?: Record<string, string | number>): string {
    const raw = (en as Record<string, string>)[key];
    if (raw === undefined) throw new Error(`missing i18n key: ${key}`);
    return raw.replace(/\{(\w+)\}/g, (_m, k) => String(vars?.[k] ?? ''));
  },
};

const plan = (over: Partial<ComparePlan> = {}): ComparePlan => ({
  id: 'p-growth', code: 'growth', name: 'Growth', monthlyPriceMinor: '899900', annualPriceMinor: '8999000',
  currencyCode: 'INR', isCurrent: false, limits: { max_farmers: '5000', max_staff: '10' },
  features: { auctions: true }, ...over,
});

const view = (over: Partial<PlanCompareView> = {}): PlanCompareView => ({
  plans: [
    plan({ id: 'p-starter', code: 'starter', name: 'Starter', monthlyPriceMinor: '299900', limits: { max_farmers: '500', max_staff: '2' }, features: {} }),
    plan({ isCurrent: true }),
    plan({ id: 'p-pro', code: 'professional', name: 'Professional', monthlyPriceMinor: '1999900', limits: { max_farmers: '25000', max_staff: '-1' }, features: { auctions: true, dairy: true } }),
  ],
  limitCodes: ['max_farmers', 'max_staff'],
  features: [{ code: 'auctions', name: 'Auctions & group lots' }, { code: 'dairy', name: 'Dairy module' }],
  current: {
    subscriptionId: 's1', planId: 'p-growth', planName: 'Growth', billingCycle: 'monthly',
    priceMinor: '899900', currencyCode: 'INR', periodStart: '2026-07-01', periodEnd: '2026-07-31', status: 'active',
  },
  usage: { max_farmers: '1284', max_staff: '7' },
  customPricing: false,
  pending: null,
  ...over,
});

const preview = (over: Partial<PlanChangePreview> = {}): PlanChangePreview => ({
  subscriptionId: 's1',
  fromPlan: { id: 'p-growth', code: 'growth', name: 'Growth', priceMinor: '899900' },
  toPlan: { id: 'p-pro', code: 'professional', name: 'Professional', priceMinor: '1999900' },
  currencyCode: 'INR', periodStart: '2026-07-01', periodEnd: '2026-07-31', today: '2026-07-13',
  taxBp: 1800, taxUsedDefault: true, taxUnavailable: false,
  lines: {
        direction: 'upgrade', daysInPeriod: 31, daysRemaining: 19,
        newPlanChargeMinor: '1225745', unusedCreditMinor: '551549', netDueMinor: '674196',
        taxMinor: '121355', totalDueMinor: '795551', effectiveDate: '2026-07-13', scheduled: false,
  },
  breaches: [],
  idempotencyKey: 'k1',
  ...over,
});

describe('TENANT-1d-2 · the compare table refuses to invent a cell', () => {
  it('an absent limit reads "—", never 0 — a quota of zero is a different claim from "not included"', () => {
    const p = plan({ limits: {} });
    expect(limitCell(p, 'max_farmers', T)).toEqual({ kind: 'absent', text: '—' });
  });

  it('-1 reads as Unlimited — W119 prints the word, not the number', () => {
    const p = plan({ limits: { max_staff: '-1' } });
    expect(isUnlimited('-1')).toBe(true);
    expect(limitCell(p, 'max_staff', T)).toEqual({ kind: 'unlimited', text: 'Unlimited' });
  });

  it('a real cap comes through as its number', () => {
    expect(limitCell(plan(), 'max_farmers', T)).toEqual({ kind: 'number', text: '5000' });
  });

  it('a feature is ✓ only when explicitly included', () => {
    expect(featureCell(plan({ features: { dairy: true } }), 'dairy')).toBe(true);
    expect(featureCell(plan({ features: { dairy: false } }), 'dairy')).toBe(false);
    expect(featureCell(plan({ features: {} }), 'dairy')).toBe(false);
  });

  it('the current plan is not offered as a change — the API refuses it', () => {
    const v = view();
    expect(offerablePlans(v).map((p) => p.id)).toEqual(['p-starter', 'p-pro']);
  });
});

describe('TENANT-1d-2 · direction is by PRICE, never by position in the table', () => {
  it('a higher-priced plan is an upgrade', () => {
    expect(directionOf(view(), plan({ id: 'p-pro', monthlyPriceMinor: '1999900' }))).toBe('upgrade');
  });

  it('a lower-priced plan is a downgrade', () => {
    expect(directionOf(view(), plan({ id: 'p-starter', monthlyPriceMinor: '299900' }))).toBe('downgrade');
  });

  it('AN ANCHOR TENANT MOVING TO A "HIGHER" PLAN IS GOING DOWN', () => {
    // ₹25,000 negotiated → list-price Professional at ₹19,999. A console reading the ladder would offer "Upgrade now" for a
    // change that reduces their bill, and the API would then schedule it — two screens disagreeing about one act.
    const v = view({ current: { ...view().current!, priceMinor: '2500000' } });
    expect(directionOf(v, plan({ id: 'p-pro', monthlyPriceMinor: '1999900' }))).toBe('downgrade');
    expect(actionLabel(directionOf(v, plan({ id: 'p-pro', monthlyPriceMinor: '1999900' })), T)).toBe('Schedule downgrade');
  });

  it('an annual subscription is compared against annual prices', () => {
    const v = view({ current: { ...view().current!, billingCycle: 'annual', priceMinor: '8999000' } });
    expect(directionOf(v, plan({ id: 'p-pro', annualPriceMinor: '19999000' }))).toBe('upgrade');
    // …and NOT against the monthly column, which would make every plan look like an upgrade.
    expect(directionOf(v, plan({ id: 'p-starter', monthlyPriceMinor: '299900', annualPriceMinor: '2999000' }))).toBe('downgrade');
  });

  it('an equal price is lateral, and gets neither promise', () => {
    expect(actionLabel(directionOf(view(), plan({ id: 'p-x', monthlyPriceMinor: '899900' })), T)).toBe('Switch plan');
  });

  it('the two labels are different sentences, because the acts are different', () => {
    expect(actionLabel('upgrade', T)).toBe('Upgrade now');
    expect(actionLabel('downgrade', T)).toBe('Schedule downgrade');
    expect(actionLabel('upgrade', T)).not.toBe(actionLabel('downgrade', T));
  });
});

describe('TENANT-1d-2 · the invoice panel', () => {
  it('shows charge, credit, net and tax as separate rows — W119 prints all four', () => {
    expect(invoiceRows(preview()).map((r) => r.key)).toEqual(['charge', 'credit', 'net', 'tax']);
  });

  it('the credit is a NEGATIVE row, not a smaller charge', () => {
    const credit = invoiceRows(preview()).find((r) => r.key === 'credit');
    expect(credit?.negative).toBe(true);
  });

  it('omits the credit row when there is none — an empty "−₹0" line is noise', () => {
    expect(invoiceRows(preview({ lines: { ...preview().lines, unusedCreditMinor: '0' } })).map((r) => r.key))
      .toEqual(['charge', 'net', 'tax']);
  });

  it('omits the tax row in a zero-rated jurisdiction', () => {
    expect(invoiceRows(preview({ taxBp: 0, lines: { ...preview().lines, taxMinor: '0' } })).map((r) => r.key))
      .toEqual(['charge', 'credit', 'net']);
  });

  it('a downgrade shows NO invoice rows at all — nothing is billed', () => {
    const p = preview({ lines: { ...preview().lines, direction: 'downgrade', scheduled: true, netDueMinor: '0', taxMinor: '0', totalDueMinor: '0' } });
    expect(invoiceRows(p)).toEqual([]);
  });

  it('THE TOTAL IS NOT THE SUM OF THE DISPLAYED ROWS', () => {
    // The page renders `totalDueMinor`; this asserts the two genuinely differ for the canon's own figures, so a future
    // "tidy-up" that sums the rows fails here rather than on a tenant's invoice.
    const p = preview();
    const rupeeSum = invoiceRows(p)
      .filter((r) => r.key === 'net' || r.key === 'tax')
      .reduce((n, r) => n + BigInt(Math.floor(Number(r.minor) / 100) * 100), 0n);
    expect(rupeeSum).not.toBe(BigInt(p.lines.totalDueMinor));
  });

  it('tax reads as a whole percent', () => {
    expect(taxPct(preview())).toBe(18);
    expect(taxPct(preview({ taxBp: 700 }))).toBe(7);
  });
});

describe('TENANT-1d-2 · the confirm button is refused BEFORE the click, not after', () => {
  it('an unreadable tax rate blocks an upgrade', () => {
    expect(canConfirm(preview({ taxUnavailable: true }))).toEqual({ ok: false, reason: 'tax_unavailable' });
  });

  it('an unreadable tax rate does NOT block a downgrade — nothing is billed', () => {
    const p = preview({ taxUnavailable: true, lines: { ...preview().lines, direction: 'downgrade', scheduled: true } });
    expect(canConfirm(p).ok).toBe(true);
  });

  it('a readable rate confirms', () => {
    expect(canConfirm(preview()).ok).toBe(true);
  });

  it('the block mirrors the API rule exactly', () => {
    // Two implementations of one rule is how a console offers a button the backend refuses. This asserts the console's
    // copy is scoped to `direction === 'upgrade'` just as the service's is.
    const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'billing', 'upgrade.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function canConfirm'));
    expect(fn).toMatch(/taxUnavailable[\s\S]{0,80}direction === 'upgrade'/);
  });
});

describe('TENANT-1d-2 · the limit heads-up warns and never blocks', () => {
  it('reports the breached codes', () => {
    const b = breachSummary([
      { limitCode: 'max_farmers', limitValue: '500', currentUsage: '1284' },
      { limitCode: 'max_staff', limitValue: '2', currentUsage: '7' },
    ]);
    expect(b).toEqual({ any: true, codes: ['max_farmers', 'max_staff'] });
  });

  it('no breach is a quiet screen, not an empty warning box', () => {
    expect(breachSummary([]).any).toBe(false);
  });

  it('nothing in the module can prevent a change', () => {
    // W119: "Existing members are never removed; you just can't add more until within limits." A console that disabled the
    // button would be enforcing a price against a register 1,284 farmers' payouts depend on.
    const src = fs.readFileSync(path.join(__dirname, '..', 'features', 'billing', 'upgrade.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export function breachSummary'), src.indexOf('export function orderedLimitCodes'));
    expect(fn).not.toMatch(/blocked|disabled|refuse/i);
  });
});

describe('TENANT-1d-2 · the two states W119 names', () => {
  it('a negotiated price shows the custom-plan notice', () => {
    expect(showsCustomPricingNotice(view({ customPricing: true }))).toBe(true);
    expect(showsCustomPricingNotice(view())).toBe(false);
  });

  it('a scheduled change is surfaced before another is offered', () => {
    const v = view({ pending: { planId: 'p-starter', planName: 'Starter', priceMinor: '299900', effectiveDate: '2026-08-01', reason: 'cost' } });
    expect(pendingNotice(v)).toEqual({ planName: 'Starter', effectiveDate: '2026-08-01', reason: 'cost' });
    expect(pendingNotice(view())).toBeNull();
  });
});

describe('TENANT-1d-2 · the three catalogues stay in step', () => {
  it('every upg.* key exists in Hindi and Gujarati', () => {
    const keys = Object.keys(en as Record<string, string>).filter((k) => k.startsWith('upg.'));
    expect(keys.length).toBeGreaterThan(50);
    // A money screen falling back to English is a co-operative being asked to approve a charge in a language they do not read.
    expect(keys.filter((k) => !(k in hi))).toEqual([]);
    expect(keys.filter((k) => !(k in gu))).toEqual([]);
  });

  it('every message that follows a failure says whether money moved', () => {
    for (const k of ['upg.error.generic', 'upg.error.invalid', 'upg.error.unavailable', 'upg.error.taxUnavailable', 'upg.prorationError']) {
      const s = (en as Record<string, string>)[k];
      expect(s.toLowerCase()).toMatch(/nothing was charged|no charge was made/);
    }
  });
});

describe('TENANT-1d-2 · /billing no longer changes a plan without a preview', () => {
  it('the plan cards link to the preview instead of posting a change', () => {
    // The card used to post `changePlanAction`, which was harmless while a change billed nothing. Now that it raises a real
    // invoice, a one-click change would charge a tenant an amount they had never been shown.
    const page = fs.readFileSync(path.join(__dirname, '..', 'app', 'billing', 'page.tsx'), 'utf8');
    expect(page).toContain('/billing/upgrade?planId=');
    expect(page).not.toContain('changePlanAction');
    const actions = fs.readFileSync(path.join(__dirname, '..', 'app', 'billing', 'actions.ts'), 'utf8');
    expect(actions).not.toMatch(/export async function changePlanAction/);
  });
});
