// apps/mobile/src/features/ambassador/commissions-summary.ts · PURE derivations over the ambassador's OWN
// commission ledger (screen 92). No React/native (SDK type is `import type` → erased) → unit-tested. Money is
// bigint minor-unit strings (Law 2): everything is summed with BigInt, never a float. The SERVER is the sole
// authority on accrual + payout; these helpers only bucket/label what the ledger already returned.
//
// §13 (NOT faked): the earning contract is {eventCode, amountMinor, payoutId, referenceType, referenceId,
// createdAt} — it carries NO farmer name and NO bank detail, so the ledger rows are labelled by their event
// CATEGORY (+ date + signed amount + paid/unpaid), never "Onboarded Anil Kumar" / "SBI ••••2247". The design's
// per-event amounts (₹50 / ₹25 / 1% / ₹500 in "How you earn") have no exposed commission-plan-amount contract, so
// the program rules are shown as fixed UI copy without a fabricated figure. The only real paid/unpaid split the
// ledger exposes is `payoutId`; there is no settlement-holdback ("pending 7d") contract, so the second tile shows
// PAID-to-date, not a fabricated pending window.
import type { AmbassadorEarning } from '@krishalaya/sdk-js';

export type CommissionCategory = 'onboarding' | 'first_sale' | 'gmv' | 'bonus' | 'payout' | 'other';

/** Classify a server event code into a display category (substring match — the server owns the exact codes). */
export function commissionCategory(eventCode: string | null | undefined): CommissionCategory {
  const c = (eventCode ?? '').toLowerCase();
  if (c.includes('payout') || c.includes('withdraw')) return 'payout';
  if (c.includes('onboard') || c.includes('signup') || c.includes('activation') || c.includes('kyc')) return 'onboarding';
  if (c.includes('first') && c.includes('sale')) return 'first_sale';
  if (c.includes('gmv') || c.includes('sales_share') || c.includes('turnover')) return 'gmv';
  if (c.includes('bonus') || c.includes('milestone') || c.includes('stipend')) return 'bonus';
  return 'other';
}

function amt(e: AmbassadorEarning): bigint {
  try { return BigInt(e.amountMinor); } catch { return 0n; }
}

/** A withdrawal/payout ledger row (its own category, or a negative amount) — never counted as earned income. */
export function isPayout(e: AmbassadorEarning): boolean {
  return commissionCategory(e.eventCode) === 'payout' || amt(e) < 0n;
}

/** "YYYY-MM" bucket for an ISO timestamp, or null when absent/unparseable. */
export function monthKey(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Sum of positive commission credits (excludes payouts) whose createdAt falls in the same month as `now`. */
export function monthCreditsMinor(items: AmbassadorEarning[], now: Date = new Date()): string {
  const key = monthKey(now.toISOString());
  let total = 0n;
  for (const e of items ?? []) {
    if (isPayout(e)) continue;
    if (monthKey(e.createdAt) !== key) continue;
    total += amt(e);
  }
  return total.toString();
}

/** Count of credits of one category in the month of `now` (e.g. onboardings, first-sales) — drives the hero line. */
export function monthCountByCategory(items: AmbassadorEarning[], category: CommissionCategory, now: Date = new Date()): number {
  const key = monthKey(now.toISOString());
  let n = 0;
  for (const e of items ?? []) {
    if (isPayout(e)) continue;
    if (monthKey(e.createdAt) !== key) continue;
    if (commissionCategory(e.eventCode) === category) n += 1;
  }
  return n;
}

/** Withdrawable = unpaid commission credits (no payoutId yet). The only real "available" figure the ledger gives. */
export function withdrawableMinor(items: AmbassadorEarning[]): string {
  let total = 0n;
  for (const e of items ?? []) {
    if (isPayout(e) || e.payoutId) continue;
    total += amt(e);
  }
  return total.toString();
}

/** Paid-to-date = commission credits already carried out under a payoutId. */
export function paidMinor(items: AmbassadorEarning[]): string {
  let total = 0n;
  for (const e of items ?? []) {
    if (isPayout(e) || !e.payoutId) continue;
    total += amt(e);
  }
  return total.toString();
}

/** Month-over-month change in earned credits, as a rounded integer percent — or null when there's no prior-month
 * baseline to compare against (never a fabricated trend). */
export function momDeltaPct(items: AmbassadorEarning[], now: Date = new Date()): number | null {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1, 12);
  const thisM = BigInt(monthCreditsMinor(items, now));
  const prevM = BigInt(monthCreditsMinor(items, prev));
  if (prevM === 0n) return null;
  return Math.round((Number(thisM - prevM) / Number(prevM)) * 100);
}

/** The four program rules shown in "How you earn" — fixed UI chrome (icons + i18n keys), NOT per-user data and NOT
 * a fabricated amount (§13: no commission-plan-amount contract is exposed). */
export const EARNING_RULES = [
  { key: 'onboarding', icon: '💰' },
  { key: 'firstSale', icon: '💰' },
  { key: 'gmv', icon: '💰' },
  { key: 'bonus', icon: '🏆' },
] as const;
export type EarningRule = (typeof EARNING_RULES)[number]['key'];
