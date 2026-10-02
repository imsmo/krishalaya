// modules/group-lots/domain/group-lot-money.ts · PC-56 TENANT-11c · THE TWO MONEY MOVES A GROUP LOT MAKES. PURE.
//
// Founder decision (2026-10-02): SETTLE PAYS FARMERS FROM THE REAL SALE, MAKER ≠ CHECKER.
//   hold    coordinator Main −gross → coordinator Hold +gross                            gl-hold:<lotId>     group_lot_hold
//           at the sale: gross = what the sale order's settlement actually paid the coordinator as seller
//   settle  coordinator Hold −gross → each pledger's Main +share, coordinator Main +fee   gl-settle:<lotId>   group_lot_settle
//           at the second person's confirm: shares from `settleShares` (bigint, remainder largest-first, Σ = gross)
// Both are ONE balanced txn each, keyed by the lot — a replay returns the same txn and moves nothing. No existing ledger leg
// changes: the order's own settlement (`settle:<orderId>`, escrow → seller) is untouched; these move the seller's money on.
import { LedgerLeg } from '../../../core/wallet/wallet.port';
import { userHold, userMain } from '../../../core/wallet/account-codes';

export const GROUP_LOT_TXN = { Hold: 'group_lot_hold', Settle: 'group_lot_settle' } as const;
export const GROUP_LOT_REFERENCE_TYPE = 'group_lot';
export const holdKey = (lotId: string) => `gl-hold:${lotId}`;
export const settleKey = (lotId: string) => `gl-settle:${lotId}`;

export function holdLegs(coordinatorUserId: string, grossMinor: bigint, currency = 'INR'): LedgerLeg[] {
  return [
    { account: userMain(coordinatorUserId, currency), amountMinor: -grossMinor },
    { account: userHold(coordinatorUserId, currency), amountMinor: grossMinor },
  ];
}

/**
 * The settlement legs. Two credits to the same Main (a coordinator who also pledged earns a share AND the fee) are MERGED into
 * one leg, so the txn names each account once; zero legs are dropped. Throws if the parts do not sum to the gross — the
 * caller's arithmetic is checked here, not trusted.
 */
export function settleLegs(coordinatorUserId: string, grossMinor: bigint, feeMinor: bigint, shares: Array<{ farmerUserId: string; shareMinor: bigint }>, currency = 'INR'): LedgerLeg[] {
  const credits = new Map<string, bigint>();
  for (const s of shares) credits.set(s.farmerUserId, (credits.get(s.farmerUserId) ?? 0n) + s.shareMinor);
  credits.set(coordinatorUserId, (credits.get(coordinatorUserId) ?? 0n) + feeMinor);
  let total = 0n;
  const legs: LedgerLeg[] = [{ account: userHold(coordinatorUserId, currency), amountMinor: -grossMinor }];
  for (const [userId, amount] of credits) {
    if (amount < 0n) throw new Error('group-lot settlement: a negative share');
    total += amount;
    if (amount > 0n) legs.push({ account: userMain(userId, currency), amountMinor: amount });
  }
  if (total !== grossMinor) throw new Error(`group-lot settlement: parts ${total} ≠ gross ${grossMinor}`);
  return legs;
}

/**
 * THE LOT'S SHARE OF THE SELLER'S SETTLED AMOUNT. The lot's listing sells the whole lot (min order = the lot), so the sale
 * order normally carries ONLY the lot's line and the lot's proceeds are exactly what the seller was settled. When the buyer's
 * order to this coordinator also carried another of the coordinator's own listings, the settled amount is split by line total
 * (floor): the lot gets lotLines ÷ subtotal of it, and the rest — the coordinator's own produce — stays in their Main.
 */
export function lotProceeds(sellerSettledMinor: bigint, lotLinesMinor: bigint, orderLinesMinor: bigint): bigint {
  if (sellerSettledMinor <= 0n || lotLinesMinor <= 0n || orderLinesMinor <= 0n) return 0n;
  if (lotLinesMinor >= orderLinesMinor) return sellerSettledMinor;
  return (sellerSettledMinor * lotLinesMinor) / orderLinesMinor;
}
