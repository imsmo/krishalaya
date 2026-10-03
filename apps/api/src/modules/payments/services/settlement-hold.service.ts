// modules/payments/services/settlement-hold.service.ts · PC-56 TENANT-SW-a — THE ONE DOOR THROUGH WHICH ANOTHER MODULE HOLDS OR RELEASES
// AN ORDER'S SETTLEMENT (founder decision "escrow holds only on a flagged POD"; canon W243 "short-paid cash logs against the ORDER").
//
// Logistics calls this PUBLIC service (module blueprint — never payments' repositories) inside its own transaction:
//   • a FLAGGED POD review → open('pod_review', reviewId); an open COD shortfall → open('cod_shortfall', shortfallId);
//   • approve / supersede / collect → release(...). When the LAST open hold of the order is released, the same transaction writes
//     `payments.settlement_hold_released`; its handler settles the deferred completion (if one arrived meanwhile) through the same
//     idempotent `settle:<order>` key. Nothing here moves money.
import { Inject, Injectable } from '@nestjs/common';
import { TxContext } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { HoldReason, SettlementHoldRepository } from '../repositories/settlement-hold.repository';

export const SETTLEMENT_HOLD_RELEASED_EVENT = 'payments.settlement_hold_released';

@Injectable()
export class SettlementHoldService {
  constructor(private readonly holds: SettlementHoldRepository, @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter) {}

  openInTx(tx: TxContext, h: { tenantId: string; orderId: string; reason: HoldReason; sourceId: string; openedBy: string | null }): Promise<string> {
    return this.holds.openTx(tx, h);
  }

  /** Release one hold. Returns whether the order is now free of holds (and the release event was written). */
  async releaseInTx(tx: TxContext, h: { tenantId: string; orderId: string; reason: HoldReason; sourceId: string; releasedBy: string | null; note: string }): Promise<{ released: boolean; orderFree: boolean }> {
    await this.holds.lockOpenTx(tx, h.tenantId, h.orderId);   // same row locks the settlement handler takes
    const n = await this.holds.releaseTx(tx, h);
    if (n === 0) return { released: false, orderFree: (await this.holds.openCountTx(tx, h.tenantId, h.orderId)) === 0 };
    const free = (await this.holds.openCountTx(tx, h.tenantId, h.orderId)) === 0;
    if (free) {
      await this.outbox.write(tx, { tenantId: h.tenantId, aggregateType: 'order', aggregateId: h.orderId, eventType: SETTLEMENT_HOLD_RELEASED_EVENT,
        payload: { v: 1, orderId: h.orderId, reason: h.reason, sourceId: h.sourceId } });
    }
    return { released: true, orderFree: free };
  }

  openCountInTx(tx: TxContext, tenantId: string, orderId: string): Promise<number> { return this.holds.openCountTx(tx, tenantId, orderId); }
}
