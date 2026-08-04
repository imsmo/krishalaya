// modules/assistant/gateway/assistant-inference.port.ts
// Port to the INTERNAL ai-services governed-inference tier. Krishalaya owns the POLICY (guardrails, cost/rate
// caps, ai_inferences logging); ai-services owns the model. CONTRACT (Law 12 — degrade, never fabricate):
//   • ask(query) returns a GovernedReply: the model's answer + confidence + needsReview + optional citations +
//     the model identity (code/id) for the audit row. It is reached over s2s (shared-secret bearer).
//   • the adapter is resilience-wrapped (timeout+retry+breaker+bulkhead). On exhaustion / no provider configured
//     it does NOT throw an answer — it returns a needsReview reply with NO fabricated text (the service then
//     surfaces a safe "needs_review" message). An answer is therefore always real or explicitly absent.
export const ASSISTANT_INFERENCE = Symbol('ASSISTANT_INFERENCE');

export interface AssistantQuery {
  tenantId: string | null;
  message: string;            // already sanitized + injection-screened by the orchestrator
  languageCode: string;       // hi|en|gu
  sessionId?: string;
  /** coarse, non-PII context the model may use (e.g. crop/region label) — pointers only, never identifiers. */
  context?: Record<string, string>;
}

export interface GovernedReply {
  reply: string;              // '' when needsReview/degraded — the orchestrator substitutes a safe message
  needsReview: boolean;
  confidence: number | null;  // 0..1, or null when unknown
  citations: Array<{ title: string; url?: string }>;
  modelCode: string;          // e.g. 'farm_assistant'
  modelId: string | null;     // registry model id (for the ai_inferences audit), null when degraded/unregistered
  degraded: boolean;          // true ⇒ no real model ran (no provider / breaker open) — never a fabricated answer
}

export interface AssistantInferenceProvider {
  ask(q: AssistantQuery): Promise<GovernedReply>;
}
