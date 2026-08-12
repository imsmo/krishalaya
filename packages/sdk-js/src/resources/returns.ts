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
  refundTxnId?: string | null; createdAt?: string;
  /** PC-56 TENANT-3b (0139): W142's "Refund value" column, recorded at request and bounded by the order total
   *  SERVER-SIDE. The note above about "no refund amount here" described the schema BEFORE 0139 — the amount is now
   *  a recorded claim rather than a client guess, and the refund path refuses without it. */
  refundAmountMinor?: string | null;
  /** W142's "inspect within 24h → refund". A refund on an uninspected parcel is refused server-side. */
  inspectedAt?: string | null; inspectedBy?: string | null; inspectionNote?: string | null;
  [k: string]: unknown;
}

/** W142's queue row — the console read (returns/console/list), which joins the order number and currency and says
 *  whether a refund on this return is already waiting on a checker. */
export interface ReturnQueueRow {
  id: string; status: string; reasonCode: string | null; orderId: string; orderNo: string | null;
  refundAmountMinor: string | null; currencyCode: string | null; inspectedAt: string | null;
  createdAt: string; pendingApprovalId: string | null;
}

export class ReturnsResource {
  constructor(private readonly http: HttpClient) {}

  /** Buyer: request a return (reason from the dispute taxonomy). Idempotent — a tap must never double-file. */
  async request(input: { orderId: string; reasonCode?: string; disputeId?: string; refundAmountMinor?: string }, idempotencyKey: string): Promise<ReturnCase> {
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
  /** W142's Inspect (0139): a received parcel, opened, with a note ≥20 chars that the buyer can read. */
  async inspect(id: string, note: string): Promise<ReturnCase> {
    return (await this.http.request<ReturnCase>('POST', `returns/${encodeURIComponent(id)}/inspect`, { body: { note } })).data;
  }
  /** THE MONEY LEG. Needs `order.refund` (0139) AND an inspection AND a recorded amount AND — at or above the
   *  tenant's threshold — an approval signed by somebody else. */
  refund(id: string): Promise<ReturnCase> { return this.step(id, 'refund'); }
  /** W142's queue + tab counts (dispute.resolve). Keyset. */
  async consoleList(params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<ReturnQueueRow>> {
    const r = await this.http.request<ReturnQueueRow[]>('GET', 'returns/console/list', { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async counts(signal?: AbortSignal): Promise<Record<string, number>> {
    return (await this.http.request<Record<string, number>>('GET', 'returns/console/counts', { signal })).data;
  }
  private step(id: string, action: string): Promise<ReturnCase> {
    return this.http.request<ReturnCase>('POST', `returns/${encodeURIComponent(id)}/${action}`, { body: {} }).then((r) => r.data);
  }
}
