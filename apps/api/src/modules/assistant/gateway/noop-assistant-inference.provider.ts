// modules/assistant/gateway/noop-assistant-inference.provider.ts
// Degrade adapter, bound when ai-services is NOT configured (no AI_SERVICES_URL / shared secret). It NEVER
// fabricates an answer — it returns a degraded needsReview reply (empty text), so the orchestrator surfaces a
// safe "the assistant isn't available" message and logs a needs_review inference. This keeps the contract
// "no key → safe degrade, never a fabricated answer" true in local/dev and in prod misconfig.
import { AssistantInferenceProvider, AssistantQuery, GovernedReply } from './assistant-inference.port';

export class NoopAssistantInferenceProvider implements AssistantInferenceProvider {
  async ask(_q: AssistantQuery): Promise<GovernedReply> {
    return { reply: '', needsReview: true, confidence: null, citations: [], modelCode: 'farm_assistant', modelId: null, modelVersion: null, degraded: true };
  }
}
