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
