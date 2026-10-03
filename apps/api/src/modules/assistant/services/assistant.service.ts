// modules/assistant/services/assistant.service.ts · governed farmer-assistant orchestration.
// Pipeline (each step fails CLOSED): screen (sanitize + injection guard) → cost/rate cap → governed s2s inference
// (resilience-wrapped, degrades to needs_review) → record an ai_inference + audit IN ONE tx → return a governed,
// logged answer. The model is the ONLY place an answer is generated (Law 11); a blocked or degraded turn returns
// a SAFE non-fabricated message, never an invented agronomic answer. Idempotent (Law 3); metric on every turn.
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics, timed } from '../../../core/observability/metrics';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { uuidv7 } from '../../../core/database/uuid.util';
import { AssistantRepository } from '../repositories/assistant.repository';
import { ASSISTANT_INFERENCE, AssistantInferenceProvider } from '../gateway/assistant-inference.port';
import { AskAssistantDto } from '../dto/assistant.dto';
import { screenMessage, safeFallbackReply } from '../domain/guardrails';
import { decideCap, ASSISTANT_CAPS } from '../domain/cost-cap';
import { AssistantRateLimitedError } from '../domain/assistant.errors';

export interface AssistantActor { userId: string; }
export type AssistantStatus = 'answered' | 'needs_review' | 'blocked';
export interface AssistantResult {
  reply: string; sessionId: string; status: AssistantStatus;
  citations: Array<{ title: string; url?: string }>;
  /** PC-56 TENANT-12 (F-7, additive): which registered model + version produced `reply` — so a client can print the AI disclosure
   *  with the model beside the answer. NULL when no model answered (blocked, degraded, needs review): no badge on a non-answer. */
  modelCode: string | null; modelVersion: string | null;
}

@Injectable()
export class AssistantService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(ASSISTANT_INFERENCE) private readonly inference: AssistantInferenceProvider,
    private readonly audit: AuditWriter,
    private readonly repo: AssistantRepository,
    @Inject(ASSISTANT_CAPS) private readonly caps: { dailyCap: number; perMinuteCap: number },
  ) {}

  async ask(tenantId: string, actor: AssistantActor, idemKey: string, dto: AskAssistantDto): Promise<AssistantResult> {
    return this.idem.remember(idemKey, actor.userId, 'assistant.ask', () =>
      timed(this.metrics, 'assistant.ask', { tenant: tenantId }, () => this.run(tenantId, actor, dto)));
  }

  private async run(tenantId: string, actor: AssistantActor, dto: AskAssistantDto): Promise<AssistantResult> {
    const sessionId = dto.sessionId ?? uuidv7();
    const lang = dto.languageCode;

    // 1) screen — sanitize + injection guard. A hit is REFUSED (no model call, no fabricated answer).
    const screen = screenMessage(dto.message);
    if (!screen.ok) {
      this.metrics.inc('assistant.blocked', { tenant: tenantId, reason: screen.reasons[0] ?? 'empty' });
      await this.record(tenantId, actor, { status: 'blocked', lang, modelId: null, confidence: null, citations: 0, degraded: false, reasons: screen.reasons });
      return { reply: safeFallbackReply(lang, 'blocked'), sessionId, status: 'blocked', citations: [], modelCode: null, modelVersion: null };
    }

    // 2) cost/rate caps — count this user's recent assistant turns on the replica, decide allow/deny.
    const now = Date.now();
    const [perMinute, perDay] = await Promise.all([
      this.repo.countSince(tenantId, actor.userId, new Date(now - 60_000).toISOString()),
      this.repo.countSince(tenantId, actor.userId, new Date(now - 86_400_000).toISOString()),
    ]);
    const decision = decideCap({ perMinute, perDay }, { perMinuteCap: this.caps.perMinuteCap, dailyCap: this.caps.dailyCap });
    if (!decision.allowed) {
      this.metrics.inc('assistant.rate_limited', { tenant: tenantId, limit: decision.limit });
      throw new AssistantRateLimitedError(decision.limit);
    }

    // 3) governed inference over s2s (resilience-wrapped; degrades to needsReview — never fabricates).
    const governed = await this.inference.ask({ tenantId, message: screen.clean, languageCode: lang, sessionId });
    const review = governed.degraded || governed.needsReview || governed.reply.trim().length === 0;
    const status: AssistantStatus = review ? 'needs_review' : 'answered';
    const reply = review ? safeFallbackReply(lang, 'needs_review') : governed.reply;
    const citations = review ? [] : governed.citations;

    // 4) record the governed decision (ai_inferences + audit) atomically — pointers only, never the message text.
    await this.record(tenantId, actor, { status, lang, modelId: governed.modelId, confidence: governed.confidence, citations: citations.length, degraded: governed.degraded, reasons: [] });
    this.metrics.inc('assistant.answered', { tenant: tenantId, status });
    return { reply, sessionId, status, citations, modelCode: review ? null : governed.modelCode, modelVersion: review ? null : governed.modelVersion };
  }

  private async record(tenantId: string, actor: AssistantActor, m: { status: AssistantStatus; lang: string; modelId: string | null; confidence: number | null; citations: number; degraded: boolean; reasons: string[] }): Promise<void> {
    await this.uow.run(tenantId, async (tx) => {
      const subjectId = uuidv7();
      await this.repo.insert(tx, {
        tenantId, modelId: m.modelId, subjectId,
        inputRef: { u: actor.userId, lang: m.lang, blocked: m.status === 'blocked', degraded: m.degraded, reasons: m.reasons.slice(0, 5) },
        output: { status: m.status, needsReview: m.status === 'needs_review', citations: m.citations },
        confidence: m.confidence,
      });
      await this.audit.write(tx, {
        tenantId, actorUserId: actor.userId,
        action: `assistant.${m.status}`, entityType: 'assistant_message', entityId: subjectId,
        newValue: { status: m.status, lang: m.lang, modelId: m.modelId, degraded: m.degraded },
      });
    }, { userId: actor.userId });
  }
}
