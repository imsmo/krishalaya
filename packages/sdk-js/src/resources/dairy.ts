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
  DairyCounterBoard, DairyShift,
  // PC-56 TENANT-6b-1 · W168's flag protocol
  DairyQualityReview, DairyReviewStatus,
  // PC-56 TENANT-6b-2 · W168's desk
  DairyQualityDesk, DairyPaymentCycle,
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

  /* ---- PC-56 TENANT-6b-1 · W168's flag protocol -----------------------------------------------------------------
   * Deliberately NOT behind the quality-desk flag: the hold on a flagged pour is a money path, and a farmer's withheld
   * pour must not stay withheld because nobody switched a screen on. Before this wave none of it existed — the flag was
   * two columns on a pour and the pour was billed and PAID at full price anyway.
   * ------------------------------------------------------------------------------------------------------------- */

  /**
   * PC-56 TENANT-6b-2 · W168's quality desk for one cycle: the litre-weighted fat/SNF averages and the *"stable ±0.1"*
   * claim measured rather than asserted, the flags with what is still held, the premium band and whether it is actually
   * being PAID, every rate card in force (plural, deliberately — nothing supersedes one), and the line-by-line
   * arithmetic a farmer is promised. Omit `day` for the DATABASE's today and `cycle` for the window the members' own
   * preference implies — the same defaults the counter board takes, through the same function.
   */
  async qualityDesk(params: { day?: string; cycle?: DairyPaymentCycle } = {}, signal?: AbortSignal): Promise<DairyQualityDesk> {
    return (await this.http.request<DairyQualityDesk>('GET', 'dairy/quality', { query: { ...params }, signal })).data;
  }

  /** The desk's queue and history. `status: 'open_any'` is open PLUS re-tested: the pours whose money is held NOW. */
  async listQualityReviews(params: { status?: DairyReviewStatus | 'open_any'; membershipId?: string; from?: string; to?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<DairyQualityReview>> {
    const r = await this.http.request<DairyQualityReview[]>('GET', 'dairy/quality-reviews', { query: { ...params, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  async getQualityReview(id: string, signal?: AbortSignal): Promise<DairyQualityReview> {
    return (await this.http.request<DairyQualityReview>('GET', `dairy/quality-reviews/${encodeURIComponent(id)}`, { signal })).data;
  }

  /** W168 step 1. `memberPresent` is REQUIRED, not optional: "with member present" is the dignity half of the promise,
   *  and a default either way would put words in somebody's mouth. */
  async retestQualityReview(id: string, input: { memberPresent: boolean; sampleSealed?: boolean; note?: string | null }, idempotencyKey: string): Promise<DairyQualityReview> {
    return (await this.http.request<DairyQualityReview>('POST', `dairy/quality-reviews/${encodeURIComponent(id)}/retest`, { idempotencyKey, body: input })).data;
  }

  /** W168 step 2 — and the pour's money moves with it, in the same transaction: `cleared` releases the hold, `rejected`
   *  means the cooperative did not buy that milk. A decision cannot be taken twice; a reversal is a new dispute. */
  async decideQualityReview(id: string, input: { outcome: 'cleared' | 'rejected'; note?: string | null }, idempotencyKey: string): Promise<DairyQualityReview> {
    return (await this.http.request<DairyQualityReview>('POST', `dairy/quality-reviews/${encodeURIComponent(id)}/decide`, { idempotencyKey, body: input })).data;
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

  // --- PC-54 W54-5: D2C milk subscriptions + the MCC day sheet ---
  async createD2cPlan(input: { productId: string; defaultName: string; frequency: 'daily' | 'alternate_day' | 'weekly' | 'monthly'; qtyPerDelivery: string; unitCode: string; pricePerDeliveryMinor: string; deliveryWindow?: string }, idempotencyKey: string): Promise<{ id: string }> {
    return (await this.http.request<{ id: string }>('POST', 'dairy/d2c/plans', { body: input, idempotencyKey })).data;
  }
  async d2cPlans(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'dairy/d2c/plans', { signal })).data;
  }
  async subscribeD2c(input: { planId: string; addressId: string; startsOn: string }, idempotencyKey: string): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', 'dairy/d2c/subscriptions', { body: input, idempotencyKey })).data;
  }
  async myD2cSubscriptions(signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'dairy/d2c/subscriptions/mine', { signal })).data;
  }
  pauseD2c(id: string, pausedUntil: string): Promise<{ id: string; status: string }> { return this.d2cStep(id, 'pause', { pausedUntil }); }
  resumeD2c(id: string): Promise<{ id: string; status: string }> { return this.d2cStep(id, 'resume', {}); }
  cancelD2c(id: string): Promise<{ id: string; status: string }> { return this.d2cStep(id, 'cancel', {}); }
  private d2cStep(id: string, action: string, body: Record<string, unknown>): Promise<{ id: string; status: string }> {
    return this.http.request<{ id: string; status: string }>('POST', `dairy/d2c/subscriptions/${encodeURIComponent(id)}/${action}`, { body }).then((r) => r.data);
  }
  /** The honest day sheet (canon 238): per-shift slips/weight/amount aggregated from ledgered rows. */
  /**
   * PC-56 TENANT-6a · W167's counter board: every centre's litres, pourers against the roll, litre-weighted fat/SNF,
   * the analyzer on file, the cooler's latest reading, the flags, and the cycle-to-date accrual.
   *
   * The first read of a DAY's collections this SDK has ever had — `listCollections` requires a membershipId, so a
   * centre's own shift could not be listed at all. Omit `day` for the DATABASE's today, and `cycle` to accrue over the
   * window the tenant's most common membership preference implies.
   */
  async counterBoard(params: { day?: string; shift?: DairyShift; cycle?: 'daily' | 'weekly' | 'fortnightly' | 'monthly' } = {}, signal?: AbortSignal): Promise<DairyCounterBoard> {
    const r = await this.http.request<DairyCounterBoard>('GET', 'dairy/counter/board', { query: { ...params }, signal });
    return r.data as DairyCounterBoard;
  }

  async mccDaySummary(mccId: string, date?: string, signal?: AbortSignal): Promise<Array<{ shift: string; slips: number; weightKg: string; amountMinor: string; waterFlags: number }>> {
    return (await this.http.request<Array<{ shift: string; slips: number; weightKg: string; amountMinor: string; waterFlags: number }>>('GET', `dairy/d2c/mccs/${encodeURIComponent(mccId)}/day-summary`, { query: { date }, signal })).data;
  }

  // --- PC-55 A5 `d2c-delivery-runs`. Drops are materialised by a server-side cadence job (idempotent at the
  // DB), so no client ever creates a delivery. Settling is seller-side and never rewrites a settled outcome.
  // The statement is a ledgered aggregate that states plainly it is NOT an invoice. ---
  async d2cDeliveries(params: { box?: 'customer' | 'seller'; from?: string; to?: string; status?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'dairy/d2c/deliveries', { query: { box: params.box, from: params.from, to: params.to, status: params.status, limit: params.limit ?? 200 }, signal })).data;
  }
  /** dueOn is REQUIRED: a drop is identified by (id, date) because the table is partitioned by delivery date. */
  async markD2cDelivered(id: string, input: { dueOn: string; qty?: string; qualityMeta?: Record<string, unknown> }): Promise<Record<string, unknown>> { return this.settleD2c(id, 'delivered', input); }
  async markD2cSkipped(id: string, input: { dueOn: string }): Promise<Record<string, unknown>> { return this.settleD2c(id, 'skipped', input); }
  async markD2cFailed(id: string, input: { dueOn: string }): Promise<Record<string, unknown>> { return this.settleD2c(id, 'failed', input); }
  private async settleD2c(id: string, outcome: 'delivered' | 'skipped' | 'failed', body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('POST', `dairy/d2c/deliveries/${encodeURIComponent(id)}/${outcome}`, { body })).data;
  }
  async d2cStatement(params: { box?: 'customer' | 'seller'; from?: string; to?: string } = {}, signal?: AbortSignal): Promise<{ period: { from: string; to: string }; lines: Array<Record<string, unknown>>; grandTotalMinor: string; billing: { mode: string; charged: boolean; note: string } }> {
    return (await this.http.request<{ period: { from: string; to: string }; lines: Array<Record<string, unknown>>; grandTotalMinor: string; billing: { mode: string; charged: boolean; note: string } }>('GET', 'dairy/d2c/statement', { query: { box: params.box, from: params.from, to: params.to }, signal })).data;
  }
}
