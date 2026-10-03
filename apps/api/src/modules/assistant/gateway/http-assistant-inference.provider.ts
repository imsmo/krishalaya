// modules/assistant/gateway/http-assistant-inference.provider.ts
// Real s2s adapter to the internal ai-services assistant endpoint (POST {base}/v1/assistant). Authenticated with
// a constant shared-secret bearer (Law 11: inference runs ONLY in the service tier). Resilience-wrapped
// (timeout+retry+breaker+bulkhead). On exhaustion it DEGRADES (returns needsReview, never a fabricated answer) so
// one slow/dead model tier can't hang or fake the farmer's request. No PII crosses the wire — only the sanitized
// message + coarse context pointers.
import { Logger } from '@nestjs/common';
import { ResilienceService } from '../../../core/resilience/resilience.service';
import { AssistantInferenceProvider, AssistantQuery, GovernedReply } from './assistant-inference.port';

const DEP = 'ai-assistant';

export interface HttpAssistantConfig { baseUrl: string; sharedSecret: string; timeoutMs: number }

export class HttpAssistantInferenceProvider implements AssistantInferenceProvider {
  private readonly log = new Logger('AssistantInference');
  constructor(private readonly cfg: HttpAssistantConfig, private readonly resilience: ResilienceService) {}

  async ask(q: AssistantQuery): Promise<GovernedReply> {
    const degraded: GovernedReply = { reply: '', needsReview: true, confidence: null, citations: [], modelCode: 'farm_assistant', modelId: null, modelVersion: null, degraded: true };
    return this.resilience.run<GovernedReply>(DEP, async () => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
      try {
        const res = await fetch(`${this.cfg.baseUrl}/v1/assistant`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.sharedSecret}`, accept: 'application/json' },
          body: JSON.stringify({ tenant_id: q.tenantId, message: q.message, language_code: q.languageCode, session_id: q.sessionId ?? null, context: q.context ?? {} }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`ai-services responded ${res.status}`);
        const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        const reply = typeof out.reply === 'string' ? out.reply : '';
        const needsReview = out.needs_review === true || reply.length === 0;
        const citations = Array.isArray(out.citations)
          ? (out.citations as Array<Record<string, unknown>>).slice(0, 10).map((c) => ({ title: String(c.title ?? ''), url: typeof c.url === 'string' ? c.url : undefined })).filter((c) => c.title)
          : [];
        return {
          reply: needsReview ? '' : reply,
          needsReview,
          confidence: typeof out.confidence === 'number' ? out.confidence : null,
          citations,
          modelCode: typeof out.model_code === 'string' ? out.model_code : 'farm_assistant',
          modelId: typeof out.model_id === 'string' ? out.model_id : null,
          modelVersion: typeof out.model_version === 'string' ? out.model_version : null,
          degraded: false,
        };
      } finally {
        clearTimeout(t);
      }
    }, {
      // GET-like, side-effect-free inference: safe to retry; on exhaustion DEGRADE (never fabricate, never hang).
      fallback: () => { this.log.warn('ai-services assistant unavailable — degrading to needs_review'); return degraded; },
    });
  }
}
