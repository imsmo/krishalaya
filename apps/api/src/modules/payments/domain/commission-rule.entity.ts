// modules/payments/domain/commission-rule.entity.ts
// Pure settlement-pricing domain. A SettlementBreakdown splits an order's gross (held in escrow)
// into the seller's net + the platform/tenant commission + GST + TDS. ALL bigint minor units; the
// seller's net is the RESIDUAL (gross − commission − gst − tds) so rounding can never break the
// zero-sum invariant — the split always sums back to the gross.
import { SettlementConfigError } from './commission.errors';
import { applyBpsFloor } from '../../../core/money/rounding';

/** floor(amount * bps / 10000) in bigint. DEV-26/Q15: re-exports the platform's ONE canonical bps helper
 *  (`core/money/rounding.ts`) under this module's pre-existing name — every existing importer of `applyBps`
 *  from this file (this module's own `charge.calculator.ts`, and any future one) keeps working unchanged. */
export const applyBps = applyBpsFloor;

export interface CommissionRuleValues { rateBps: number; fixedMinor: bigint; capMinor: bigint | null; platformShareBps: number; chargedTo: 'seller' | 'buyer'; }
export interface TaxRuleValues { rateBps: number; thresholdMinor: bigint | null; }

export interface SettlementBreakdown {
  grossMinor: bigint;
  commissionMinor: bigint;        // total commission (tenant + platform share)
  platformShareMinor: bigint;     // KV's share OF the commission
  tenantCommissionMinor: bigint;  // tenant's net commission
  gstOnCommissionMinor: bigint;   // GST charged on the platform's commission service
  tdsMinor: bigint;               // 194-O TDS collected on the seller's gross (if over threshold)
  sellerNetMinor: bigint;         // RESIDUAL — what actually reaches the seller's wallet
}

/** Compute the split. Supports charged_to='seller' (deducted from the seller's net). For
 *  charged_to='buyer' the commission is a buyer-side fee added at checkout (charge_definitions,
 *  deferred) — here we still compute the seller deduction model and flag via the caller. */
export function computeSettlement(grossMinor: bigint, commission: CommissionRuleValues, gst: TaxRuleValues | null, tds: TaxRuleValues | null): SettlementBreakdown {
  if (grossMinor <= 0n) throw new SettlementConfigError({ grossMinor: grossMinor.toString() });

  let commissionMinor = applyBps(grossMinor, commission.rateBps) + commission.fixedMinor;
  if (commission.capMinor != null && commissionMinor > commission.capMinor) commissionMinor = commission.capMinor;
  if (commissionMinor < 0n) commissionMinor = 0n;

  const platformShareMinor = applyBps(commissionMinor, commission.platformShareBps);
  const tenantCommissionMinor = commissionMinor - platformShareMinor;
  const gstOnCommissionMinor = gst ? applyBps(commissionMinor, gst.rateBps) : 0n;
  const tdsMinor = tds && (tds.thresholdMinor == null || grossMinor >= tds.thresholdMinor) ? applyBps(grossMinor, tds.rateBps) : 0n;

  const sellerNetMinor = grossMinor - commissionMinor - gstOnCommissionMinor - tdsMinor;
  if (sellerNetMinor < 0n) throw new SettlementConfigError({ grossMinor: grossMinor.toString(), commissionMinor: commissionMinor.toString(), gstOnCommissionMinor: gstOnCommissionMinor.toString(), tdsMinor: tdsMinor.toString() });

  return { grossMinor, commissionMinor, platformShareMinor, tenantCommissionMinor, gstOnCommissionMinor, tdsMinor, sellerNetMinor };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PC-56 TENANT-SW-a · A2 / A4 — THE FROZEN RULE AND THE BUYER-CHARGED COMMISSION
// ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What an order freezes at placement (orders.commission_snapshot). Money as minor-unit STRINGS (jsonb has no bigint). A snapshot with
 *  `ruleId: null` records that NO rule applied on that date — settlement then fails closed (NO_COMMISSION_RULE) rather than re-resolve. */
export interface CommissionSnapshot {
  v: 1;
  ruleId: string | null;
  scope: 'tenant' | 'platform' | null;
  rateBps: number; fixedMinor: string; capMinor: string | null;
  platformShareBps: number;
  chargedTo: 'seller' | 'buyer';
  /** The IST date the rule was resolved ON — placement day, or (pre-0196 orders) the placement day resolved once at completion. */
  resolvedOn: string;
  /** true only for an order placed before 0196, resolved once at completion on its placement date (A2). */
  resolvedAtCompletion?: boolean;
  /** charged_to = buyer: the commission and its GST the BUYER paid at placement (part of the order total). */
  buyerCharge?: { commissionMinor: string; gstMinor: string; gstRateBps: number | null } | null;
}

export function snapshotFromRule(rule: (CommissionRuleValues & { id: string; scope?: 'tenant' | 'platform' }) | null, resolvedOn: string, extra: Partial<CommissionSnapshot> = {}): CommissionSnapshot {
  if (!rule) return { v: 1, ruleId: null, scope: null, rateBps: 0, fixedMinor: '0', capMinor: null, platformShareBps: 0, chargedTo: 'seller', resolvedOn, ...extra };
  return {
    v: 1, ruleId: rule.id, scope: rule.scope ?? null, rateBps: rule.rateBps, fixedMinor: rule.fixedMinor.toString(),
    capMinor: rule.capMinor != null ? rule.capMinor.toString() : null, platformShareBps: rule.platformShareBps, chargedTo: rule.chargedTo,
    resolvedOn, ...extra,
  };
}

/** The frozen rule as computation values — never a database read. */
export function valuesFromSnapshot(s: CommissionSnapshot): CommissionRuleValues {
  return { rateBps: s.rateBps, fixedMinor: BigInt(s.fixedMinor), capMinor: s.capMinor != null ? BigInt(s.capMinor) : null, platformShareBps: s.platformShareBps, chargedTo: s.chargedTo };
}

export function isCommissionSnapshot(x: unknown): x is CommissionSnapshot {
  const s = x as CommissionSnapshot | null;
  return !!s && typeof s === 'object' && s.v === 1 && typeof s.resolvedOn === 'string' && (s.chargedTo === 'seller' || s.chargedTo === 'buyer');
}

/** The commission figure itself (rate × base + fixed, capped, never negative) — one formula for both charging models. */
export function commissionOn(baseMinor: bigint, c: CommissionRuleValues): bigint {
  let commissionMinor = applyBps(baseMinor, c.rateBps) + c.fixedMinor;
  if (c.capMinor != null && commissionMinor > c.capMinor) commissionMinor = c.capMinor;
  return commissionMinor < 0n ? 0n : commissionMinor;
}

/** A4 (F-10) · charged_to = buyer, AT PLACEMENT: the buyer pays the commission on the goods value plus GST on it (the platform's
 *  service tax on the commission, the same rate the seller model deducts). Nothing is taken from the seller. */
export function buyerCommissionCharge(goodsMinor: bigint, c: CommissionRuleValues, gst: TaxRuleValues | null): { commissionMinor: bigint; gstMinor: bigint } {
  const commissionMinor = goodsMinor > 0n ? commissionOn(goodsMinor, c) : 0n;
  return { commissionMinor, gstMinor: gst ? applyBps(commissionMinor, gst.rateBps) : 0n };
}

/** A4 · charged_to = buyer, AT SETTLEMENT, from the FROZEN amounts: the seller is settled on the full goods value (less only 194-O TDS,
 *  which is the seller's statutory deduction whoever pays the commission); the buyer-paid commission splits tenant / platform share;
 *  its GST goes to gst_payable. Zero-sum against escrow by construction (see OrderSettlementService). */
export function computeBuyerChargedSettlement(goodsMinor: bigint, frozen: { commissionMinor: bigint; gstMinor: bigint; platformShareBps: number }, tds: TaxRuleValues | null) {
  if (goodsMinor < 0n) throw new SettlementConfigError({ goodsMinor: goodsMinor.toString() });
  const platformShareMinor = applyBps(frozen.commissionMinor, frozen.platformShareBps);
  const tenantCommissionMinor = frozen.commissionMinor - platformShareMinor;
  const tdsMinor = tds && (tds.thresholdMinor == null || goodsMinor >= tds.thresholdMinor) ? applyBps(goodsMinor, tds.rateBps) : 0n;
  return { commissionMinor: frozen.commissionMinor, gstMinor: frozen.gstMinor, platformShareMinor, tenantCommissionMinor, tdsMinor, sellerNetMinor: goodsMinor - tdsMinor };
}
