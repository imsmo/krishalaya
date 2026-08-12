// modules/ai-governance/events/ai-governance.publisher.ts
// Typed façade over the outbox writer for ai-governance's integration events. Every event is written
// INSIDE the caller's db transaction (Law 4) so the state change + event commit atomically. Payloads are
// versioned ({ v: 1, ... }) and carry IDs only — NEVER PII, never the model input/output (the inference
// row itself is never emitted; that would be write amplification at billions of ops). Consumers
// (notifications / the originating module) are at-least-once + idempotent.
//
// What ai-governance emits (the shared contract downstream modules rely on):
//   ai.review_enqueued     { reviewId, queueKind, subjectType, subjectId }
//       — a low-confidence/flagged inference (or a manual op item) needs a human; notify AI Ops.
//   ai.review_resolved     { reviewId, decision:'accepted'|'rejected', queueKind, subjectType, subjectId, reviewerUserId }
//       — the originating module (listings/messaging/…) acts on the human decision.
//   ai.moderation_filed    { reportId, subjectType, subjectId }
//       — the FIRST open report against a subject; notify moderators (deduped — not per duplicate report).
//   ai.moderation_actioned { reportId, subjectType, subjectId, status, actionTaken, handledBy }
//       — a moderator actioned/dismissed a report; the owning module applies hide/remove/etc.
//   ai.model_promoted / ai.model_retired  { modelId, code, status }
//       — model lifecycle (defined here as the shared contract).
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { TxContext } from '../../../core/database/unit-of-work';
import { DomainEvent } from '../domain/ai-governance.events';

/** The ai-governance aggregates that publish events (matches the outbox aggregate_type written today).
 *  'appeal' added by ADMIN-SWEEP-b1 — an appeal is not a report and must not masquerade as one in the event log. */
export type AiAggregateType = 'ai_review' | 'moderation_report' | 'ai_model' | 'appeal';

@Injectable()
export class AiGovernancePublisher {
  constructor(@Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter) {}

  /** Emit a batch of an aggregate's domain events, each in the caller's tx (Law 4). The single write
   *  path every ai-governance service routes through — keeps the {v:1,...} envelope + aggregate_type
   *  naming consistent and gives one place to assert the no-PII contract. */
  async publish(tx: TxContext, tenantId: string, aggregateType: AiAggregateType, aggregateId: string, events: DomainEvent[]): Promise<void> {
    for (const e of events) {
      await this.outbox.write(tx, { tenantId, aggregateType, aggregateId, eventType: e.type, payload: { v: 1, ...e.payload } });
    }
  }
}
