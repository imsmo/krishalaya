// @krishalaya/sdk-js · warehousing resource (PC-32 OW-2). Warehouses, storage bookings (deposit lifecycle:
// requested → confirmed → stored → released, +cancel pre-storage), assay reports, and eNWR receipts (NERL/CCRL).
// Ops writes are gated server-side by warehousing.manage (deposit REQUEST is the depositor's warehousing.store).
// Money is bigint minor-unit STRINGS (Law 2; storage fees are server-computed). Booking release and receipt cancel are Idempotency-Keyed
// (Law 3). PC-56 OPS-2b: eNWR issue and standalone receipt release are refused by the API and no longer offered here.
import { HttpClient } from '../http';
import { Page } from '../types';

// PC-56 OPS-2c (survey F-9 / C-16, a minimal deviation recorded in the wave report): W378 reads the operator's OWN warehouses and their rate on
// file, so `warehouses()` gains `box` and the type gains the fields the API's `toJSON` returns that W378 prints. The rest of the type drift and
// the bookings / receipts `box` are OPS-2a's (OPS2-B7, E13).
export interface Warehouse {
  id: string; defaultName: string; regionId?: string | null; capacity?: string | null; capacityUnit?: string | null; isActive?: boolean; createdAt?: string;
  operatorUserId?: string | null; wdraRegNo?: string | null; capacityMt?: string | null;
  /** The storage rate on file NOW, per quintal per month, a bigint minor-unit STRING (null: none set). Never computed on a client. */
  ratePerQtlMonthMinor?: string | null;
}
/** `mine` = warehouses the caller operates (tenant-scoped); `browse` (the API default) = the tenant's + platform-global; `all` = needs booking.manage. */
export type WarehouseBox = 'mine' | 'browse' | 'all';
export interface StorageBooking {
  id: string; warehouseId: string; productId: string; quantity: string; unitCode: string; status: string;
  expectedArrival?: string | null; storedAt?: string | null; releasedAt?: string | null; feeMinor?: string | null; createdAt?: string;
  productName?: string | null; warehouseName?: string | null;
}
export interface AssayReport { id: string; storageBookingId: string; assayerName: string; parameters: Record<string, string | number | boolean>; gradeOptionId?: string | null; reportMediaId?: string | null; assayedAt?: string | null; validUntil?: string | null; createdAt?: string; }
/**
 * PC-56 OPS-2b (founder Q3-A, Q4-A, Q9-A): a RECORD of a receipt number — this platform issues none. The API body also carries `holderUserId` and
 * `valuationMinor`; they are deliberately NOT in this type, so no console can print a holder or a valuation from it. `quantity` is the decimal
 * string the API prints (three places), copied from the booking at the time; the receipt itself stores no unit.
 */
export interface NwrReceipt { id: string; storageBookingId: string; repository: string; enwrNo: string; quantity?: string | null; status: string; issuedAt?: string | null; expiresAt?: string | null; createdAt?: string; }
/** `mine` (the API default) = receipts the caller holds; `all` = the organisation's records (warehouse.manage). */
export type NwrBox = 'mine' | 'all';

export class WarehousingResource {
  constructor(private readonly http: HttpClient) {}

  // --- warehouses ---
  async warehouses(params: { box?: WarehouseBox; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Warehouse>> {
    const r = await this.http.request<Warehouse[]>('GET', 'warehousing/warehouses', { query: { box: params.box, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
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

  // --- eNWR receipt RECORDS (PC-56 OPS-2b: `issueNwr` and `releaseNwr` are removed — the API refuses both by name, ENWR_ISSUE_NOT_ON_PLATFORM /
  // ENWR_RELEASE_NOT_STANDALONE; no console offers either) ---
  async nwrs(params: { box?: NwrBox; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<NwrReceipt>> {
    const r = await this.http.request<NwrReceipt[]>('GET', 'warehousing/nwr', { query: { box: params.box, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** One receipt record (the holder's own, or staff's; 404 otherwise — no IDOR). */
  async nwr(id: string, signal?: AbortSignal): Promise<NwrReceipt> {
    return (await this.http.request<NwrReceipt>('GET', `warehousing/nwr/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** The warehouse's NAMED operator cancels a receipt record — Idempotency-Keyed, with a reason; audited (PC-56 OPS-2b, Q5-A). No console calls it in OPS-2b. */
  async cancelNwr(id: string, reason: string, idempotencyKey: string): Promise<NwrReceipt> {
    return (await this.http.request<NwrReceipt>('POST', `warehousing/nwr/${encodeURIComponent(id)}/cancel`, { idempotencyKey, body: { reason } })).data;
  }
}
