// @krishalaya/sdk-js · equipment (CHC) resource (PC-33 OW-3). Custom-hiring-centre assets + rental lifecycle:
// requested → quoted(advance) → confirmed(idempotent — advance may move) → in_progress(start OTP) →
// completed(actual quantity) → settled(idempotent — money settles server-side); cancel per state machine.
// Ops writes gated server-side by equipment.manage (confirm = the renter's equipment.rent). Money bigint minor.
import { HttpClient } from '../http';
import { Page } from '../types';

// [PC-56 OPS-4a · OPS4-B5 / E1, survey C-13] Each type carries EXACTLY the API entity's `toJSON` fields (pinned by
// test/ops4a-equipment.spec.ts against the entity sources): no `defaultName` (an asset has no name — a page names a machine by its
// category and registration number), no `quantity` / `unitCode` / `assetName` (never returned; pages printed `undefined`).
/** `EquipmentAsset.toJSON` (apps/api …/equipment-asset.entity.ts). `engineHours` is a string TYPED by the owner — not a meter reading. */
export interface EquipmentAsset {
  id: string; ownerUserId: string; categoryId: string; productId: string | null; regNo: string | null; yearOfMfg: number | null;
  engineHours: string | null; hpRating: number | null; baseAddressId: string | null; serviceRadiusKm: number; status: string; createdAt?: string;
}
/** `EquipmentRate.toJSON` (…/equipment-rate.entity.ts): one rate line of a machine, its days as `YYYY-MM-DD`. */
export interface EquipmentRate {
  id: string; assetId: string; rateBasis: string; rateMinor: string; includesOperator: boolean; includesFuel: boolean; effectiveFrom: string; effectiveTo: string | null;
}
/** `EquipmentBooking.toJSON` (…/equipment-booking.entity.ts). Quantities are scaled strings ("6.00"); money is minor strings. */
export interface EquipmentRental {
  id: string; bookingNo: string; renterUserId: string; assetId: string; ownerUserId: string; operatorUserId: string | null; taskDesc: string | null;
  rateBasis: string; rateMinor: string; estQuantity: string; actualQuantity: string | null; scheduledAt: string; status: string;
  advanceMinor: string; totalMinor: string | null; startedAt: string | null; completedAt: string | null; createdAt?: string;
  /** PC-56 HOTFIX-13 (founder Q1-A): when the RENTER confirmed the hours the owner recorded; null until she does. Until then a
   *  settlement takes nothing beyond the deposit (`SETTLE_HOURS_NOT_CONFIRMED`). */
  usageConfirmedAt: string | null;
}
/** The three lists of hires (`QueryBookingsSchema.box`). REQUIRED on `rentals()`: the API's default is `renter` (survey C-13). */
export type RentalBox = 'renter' | 'owner' | 'all';
const RENTAL_BOXES: readonly RentalBox[] = ['renter', 'owner', 'all'];

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
  /** [PC-56 OPS-4a · E1] the strict `QueryRatesSchema` REQUIRES `?assetId=` — without it every call answered 400 (survey C-13). */
  async rates(assetId: string, signal?: AbortSignal): Promise<EquipmentRate[]> {
    return (await this.http.request<EquipmentRate[]>('GET', `equipment/assets/${encodeURIComponent(assetId)}/rates`, { query: { assetId }, signal })).data;
  }

  // --- rentals ---
  /** [PC-56 OPS-4a · E1] `box` is REQUIRED (typed and checked): left out, the API answered the caller's own hires AS A RENTER. No
   *  `assetId` filter exists on the API (its strict query refuses one), so none is offered. */
  async rentals(params: { box: RentalBox; status?: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<EquipmentRental>> {
    if (!params || !RENTAL_BOXES.includes(params.box)) throw new TypeError('equipment.rentals: box is required (renter | owner | all)');
    const r = await this.http.request<EquipmentRental[]>('GET', 'equipment/rentals', { query: { box: params.box, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
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
  /**
   * PC-56 HOTFIX-13 · the RENTER confirms the hours the owner recorded on a completed hire, in her own session (Idempotency-Keyed).
   * Anyone else → 403 `USAGE_CONFIRM_NOT_RENTER`. Until she does, settle takes nothing beyond the deposit from her wallet.
   */
  async confirmRentalUsage(id: string, idempotencyKey: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/confirm-usage`, { idempotencyKey, body: {} })).data;
  }
  /** Ops: settle — money moves server-side; Idempotency-Keyed (completed → settled). PC-56 HOTFIX-13: a bill above the deposit is
   *  refused `SETTLE_HOURS_NOT_CONFIRMED` (409) until the renter has confirmed the hours. */
  async settleRental(id: string, idempotencyKey: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/settle`, { idempotencyKey, body: {} })).data;
  }
  /** [PC-56 OPS-4a · E10] Idempotency-Keyed (the API answers 400 without one); the reason optional, 1–250 characters. */
  async cancelRental(id: string, idempotencyKey: string, reason?: string): Promise<EquipmentRental> {
    return (await this.http.request<EquipmentRental>('POST', `equipment/rentals/${encodeURIComponent(id)}/cancel`, { idempotencyKey, body: reason ? { reason } : {} })).data;
  }

  // --- PC-54 W54-12 `equipment-maintenance-alerts` (canon 312) ---
  async maintenanceAlerts(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'equipment/assets/maintenance/alerts', { signal })).data;
  }
  async recordMaintenance(assetId: string, input: { logType: 'service' | 'repair' | 'breakdown' | 'inspection'; costMinor?: string; notes?: string; engineHoursAt?: string; performedOn: string }): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', `equipment/assets/${encodeURIComponent(assetId)}/maintenance-logs`, { body: input })).data;
  }
  async maintenanceLogs(assetId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', `equipment/assets/${encodeURIComponent(assetId)}/maintenance-logs`, { signal })).data;
  }
}
