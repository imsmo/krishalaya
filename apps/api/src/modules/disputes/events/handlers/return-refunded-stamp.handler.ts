// modules/disputes/events/handlers/return-refunded-stamp.handler.ts
// Consumes payments.return_refunded (via the outbox relay). Stamps the ledger reversal txn id onto the refunded
// return (`refund_txn_id`) — the audit link W142 promises ("Refunds are ledger reversals (refund_txn_id) — the money
// trail always closes") and which nothing wrote before PC-56 TENANT-3b, because nothing consumed the refund event at
// all. Runs INSIDE the relay tx, touches only the disputes module's own table. IDEMPOTENT: stamps only once.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { ReturnRepository } from '../../repositories/return.repository';

@Injectable()
export class ReturnRefundedStampHandler implements OutboxHandler {
  readonly eventType = 'payments.return_refunded';
  constructor(private readonly repo: ReturnRepository) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    const p = event.payload as Record<string, unknown>;
    const returnId = (p.returnId as string | undefined) ?? event.aggregateId;
    const txnId = p.txnId as string | undefined;
    if (!tenantId || !returnId || !txnId) return;
    await this.repo.stampRefundTxn(tx, tenantId, returnId, txnId);
  }
}
