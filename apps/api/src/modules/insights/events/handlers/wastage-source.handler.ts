// modules/insights/events/handlers/wastage-source.handler.ts · PC-56 TENANT-SW-f · W195 (DELTA-031) — a recorded loss becomes ONE wastage
// event. One class, registered once per SOURCE event (the registry keys a handler by its event type):
//   disputes.return_refunded               → returns              (a return accepted and refunded: the refund is the money fact)
//   dairy.quality_flag_decided             → milk_quality_reviews (rejected pours only — a cleared one is not a fact and writes nothing)
//   disputes.dispute_resolved              → disputes             (a POD-opened dispute resolved with a refund)
//   logistics.cold_chain_outcome_recorded  → cold_chain_breaches  (outcome loss_recorded only)
//   logistics.pod_rejected                 → pod_reviews          (a POD rejection confirmed by a second person)
//
// The handler names the SOURCE and nothing else: `kv_wastage_record` (0202) takes a per-source advisory lock, answers `exists` for a
// source already recorded (at-least-once delivery is idempotent), `not_fact` for one that is not a loss, and the table's trigger derives
// every fact column from the source row. HOTFIX-2: the relay runs as kv_relay, which holds NOTHING on wastage_events — the write happens
// in a kv_app unit of work scoped to the event's tenant (INSERT is all kv_app holds there).
import { Logger } from '@nestjs/common';
import { OutboxEvent, OutboxHandler } from '../../../../core/outbox/event-envelope';
import { TxContext, UnitOfWork } from '../../../../core/database/unit-of-work';
import { InsightsRepository } from '../../repositories/insights.repository';
import type { WastageSourceTable } from '../../domain/insights';

/** The source events, their table and the payload key that names the source row. */
export const WASTAGE_SOURCE_EVENTS: ReadonlyArray<{ eventType: string; table: WastageSourceTable; idKey: string }> = [
  { eventType: 'disputes.return_refunded', table: 'returns', idKey: 'returnId' },
  { eventType: 'dairy.quality_flag_decided', table: 'milk_quality_reviews', idKey: 'reviewId' },
  { eventType: 'disputes.dispute_resolved', table: 'disputes', idKey: 'disputeId' },
  { eventType: 'logistics.cold_chain_outcome_recorded', table: 'cold_chain_breaches', idKey: 'breachId' },
  { eventType: 'logistics.pod_rejected', table: 'pod_reviews', idKey: 'podReviewId' },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WastageSourceHandler implements OutboxHandler {
  private readonly log = new Logger(WastageSourceHandler.name);
  constructor(readonly eventType: string, private readonly table: WastageSourceTable, private readonly idKey: string,
              private readonly uow: UnitOfWork, private readonly repo: InsightsRepository) {}

  async handle(event: OutboxEvent, _relayTx: TxContext): Promise<void> {
    const id = event.payload?.[this.idKey];
    if (!event.tenantId || typeof id !== 'string' || !UUID.test(id)) return;   // malformed — never invent a source
    const tenantId = event.tenantId;
    const verdict = await this.uow.run(tenantId, (tx) => this.repo.record(tx, this.table, id, 'event', null), { userId: undefined });
    if (verdict === 'written') this.log.log(`wastage event recorded from ${this.table} ${id}`);
  }
}
