// @krishalaya/sdk-js · equipment (CHC) resource (PC-33 OW-3). Custom-hiring-centre assets + rental lifecycle:
// requested → quoted(advance) → confirmed(idempotent — advance may move) → in_progress(start OTP) →
// completed(actual quantity) → settled(idempotent — money settles server-side); cancel per state machine.
// Ops writes gated server-side by equipment.manage (confirm = the renter's equipment.rent). Money bigint minor.
import { HttpClient } from '../http';
import { Page } from '../types';

export interface EquipmentAsset { id: string; defaultName: string; categoryId?: string | null; status?: string; regionId?: string | null; createdAt?: string; }
export interface EquipmentRate { id: string; assetId: string; unitCode: string; rateMinor: string; rateBasis?: string; includesOperator?: boolean; includesFuel?: boolean; minQuantity?: string | null; isActive?: boolean; }
export interface EquipmentRental {
  id: string; assetId: string; renterUserId?: string; quantity: string; unitCode: string; status: string;
  advanceMinor?: string | null; totalMinor?: string | null; scheduledAt?: string | null; startedAt?: string | null;
  completedAt?: string | null; createdAt?: string; assetName?: string | null;
}

export class EquipmentResource {
  constructor(private readonly http: HttpClient) {}

  // --- assets ---
  async assets(params: { box?: 'mine' | 'browse' | 'all'; categoryId?: string; status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<EquipmentAsset>> {
    const r = await this.http.request<EquipmentAsset[]>('GET', 'equipment/assets', { query: { box: params.box, categoryId: params.categoryId, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Owner: register an asset on the CHC fleet — idempotent (a machine must never double-register). */
  async registerAsset(input: { categoryId: string; productId?: string; regNo?: string; yearOfMfg?: number; engineHours?: string; hpRating?: number; serviceRadiusKm?: number }, idempotencyKey: string): Promise<EquipmentAsset> {
    return (await this.http.request<EquipmentAsset>('POST', 'equipment/assets', { body: input, idempotencyKey })).data;
  }
  /** Owner: set/replace a rate line (rateMinor is a bigint minor STRING — Law 2). */
  async setRate(assetId: string, input: { rateBasis: string; rateMinor: string; includesOperator?: boolean; includesFuel?: boolean }): Promise<EquipmentRate> {
    return (await this.http.request<EquipmentRate>('POST', `equipment/assets/${encodeURIComponent(assetId)}/rates`, { body: input })).data;
  }
  async setAssetStatus(id: string, status: string): Promise<EquipmentAsset> {
    return (await this.http.request<EquipmentAsset>('POST', `equipment/assets/${encodeURIComponent(id)}/status`, { body: { status } })).data;
  }
  async rates(assetId: string, signal?: AbortSignal): Promise<EquipmentRate[]> {
    return (await this.http.request<EquipmentRate[]>('GET', `equipment/assets/${encodeURIComponent(assetId)}/rates`, { signal })).data;
  }

  // --- rentals ---
  async rentals(params: { box?: 'renter' | 'owner' | 'all'; status?: string; assetId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<EquipmentRental>> {
    const r = await this.http.request<EquipmentRental[]>('GET', 'equipment/rentals', { query: { box: params.box, status: params.status, assetId: params.assetId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async rental(id: string, signal?: AbortSignal): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('GET', `equipment/rentals/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Ops: quote the advance (requested → quoted). Float-free minor string. */
  async quoteRental(id: string, advanceMinor: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/quote`, { body: { advanceMinor } })).data;
  }
  /** Ops: start the job with the renter's OTP (confirmed → in_progress). */
  async startRental(id: string, otp: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/start`, { body: { otp } })).data;
  }
  /** Ops: record actual usage (in_progress → completed). */
  async completeRental(id: string, actualQuantity: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/complete`, { body: { actualQuantity } })).data;
  }
  /** Ops: settle — money moves server-side; Idempotency-Keyed (completed → settled). */
  async settleRental(id: string, idempotencyKey: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/settle`, { idempotencyKey, body: {} })).data;
  }
  async cancelRental(id: string, reason?: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/cancel`, { body: { reason } })).data;
  }
}
