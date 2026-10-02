// modules/promotions/repositories/coupon-attempt.repository.ts · PC-56 TENANT-10b · A4 — THE ATTEMPTS LOG (0185).
// One row per validate (stage `preview`) / redeem (`redeem`, `backstop`) OUTCOME, applied or declined. INSERT only —
// kv_app holds SELECT + INSERT and a trigger refuses UPDATE / DELETE / TRUNCATE whoever asks (Law 2). RLS binds the row
// to `current_tenant_id()` on the way IN (WITH CHECK), so a tenant can never write another tenant's attempt.
import { Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { uuidv7 } from '../../../core/database/uuid.util';
import type { CouponOutcome } from '../domain/coupon-outcome';

export type AttemptStage = 'preview' | 'redeem' | 'backstop';
export interface AttemptInput {
  tenantId: string; couponId: string | null; orderId: string | null; userId: string;
  stage: AttemptStage; outcome: CouponOutcome; amountMinor: bigint | null;
}

@Injectable()
export class CouponAttemptRepository {
  async insert(tx: TxContext, a: AttemptInput): Promise<string> {
    const id = uuidv7();
    await tx.query(
      `INSERT INTO coupon_redemption_attempts (id, tenant_id, coupon_id, order_id, user_id, stage, outcome, amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7::coupon_attempt_outcome,$8)`,
      [id, a.tenantId, a.couponId, a.orderId, a.userId, a.stage, a.outcome, a.amountMinor === null ? null : a.amountMinor.toString()]);
    return id;
  }
}
