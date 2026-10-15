// modules/orders/domain/placement-charges.ts · PC-56 STORE-3b · B3 (founder D2, Law 9) — THE BUYER-SIDE CHARGES OF AN ORDER, FROM ONE FUNCTION.
//
// Until this wave the rule lived inline in CheckoutService twice (placement and the preview): the buyer-charge quote's delivery + platform fee,
// the MEMBER-BENEFIT override (free delivery · `platformFeeBpsOverride` → `applyBpsFloor(goods, bps)`, recorded in the charge snapshot so the
// snapshot never disagrees with the amount), then `CommissionSnapshotService.freezeAtPlacement` (the commission rule frozen on the IST
// placement date; a BUYER-charged commission + GST when `commission_split` is on, added to the charge snapshot as `buyer_commission`). An
// order created from an accepted OFFER (OfferAcceptedHandler) carried NONE of it (survey F-5). Founder D2 (2026-10-15): the offer order
// carries checkout's fees by the SAME rules — so the rule is extracted here, ONCE, and both callers use it:
//   • checkout placement + the checkout preview pass the quote they computed (`ChargePricingService` — zone / generic delivery, platform fee);
//   • the offer order passes NO quote (`NO_QUOTE`: no delivery line — "collection or delivery arranged with the organisation" — and no quoted
//     platform fee), so its platform fee is the member-benefit override or 0, and its buyer commission is the frozen rule's, exactly as a
//     checkout order of the same goods value under the same rule.
// Every amount is bigint minor units; nothing here posts money (the order's total includes the charges; settlement routes them — unchanged).
import type { TxContext } from '../../../core/database/unit-of-work';
import { applyBpsFloor } from '../../../core/money/rounding';
import type { FrozenAtPlacement } from '../../payments/services/commission-snapshot.service';

/** The two collaborators the rule needs — the memberships module's benefits read and payments' commission freeze (public services, Law 11). */
export interface PlacementChargeDeps {
  memberships: { checkoutBenefits(tx: TxContext, tenantId: string, userId: string): Promise<{ freeDelivery: boolean; platformFeeBpsOverride: number | null } | null> };
  commission: { freezeAtPlacement(tx: TxContext, i: { tenantId: string; source: string; categoryId: string | null; goodsMinor: bigint; splitOn: boolean; now?: Date }): Promise<FrozenAtPlacement> };
}
export interface ChargeQuote { deliveryFeeMinor: bigint; platformFeeMinor: bigint; snapshot: Record<string, unknown> | null }
/** An order placed with no buyer-charge quote (an OFFER order — founder D2: no delivery line; no quoted platform fee). */
export const NO_QUOTE: ChargeQuote = Object.freeze({ deliveryFeeMinor: 0n, platformFeeMinor: 0n, snapshot: null }) as ChargeQuote;

export interface PlacementChargeInput {
  tenantId: string; buyerUserId: string;
  /** the order's source as the commission resolver reads it ('direct' for checkout, 'offer' for an accepted offer) */
  source: string;
  categoryId: string | null;
  /** the goods value the charges apply to (the order's subtotal) */
  goodsMinor: bigint;
  /** the placement instant (the IST date the commission rule is frozen on); omitted by the preview (= now) */
  now?: Date;
  quote: ChargeQuote;
  /** `buyer_charges` ON for this buyer (the member override applies only then — checkout's rule) */
  applyCharges: boolean;
  /** `memberships` ON for this buyer */
  applyMemberBenefits: boolean;
  /** `commission_split` ON for the tenant */
  splitOn: boolean;
}
export interface PlacementCharges {
  deliveryFeeMinor: bigint; platformFeeMinor: bigint; buyerCommissionMinor: bigint;
  /** the CHARGE snapshot (orders.charge_snapshot): the quote's, with the member benefit and the buyer-commission entry folded in */
  chargeSnapshot: Record<string, unknown> | null;
  /** the frozen COMMISSION snapshot (orders.commission_snapshot) */
  commissionSnapshot: Record<string, unknown>;
}

export async function placementCharges(deps: PlacementChargeDeps, tx: TxContext, i: PlacementChargeInput): Promise<PlacementCharges> {
  let { deliveryFeeMinor, platformFeeMinor } = i.quote;
  const chargeSnapshot = i.quote.snapshot ? { ...i.quote.snapshot } : null;
  // membership benefits override the buyer-side charges (free delivery + sliding platform fee)
  if (i.applyCharges && i.applyMemberBenefits) {
    const ben = await deps.memberships.checkoutBenefits(tx, i.tenantId, i.buyerUserId);
    if (ben) {
      if (ben.freeDelivery) deliveryFeeMinor = 0n;
      if (ben.platformFeeBpsOverride != null) platformFeeMinor = applyBpsFloor(i.goodsMinor, ben.platformFeeBpsOverride);
      // **THE OVERRIDE GOES INTO THE SNAPSHOT TOO, OR THE SNAPSHOT LIES.** A membership benefit changes
      // the amount AFTER the rules were resolved; freezing only the rules would leave an accountant
      // reading a ₹340 delivery slab against a ₹0 charge and finding no explanation on the record.
      if (chargeSnapshot) {
        chargeSnapshot.memberBenefit = {
          freeDelivery: ben.freeDelivery === true,
          platformFeeBpsOverride: ben.platformFeeBpsOverride ?? null,
          appliedDeliveryFeeMinor: deliveryFeeMinor.toString(),
          appliedPlatformFeeMinor: platformFeeMinor.toString(),
        };
      }
    }
  }
  // A2 · THE COMMISSION RULE IS FROZEN HERE (placement day, IST) — settlement reads this and never resolves again.
  // A4 · a rule that charges the BUYER (with the split on) adds the commission + GST to this order as a buyer charge.
  const frozen = await deps.commission.freezeAtPlacement(tx, { tenantId: i.tenantId, source: i.source, categoryId: i.categoryId,
    goodsMinor: i.goodsMinor, splitOn: i.splitOn, ...(i.now ? { now: i.now } : {}) });
  let snapshotOut = chargeSnapshot;
  if (frozen.chargeEntry) {
    snapshotOut = snapshotOut
      ? { ...snapshotOut, charges: [...((snapshotOut.charges as unknown[]) ?? []), frozen.chargeEntry] }
      : { resolvedAt: (i.now ?? new Date()).toISOString(), charges: [frozen.chargeEntry] };
  }
  return { deliveryFeeMinor, platformFeeMinor, buyerCommissionMinor: frozen.buyerCommissionMinor, chargeSnapshot: snapshotOut,
    commissionSnapshot: frozen.snapshot as unknown as Record<string, unknown> };
}
