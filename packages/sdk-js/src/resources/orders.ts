// @krishalaya/sdk-js · orders resource (module 5). Read the buyer/seller timeline (keyset/cursor — never offset)
// and one order's detail; drive the lifecycle (confirm → packed → ready → delivered → completed, plus cancel /
// dispute). Ownership + the legal state transition are enforced SERVER-SIDE (the entity state machine + RLS) — the
// client only reflects what's allowed. Lifecycle POSTs carry an Idempotency-Key (Law 3): a retried "confirm" from a
// flaky network can't double-apply. Money is bigint minor-unit strings (Law 2).
import { HttpClient } from '../http';
import { OrderListItem, OrderDetail, WalletPaymentResult, OrderTracking, OrderBuyerSummary, Page } from '../types';

export type OrderRole = 'buyer' | 'seller';

export class OrdersResource {
  constructor(private readonly http: HttpClient) {}

  /** The caller's orders as buyer or seller, optionally filtered by status. Keyset-paged. */
  async list(params: { role: OrderRole; status?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<OrderListItem>> {
    const r = await this.http.request<OrderListItem[]>('GET', 'orders', {
      query: { role: params.role, status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<OrderDetail> {
    return (await this.http.request<OrderDetail>('GET', `orders/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Order-tracking feed (buyer/seller): stamped order-status transitions + the shipment's status/location
   *  timeline (real per-step timestamps; lat/lng when a rider has posted a ping). No ETA is returned — the
   *  caller shows ETA as unknown rather than fabricating one. */
  async tracking(id: string, signal?: AbortSignal): Promise<OrderTracking> {
    return (await this.http.request<OrderTracking>('GET', `orders/${encodeURIComponent(id)}/tracking`, { signal })).data;
  }

  /** Buyer trust summary for the seller's accept/reject decision (seller/moderator only): the buyer's order
   *  counts in this tenant + their verified business type. Coarse, non-PII signals; no distance/tenure (§13). */
  async buyerSummary(id: string, signal?: AbortSignal): Promise<OrderBuyerSummary> {
    return (await this.http.request<OrderBuyerSummary>('GET', `orders/${encodeURIComponent(id)}/buyer-summary`, { signal })).data;
  }

  // --- lifecycle (idempotent transitions; the server re-validates state + ownership) ---
  confirm(id: string, idempotencyKey: string): Promise<{ ok: boolean }> { return this.transition(id, 'confirm', idempotencyKey); }
  markPacked(id: string, idempotencyKey: string): Promise<{ ok: boolean }> { return this.transition(id, 'packed', idempotencyKey); }
  markReady(id: string, idempotencyKey: string): Promise<{ ok: boolean }> { return this.transition(id, 'ready', idempotencyKey); }
  markDelivered(id: string, idempotencyKey: string): Promise<{ ok: boolean }> { return this.transition(id, 'delivered', idempotencyKey); }
  complete(id: string, idempotencyKey: string): Promise<{ ok: boolean }> { return this.transition(id, 'complete', idempotencyKey); }
  cancel(id: string, idempotencyKey: string, reasonId?: string): Promise<{ ok: boolean }> {
    return this.http.request<{ ok: boolean }>('POST', `orders/${encodeURIComponent(id)}/cancel`, { idempotencyKey, body: { reasonId } }).then((r) => r.data);
  }
  /** Raise a dispute / report a problem with an order (free-text note; the server opens the case). */
  dispute(id: string, note: string, idempotencyKey: string): Promise<{ ok: boolean }> {
    return this.http.request<{ ok: boolean }>('POST', `orders/${encodeURIComponent(id)}/dispute`, { idempotencyKey, body: { note } }).then((r) => r.data);
  }

  /** Pay an awaiting-payment order from the buyer's OWN wallet balance (alternative to the gateway).
   *  Idempotent (Law 3); the server charges the order's authoritative total and fails closed if the
   *  wallet can't cover it. The order confirms shortly after (async, via the same path as a gateway pay). */
  payFromWallet(id: string, idempotencyKey: string): Promise<WalletPaymentResult> {
    return this.http.request<WalletPaymentResult>('POST', `orders/${encodeURIComponent(id)}/pay-from-wallet`, { idempotencyKey, body: {} }).then((r) => r.data);
  }

  private transition(id: string, action: string, idempotencyKey: string): Promise<{ ok: boolean }> {
    return this.http.request<{ ok: boolean }>('POST', `orders/${encodeURIComponent(id)}/${action}`, { idempotencyKey, body: {} }).then((r) => r.data);
  }
}
