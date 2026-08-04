// @krishalaya/sdk-js · requirements (reverse-marketplace) resource (PC-28c). A BUYER posts a requirement
// ("need 5T wheat by Friday"); SELLERS quote against it; the buyer closes it (accepting a quote into an order is
// server-side, quote.listingId required there). Post + quote carry an Idempotency-Key (Law 3); money is bigint
// minor strings (Law 2). Server perms: requirement.post / requirement.quote.
import { HttpClient } from '../http';
import { Page } from '../types';

export interface Requirement {
  id: string; title: string; quantity: string; unitCode: string; productId?: string | null; categoryId?: string | null;
  budgetMinMinor?: string | null; budgetMaxMinor?: string | null; currencyCode?: string; needBy?: string | null;
  deliveryPincode?: string | null; isUrgent?: boolean; status: string; postedBy?: string; responsesCount?: number; createdAt?: string;
}
export interface RequirementResponse {
  id: string; requirementId: string; responderUserId?: string; quotedPriceMinor: string; quantity: string;
  listingId?: string | null; validUntil?: string | null; message?: string | null; status?: string; createdAt?: string;
}

export class RequirementsResource {
  constructor(private readonly http: HttpClient) {}

  async create(input: { title: string; quantity: string; unitCode: string; productId?: string; categoryId?: string; budgetMinMinor?: string; budgetMaxMinor?: string; needBy?: string; deliveryPincode?: string; isUrgent?: boolean }, idempotencyKey: string): Promise<Requirement> {
    return (await this.http.request<Requirement>('POST', 'requirements', { idempotencyKey, body: input })).data;
  }
  /** box=open → browse open requirements (sellers); box=mine → the caller's own posts. Keyset. */
  async list(params: { box?: 'open' | 'mine'; status?: string; categoryId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<Requirement>> {
    const r = await this.http.request<Requirement[]>('GET', 'requirements', { query: { box: params.box ?? 'open', status: params.status, categoryId: params.categoryId, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<Requirement> {
    return (await this.http.request<Requirement>('GET', `requirements/${encodeURIComponent(id)}`, { signal })).data;
  }
  async close(id: string): Promise<Requirement> {
    return (await this.http.request<Requirement>('POST', `requirements/${encodeURIComponent(id)}/close`, {})).data;
  }
  /** Seller: quote. quotedPriceMinor is the POSITIVE bigint-minor unit price; listingId enables accept-to-order. */
  async quote(id: string, input: { quotedPriceMinor: string; quantity: string; listingId?: string; validUntil?: string; message?: string }, idempotencyKey: string): Promise<RequirementResponse> {
    return (await this.http.request<RequirementResponse>('POST', `requirements/${encodeURIComponent(id)}/responses`, { idempotencyKey, body: input })).data;
  }
  async responses(id: string, params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<RequirementResponse>> {
    const r = await this.http.request<RequirementResponse[]>('GET', `requirements/${encodeURIComponent(id)}/responses`, { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}
