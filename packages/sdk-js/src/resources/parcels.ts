// @krishalaya/sdk-js · land parcels resource (P-22 farm details). The farmer registers a parcel (idempotent —
// Law 3) and lists/reads their OWN parcels (box=mine, server-scoped — no IDOR). `area` is a decimal string in
// `areaUnit` (acre/ha) — NOT money. Server verifies parcels (verificationStatus); the app shows it read-only.
// Gated server-side by the `land_soil_weather` flag.
import { HttpClient } from '../http';
import { LandParcel, Page } from '../types';

export class ParcelsResource {
  constructor(private readonly http: HttpClient) {}
  /** The caller's own parcels (box=mine), keyset. */
  async mine(params: { regionId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<LandParcel>> {
    const r = await this.http.request<LandParcel[]>('GET', 'land/parcels', { query: { box: 'mine', regionId: params.regionId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<LandParcel> {
    return (await this.http.request<LandParcel>('GET', `land/parcels/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Register a parcel. `areaValue` is a decimal string (≤4 dp); `areaUnit` defaults to acre. Idempotent (Law 3). */
  async register(input: { areaValue: string; areaUnit?: string; regionId?: string; surveyNo?: string; bhulekhRef?: string; irrigationTypeCode?: string; isTenantFarmed?: boolean }, idempotencyKey: string): Promise<LandParcel> {
    return (await this.http.request<LandParcel>('POST', 'land/parcels', { idempotencyKey, body: { areaValue: input.areaValue, areaUnit: input.areaUnit ?? 'acre', regionId: input.regionId, surveyNo: input.surveyNo, bhulekhRef: input.bhulekhRef, irrigationTypeCode: input.irrigationTypeCode, isTenantFarmed: input.isTenantFarmed ?? false } })).data;
  }
}
