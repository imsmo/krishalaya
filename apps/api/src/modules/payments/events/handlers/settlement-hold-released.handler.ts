// modules/payments/events/handlers/settlement-hold-released.handler.ts · PC-56 TENANT-SW-a — THE LAST HOLD ON AN ORDER WAS RELEASED; IF
// ITS COMPLETION ARRIVED WHILE IT WAS HELD, SETTLE IT NOW.
//
// `payments.settlement_hold_released` is written (by SettlementHoldService, in logistics' transaction) when the last open hold of an
// order is released — a flagged POD approved or superseded by a dispute, a COD shortfall collected. The deferred completion payload is
// read as kv_app; settlement runs through OrderSettlementService — the SAME path and the SAME `settle:<orderId>` key as a normal
// completion, so a redelivery, or a completion racing this, settles once. No deferral (the order had not completed yet) → nothing to do:
// the completion, when it comes, finds no hold and settles normally. The deferral's settled_at is informational and written after the
// legs; the ledger key, not that column, decides whether money moves.
import { Inject, Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UNIT_OF_WORK, UnitOfWork } from '../../../../core/database/unit-of-work';
import { OrderSettlementService } from '../../services/order-settlement.service';
import { SettlementHoldRepository } from '../../repositories/settlement-hold.repository';
import { SETTLEMENT_HOLD_RELEASED_EVENT } from '../../services/settlement-hold.service';

@Injectable()
export class SettlementHoldReleasedHandler implements OutboxHandler {
  readonly eventType = SETTLEMENT_HOLD_RELEASED_EVENT;
  constructor(private readonly settlement: OrderSettlementService, private readonly holds: SettlementHoldRepository, @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const orderId = (event.payload.orderId as string | undefined) ?? event.aggregateId;
    if (!tenantId || !orderId) return;
    const deferral = await this.uow.run(tenantId, (r) => this.holds.deferralTx(r, tenantId, orderId), { userId: 'system' });
    if (!deferral) return;
    const out = await this.settlement.settle(tx, tenantId, orderId, deferral.payload);
    if (out === 'settled') await this.uow.run(tenantId, (w) => this.holds.markDeferralSettledTx(w, tenantId, orderId), { userId: 'system' });
  }
}
