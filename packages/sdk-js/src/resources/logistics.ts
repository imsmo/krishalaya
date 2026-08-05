// @krishalaya/sdk-js · logistics shipments resource (module 5). Tracks an order's shipment and captures
// PROOF-OF-DELIVERY: the buyer's OTP (issued server-side, 4–8 digits) + an optional signed PoD photo (mediaId).
// The OTP is verified SERVER-SIDE (we send the raw code; the server hashes + compares) — the client never trusts
// itself. `deliver` carries an Idempotency-Key (Law 3) so a retried delivery can't double-fire. Delivery is gated
// to the assigned rider / logistics manager server-side.
import { HttpClient } from '../http';
import { Shipment, Page } from '../types';

export class ShipmentsResource {
  constructor(private readonly http: HttpClient) {}

  /** Shipments, filterable by order (and `box=mine` for the calling rider's assigned shipments). Keyset-paged. */
  async list(params: { box?: 'all' | 'mine'; orderId?: string; status?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<Shipment>> {
    const r = await this.http.request<Shipment[]>('GET', 'shipments', {
      query: { box: params.box ?? 'mine', orderId: params.orderId, status: params.status, cursor: params.cursor, limit: params.limit ?? 20 }, signal,
    });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<Shipment> {
    return (await this.http.request<Shipment>('GET', `shipments/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Mark delivered with proof-of-delivery: the buyer's OTP (required) + an optional uploaded PoD photo. */
  async deliver(id: string, input: { otp: string; podMediaId?: string }, idempotencyKey: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/deliver`, { idempotencyKey, body: input })).data;
  }
  /** Assigned rider (or manager) posts a live GPS ping (lat/lng + optional note) → appends a tracking point
   *  to the shipment timeline (no status change). Server enforces rider/manager authorization. */
  async postLocation(id: string, loc: { lat: number; lng: number; note?: string }): Promise<{ ok: boolean }> {
    return (await this.http.request<{ ok: boolean }>('POST', `shipments/${encodeURIComponent(id)}/location`, { body: loc })).data;
  }

  // --- rider lifecycle (PC-50 W10-5; the server verifies the caller IS the assigned rider) ---
  async markPickedUp(id: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/picked-up`, { body: {} })).data;
  }
  async markInTransit(id: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/in-transit`, { body: {} })).data;
  }
  async markAtHub(id: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/at-hub`, { body: {} })).data;
  }
  async markOutForDelivery(id: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/out-for-delivery`, { body: {} })).data;
  }
  /** A failed attempt keeps the shipment re-attemptable; the reason is required and audited. */
  async fail(id: string, reason: string): Promise<Shipment> {
    return (await this.http.request<Shipment>('POST', `shipments/${encodeURIComponent(id)}/fail`, { body: { reason } })).data;
  }

  /** PC-54 W54-2 `cod-recon`: outstanding delivered COD per rider (Manage-gated). Minor strings (Law 2). */
  async codOutstanding(signal?: AbortSignal): Promise<Array<{ riderUserId: string | null; shipments: number; codMinor: string; oldestDeliveredAt: string | null }>> {
    return (await this.http.request<Array<{ riderUserId: string | null; shipments: number; codMinor: string; oldestDeliveredAt: string | null }>>('GET', 'shipments/cod/outstanding', { signal })).data;
  }

  // --- PC-54 W54-12: iot-device-fleet + ops-alerting v1 (Manage-gated read-models) ---
  async coldChainDevices(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'logistics/cold-chain/devices', { signal })).data;
  }
  async coldChainBreaches(params: { hours?: number; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'logistics/cold-chain/breaches', { query: { hours: params.hours ?? 24, limit: params.limit ?? 100 }, signal })).data;
  }

  // --- PC-55 A2 `cod-remittance-ledger` (Manage-gated). The TOTAL is server-computed: you may send
  // expectedAmountMinor from the worksheet you were reading, and a stale figure is REFUSED (409) — never
  // silently banked. Create is Idempotency-Keyed; reconcile enforces maker≠checker server-side. ---
  async createCodRemittance(input: { riderUserId: string; shipmentIds?: string[]; expectedAmountMinor?: string; depositRef?: string; depositMethod?: 'bank_branch' | 'cash_office' | 'upi' | 'other'; currencyCode?: string }, idempotencyKey: string): Promise<{ id: string; status: string; amountMinor: string; shipmentCount: number }> {
    return (await this.http.request<{ id: string; status: string; amountMinor: string; shipmentCount: number }>('POST', 'shipments/cod/remittances', { body: input, idempotencyKey })).data;
  }
  async codRemittances(params: { riderUserId?: string; status?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'shipments/cod/remittances', { query: { riderUserId: params.riderUserId, status: params.status, limit: params.limit ?? 100 }, signal })).data;
  }
  async codRemittance(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', `shipments/cod/remittances/${encodeURIComponent(id)}`, { signal })).data;
  }
  async depositCodRemittance(id: string, input: { depositRef: string; depositMethod: 'bank_branch' | 'cash_office' | 'upi' | 'other' }): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `shipments/cod/remittances/${encodeURIComponent(id)}/deposit`, { body: input })).data;
  }
  async reconcileCodRemittance(id: string, note?: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `shipments/cod/remittances/${encodeURIComponent(id)}/reconcile`, { body: note ? { note } : {} })).data;
  }
  async cancelCodRemittance(id: string, reason: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `shipments/cod/remittances/${encodeURIComponent(id)}/cancel`, { body: { reason } })).data;
  }
}
