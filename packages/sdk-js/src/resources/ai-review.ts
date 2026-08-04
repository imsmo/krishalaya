// @krishalaya/sdk-js · AI review-queue resource (human-in-the-loop, P1-12). A reviewer browses the queue of
// AI decisions awaiting human judgement (low-confidence grades, fraud flags, price anomalies, …), claims an item,
// and resolves it accepted/rejected — the resolution drives the originating module via the server's outbox.
// Every call is gated server-side by `ai.review` + the `ai_governance` flag, and RLS-isolated to the tenant.
import { HttpClient } from '../http';
import { AiReviewItem, AiReviewStatus, AiReviewQueueKind, EnqueueReviewInput, ResolveReviewInput, Page } from '../types';

export class AiReviewResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse the queue: `open` (pending + in_review) or `all`; optional status / queueKind filter. */
  async list(params: { box?: 'open' | 'all'; status?: AiReviewStatus; queueKind?: AiReviewQueueKind; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<AiReviewItem>> {
    const r = await this.http.request<AiReviewItem[]>('GET', 'ai/review-queue', { query: { box: params.box ?? 'open', status: params.status, queueKind: params.queueKind, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** A single queue item. */
  async get(id: string, signal?: AbortSignal): Promise<AiReviewItem> {
    return (await this.http.request<AiReviewItem>('GET', `ai/review-queue/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Manually enqueue a HITL item not tied to an inference (e.g. an out-of-band fraud flag). */
  async enqueue(input: EnqueueReviewInput): Promise<AiReviewItem> {
    return (await this.http.request<AiReviewItem>('POST', 'ai/review-queue', { body: input })).data;
  }
  /** Take ownership of a pending item (pending → in_review). */
  async claim(id: string): Promise<AiReviewItem> {
    return (await this.http.request<AiReviewItem>('POST', `ai/review-queue/${encodeURIComponent(id)}/claim`, {})).data;
  }
  /** Record the reviewer's decision (accepted | rejected) with an optional note. */
  async resolve(id: string, input: ResolveReviewInput): Promise<AiReviewItem> {
    return (await this.http.request<AiReviewItem>('POST', `ai/review-queue/${encodeURIComponent(id)}/resolve`, { body: input })).data;
  }
}
