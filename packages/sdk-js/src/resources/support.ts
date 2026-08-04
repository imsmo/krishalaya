// @krishalaya/sdk-js · support tickets resource (P-22 help/complaint). The caller opens a ticket (idempotent —
// Law 3), lists/reads their OWN tickets (box=mine, server-scoped — no IDOR), and rates CSAT once resolved. SLA
// due-times are server-set from severity and read-only on the app (the app never decides SLA — Law 11). Agent
// actions (assign/respond/transition) are NOT exposed here — they need support.handle and live in the console.
// Gated server-side by the `support` flag.
import { HttpClient } from '../http';
import { SupportTicket, SupportThread, Page } from '../types';

export class SupportResource {
  constructor(private readonly http: HttpClient) {}
  /** Open a ticket. `severity` defaults server-side to P2; needs a subject or a category. Idempotent (Law 3). */
  async open(input: { subject?: string; categoryId?: string; severity?: 'P0' | 'P1' | 'P2' | 'P3'; channel?: string }, idempotencyKey: string): Promise<SupportTicket> {
    return (await this.http.request<SupportTicket>('POST', 'support/tickets', { idempotencyKey, body: { channel: input.channel ?? 'app', subject: input.subject, categoryId: input.categoryId, severity: input.severity } })).data;
  }
  /** GET /v1/support/tickets/:id/thread (screen 520) — lazily creates (first call) or returns the existing chat
   * thread linked to this ticket. Requester-or-agent-only (404 for a stranger — no IDOR). The caller then drives
   * the actual conversation via `conversations.listMessages`/`postMessage` on the returned conversationId. */
  async thread(id: string, signal?: AbortSignal): Promise<SupportThread> {
    return (await this.http.request<SupportThread>('GET', `support/tickets/${encodeURIComponent(id)}/thread`, { signal })).data;
  }
  /** The caller's own tickets (box=mine), keyset. */
  async myTickets(params: { status?: string; severity?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<SupportTicket>> {
    const r = await this.http.request<SupportTicket[]>('GET', 'support/tickets', { query: { box: 'mine', status: params.status, severity: params.severity, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<SupportTicket> {
    return (await this.http.request<SupportTicket>('GET', `support/tickets/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Rate satisfaction (1–5) on a resolved/closed ticket. */
  async submitCsat(id: string, score: number): Promise<SupportTicket> {
    return (await this.http.request<SupportTicket>('POST', `support/tickets/${encodeURIComponent(id)}/csat`, { body: { score } })).data;
  }
}
