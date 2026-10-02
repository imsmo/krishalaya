// @krishalaya/sdk-js · group-lots resource (FPO pooling, P1-12 · PC-56 TENANT-11c). One typed method per route of
// `/v1/group-lots` (the group-lots module is its only owner). A member pledges as themself and withdraws until the lot lists;
// THIS lot's coordinator (or tenant_admin) readies, lists, extends once, nudges, cancels with a reason and prepares the
// settlement; a SECOND person (`group_lot.settle_approve`) confirms it — which pays every pledger from the held sale proceeds in
// one ledger transaction — or refuses it. Money is bigint minor strings; quantities are decimal strings (≤ 3 dp).
// create, pledge, list and confirm carry an Idempotency-Key (Law 3).
import { HttpClient } from '../http';
import {
  GroupLot, GroupLotDetail, GroupLotPage, CreateGroupLotInput, GroupLotStatus, GroupLotPledgeInput, GroupLotCancelReason, GroupLotNudgeResult,
  GroupLotPrepared, GroupLotConfirmed,
} from '../types';

const enc = encodeURIComponent;

export class GroupLotsResource {
  constructor(private readonly http: HttpClient) {}

  /** Browse lots: `mine` = the lots you coordinate; `all` = the tenant's. `sort=deadline` is W135's "Deadline ▴". µs keyset pages. */
  async list(params: { box?: 'mine' | 'all'; status?: GroupLotStatus; sort?: 'recent' | 'deadline'; counts?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<GroupLotPage> {
    const r = await this.http.request<GroupLot[]>('GET', 'group-lots', { query: { box: params.box ?? 'all', status: params.status, sort: params.sort, counts: params.counts ? '1' : undefined, cursor: params.cursor, limit: params.limit ?? 25 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, counts: (r.meta?.counts as GroupLotPage['counts']) ?? null, total: (r.meta?.total as number | null) ?? null };
  }
  /** The cancel reasons (`other` needs your own words). */
  async lookups(signal?: AbortSignal): Promise<{ cancelReasons: GroupLotCancelReason[] }> {
    return (await this.http.request<{ cancelReasons: GroupLotCancelReason[] }>('GET', 'group-lots/lookups', { signal })).data;
  }
  /** A lot: progress + your own pledge for every member; the pledge table for its coordinator and tenant_admin. */
  async get(id: string, signal?: AbortSignal): Promise<GroupLotDetail> {
    return (await this.http.request<GroupLotDetail>('GET', `group-lots/${enc(id)}`, { signal })).data;
  }
  /** Open a lot (as its coordinator, or appoint a member with their consent). Idempotent. */
  async create(input: CreateGroupLotInput, idempotencyKey: string): Promise<GroupLot> {
    return (await this.http.request<GroupLot>('POST', 'group-lots', { idempotencyKey, body: input })).data;
  }
  /** Pledge — as yourself (omit farmerUserId) or, as this lot's coordinator, FOR a member. Idempotent. */
  async pledge(id: string, input: GroupLotPledgeInput, idempotencyKey: string): Promise<GroupLot & { myPledge: { quantity: string; status: string }; onBehalf: boolean; autoReady: boolean }> {
    return (await this.http.request<GroupLot & { myPledge: { quantity: string; status: string }; onBehalf: boolean; autoReady: boolean }>('POST', `group-lots/${enc(id)}/pledges`, { idempotencyKey, body: input })).data;
  }
  /** Withdraw your own pledge (until the lot lists). */
  async withdraw(id: string): Promise<GroupLot> {
    return (await this.http.request<GroupLot>('DELETE', `group-lots/${enc(id)}/pledges/me`, {})).data;
  }
  /** Mark ready. Below the target, a reason is required. */
  async markReady(id: string, reason?: string): Promise<GroupLot> {
    return (await this.http.request<GroupLot>('POST', `group-lots/${enc(id)}/ready`, { body: reason ? { reason } : {} })).data;
  }
  /** ready → listed: ONE listing, the coordinator's, for the pledged quantity at this price per unit. Idempotent. */
  async listLot(id: string, input: { pricePerUnitMinor: string; reason?: string }, idempotencyKey: string): Promise<GroupLot & { listing: { id: string; status: string } }> {
    return (await this.http.request<GroupLot & { listing: { id: string; status: string } }>('POST', `group-lots/${enc(id)}/list`, { idempotencyKey, body: input })).data;
  }
  /** Extend the pledge deadline ONCE, by at most 48 h. Members are told. */
  async extend(id: string, input: { pledgeDeadline: string; reason: string }): Promise<GroupLot & { notified: number }> {
    return (await this.http.request<GroupLot & { notified: number }>('POST', `group-lots/${enc(id)}/extend`, { body: input })).data;
  }
  /** Nudge the members who grow this crop and have not pledged (once per 24 h). */
  async nudge(id: string, reason?: string): Promise<GroupLotNudgeResult> {
    return (await this.http.request<GroupLotNudgeResult>('POST', `group-lots/${enc(id)}/nudge`, { body: reason ? { reason } : {} })).data;
  }
  /** Cancel with a reason from `lookups()`; pledges are released and every pledger is told the reason. */
  async cancel(id: string, input: { reasonCode: string; reasonText?: string }): Promise<GroupLot & { notified: number }> {
    return (await this.http.request<GroupLot & { notified: number }>('POST', `group-lots/${enc(id)}/cancel`, { body: input })).data;
  }
  /** Prepare the shares from the held sale proceeds. NO money moves. */
  async prepareSettlement(id: string): Promise<GroupLotPrepared> {
    return (await this.http.request<GroupLotPrepared>('POST', `group-lots/${enc(id)}/settle/prepare`, {})).data;
  }
  /** The second person confirms: every pledger paid by share + the coordinator fee, in one ledger transaction. Idempotent. */
  async confirmSettlement(id: string, idempotencyKey: string, reason?: string): Promise<GroupLotConfirmed> {
    return (await this.http.request<GroupLotConfirmed>('POST', `group-lots/${enc(id)}/settle/confirm`, { idempotencyKey, body: reason ? { reason } : {} })).data;
  }
  /** The second person refuses the preparation (the lot stays sold and may be prepared again). */
  async refuseSettlement(id: string, reason: string): Promise<{ lot: GroupLot; settlementId: string; status: 'refused' }> {
    return (await this.http.request<{ lot: GroupLot; settlementId: string; status: 'refused' }>('POST', `group-lots/${enc(id)}/settle/refuse`, { body: { reason } })).data;
  }
}
