// @krishalaya/sdk-js · returns resource (PC-54 W54-2). The return lifecycle the api already enforces
// (domain/return.state.ts): requested → approved → in_transit → received → refunded | rejected.
// The REFUND is the money leg (Resolve-gated, wallet-reversed server-side); request is Idempotency-Keyed.
// boxes: mine = my returns as buyer; against = returns on my sales; all = moderator.
import { HttpClient } from '../http';
import { Page } from '../types';

export const RETURN_STATUSES = ['requested', 'approved', 'in_transit', 'received', 'refunded', 'rejected'] as const;
export interface ReturnCase {
  id: string; orderId: string; buyerUserId?: string; sellerUserId?: string; status: string;
  reasonCode?: string | null; disputeId?: string | null; refundedMinor?: string | null; createdAt?: string; [k: string]: unknown;
}

export class ReturnsResource {
  constructor(private readonly http: HttpClient) {}

  /** Buyer: request a return (reason from the dispute taxonomy). Idempotent — a tap must never double-file. */
  async request(input: { orderId: string; reasonCode?: string; disputeId?: string }, idempotencyKey: string): Promise<ReturnCase> {
    return (await this.http.request<ReturnCase>('POST', 'returns', { body: input, idempotencyKey })).data;
  }
  async list(params: { box?: 'mine' | 'against' | 'all'; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<ReturnCase>> {
    const r = await this.http.request<ReturnCase[]>('GET', 'returns', { query: { box: params.box, status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<ReturnCase> {
    return (await this.http.request<ReturnCase>('GET', `returns/${encodeURIComponent(id)}`, { signal })).data;
  }
  // --- lifecycle (server re-validates state + party on every step) ---
  approve(id: string): Promise<ReturnCase> { return this.step(id, 'approve'); }
  reject(id: string): Promise<ReturnCase> { return this.step(id, 'reject'); }
  ship(id: string): Promise<ReturnCase> { return this.step(id, 'ship'); }
  receive(id: string): Promise<ReturnCase> { return this.step(id, 'receive'); }
  /** The money leg (Resolve-gated server-side). */
  refund(id: string): Promise<ReturnCase> { return this.step(id, 'refund'); }
  private step(id: string, action: string): Promise<ReturnCase> {
    return this.http.request<ReturnCase>('POST', `returns/${encodeURIComponent(id)}/${action}`, { body: {} }).then((r) => r.data);
  }
}
