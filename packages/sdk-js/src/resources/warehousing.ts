// @krishalaya/sdk-js · warehousing resource (PC-32 OW-2). Warehouses, storage bookings (deposit lifecycle:
// requested → confirmed → stored → released, +cancel pre-storage), assay reports, and eNWR receipts (NERL/CCRL).
// Ops writes are gated server-side by warehousing.manage (deposit REQUEST is the depositor's warehousing.store).
// Money is bigint minor-unit STRINGS (Law 2: eNWR valuation; storage fees are server-computed). eNWR issue and
// booking release are Idempotency-Keyed (Law 3 — a receipt or a release must never double-fire).
import { HttpClient } from '../http';
import { Page } from '../types';

export interface Warehouse { id: string; defaultName: string; regionId?: string | null; capacity?: string | null; capacityUnit?: string | null; isActive?: boolean; createdAt?: string; }
export interface StorageBooking {
  id: string; warehouseId: string; productId: string; quantity: string; unitCode: string; status: string;
  expectedArrival?: string | null; storedAt?: string | null; releasedAt?: string | null; feeMinor?: string | null; createdAt?: string;
  productName?: string | null; warehouseName?: string | null;
}
export interface AssayReport { id: string; storageBookingId: string; assayerName: string; parameters: Record<string, string | number | boolean>; gradeOptionId?: string | null; reportMediaId?: string | null; validUntil?: string | null; createdAt?: string; }
export interface NwrReceipt { id: string; storageBookingId: string; repository: string; enwrNo: string; valuationMinor: string; status: string; expiresAt?: string | null; createdAt?: string; }

export class WarehousingResource {
  constructor(private readonly http: HttpClient) {}

  // --- warehouses ---
  async warehouses(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Warehouse>> {
    const r = await this.http.request<Warehouse[]>('GET', 'warehousing/warehouses', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async createWarehouse(input: { defaultName: string; regionId?: string; capacity?: string; capacityUnit?: string }): Promise<Warehouse> {
    return (await this.http.request<Warehouse>('POST', 'warehousing/warehouses', { body: input })).data;
  }

  // --- storage bookings (the deposit lifecycle) ---
  async requestBooking(input: { warehouseId: string; productId: string; quantity: string; unitCode: string; expectedArrival?: string }): Promise<StorageBooking> {
    return (await this.http.request<StorageBooking>('POST', 'warehousing/storage-bookings', { body: input })).data;
  }
  async bookings(params: { status?: string; warehouseId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<StorageBooking>> {
    const r = await this.http.request<StorageBooking[]>('GET', 'warehousing/storage-bookings', { query: { status: params.status, warehouseId: params.warehouseId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async booking(id: string, signal?: AbortSignal): Promise<StorageBooking> {
    return (await this.http.request<StorageBooking>('GET', `warehousing/storage-bookings/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Ops: confirm arrival (requested → confirmed). */
  async confirmBooking(id: string): Promise<StorageBooking> {
    return (await this.http.request<StorageBooking>('POST', `warehousing/storage-bookings/${encodeURIComponent(id)}/confirm`, {})).data;
  }
  /** Ops: mark stored after weighment (confirmed → stored). */
  async storeBooking(id: string): Promise<StorageBooking> {
    return (await this.http.request<StorageBooking>('POST', `warehousing/storage-bookings/${encodeURIComponent(id)}/store`, {})).data;
  }
  /** Ops: release the goods (stored → released) — Idempotency-Keyed (storage fee settles server-side). */
  async releaseBooking(id: string, idempotencyKey: string): Promise<StorageBooking> {
    return (await this.http.request<StorageBooking>('POST', `warehousing/storage-bookings/${encodeURIComponent(id)}/release`, { idempotencyKey, body: {} })).data;
  }
  async cancelBooking(id: string, reason?: string): Promise<StorageBooking> {
    return (await this.http.request<StorageBooking>('POST', `warehousing/storage-bookings/${encodeURIComponent(id)}/cancel`, { body: { reason } })).data;
  }

  // --- assay reports (quality lab, hangs off a booking) ---
  async recordAssay(bookingId: string, input: { assayerName: string; parameters: Record<string, string | number | boolean>; gradeOptionId?: string; reportMediaId?: string; validUntil?: string }): Promise<AssayReport> {
    return (await this.http.request<AssayReport>('POST', `warehousing/storage-bookings/${encodeURIComponent(bookingId)}/assays`, { body: { storageBookingId: bookingId, ...input } })).data;
  }
  async assays(bookingId: string, signal?: AbortSignal): Promise<AssayReport[]> {
    return (await this.http.request<AssayReport[]>('GET', `warehousing/storage-bookings/${encodeURIComponent(bookingId)}/assays`, { signal })).data;
  }

  // --- eNWR receipts ---
  async issueNwr(input: { storageBookingId: string; repository: string; enwrNo: string; valuationMinor: string; expiresAt?: string }, idempotencyKey: string): Promise<NwrReceipt> {
    return (await this.http.request<NwrReceipt>('POST', 'warehousing/nwr', { idempotencyKey, body: input })).data;
  }
  async nwrs(params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<NwrReceipt>> {
    const r = await this.http.request<NwrReceipt[]>('GET', 'warehousing/nwr', { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async releaseNwr(id: string): Promise<NwrReceipt> {
    return (await this.http.request<NwrReceipt>('POST', `warehousing/nwr/${encodeURIComponent(id)}/release`, {})).data;
  }
  async cancelNwr(id: string): Promise<NwrReceipt> {
    return (await this.http.request<NwrReceipt>('POST', `warehousing/nwr/${encodeURIComponent(id)}/cancel`, {})).data;
  }
}
