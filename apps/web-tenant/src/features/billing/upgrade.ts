// apps/web-tenant/src/features/billing/upgrade.ts · pure logic for W119 (PC-56 TENANT-1d-2).
//
// No React, no I/O. Every rule here is about **not letting the screen and the invoice disagree** — the failure that hurts
// most on a money screen, because the tenant reads one number and pays another.
import type { ComparePlan, PlanChangePreview, PlanCompareView, PlanLimitBreach } from '@krishalaya/sdk-js';

export interface T { t(key: string, vars?: Record<string, string | number>): string }

/** 0002's convention: `-1` means unlimited. A screen printing "-1 members" is a screen nobody proofread. */
export const UNLIMITED = '-1';

export function isUnlimited(limitValue: string | undefined): boolean {
  return limitValue === UNLIMITED;
}

/**
 * How one cell of the compare table reads.
 *
 * Three states, because the table has three: a number, "unlimited", and **absent — which is "—", not "0"**. W119 prints "—"
 * for Auctions on Starter and it means "not included"; printing 0 would read as a quota of zero, which is a different and
 * more alarming claim about a plan somebody is considering.
 */
export function limitCell(plan: ComparePlan, code: string, t: T): { kind: 'number' | 'unlimited' | 'absent'; text: string } {
  const v = plan.limits[code];
  if (v === undefined) return { kind: 'absent', text: '—' };
  if (isUnlimited(v)) return { kind: 'unlimited', text: t.t('upg.unlimited') };
  return { kind: 'number', text: v };
}

/** A feature cell: ✓ when included, "—" when the plan does not carry it. Same reasoning as `limitCell`. */
export function featureCell(plan: ComparePlan, code: string): boolean {
  return plan.features[code] === true;
}

/**
 * Which plans a tenant may actually move to.
 *
 * Their current plan is in the table (W119 marks it "current") and is NOT offerable — the API refuses "already on this
 * plan", so rendering the button would be an invitation into a 400.
 */
export function offerablePlans(view: PlanCompareView): ComparePlan[] {
  return view.plans.filter((p) => !p.isCurrent);
}

/**
 * The direction the tenant is going, worked out from the SAME prices the API used.
 *
 * **BY PRICE, NEVER BY POSITION IN THE TABLE.** `subscriptions.price_minor` is the negotiated price, so an anchor tenant on
 * ₹25,000 moving to list-price Professional at ₹19,999 is going DOWN even though Professional sits to the right of Growth.
 * A console that read the ladder would offer them an "Upgrade now" button for a change that reduces their bill.
 */
export function directionOf(view: PlanCompareView, plan: ComparePlan): 'upgrade' | 'downgrade' | 'lateral' | 'unknown' {
  if (!view.current) return 'unknown';
  const cycle = view.current.billingCycle;
  const from = BigInt(view.current.priceMinor);
  const to = BigInt(cycle === 'annual' ? plan.annualPriceMinor : plan.monthlyPriceMinor);
  if (to > from) return 'upgrade';
  if (to < from) return 'downgrade';
  return 'lateral';
}

/**
 * The label on the button.
 *
 * **"Schedule downgrade" AND "Upgrade now" ARE DIFFERENT PROMISES AND THE SCREEN MUST NOT BLUR THEM.** W119 uses both, and
 * the difference is whether money moves today: one raises an invoice due in 7 days, the other changes nothing until the
 * period ends. A single "Change plan" button would make the tenant guess.
 */
export function actionLabel(direction: ReturnType<typeof directionOf>, t: T): string {
  switch (direction) {
    case 'upgrade': return t.t('upg.action.upgrade');
    case 'downgrade': return t.t('upg.action.schedule');
    case 'lateral': return t.t('upg.action.switch');
    default: return t.t('upg.action.change');
  }
}

/**
 * The invoice panel's rows.
 *
 * **THE TOTAL IS NOT THE SUM OF THESE ROWS AND MUST NOT BE COMPUTED FROM THEM.** W119's own printed lines sum to ₹7,954
 * while the true total is ₹7,955.48 — each line was rounded down for presentation before a reader added them. So the rows
 * carry the parts and the total comes from `totalDueMinor`, which is what the tenant will be charged. Two answers to one
 * question is the worst thing a billing screen can do.
 */
export function invoiceRows(p: PlanChangePreview): Array<{ key: string; minor: string; negative: boolean }> {
  if (p.lines.direction !== 'upgrade') return [];
  const rows = [{ key: 'charge', minor: p.lines.newPlanChargeMinor, negative: false }];
  if (BigInt(p.lines.unusedCreditMinor) > 0n) rows.push({ key: 'credit', minor: p.lines.unusedCreditMinor, negative: true });
  rows.push({ key: 'net', minor: p.lines.netDueMinor, negative: false });
  if (BigInt(p.lines.taxMinor) > 0n) rows.push({ key: 'tax', minor: p.lines.taxMinor, negative: false });
  return rows;
}

/** Tax as a percentage for the label — W119's "GST 18%". Whole percent, because a bp figure means nothing to a reader. */
export function taxPct(p: PlanChangePreview): number {
  return Math.round(p.taxBp / 100);
}

/**
 * Whether the confirm button may be offered at all.
 *
 * **AN UNREADABLE TAX RATE BLOCKS AN UPGRADE AND NOT A DOWNGRADE**, matching the API exactly: a downgrade bills nothing, so
 * there is no figure to get wrong. Mirroring the rule here is not duplication — it is the difference between a refusal the
 * tenant understands before clicking and a 503 after.
 */
export function canConfirm(p: PlanChangePreview): { ok: boolean; reason: 'tax_unavailable' | null } {
  if (p.taxUnavailable && p.lines.direction === 'upgrade') return { ok: false, reason: 'tax_unavailable' };
  return { ok: true, reason: null };
}

/**
 * The limit heads-up. W119: "you have 1,284 members and 7 staff — over Starter's limits (500 / 2). Existing members are
 * never removed; you just can't add more until within limits."
 *
 * **IT WARNS AND NEVER BLOCKS.** `breachBlocksChange()` exists in the API's domain and returns false on purpose: a platform
 * that dropped 784 members because a co-operative downgraded to save ₹6,000 a month would have destroyed the register those
 * members' payouts depend on, in order to enforce a price.
 */
export function breachSummary(breaches: PlanLimitBreach[]): { any: boolean; codes: string[] } {
  return { any: breaches.length > 0, codes: breaches.map((b) => b.limitCode) };
}

/** Row order: W119 leads with Members then Staff seats, then the rest as the API ordered them. */
export function orderedLimitCodes(view: PlanCompareView): string[] {
  return view.limitCodes;
}

/**
 * Should the compare table be replaced by W119's "Custom plan in force" panel?
 *
 * **A NEGOTIATED TENANT MUST NOT BE SHOWN A SHELF-PRICE TABLE AS THOUGH IT APPLIED TO THEM.** W119: "Anchor/negotiated terms
 * replace this table — your account manager quote is the source of truth." The table still renders below the panel, because
 * hiding it entirely would leave a founding partner unable to see what the standard plans include.
 */
export function showsCustomPricingNotice(view: PlanCompareView): boolean {
  return view.customPricing;
}

/** A scheduled change already waiting — shown before any new one is offered, so a tenant does not stack two. */
export function pendingNotice(view: PlanCompareView): { planName: string; effectiveDate: string; reason: string | null } | null {
  return view.pending ? { planName: view.pending.planName, effectiveDate: view.pending.effectiveDate, reason: view.pending.reason } : null;
}
