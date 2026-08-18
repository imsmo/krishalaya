// PC-56 TENANT-4d-1 · W118's meters and W115's cards — the console rules, and the page's own promises pinned
// against its source (comments stripped, so a promise in a comment cannot pass a test).
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  METER_ORDER, annualSavingMinor, barPct, hasAnnualSaving, limitLabelKey, limitsApplyKey, memberLimitOf,
  meterBadgeKey, needsAttention, noticeRuleKey, projectedMonth, projectionKey, refusalKey, showsBar, verdictKey,
} from '../features/billing/usage';

const card = (over: Partial<Parameters<typeof annualSavingMinor>[0]> = {}) => ({
  code: 'growth', version: 3, name: 'Growth', monthlyPriceMinor: '899900', annualPriceMinor: '8999000',
  currencyCode: 'INR', limits: { max_farmers: 5000 }, ...over,
});

describe('TENANT-4d-1 · a meter looks different in each of its three states', () => {
  it('the four meters are in W118\'s order', () => {
    expect([...METER_ORDER]).toEqual(['members', 'staff_seats', 'api_calls', 'storage_gb']);
  });
  it('AN UNMEASURED METER DRAWS NO BAR — an empty bar reads as headroom, not as ignorance', () => {
    expect(showsBar('not_measured')).toBe(false);
    expect(showsBar('counted_only')).toBe(true);
    expect(showsBar('enforced')).toBe(true);
    expect(meterBadgeKey('not_measured')).toBe('pu.state.notMeasured');
    expect(meterBadgeKey('counted_only')).toBe('pu.state.countedOnly');
    expect(meterBadgeKey('enforced')).toBe('pu.state.enforced');
    expect(meterBadgeKey('not_measured')).not.toBe(meterBadgeKey('enforced'));
  });
  it('each verdict has its own sentence, and the two unmeasured reasons are distinguished', () => {
    expect(verdictKey({ kind: 'not_measured', reason: 'no_source' })).toBe('pu.verdict.noSource');
    expect(verdictKey({ kind: 'not_measured', reason: 'no_limit' })).toBe('pu.verdict.noLimit');
    expect(verdictKey({ kind: 'unlimited', used: 5 })).toBe('pu.verdict.unlimited');
    expect(verdictKey({ kind: 'within', used: 1, limit: 10, pct: 10, atNotice: false })).toBe('pu.verdict.within');
    expect(verdictKey({ kind: 'within', used: 9, limit: 10, pct: 90, atNotice: true })).toBe('pu.verdict.withinNotice');
    expect(verdictKey({ kind: 'at_limit', used: 10, limit: 10, pct: 100 })).toBe('pu.verdict.atLimit');
    expect(verdictKey({ kind: 'over_limit', used: 11, limit: 10, pct: 110 })).toBe('pu.verdict.overLimit');
  });
  it('the bar is capped for layout but the WORDS come from the verdict, so over-limit still says so', () => {
    expect(barPct({ kind: 'over_limit', used: 11, limit: 10, pct: 110 })).toBe(100);
    expect(verdictKey({ kind: 'over_limit', used: 11, limit: 10, pct: 110 })).toBe('pu.verdict.overLimit');
    expect(barPct({ kind: 'not_measured', reason: 'no_source' })).toBeNull();
    expect(barPct({ kind: 'unlimited', used: 9 })).toBeNull();
    expect(barPct({ kind: 'within', used: 1, limit: 4, pct: 25, atNotice: false })).toBe(25);
  });
  it('attention is raised at the notice threshold, at the limit and over it — not below', () => {
    expect(needsAttention({ kind: 'within', used: 1, limit: 10, pct: 10, atNotice: false })).toBe(false);
    expect(needsAttention({ kind: 'within', used: 9, limit: 10, pct: 90, atNotice: true })).toBe(true);
    expect(needsAttention({ kind: 'at_limit', used: 10, limit: 10, pct: 100 })).toBe(true);
    expect(needsAttention({ kind: 'over_limit', used: 11, limit: 10, pct: 110 })).toBe(true);
    expect(needsAttention({ kind: 'not_measured', reason: 'no_limit' })).toBe(false);
  });
});

describe('TENANT-4d-1 · the page states the rule ACTUALLY in force', () => {
  it('a display-only rule is not printed as an enforced one', () => {
    expect(noticeRuleKey(true)).toBe('pu.rule.enforced');
    expect(noticeRuleKey(false)).toBe('pu.rule.displayOnly');
  });
  it('the status line distinguishes trial, past-due, suspended limits and no subscription', () => {
    expect(limitsApplyKey('trialing', true)).toBe('pu.status.trialing');
    expect(limitsApplyKey('past_due', true)).toBe('pu.status.pastDue');
    expect(limitsApplyKey('active', true)).toBe('pu.status.active');
    expect(limitsApplyKey('paused', false)).toBe('pu.status.limitsSuspended');
    expect(limitsApplyKey(null, false)).toBe('pu.status.noSubscription');
  });
});

describe('TENANT-4d-1 · the projection', () => {
  it('each not-available reason is its own sentence', () => {
    expect(projectionKey({ kind: 'not_available', reason: 'insufficient_history' })).toBe('pu.projection.noHistory');
    expect(projectionKey({ kind: 'not_available', reason: 'no_limit' })).toBe('pu.projection.noLimit');
    expect(projectionKey({ kind: 'not_available', reason: 'not_growing' })).toBe('pu.projection.notGrowing');
    expect(projectionKey({ kind: 'reaches', monthsAway: 41, perMonth: 92 })).toBe('pu.projection.reaches');
    expect(projectionKey({ kind: 'reaches', monthsAway: 0, perMonth: 92 })).toBe('pu.projection.reached');
  });
  it('the projected month rolls the year correctly rather than producing a 13th', () => {
    expect(projectedMonth(new Date('2026-08-18T00:00:00Z'), 41)).toBe('2030-01');
    expect(projectedMonth(new Date('2026-08-18T00:00:00Z'), 5)).toBe('2027-01');
    expect(projectedMonth(new Date('2026-08-18T00:00:00Z'), 0)).toBe('2026-08');
  });
});

describe('TENANT-4d-1 · W115\'s cards', () => {
  it('the member limit is read from the plan, and "not stated" is not "unlimited"', () => {
    expect(memberLimitOf(card())).toBe(5000);
    expect(memberLimitOf(card({ limits: {} }))).toBeNull();
    expect(limitLabelKey(5000)).toBe('pu.limit.count');
    expect(limitLabelKey(-1)).toBe('pu.limit.unlimited');
    expect(limitLabelKey(null)).toBe('pu.limit.notStated');
    expect(limitLabelKey(null)).not.toBe(limitLabelKey(-1));
  });
  it('THE ANNUAL SAVING IS THE DIFFERENCE BETWEEN THE TWO STORED PRICES, never "two months off"', () => {
    // 12 × 8,999.00 = 1,07,988.00; annual 89,990.00 → saving 17,998.00 (two months, as it happens).
    expect(annualSavingMinor(card())).toBe('1799800');
    expect(hasAnnualSaving(card())).toBe(true);
    // A plan whose annual price is NOT cheaper advertises no saving at all.
    expect(annualSavingMinor(card({ annualPriceMinor: '10798800' }))).toBe('0');
    expect(hasAnnualSaving(card({ annualPriceMinor: '10798800' }))).toBe(false);
    expect(annualSavingMinor(card({ annualPriceMinor: '99999999' }))).toBe('0');
  });
});

describe('TENANT-4d-1 · refusals are translated by NAME', () => {
  it('the member-limit refusal has its own message', () => {
    expect(refusalKey('PLAN_MEMBER_LIMIT_REACHED')).toBe('pu.err.memberLimit');
    expect(refusalKey('SIGNUP_PLAN_NOT_OFFERED')).toBe('pu.err.planNotOffered');
    expect(refusalKey('WHAT')).toBe('pu.err.generic');
  });
});

describe('TENANT-4d-1 · the page states its own rules (comments stripped)', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  const read = (...p: string[]) => strip(fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8'));

  it('W118 reads the plan-usage endpoint and is gated by tenant.settings', () => {
    const s = read('app', 'plan', 'page.tsx');
    expect(s).toContain('tenancy.planUsage()');
    expect(s).toContain("tenantHasPerm('tenant.settings')");
    expect(s).toContain('pu.restricted');
  });
  it('it prints the version it is price-locked to, and the rule in force', () => {
    const s = read('app', 'plan', 'page.tsx');
    expect(s).toContain('pu.priceLocked');
    expect(s).toContain('noticeRuleKey(');
    expect(s).toContain('limitsApplyKey(');
  });
  it('it withholds the bar where nothing is measured, and names the basis of every meter', () => {
    const s = read('app', 'plan', 'page.tsx');
    expect(s).toContain('showsBar(');
    expect(s).toContain('pu.meterBasis.');
    expect(s).toContain('pu.shape.');
  });
  it('and it surfaces the unpriced gated metrics rather than leaving them in a migration header', () => {
    expect(read('app', 'plan', 'page.tsx')).toContain('pu.unpriced');
  });
  it('every new key is translated in all three launch languages', () => {
    const keys = (file: string) => new Set([...fs.readFileSync(path.join(__dirname, '..', 'i18n', file), 'utf8').matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]));
    const en = keys('en.ts'), hi = keys('hi.ts'), gu = keys('gu.ts');
    const mine = [...en].filter((k) => k.startsWith('pu.'));
    expect(mine.length).toBeGreaterThan(45);
    expect(mine.filter((k) => !hi.has(k))).toEqual([]);
    expect(mine.filter((k) => !gu.has(k))).toEqual([]);
  });
});
