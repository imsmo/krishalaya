// modules/ai-governance/services/ai-inference.service.ts · record every consequential AI decision (the
// explainability/audit spine) and route low-confidence/flagged ones to the human review queue. One ACID tx per
// write, outbox in-tx (Law 4), idempotent on the Idempotency-Key (Law 3). SCALE: recording does NOT emit an
// event (billions of ops); only ENQUEUEING a review emits AiReviewEnqueued. Money-free.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork, TxContext } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { AiGovernancePublisher } from '../events/ai-governance.publisher';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AiInference } from '../domain/ai-inference.entity';
import { AiReview } from '../domain/ai-review.entity';
import { DomainEvent, QueueKind } from '../domain/ai-governance.events';
import { AiInferenceRepository } from '../repositories/ai-inference.repository';
import { AiReviewRepository } from '../repositories/ai-review.repository';
import { AiModelRepository } from '../repositories/ai-model.repository';
import { CreateInferenceDto } from '../dto/create-ai-inference.dto';
import { OverrideInferenceDto } from '../dto/override-ai-inference.dto';
import { AiModelNotFoundError, InferenceNotFoundError, AiForbiddenError } from '../domain/ai-governance.errors';

export interface AiActor { userId: string; canReview: boolean; canModerate: boolean; canRead?: boolean }

/** Map a subject type to the review queue kind it should land in. */
function queueKindFor(subjectType: string, forced: boolean, belowThreshold: boolean): QueueKind {
  if (subjectType === 'listing' || subjectType === 'review') return 'fraud_flag';
  if (subjectType === 'price') return 'price_anomaly';
  if (belowThreshold) return 'low_confidence_grade';
  return forced ? 'manual' : 'low_confidence_grade';
}

@Injectable()
export class AiInferenceService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly publisher: AiGovernancePublisher,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly inferences: AiInferenceRepository,
    private readonly reviews: AiReviewRepository,
    private readonly models: AiModelRepository,
  ) {}

  /** Record an inference; if it's below the model's confidence threshold (or forced), enqueue a human review. */
  async record(tenantId: string, actor: AiActor, idemKey: string, dto: CreateInferenceDto) {
    if (!actor.canReview) throw new AiForbiddenError('requires ai.review');
    return this.idem.remember(idemKey, actor.userId, 'ai.inference.record', () =>
      timed(this.metrics, 'ai.inference.record', { tenant: tenantId }, () =>
        this.uow.run(tenantId, async (tx) => {
          const model = await this.models.getServingByCode(tx, dto.modelCode);
          if (!model) throw new AiModelNotFoundError(dto.modelCode);
          const inf = AiInference.record({ tenantId, modelId: model.id, subjectType: dto.subjectType, subjectId: dto.subjectId,
            inputRef: dto.inputRef, output: dto.output, confidence: dto.confidence ?? null });
          const { id, createdAt } = await this.inferences.insert(tx, inf);

          const belowThreshold = model.needsReview(dto.confidence ?? null);
          const enqueue = dto.forceReview || belowThreshold;
          let reviewId: string | null = null;
          if (enqueue && !(await this.reviews.existsForInference(tx, tenantId, id))) {
            const review = AiReview.enqueue({ id: uuidv7(), tenantId, inferenceId: id, inferenceCreatedAt: createdAt,
              queueKind: queueKindFor(dto.subjectType, dto.forceReview, belowThreshold),
              priority: belowThreshold ? 50 : 100, subjectType: dto.subjectType, subjectId: dto.subjectId });
            await this.reviews.insert(tx, review);
            await this.flush(tx, tenantId, review.id, review.pullEvents());
            reviewId = review.id;
          }
          this.metrics.inc('ai.inference.recorded', { review: enqueue ? '1' : '0' });
          return { id, createdAt, modelId: model.id, subjectType: dto.subjectType, subjectId: dto.subjectId,
            confidence: dto.confidence ?? null, reviewEnqueued: enqueue, reviewId };
        }, { userId: actor.userId })));
  }

  /** Mark an inference as overridden by a human (audit when AI was corrected out-of-band). */
  async override(tenantId: string, actor: AiActor, id: string, dto: OverrideInferenceDto) {
    if (!actor.canReview) throw new AiForbiddenError('requires ai.review');
    const createdAt = new Date(dto.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new InferenceNotFoundError(id);
    return timed(this.metrics, 'ai.inference.override', { tenant: tenantId }, () =>
      this.uow.run(tenantId, async (tx) => {
        const inf = await this.inferences.getForUpdate(tx, tenantId, id, createdAt);
        if (!inf) throw new InferenceNotFoundError(id);
        await this.inferences.markOverridden(tx, tenantId, id, createdAt, actor.userId, dto.reason);
        return { id, wasOverridden: true, overrideBy: actor.userId };
      }, { userId: actor.userId }));
  }

  async getById(tenantId: string, actor: AiActor, id: string) {
    if (!actor.canReview && !actor.canRead) throw new AiForbiddenError('requires ai.review or ai.inference.read');
    const inf = await this.inferences.getById(tenantId, id);
    if (!inf) throw new InferenceNotFoundError(id);
    return inf.toJSON();
  }
  async list(tenantId: string, actor: AiActor, q: { subjectType?: string; subjectId?: string; cursor?: { c: string; id: string }; limit: number }) {
    if (!actor.canReview && !actor.canRead) throw new AiForbiddenError('requires ai.review or ai.inference.read');
    const rows = await this.inferences.listFor(tenantId, q);
    const items = rows.map((i) => i.toJSON());
    const last = items[items.length - 1] as any;
    const nextCursor = items.length === q.limit && last ? Buffer.from(`${last.createdAt?.toISOString?.() ?? last.createdAt}|${last.id}`).toString('base64') : null;
    return { items, nextCursor };
  }
  private async flush(tx: TxContext, tenantId: string, reviewId: string, evts: DomainEvent[]): Promise<void> {
    await this.publisher.publish(tx, tenantId, 'ai_review', reviewId, evts);
  }
}
