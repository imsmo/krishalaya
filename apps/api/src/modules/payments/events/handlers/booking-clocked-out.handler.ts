// PC-56 TENANT-SW-b · F-11 — RETIRED (no longer registered in OUTBOX_HANDLER_REGISTRY; see payments.module.ts). The "wage priority lane"
// promoted `payouts` rows with reference_type='labour_booking' that NOTHING writes: labour wages move as wallet legs (escrow Hold → worker
// Main) through the daily 18:00 IST wage run, never as bank payouts. Kept as a class only for payout-batch.integration.spec's lane test.
// modules/payments/events/handlers/booking-clocked-out.handler.ts
// Consumes `labour.wages_paid` (a labour engagement "clocked out" + settled into worker wallets,
// delivered by the outbox relay). Behind the `wage_priority_payout` flag (default OFF, kill-switch —
// Law 10), it PROMOTES that booking's still-queued payouts into the wage priority lane so a worker's
// money reaches their bank ahead of the bulk settlement queue (the wage-priority-lane worker job
// disburses low-priority-number payouts first).
//
// It MOVES NO MONEY and reads ONLY payments' own `payouts` table (the booking id comes from the event
// payload — never a cross-module table read, Law 11). Runs INSIDE the relay's per-event tx in the
// event's tenant context (RLS applies). IDEMPOTENT: promotion only lowers a priority still above the
// lane, so re-delivery is a no-op.
import { Injectable } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext } from '../../../../core/database/unit-of-work';
import { FlagsService } from '../../../../core/feature-flags/flags.service';
import { PayoutRepository } from '../../repositories/payout.repository';
import { WAGE_LANE_PRIORITY } from '../../domain/payout.state';

@Injectable()
export class BookingClockedOutHandler implements OutboxHandler {
  readonly eventType = 'labour.wages_paid';
  constructor(private readonly flags: FlagsService, private readonly payouts: PayoutRepository) {}

  async handle(event: OutboxEvent, tx: TxContext): Promise<void> {
    const tenantId = event.tenantId;
    if (!tenantId) return;                                  // platform-scope event → nothing to promote
    if (event.aggregateType !== 'labour_booking') return;   // only the booking-level settlement event
    const bookingId = event.aggregateId;
    if (!bookingId) return;
    if (!(await this.flags.isEnabled('wage_priority_payout', { tenantId }))) return;   // OFF by default (Law 10)
    await this.payouts.promoteToWageLane(tx, tenantId, bookingId, WAGE_LANE_PRIORITY);  // idempotent, in-module
  }
}
