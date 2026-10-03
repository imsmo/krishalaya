// @krishalaya/sdk-js · crop seasons + soil tests (PC-56 TENANT-12, F-13 — the eight land routes that had no SDK method).
// A yield is a decimal string WITH its unit (`yieldUnitCode`, a mass unit: kg / quintal / ton — the server refuses a yield without one,
// F-9). Abandoning a season needs a reason (F-19). A soil test is recorded once per Idempotency-Key (Law 3). Gated by `land_soil_weather`.
import { HttpClient } from '../http';

export type CropSeasonName = 'kharif' | 'rabi' | 'zaid' | 'perennial';
export type CropSeasonStatus = 'planned' | 'sown' | 'harvested' | 'abandoned';
export interface CropSeason {
  id: string; parcelId: string; productId: string; season: CropSeasonName; year: number; sownOn: string | null; expectedHarvest: string | null;
  expectedYield: string | null; actualYield: string | null; yieldUnitCode: string | null; status: CropSeasonStatus; createdAt?: string;
}
export interface SoilTest {
  id: string; parcelId: string; labName: string | null; shcCardNo: string | null; sampledOn: string; results: Record<string, string | number | boolean>;
  recommendations: Record<string, unknown>; reportMediaId: string | null; validUntil: string | null; createdAt?: string;
}

export class CropSeasonsResource {
  constructor(private readonly http: HttpClient) {}
  async list(parcelId: string, status?: CropSeasonStatus, signal?: AbortSignal): Promise<CropSeason[]> {
    return (await this.http.request<CropSeason[]>('GET', 'land/crop-seasons', { query: { parcelId, status }, signal })).data;
  }
  async plan(input: { parcelId: string; productId: string; season: CropSeasonName; year: number; sownOn?: string; expectedHarvest?: string; expectedYield?: string; yieldUnitCode?: string }, idempotencyKey: string): Promise<CropSeason> {
    return (await this.http.request<CropSeason>('POST', 'land/crop-seasons', { idempotencyKey, body: input })).data;
  }
  async sow(id: string, sownOn: string): Promise<CropSeason> {
    return (await this.http.request<CropSeason>('POST', `land/crop-seasons/${encodeURIComponent(id)}/sow`, { body: { sownOn } })).data;
  }
  async harvest(id: string, input: { actualYield?: string; yieldUnitCode?: string } = {}): Promise<CropSeason> {
    return (await this.http.request<CropSeason>('POST', `land/crop-seasons/${encodeURIComponent(id)}/harvest`, { body: input })).data;
  }
  async abandon(id: string, reason: string): Promise<CropSeason> {
    return (await this.http.request<CropSeason>('POST', `land/crop-seasons/${encodeURIComponent(id)}/abandon`, { body: { reason } })).data;
  }
}

export class SoilTestsResource {
  constructor(private readonly http: HttpClient) {}
  async list(parcelId: string, signal?: AbortSignal): Promise<SoilTest[]> {
    return (await this.http.request<SoilTest[]>('GET', 'land/soil-tests', { query: { parcelId }, signal })).data;
  }
  async record(input: { parcelId: string; labName?: string; shcCardNo?: string; sampledOn: string; results: Record<string, string | number | boolean>; recommendations?: Record<string, unknown>; reportMediaId?: string; validUntil?: string }, idempotencyKey: string): Promise<SoilTest> {
    return (await this.http.request<SoilTest>('POST', 'land/soil-tests', { idempotencyKey, body: input })).data;
  }
}
