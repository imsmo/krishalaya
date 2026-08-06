// @krishalaya/sdk-js · returns resource (PC-54 W54-2). The return lifecycle the api already enforces
// (domain/return.state.ts): requested → approved → in_transit → received → refunded | rejected.
// The REFUND is the money leg (Resolve-gated, wallet-reversed server-side); request is Idempotency-Keyed.
// boxes: mine = my returns as buyer; against = returns on my sales; all = moderator.
import { HttpClient } from '../http';
import { Page } from '../types';

export const RETURN_STATUSES = ['requested', 'approved', 'in_transit', 'received', 'refunded', 'rejected'] as const;
/** The shape the API actually serializes (modules/disputes/services/return.service.ts#serialize).
 *  • `reasonCode` is the dispute_reason CODE, resolved server-side from `reasonId` (PC-55 B8) — null when the id
 *    resolves to nothing, so an unnameable reason reads as unknown rather than as a plausible default.
 *  • `refundTxnId` is the wallet transaction the refund was booked as. There is deliberately NO refund AMOUNT here:
 *    the money lives in the wallet ledger, and a field that looked like an amount but was populated by a client
 *    guess would be exactly the fabricated money Law 2 forbids. Read the amount from the wallet txn.
 *  • buyer/seller are NOT on the row (returns carry no party columns; they come from dispute_eligibility) — the API
 *    resolves the caller's role instead of exposing the counterparty. */
export interface ReturnCase {
  id: string; orderId: string; status: string;
  reasonId?: string | null; reasonCode?: string | null; disputeId?: string | null;
  refundTxnId?: string | null; createdAt?: string; [k: string]: unknown;
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
