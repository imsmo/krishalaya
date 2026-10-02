// modules/promotions/domain/promo-money.ts · PC-56 TENANT-10b · F-2 — THE THREE MOVES OF PROMOTION MONEY, AS DATA. PURE.
//
// Founder decision F-2: the TENANT'S WALLET funds a coupon discount. Three balanced WalletPort transactions, each keyed so
// a replay is the same transaction (Law 3), each referenced to the redemption it belongs to:
//   HOLD     at redemption (the checkout tx):            tenant Main −d → tenant Hold +d     `promo-hold:<orderId>:<couponId>`
//   SETTLE   at settlement (the relay tx that settles):  tenant Hold −d → seller Main +d     `promo-settle:<orderId>:<couponId>`
//   RELEASE  on cancel/refund before settlement:         tenant Hold −d → tenant Main +d     `promo-release:<orderId>:<couponId>`
// The seller is therefore settled on the FULL goods value: the existing escrow legs pay `total − buyer charges` (the
// discounted figure, unchanged), and SETTLE adds the discount on top, out of the reservation the tenant made at checkout.
import type { LedgerLeg } from '../../../core/wallet/wallet.port';
import { AccountRef, TenantAccount, UserAccount } from '../../../core/wallet/account-codes';

export const PROMO_TXN = { Hold: 'promo_hold', Settle: 'promo_settle', Release: 'promo_release' } as const;
export const PROMO_REFERENCE_TYPE = 'coupon_redemption';

export const tenantMain = (tenantId: string): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Main, currencyCode: 'INR' });
export const tenantHold = (tenantId: string): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Hold, currencyCode: 'INR' });
export const sellerMain = (userId: string): AccountRef => ({ kind: 'user', userId, accountCode: UserAccount.Main, currencyCode: 'INR' });

export const holdKey = (orderId: string, couponId: string) => `promo-hold:${orderId}:${couponId}`;
export const settleKey = (orderId: string, couponId: string) => `promo-settle:${orderId}:${couponId}`;
export const releaseKey = (orderId: string, couponId: string) => `promo-release:${orderId}:${couponId}`;

function pair(from: AccountRef, to: AccountRef, amountMinor: bigint): LedgerLeg[] {
  if (amountMinor <= 0n) throw new RangeError('a promotion money move must be a positive amount');
  return [{ account: from, amountMinor: -amountMinor }, { account: to, amountMinor }];
}
export const holdLegs = (tenantId: string, d: bigint) => pair(tenantMain(tenantId), tenantHold(tenantId), d);
export const settleLegs = (tenantId: string, sellerUserId: string, d: bigint) => pair(tenantHold(tenantId), sellerMain(sellerUserId), d);
export const releaseLegs = (tenantId: string, d: bigint) => pair(tenantHold(tenantId), tenantMain(tenantId), d);
