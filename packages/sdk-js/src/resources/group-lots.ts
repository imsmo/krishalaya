// @krishalaya/sdk-js · group-lots resource (FPO pooling, P1-12). A coordinator opens a pooled lot, records
// farmer pledges, marks it ready, cancels, and settles — the server computes each pledger's proportional share of
// the sale proceeds (float-free, zero-loss; Law 2). Money is bigint minor strings; quantities are decimal strings.
// Every WRITE is gated server-side by `group_lot.coordinate` + the `group_lots` flag. create + pledge carry an
// Idempotency-Key (Law 3). settle RECORDS the share breakdown — it does NOT move money (disbursement is separate).
import { HttpClient } from '../http';
import { GroupLot, GroupLotDetail, GroupLotSettlement, CreateGroupLotInput, GroupLotStatus, Page } from '../types';

export class GroupLotsResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse lots: `mine` = the coordinator's own; `all` = the tenant's open lots. */
  async list(params: { box?: 'mine' | 'all'; status?: GroupLotStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<GroupLot>> {
    const r = await this.http.request<GroupLot[]>('GET', 'group-lots', { query: { box: params.box ?? 'all', status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** A lot + its pledges (settled shares present once settled). */
  async get(id: string, signal?: AbortSignal): Promise<GroupLotDetail> {
    return (await this.http.request<GroupLotDetail>('GET', `group-lots/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Open a pooled lot. Idempotent (Law 3). */
  async create(input: CreateGroupLotInput, idempotencyKey: string): Promise<GroupLot> {
    return (await this.http.request<GroupLot>('POST', 'group-lots', { idempotencyKey, body: input })).data;
  }
  /** Record a farmer's pledge (running total, deadline-gated). Idempotent. */
  async pledge(id: string, input: { farmerUserId: string; quantity: string }, idempotencyKey: string): Promise<GroupLot> {
    return (await this.http.request<GroupLot>('POST', `group-lots/${encodeURIComponent(id)}/pledges`, { idempotencyKey, body: input })).data;
  }
  async markReady(id: string): Promise<GroupLot> {
    return (await this.http.request<GroupLot>('POST', `group-lots/${encodeURIComponent(id)}/ready`, {})).data;
  }
  async cancel(id: string): Promise<GroupLot> {
    return (await this.http.request<GroupLot>('POST', `group-lots/${encodeURIComponent(id)}/cancel`, {})).data;
  }
  /** Split the sale proceeds proportionally across pledgers (server computes; records shares; no money move). */
  async settle(id: string, grossProceedsMinor: string): Promise<GroupLotSettlement> {
    return (await this.http.request<GroupLotSettlement>('POST', `group-lots/${encodeURIComponent(id)}/settle`, { body: { grossProceedsMinor } })).data;
  }
}
