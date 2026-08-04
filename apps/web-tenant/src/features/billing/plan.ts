// apps/web-tenant/src/features/billing/plan.ts · PURE helpers for the billing page. No framework, no I/O →
// unit-tested. planPriceMinor picks the right bigint minor-unit string for the chosen billing cycle (rendered via
// formatMoneyMinor — never a float, Law 2). mergeUsageRows unions the plan's limits with the tenant's usage into
// display rows (a missing limit means "unlimited"; a missing usage means 0).
import type { Plan } from '@krishalaya/sdk-js';

export type BillingCycle = 'monthly' | 'annual';

/** The price (minor-unit string) for the chosen cycle. */
export function planPriceMinor(plan: Pick<Plan, 'monthlyPriceMinor' | 'annualPriceMinor'>, cycle: BillingCycle): string {
  return cycle === 'annual' ? plan.annualPriceMinor : plan.monthlyPriceMinor;
}

export interface UsageRow { key: string; used: string; limit: string | null }

/** Union the limits + usage maps into sorted rows. `limit: null` = unlimited (no cap configured). */
export function mergeUsageRows(limits?: Record<string, string>, usage?: Record<string, string>): UsageRow[] {
  const keys = new Set<string>([...Object.keys(limits ?? {}), ...Object.keys(usage ?? {})]);
  return [...keys].sort().map((key) => ({
    key,
    used: usage?.[key] ?? '0',
    limit: limits?.[key] ?? null,
  }));
}

/** Validate the apply-plan form. Returns the typed payload or an error key. */
export type ApplyResult = { ok: true; value: { planId: string; billingCycle: BillingCycle } } | { ok: false; error: 'plan' };
export function buildApply(raw: { planId?: string; billingCycle?: string }): ApplyResult {
  const planId = (raw.planId ?? '').trim();
  if (!planId) return { ok: false, error: 'plan' };
  const billingCycle: BillingCycle = raw.billingCycle === 'annual' ? 'annual' : 'monthly';
  return { ok: true, value: { planId, billingCycle } };
}
