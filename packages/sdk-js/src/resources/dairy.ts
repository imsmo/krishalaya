// @krishalaya/sdk-js · dairy MCC-operator resource (P1-12). The cooperative/MCC operator console talks to the
// dairy module: manage MCCs + rate cards, enrol members, record counter milk-collections, and run the per-cycle
// milk-bill settlement (generate → preview → approve → pay). Every WRITE is gated server-side by `dairy.manage`
// + the `dairy` feature flag; money is computed and moved SERVER-SIDE (Law 2/11) — the SDK only carries strings.
// Mutations that create/record/settle require an Idempotency-Key (Law 3); callers pass a fresh UUID.
import { HttpClient } from '../http';
import {
  Page, DairyMcc, DairyMembership, DairyRateCard, DairyCollection, MilkBill,
  CreateMccInput, EnrolMemberInput, CreateRateCardInput, RecordCollectionInput, GenerateBillInput,
  DairyAnimalType, MilkBillStatus,
} from '../types';

export class DairyResource {
  constructor(private readonly http: HttpClient) {}

  // ---- MCCs ----
  async listMccs(params: { activeOnly?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DairyMcc>> {
    const r = await this.http.request<DairyMcc[]>('GET', 'dairy/mccs', { query: { activeOnly: params.activeOnly, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getMcc(id: string, signal?: AbortSignal): Promise<DairyMcc> {
    return (await this.http.request<DairyMcc>('GET', `dairy/mccs/${encodeURIComponent(id)}`, { signal })).data;
  }
  async createMcc(input: CreateMccInput, idempotencyKey: string): Promise<DairyMcc> {
    return (await this.http.request<DairyMcc>('POST', 'dairy/mccs', { idempotencyKey, body: input })).data;
  }
  async setMccActive(id: string, isActive: boolean): Promise<DairyMcc> {
    return (await this.http.request<DairyMcc>('POST', `dairy/mccs/${encodeURIComponent(id)}/active`, { body: { isActive } })).data;
  }

  // ---- memberships ----
  async listMemberships(params: { box?: 'mine' | 'mcc' | 'all'; mccId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DairyMembership>> {
    const r = await this.http.request<DairyMembership[]>('GET', 'dairy/mccs/memberships/list', { query: { box: params.box, mccId: params.mccId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getMembership(id: string, signal?: AbortSignal): Promise<DairyMembership> {
    return (await this.http.request<DairyMembership>('GET', `dairy/mccs/memberships/${encodeURIComponent(id)}`, { signal })).data;
  }
  async enrolMember(input: EnrolMemberInput, idempotencyKey: string): Promise<DairyMembership> {
    return (await this.http.request<DairyMembership>('POST', 'dairy/mccs/memberships', { idempotencyKey, body: input })).data;
  }

  // ---- rate cards ----
  async listRateCards(params: { animalType?: DairyAnimalType; activeOnly?: boolean } = {}, signal?: AbortSignal): Promise<DairyRateCard[]> {
    return (await this.http.request<DairyRateCard[]>('GET', 'dairy/rate-cards', { query: { animalType: params.animalType, activeOnly: params.activeOnly }, signal })).data;
  }
  async getRateCard(id: string, signal?: AbortSignal): Promise<DairyRateCard> {
    return (await this.http.request<DairyRateCard>('GET', `dairy/rate-cards/${encodeURIComponent(id)}`, { signal })).data;
  }
  async createRateCard(input: CreateRateCardInput, idempotencyKey: string): Promise<DairyRateCard> {
    return (await this.http.request<DairyRateCard>('POST', 'dairy/rate-cards', { idempotencyKey, body: input })).data;
  }

  // ---- collections (counter entry) ----
  async listCollections(params: { membershipId: string; from: string; to: string; cursor?: string; limit?: number }, signal?: AbortSignal): Promise<Page<DairyCollection>> {
    const r = await this.http.request<DairyCollection[]>('GET', 'dairy/collections', { query: { membershipId: params.membershipId, from: params.from, to: params.to, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async recordCollection(input: RecordCollectionInput, idempotencyKey: string): Promise<DairyCollection> {
    return (await this.http.request<DairyCollection>('POST', 'dairy/collections', { idempotencyKey, body: input })).data;
  }

  // ---- milk bills (settlement; pay is the money route) ----
  async listBills(params: { box?: 'mine' | 'all'; membershipId?: string; status?: MilkBillStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<MilkBill>> {
    const r = await this.http.request<MilkBill[]>('GET', 'dairy/milk-bills', { query: { box: params.box, membershipId: params.membershipId, status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async getBill(id: string, signal?: AbortSignal): Promise<MilkBill> {
    return (await this.http.request<MilkBill>('GET', `dairy/milk-bills/${encodeURIComponent(id)}`, { signal })).data;
  }
  async generateBill(input: GenerateBillInput, idempotencyKey: string): Promise<MilkBill> {
    return (await this.http.request<MilkBill>('POST', 'dairy/milk-bills/generate', { idempotencyKey, body: input })).data;
  }
  async previewBill(id: string): Promise<MilkBill> {
    return (await this.http.request<MilkBill>('POST', `dairy/milk-bills/${encodeURIComponent(id)}/preview`, {})).data;
  }
  async approveBill(id: string): Promise<MilkBill> {
    return (await this.http.request<MilkBill>('POST', `dairy/milk-bills/${encodeURIComponent(id)}/approve`, {})).data;
  }
  /** Pay the NET amount to the farmer's wallet (server-side double-entry; Law 2/3). Idempotent. */
  async payBill(id: string, idempotencyKey: string): Promise<MilkBill> {
    return (await this.http.request<MilkBill>('POST', `dairy/milk-bills/${encodeURIComponent(id)}/pay`, { idempotencyKey })).data;
  }
}
