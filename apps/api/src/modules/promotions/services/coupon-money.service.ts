// modules/promotions/services/coupon-money.service.ts · PC-56 TENANT-10b · F-2 / A1 / A2 / A3 — THE PROMOTION MONEY LEGS.
//
// Founder decision F-2: the tenant's wallet funds a coupon discount. This service is the ONLY place promotion money moves,
// and it moves it ONLY through the WalletPort (Law 2) — three balanced, idempotency-keyed transactions (domain/promo-money):
//   hold     tenant Main → tenant Hold        at redemption, inside the checkout transaction           (tryHold)
//   settle   tenant Hold → seller Main        at settlement, inside the relay transaction that settles  (settleOrderInTx)
//   release  tenant Hold → tenant Main        on cancel/refund before settlement                        (releaseInTx)
//
// WHY THE HOLD IS WRAPPED IN A SAVEPOINT. The in-process wallet claims the idempotency key and appends each leg in
// account-id order, checking "no overdraw" leg by leg; when tenant Main cannot cover the debit it throws AFTER the header
// and possibly the Hold credit are already written. The coupon path must CONTINUE the checkout at full price when that
// happens (A1), so the refusal must leave nothing behind: `SAVEPOINT` before the post, `ROLLBACK TO SAVEPOINT` on a
// funds refusal (insufficient or frozen), and the key is unclaimed again. Any other error is not a funds answer and is
// rethrown — the checkout fails closed, as it did before.
//
// WHY SETTLEMENT RUNS IN THE RELAY'S TRANSACTION. The Hold account is POOLED per tenant. If settlement read "this order
// still has a reservation" in one transaction and posted the leg in another, a cancel racing it could release the same
// reservation and the settlement would then pay the seller out of ANOTHER order's reserved money. So the redemption row is
// locked FOR UPDATE and stamped in the same transaction that posts the leg — the relay's, as kv_relay, which 0185 grants
// SELECT and UPDATE(settled_txn_id, settled_at) on coupon_redemptions and nothing more.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { WALLET_SERVICE, WalletPort } from '../../../core/wallet/wallet.port';
import { InsufficientWalletBalanceError, WalletFrozenError } from '../../../core/wallet/wallet.errors';
import { CouponRedemptionRepository, RedemptionMoneyRow } from '../repositories/coupon-redemption.repository';
import { PROMO_REFERENCE_TYPE, PROMO_TXN, holdKey, holdLegs, releaseKey, releaseLegs, settleKey, settleLegs, tenantMain } from '../domain/promo-money';

const isFundsRefusal = (e: unknown) => e instanceof InsufficientWalletBalanceError || e instanceof WalletFrozenError;

@Injectable()
export class CouponMoneyService {
  constructor(
    @Inject(WALLET_SERVICE) private readonly wallet: WalletPort,
    private readonly redemptions: CouponRedemptionRepository,
  ) {}

  /** A5 — the preview's read-only funds check: can the tenant's Main cover this reservation right now? */
  async tenantCanFund(tx: TxContext, tenantId: string, amountMinor: bigint): Promise<boolean> {
    if (amountMinor <= 0n) return true;
    return (await this.wallet.balanceMinor(tx, tenantMain(tenantId))) >= amountMinor;
  }

  /**
   * A1 — reserve the discount: tenant Main −d → tenant Hold +d, keyed `promo-hold:<orderId>:<couponId>`. Returns the
   * ledger txn id, or NULL when the tenant cannot fund it (insufficient or frozen) — in which case NOTHING was written.
   */
  async tryHold(tx: TxContext, input: { tenantId: string; orderId: string; couponId: string; amountMinor: bigint; initiatedBy?: string }): Promise<string | null> {
    if (input.amountMinor <= 0n) return null;
    await tx.query('SAVEPOINT kv_promo_hold');
    try {
      const r = await this.wallet.post(tx, {
        tenantId: input.tenantId, txnType: PROMO_TXN.Hold, idempotencyKey: holdKey(input.orderId, input.couponId),
        legs: holdLegs(input.tenantId, input.amountMinor), referenceType: PROMO_REFERENCE_TYPE, referenceId: input.orderId,
        initiatedBy: input.initiatedBy, description: 'Coupon discount reserved from the organisation wallet',
      });
      await tx.query('RELEASE SAVEPOINT kv_promo_hold');
      return r.txnId;
    } catch (e) {
      await tx.query('ROLLBACK TO SAVEPOINT kv_promo_hold');
      await tx.query('RELEASE SAVEPOINT kv_promo_hold');
      if (isFundsRefusal(e)) return null;
      throw e;
    }
  }

  /**
   * A2 — pay every reserved discount of this order to its seller: tenant Hold −d → seller Main +d, keyed
   * `promo-settle:<orderId>:<couponId>`, and stamp the redemption — IN THE CALLER'S (the settlement's) TRANSACTION.
   * Idempotent per order: a row already settled (or released) is skipped, and a replayed post is the same txn. A row
   * with no hold (before 0185, or a backstop the tenant could not fund) has nothing to pay and is skipped by name.
   */
  async settleOrderInTx(tx: TxContext, input: { tenantId: string; orderId: string; sellerUserId: string }): Promise<{ settled: number; topUpMinor: bigint; unfunded: number }> {
    const rows = await this.redemptions.forOrderForUpdate(tx, input.tenantId, input.orderId);
    let settled = 0; let topUp = 0n; let unfunded = 0;
    for (const r of rows) {
      if (r.settledTxnId || r.releasedTxnId) continue;
      if (!r.holdTxnId) { unfunded += 1; continue; }
      const txn = await this.wallet.post(tx, {
        tenantId: input.tenantId, txnType: PROMO_TXN.Settle, idempotencyKey: settleKey(input.orderId, r.couponId),
        legs: settleLegs(input.tenantId, input.sellerUserId, r.amountMinor), referenceType: PROMO_REFERENCE_TYPE, referenceId: r.id,
        initiatedBy: 'system', description: 'Coupon discount paid to the seller from the organisation reservation',
      });
      await this.redemptions.markSettled(tx, input.tenantId, r.id, txn.txnId);
      settled += 1; topUp += r.amountMinor;
    }
    return { settled, topUpMinor: topUp, unfunded };
  }

  /** A3 — return one reservation to the tenant's Main: tenant Hold −d → tenant Main +d, keyed `promo-release:…`, and stamp
   *  it. The caller holds the row lock (forOrderForUpdate) and has checked it is held, unsettled and unreleased. */
  async releaseInTx(tx: TxContext, tenantId: string, r: RedemptionMoneyRow, initiatedBy = 'system'): Promise<string> {
    const txn = await this.wallet.post(tx, {
      tenantId, txnType: PROMO_TXN.Release, idempotencyKey: releaseKey(r.orderId ?? r.id, r.couponId),
      legs: releaseLegs(tenantId, r.amountMinor), referenceType: PROMO_REFERENCE_TYPE, referenceId: r.id,
      initiatedBy, description: 'Coupon reservation returned to the organisation wallet (order closed before settlement)',
    });
    await this.redemptions.markReleased(tx, tenantId, r.id, txn.txnId);
    return txn.txnId;
  }
}
