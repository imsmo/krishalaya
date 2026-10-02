// @krishalaya/sdk-js · requirements (reverse-marketplace) resource (PC-28c · PC-56 TENANT-11d). One typed method per route of
// `/v1/requirements` and `/v1/responses`. A BUYER posts a requirement; SELLERS quote with their own listing; the BUYER DESK
// (`requirement.desk`) posts for a named buyer with the buyer's consent and responds with MEMBER STOCK — a pooled quote whose
// lines each carry their member's consent before it can be sent, sent as one linked response per member; the buyer shortlists /
// accepts (by quantity) / rejects — the desk does so only with the buyer's consent for that act. Each accepted response becomes
// ONE order. Post and quote carry an Idempotency-Key (Law 3); money is bigint minor strings (Law 2); quantities ≤ 3-dp strings.
import { HttpClient } from '../http';
import { Page } from '../types';

const enc = encodeURIComponent;

export type RequirementStatus = 'open' | 'partially_matched' | 'fulfilled' | 'expired' | 'closed';
export type ConsentChannel = 'otp' | 'voice' | 'written' | 'app';
export interface ConsentInput { channel: ConsentChannel; mediaId?: string; note?: string }

export interface Requirement {
  id: string; reqNo?: string | null; title: string; quantity: string; fulfilledQuantity?: string; unitCode: string; productId?: string | null; categoryId?: string | null;
  budgetMinMinor?: string | null; budgetMaxMinor?: string | null; currencyCode?: string; needBy?: string | null;
  deliveryPincode?: string | null; isUrgent?: boolean; status: string; buyerUserId?: string; createdAt?: string;
  /** The SQL count of responses on this requirement (never a client default). */
  responsesCount?: number;
  buyerShortName?: string | null; buyerPhoneMasked?: string | null; buyerOrganisation?: string | null; productName?: string | null;
  postedBy?: string | null; postedByShortName?: string | null; onBehalf?: boolean; closedAt?: string | null; closeReason?: string | null;
  /** On GET /requirements/:id — what THIS viewer may do (the console offers only these; the API re-decides every act). */
  viewer?: { isBuyer: boolean; canDesk: boolean; canModerate: boolean; canQuote: boolean; decidesAsBuyer: boolean; decidesForBuyerWithConsent: boolean; canClose: boolean; closeNeedsReason: boolean } | null;
}
export interface RequirementPage extends Page<Requirement> { counts: Partial<Record<RequirementStatus, number>> | null; total: number | null }
export interface RequirementResponse {
  id: string; requirementId: string; sellerUserId?: string; quotedPriceMinor: string; quantity: string;
  listingId?: string | null; validUntil?: string | null; message?: string | null; status?: string; createdAt?: string;
  groupId?: string | null; consentState?: 'recorded' | 'missing' | 'own_quote'; acceptedQuantity?: string | null; orderId?: string | null; onBehalfDecision?: boolean;
  sellerShortName?: string | null; sellerPhoneMasked?: string | null; listingTitle?: string | null; aboveCeiling?: boolean;
  requirement?: { status: string; fulfilledQuantity: string; quantity: string };
}
export interface MemberStockMatch {
  listingId: string; title: string; sellerUserId: string; sellerShortName: string | null; sellerPhoneMasked: string | null;
  quantityAvailable: string; unitCode: string; priceMinor: string; pincode: string | null; distanceKm: number | null; matchedOn: 'product' | 'category';
  aboveCeiling: boolean; suggestedQuantity: string;
}
export interface MemberStock {
  /** "stock match (rule-based) — AI score not yet available" — word for word. */
  rule: string; ruleCode: 'rule_based'; aiScore: { available: false };
  basis: 'product' | 'category' | 'none'; orderedBy: 'price' | 'price_then_distance'; unitCode: string; remainingQuantity: string; items: MemberStockMatch[];
}
export type ResponseGroupStatus = 'draft' | 'consent_pending' | 'submitted' | 'accepted' | 'rejected' | 'withdrawn';
export interface ResponseGroupLine {
  id: string; sellerUserId: string; sellerShortName: string | null; sellerPhoneMasked: string | null; listingId: string; listingTitle: string | null;
  quantity: string; priceMinor: string; valueMinor: string; aboveCeiling: boolean; status: 'active' | 'sent' | 'removed'; responseId: string | null;
  consent: { id: string; channel: ConsentChannel | null; recordedAt: string | null; self: boolean } | null;
}
export interface ResponseGroup {
  id: string; requirementId: string; status: ResponseGroupStatus; createdBy: string; createdAt: string; lineCount: number; totalQuantity: string; unitCode: string;
  totalValueMinor: string; blendedPriceMinor: string | null; blendedRemainderMinor: string; budgetMaxMinor: string | null; aboveCeiling: boolean;
  fillsRequirement: boolean; remainingQuantity: string; validUntil: string | null; sentAt: string | null; decidedAt: string | null; withdrawReason: string | null;
  validForHours: number; consentMissing: Array<{ lineId: string; sellerUserId: string; sellerShortName: string | null }>; lines: ResponseGroupLine[];
  linkedResponses?: number;
}
export interface CreateRequirementInput {
  title: string; quantity: string; unitCode: string; productId?: string; categoryId?: string; budgetMinMinor?: string; budgetMaxMinor?: string;
  needBy?: string; deliveryPincode?: string; isUrgent?: boolean;
  /** The buyer desk posting FOR a named buyer, with that buyer's recorded consent. */
  onBehalf?: { buyerUserId: string; consent: ConsentInput };
}
export type UpdateRequirementInput = Partial<Omit<CreateRequirementInput, 'onBehalf'>>;

export class RequirementsResource {
  constructor(private readonly http: HttpClient) {}

  async create(input: CreateRequirementInput, idempotencyKey: string): Promise<Requirement> {
    return (await this.http.request<Requirement>('POST', 'requirements', { idempotencyKey, body: input })).data;
  }
  /** box=open → still soliciting quotes (`status` narrows within it); mine → the caller's own; all → the desk's whole board.
   *  sort=need_by → "Need by ▴". counts → per-status counts + total. µs keyset pages. */
  async list(params: { box?: 'open' | 'mine' | 'all'; status?: RequirementStatus; categoryId?: string; sort?: 'recent' | 'need_by'; counts?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<RequirementPage> {
    const r = await this.http.request<Requirement[]>('GET', 'requirements', { query: { box: params.box ?? 'open', status: params.status, categoryId: params.categoryId, sort: params.sort,
      counts: params.counts ? '1' : undefined, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, counts: (r.meta?.counts as RequirementPage['counts']) ?? null, total: (r.meta?.total as number | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<Requirement> {
    return (await this.http.request<Requirement>('GET', `requirements/${enc(id)}`, { signal })).data;
  }
  /** The buyer edits their requirement while it solicits quotes (audited before/after). */
  async update(id: string, input: UpdateRequirementInput): Promise<Requirement> {
    return (await this.http.request<Requirement>('PATCH', `requirements/${enc(id)}`, { body: input })).data;
  }
  /** The buyer withdraws it, or a moderator closes it — a moderator's close needs a reason. */
  async close(id: string, reason?: string): Promise<Requirement> {
    return (await this.http.request<Requirement>('POST', `requirements/${enc(id)}/close`, { body: reason ? { reason } : {} })).data;
  }
  /** Seller: quote with your own listing (`listingId` is what lets the buyer accept it into an order). */
  async quote(id: string, input: { quotedPriceMinor: string; quantity: string; listingId?: string; validUntil?: string; message?: string }, idempotencyKey: string): Promise<RequirementResponse> {
    return (await this.http.request<RequirementResponse>('POST', `requirements/${enc(id)}/responses`, { idempotencyKey, body: input })).data;
  }
  async responses(id: string, params: { status?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<RequirementResponse>> {
    const r = await this.http.request<RequirementResponse[]>('GET', `requirements/${enc(id)}/responses`, { query: { status: params.status, cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  // ---- the buyer desk: member stock + the pooled quote ----
  /** The rule-based member-stock match (no AI score exists). */
  async matches(id: string, signal?: AbortSignal): Promise<MemberStock> {
    return (await this.http.request<MemberStock>('GET', `requirements/${enc(id)}/matches`, { signal })).data;
  }
  async groups(id: string, signal?: AbortSignal): Promise<ResponseGroup[]> {
    return (await this.http.request<ResponseGroup[]>('GET', `requirements/${enc(id)}/response-groups`, { signal })).data;
  }
  async group(id: string, groupId: string, signal?: AbortSignal): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('GET', `requirements/${enc(id)}/response-groups/${enc(groupId)}`, { signal })).data;
  }
  async createGroup(id: string): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('POST', `requirements/${enc(id)}/response-groups`, { body: {} })).data;
  }
  /** A member's listing + quantity (≤ available) + price per unit (omit to take the listing's). */
  async addLine(id: string, groupId: string, input: { listingId: string; quantity: string; priceMinor?: string }): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('POST', `requirements/${enc(id)}/response-groups/${enc(groupId)}/lines`, { body: input })).data;
  }
  /** New figures clear the member's consent — a new yes is needed. */
  async editLine(id: string, groupId: string, lineId: string, input: { quantity?: string; priceMinor?: string }): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('PATCH', `requirements/${enc(id)}/response-groups/${enc(groupId)}/lines/${enc(lineId)}`, { body: input })).data;
  }
  async removeLine(id: string, groupId: string, lineId: string): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('POST', `requirements/${enc(id)}/response-groups/${enc(groupId)}/lines/${enc(lineId)}/remove`, { body: {} })).data;
  }
  /** The member's yes to their line (the desk records otp / voice / written; the member themself records `app`). */
  async recordConsent(id: string, groupId: string, lineId: string, consent: ConsentInput): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('POST', `requirements/${enc(id)}/response-groups/${enc(groupId)}/lines/${enc(lineId)}/consent`, { body: consent })).data;
  }
  /** Refused (CONSENT_MISSING, naming the member) while any line lacks its member's consent. */
  async sendGroup(id: string, groupId: string): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('POST', `requirements/${enc(id)}/response-groups/${enc(groupId)}/send`, { body: {} })).data;
  }
  async withdrawGroup(id: string, groupId: string, reason: string): Promise<ResponseGroup> {
    return (await this.http.request<ResponseGroup>('POST', `requirements/${enc(id)}/response-groups/${enc(groupId)}/withdraw`, { body: { reason } })).data;
  }
}

/** `/v1/responses` — one quote, or a pooled quote as a whole. */
export class ResponsesResource {
  constructor(private readonly http: HttpClient) {}
  async get(id: string, signal?: AbortSignal): Promise<RequirementResponse> {
    return (await this.http.request<RequirementResponse>('GET', `responses/${enc(id)}`, { signal })).data;
  }
  async shortlist(id: string, consent?: ConsentInput): Promise<RequirementResponse> {
    return (await this.http.request<RequirementResponse>('POST', `responses/${enc(id)}/shortlist`, { body: consent ? { consent } : {} })).data;
  }
  /** Accept all of the quote, or `quantity` of it. */
  async accept(id: string, input: { quantity?: string; consent?: ConsentInput } = {}): Promise<RequirementResponse> {
    return (await this.http.request<RequirementResponse>('POST', `responses/${enc(id)}/accept`, { body: input })).data;
  }
  async reject(id: string, consent?: ConsentInput): Promise<RequirementResponse> {
    return (await this.http.request<RequirementResponse>('POST', `responses/${enc(id)}/reject`, { body: consent ? { consent } : {} })).data;
  }
  async acceptGroup(groupId: string, consent?: ConsentInput): Promise<{ groupId: string; status: 'accepted'; responses: RequirementResponse[]; requirement: { status: string; fulfilledQuantity: string; quantity: string } }> {
    return (await this.http.request<{ groupId: string; status: 'accepted'; responses: RequirementResponse[]; requirement: { status: string; fulfilledQuantity: string; quantity: string } }>('POST', `responses/groups/${enc(groupId)}/accept`, { body: consent ? { consent } : {} })).data;
  }
  async rejectGroup(groupId: string, consent?: ConsentInput): Promise<{ groupId: string; status: 'rejected' }> {
    return (await this.http.request<{ groupId: string; status: 'rejected' }>('POST', `responses/groups/${enc(groupId)}/reject`, { body: consent ? { consent } : {} })).data;
  }
}
