// core/wallet/account-codes.ts · the fixed chart of accounts (account_code values from
// db/migrations/0006_money.sql). Money never appears or disappears — it MOVES between these.
// PC-56 TENANT-SW-a · `cash_in_hand` — a rider's COD cash LIABILITY (founder decision "COD cash is a ledger fact"): a collection
// debits it (the rider now owes escrow, the balance goes NEGATIVE), a reconciled remittance credits it back toward zero. It is the
// one user account that may sit below zero and may never sit above it (InProcessWalletClient enforces both, LIABILITY_ACCOUNTS).
export const UserAccount = { Main: 'main', Hold: 'hold', CashInHand: 'cash_in_hand' } as const;
export const TenantAccount = { Main: 'main', Commission: 'commission', Hold: 'hold' } as const;
export const PlatformAccount = {
  Escrow: 'escrow', Fees: 'fees', Gateway: 'gateway', Payouts: 'payouts',
  GstPayable: 'gst_payable', TdsPayable: 'tds_payable', PromoLiability: 'promo_liability', Suspense: 'suspense',
  // PC-56 TENANT-SW-a · the platform's bank-clearing fact for COD cash: a reconciled deposit debits it, exactly as Gateway is debited
  // when a card payment arrives (money that entered the platform's bank from outside the ledger).
  CashClearing: 'cash_clearing',
} as const;

export type WalletOwnerKind = 'user' | 'tenant' | 'platform';

/** A stable reference to a wallet account, resolved/created on first use. */
export interface AccountRef {
  kind: WalletOwnerKind;
  userId?: string;        // required when kind='user'
  tenantId?: string;      // required when kind='tenant'
  accountCode: string;    // one of the *Account codes above
  currencyCode?: string;  // default 'INR'
}

export const userMain = (userId: string, currencyCode = 'INR'): AccountRef => ({ kind: 'user', userId, accountCode: UserAccount.Main, currencyCode });
export const userHold = (userId: string, currencyCode = 'INR'): AccountRef => ({ kind: 'user', userId, accountCode: UserAccount.Hold, currencyCode });
/** PC-56 TENANT-SW-a · the rider's COD cash liability (≤ 0 always; 0 = owes nothing). Riders are users (shipments.rider_user_id). */
export const userCashInHand = (userId: string, currencyCode = 'INR'): AccountRef => ({ kind: 'user', userId, accountCode: UserAccount.CashInHand, currencyCode });
/** Accounts on the user/tenant side that hold a LIABILITY: allowed below zero, never above it. */
export const LIABILITY_ACCOUNTS: ReadonlySet<string> = new Set([UserAccount.CashInHand]);
export const tenantCommission = (tenantId: string, currencyCode = 'INR'): AccountRef => ({ kind: 'tenant', tenantId, accountCode: TenantAccount.Commission, currencyCode });
export const platform = (accountCode: string, currencyCode = 'INR'): AccountRef => ({ kind: 'platform', accountCode, currencyCode });
