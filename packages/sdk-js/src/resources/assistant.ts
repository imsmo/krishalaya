// @krishalaya/sdk-js · AI farm-assistant resource (P-20 AI-chat). ASSUMED CONTRACT: no farmer-facing AI endpoint
// is live yet (the only AI surface today is the admin `ai/inferences` governance queue, which is NOT this). We wire
// the real call shape we expect — POST ai/assistant/messages with the user's message + UI language + a thread
// sessionId, idempotent (Law 3) so a retried turn can't double-post — and the data layer degrades honestly if the
// endpoint 404s (the app NEVER fabricates an answer). The server is the only place inference runs (Law 11).
import { HttpClient } from '../http';
import { AssistantReply } from '../types';

export class AssistantResource {
  constructor(private readonly http: HttpClient) {}
  /** Ask the assistant. `languageCode` ∈ hi|en|gu so the model replies in the farmer's language. `sessionId`
   * threads the conversation (omit to start one). `idempotencyKey` dedupes a retried send (Law 3). */
  async ask(input: { message: string; languageCode: string; sessionId?: string }, idempotencyKey: string, signal?: AbortSignal): Promise<AssistantReply> {
    return (await this.http.request<AssistantReply>('POST', 'ai/assistant/messages', { idempotencyKey, body: input, signal })).data;
  }
}
