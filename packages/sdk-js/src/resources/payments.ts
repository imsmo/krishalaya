// @krishalaya/sdk-js · payments + payouts resources (module 4). createIntent returns a gateway order to hand to
// the gateway SDK (Razorpay) on the client; the actual capture is verified SERVER-SIDE via the signed webhook —
// the client only polls status. Both money-moving POSTs require an Idempotency-Key (Law 3). Money is bigint
// minor-unit strings (Law 2). Gated server-side by the `online_payments` flag.
import { HttpClient } from '../http';
import { PaymentIntent, PaymentSummary, PayoutSummary, WalletBalance, WalletLedgerEntry, WalletInsights, WalletStatementFile, AutopayMandate, MandateExecution, SavedInstruments, InvoiceSummary, InvoiceDownload, Page } from '../types';

/** Buyer-facing GST trade invoices for orders. Read-only + ownership-gated server-side (the order's buyer/seller
 *  or a finance moderator — a foreign order is 404, never enumerable). Hangs off `payments.invoices`. */
export class InvoicesResource {
  constructor(private readonly http: HttpClient) {}
  /** The invoice record for an order (totals + GST split). 404 if none / not the caller's order. */
  async getByOrder(orderId: string, signal?: AbortSignal): Promise<InvoiceSummary> {
    return (await this.http.request<InvoiceSummary>('GET', `invoices/order/${encodeURIComponent(orderId)}`, { signal })).data;
  }
  /** A short-lived presigned PDF download URL for the order's invoice. Throws if the PDF isn't ready yet
   *  (INVOICE_PDF_NOT_READY, retryable) or the order has no invoice (404). */
  async downloadUrl(orderId: string, signal?: AbortSignal): Promise<InvoiceDownload> {
    return (await this.http.request<InvoiceDownload>('GET', `invoices/order/${encodeURIComponent(orderId)}/download`, { signal })).data;
  }

  // ---- PC-56 TENANT-3c-1 · W151's month view, W152's document, the GSTR-1 export and credit notes ----
  // These are FINANCE-SCOPED (report.view) and tenant-wide: a list of every invoice with taxable values and buyer
  // identifiers is not a buyer's own document, so the API answers 404 to a caller without the scope.

  /** W151. Keyset only — there is no page number to ask for. `period` is a GST month (YYYY-MM); with it, `meta.kpis`
   *  carries the month's totals AND the count of invoices whose breakdown was never recorded. */
  async list(params: { period?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: TradeInvoiceRow[]; nextCursor: string | null; kpis: InvoiceMonthKpis | null }> {
    const r = await this.http.request<TradeInvoiceRow[]>('GET', 'invoices', { query: { period: params.period, cursor: params.cursor, limit: params.limit ?? 25 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, kpis: (r.meta?.kpis as InvoiceMonthKpis | null) ?? null };
  }

  /** W152 — the document, its lines, and the credit notes against it. */
  async detail(id: string, signal?: AbortSignal): Promise<TradeInvoiceDetail> {
    return (await this.http.request<TradeInvoiceDetail>('GET', `invoices/${encodeURIComponent(id)}`, { signal })).data;
  }

  /** W151's "Export GSTR-1 data (month)". REFUSES an open period (GSTR1_PERIOD_OPEN) and a month larger than the row
   *  cap (GSTR1_TOO_LARGE) rather than returning part of a return. The receipt carries sha256 + coverage. */
  async exportGstr1(period: string): Promise<Gstr1ExportResult> {
    return (await this.http.request<Gstr1ExportResult>('POST', 'invoices/gstr1', { body: { period } })).data;
  }

  /** W152's "Issue credit note (checker)". `approvalId` is an APPROVED refund_approvals row with subject 'credit_note'
   *  (0139's plane, widened by 0140) — it carries the amount, so this call cannot choose one. */
  async issueCreditNote(invoiceId: string, input: { approvalId: string; reasonCode: string; reasonText: string }): Promise<CreditNoteResult> {
    return (await this.http.request<CreditNoteResult>('POST', `invoices/${encodeURIComponent(invoiceId)}/credit-notes`, { body: input })).data;
  }
}

// ---------------------------------------------------------------------------
// PC-56 TENANT-3c-1 types (api: modules/payments, schema 0140)
// ---------------------------------------------------------------------------
export interface TradeInvoiceRow {
  id: string; invoiceNo: string; orderId: string; orderNo: string | null;
  buyerGstin: string | null; totalMinor: string;
  /** **null MEANS THE BREAKDOWN WAS NEVER RECORDED** (a pre-0140 invoice, computed as one blended rate over the whole
   *  order). It is not zero, and the console must not render it as ₹0. */
  taxMinor: string | null; taxableMinor: string | null; exemptMinor: string | null;
  /** 'intra' | 'inter' | 'unknown' — unknown means neither party's state could be established, not intra-state. */
  supplyType: string | null; placeOfSupplyCode: string | null;
  /** false = a line's rate could not be resolved; the invoice is excluded from the GSTR-1 export by name. */
  taxBasisComplete: boolean | null;
  issuedAt: string | null; createdAt: string;
  /** Total already credited back against this invoice (0140's credit_notes). */
  creditedMinor: string;
}
export interface TradeInvoiceLine {
  key: string; hsn: string | null; grossMinor: string; taxableMinor: string; exemptMinor: string;
  rateBps: number; taxMinor: string;
  /** 'resolved' | 'exempt_by_rule' | 'not_recorded' — the last one is UNKNOWN, never an exemption. */
  rateBasis: string; legalRef: string | null;
}
export interface TradeInvoiceDetail extends TradeInvoiceRow {
  sellerGstin: string | null; lines: TradeInvoiceLine[] | null; taxBreakup: Record<string, unknown>;
  creditNotes: Array<{ id: string; creditNoteNo: string; reasonCode: string; reasonText: string; totalMinor: string; taxMinor: string; issuedAt: string; issuedBy: string }>;
}
export interface InvoiceMonthKpis {
  count: number; taxableMinor: string; taxMinor: string; exemptMinor: string;
  withoutBreakdown: number; incompleteBasis: number; windowFromIso: string; windowToIso: string;
}
export interface Gstr1ExportResult {
  period: string;
  sections: Record<string, Array<{ invoiceNo: string; buyerGstin: string | null; placeOfSupplyCode: string | null; totalMinor: string; taxableMinor: string; taxMinor: string }>>;
  creditNotes: Array<{ creditNoteNo: string; invoiceId: string; totalMinor: string; taxableMinor: string; taxMinor: string; reasonCode: string; placeOfSupplyCode: string | null }>;
  excluded: Array<{ invoiceNo: string; reason: string }>;
  summary: {
    sections: Record<string, { count: number; taxableMinor: string; taxMinor: string }>;
    excluded: Record<string, number>; excludedCount: number; filableCount: number;
    coverage: 'complete' | 'partial' | 'empty';
  };
  receipt: { fileName: string; rowCount: number; sha256: string; digestBasis: string; generatedAt: string; requestedBy: string; coverage: string; omissions: Array<{ reason: string; count: number }> };
}
export interface CreditNoteResult {
  id: string; creditNoteNo: string; invoiceId: string; totalMinor: string; taxableMinor: string;
  exemptMinor: string; taxMinor: string; reasonCode: string; issuedAt: string;
}

/** W150's charges & taxes (PC-56 TENANT-3c-2). The charge table is tenant-configurable through a PROPOSAL that a
 *  second admin signs (`tenant.settings` on both sides, maker != checker); the tax table is READ-ONLY by design —
 *  "statutory correctness is our job, not your risk" — so this resource has no tax write method at all. */
export class ChargesResource {
  constructor(private readonly http: HttpClient) {}
  async overview(signal?: AbortSignal): Promise<ChargeOverview> {
    return (await this.http.request<ChargeOverview>('GET', 'charges', { signal })).data;
  }
  /** Add / change / end an override. The ACTION is re-derived server-side from what the tenant already owns, so a
   *  wrong one cannot create the overlapping window 0141's EXCLUDE constraint forbids. `effectiveFrom` must be
   *  TOMORROW or later: two prices in one day cannot be explained to the buyer who paid the first. */
  async propose(input: { chargeCode: string; action: 'add' | 'change' | 'end'; label?: string; calcMethod?: 'flat' | 'percent' | 'slab' | 'per_unit'; config?: Record<string, unknown>; currencyCode?: string; effectiveFrom: string; note: string }): Promise<ChargeProposalResult> {
    return (await this.http.request<ChargeProposalResult>('POST', 'charges/proposals', { body: input })).data;
  }
  async decide(proposalId: string, input: { decision: 'approved' | 'rejected'; note?: string }): Promise<{ id: string; status: string; chargeCode: string }> {
    return (await this.http.request<{ id: string; status: string; chargeCode: string }>('POST', `charges/proposals/${encodeURIComponent(proposalId)}/decision`, { body: input })).data;
  }
  /** Apply an APPROVED proposal — inserts the new dated row and end-dates the previous one. Never an edit. */
  async apply(proposalId: string): Promise<{ id: string; status: string; definitionId: string | null; chargeCode: string; effectiveFrom: string }> {
    return (await this.http.request<{ id: string; status: string; definitionId: string | null; chargeCode: string; effectiveFrom: string }>('POST', `charges/proposals/${encodeURIComponent(proposalId)}/apply`, { body: {} })).data;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// PC-56 TENANT-4a · THE ORGANISATION's wallet (W143/W144) — NOT the caller's personal wallet above.
// Subject is the TENANT, resolved server-side from the token; gated by `wallet.org_view` (0142). Read-only: there
// is no add-funds method because no tenant top-up product exists, and the overview names that gap by code.
// ---------------------------------------------------------------------------------------------------------------
export class OrgWalletResource {
  constructor(private readonly http: HttpClient) {}
  /** The three accounts (main/commission/hold) with their basis, today's movement, escrow held for this tenant,
   *  and the ledger health the tenant can assert about its OWN book. */
  async overview(currency = 'INR', signal?: AbortSignal): Promise<OrgWalletOverview> {
    return (await this.http.request<OrgWalletOverview>('GET', 'org-wallet', { query: { currency }, signal })).data;
  }
  /** W144's ledger view. Keyset only — there is no page number and no total, on purpose. */
  async ledger(opts: { cursor?: string; limit?: number; account?: 'main' | 'commission' | 'hold'; type?: string; from?: string; to?: string; currency?: string } = {}, signal?: AbortSignal): Promise<Page<OrgLedgerRow> & { window?: OrgLedgerWindow }> {
    const r = await this.http.request<OrgLedgerRow[]>('GET', 'org-wallet/ledger', { query: { cursor: opts.cursor, limit: opts.limit ?? 50, account: opts.account, type: opts.type, from: opts.from, to: opts.to, currency: opts.currency ?? 'INR' }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null, window: r.meta?.window as OrgLedgerWindow | undefined };
  }
  /** The txn types present in this tenant's own ledger — the filter chips, from the rows, not a hardcoded list. */
  async txnTypes(currency = 'INR', signal?: AbortSignal): Promise<Array<{ code: string; count: number }>> {
    return (await this.http.request<Array<{ code: string; count: number }>>('GET', 'org-wallet/txn-types', { query: { currency }, signal })).data;
  }
  /** W144's Export CSV, with the audit receipt. REFUSES (WALLET_EXPORT_TOO_LARGE) rather than truncating. */
  async export(opts: { account?: 'main' | 'commission' | 'hold'; type?: string; from?: string; to?: string; currency?: string } = {}, signal?: AbortSignal): Promise<OrgLedgerExport> {
    return (await this.http.request<OrgLedgerExport>('GET', 'org-wallet/export', { query: { account: opts.account, type: opts.type, from: opts.from, to: opts.to, currency: opts.currency ?? 'INR' }, signal })).data;
  }
}

export type OrgTenantAccountCode = 'main' | 'commission' | 'hold';
export type OrgBalanceVerdict =
  | { kind: 'reconciled'; minor: string }
  | { kind: 'drifted'; minor: string; cachedMinor: string; driftMinor: string }
  | { kind: 'never_used'; minor: '0' };
export interface OrgAccountRow {
  code: OrgTenantAccountCode; verdict: OrgBalanceVerdict; minor: string;
  isFrozen: boolean; entryCount: number; lastEntryAt: string | null;
}
export interface OrgMovementRow {
  entryId: string; txnId: string; txnType: string | null; accountCode: string; amountMinor: string;
  currencyCode: string; referenceType: string | null; referenceId: string | null; description: string | null; createdAt: string;
}
export interface OrgLedgerRow extends OrgMovementRow { balanceAfterMinor: string }
export interface OrgLedgerWindow { fromIso: string; toIso: string; days: number; clamped: boolean }
export interface OrgHealthLine { check: 'cached_vs_ledger' | 'own_chain' | 'platform_recon'; state: 'ok' | 'attention' | 'unverifiable' | 'not_ours_to_assert'; detail?: string }
export interface OrgWalletOverview {
  currencyCode: string;
  accounts: OrgAccountRow[];
  holdBasis: 'no_freeze_path' | 'frozen_by_ledger';
  escrow: { heldMinor: string; orderCount: number; basis: 'ledger_net_by_tenant' };
  today: OrgMovementRow[];
  health: OrgHealthLine[];
  chain: { accountCode: OrgTenantAccountCode; verdict: { kind: string; checked?: number; lastHash?: string | null; atEntryId?: string; reason?: string }; headMatches: boolean | null } | null;
  /** The surfaces W143 draws that have no backend, named by code so every screen says the same thing. */
  gaps: Array<'add_funds' | 'payout_bank_change' | 'tenant_hold_freeze'>;
}
export interface OrgLedgerExport {
  receipt: { fileName: string; rowCount: number; sha256: string; digestBasis: string; generatedAt: string; requestedBy: string; coverage: string; omissions: Array<{ reason: string; count: number }> };
  header: string[];
  rows: string[][];
  window: OrgLedgerWindow;
}

// ---------------------------------------------------------------------------------------------------------------
// PC-56 TENANT-4b · W145/W146 — the ORGANISATION's outbound payout queue and the maker-checker gate over a run.
// Distinct from `PayoutsResource` above, which is the caller's OWN withdrawal. Every method is tenant-scoped
// server-side; the batch reads used to take no tenant at all (see the migration header for what that leaked).
// ---------------------------------------------------------------------------------------------------------------
export class PayoutConsoleResource {
  constructor(private readonly http: HttpClient) {}
  /** W145: the queue with its five tabs, the counts, and any status the tabs do not cover. */
  async queue(opts: { tab?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PayoutQueuePage> {
    return (await this.http.request<PayoutQueuePage>('GET', 'payouts/console', { query: { tab: opts.tab, cursor: opts.cursor, limit: opts.limit ?? 50 }, signal })).data;
  }
  async batches(opts: { status?: string; batchType?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PayoutBatchRow[]> {
    return (await this.http.request<PayoutBatchRow[]>('GET', 'payouts/batches', { query: { status: opts.status, batchType: opts.batchType, cursor: opts.cursor, limit: opts.limit ?? 20 }, signal })).data;
  }
  /** W146: the batch, its items, its pre-flight evidence, and whether THIS viewer may sign it. */
  async review(batchId: string, signal?: AbortSignal): Promise<PayoutBatchReview> {
    return (await this.http.request<PayoutBatchReview>('GET', `payouts/batches/${encodeURIComponent(batchId)}/review`, { signal })).data;
  }
  /** The maker step (`payout.prepare`). `executeAt` is an ISO instant WITH an offset — never a local time. */
  async prepare(input: { batchType: string; executeAt: string; maxPriority?: number | null }, idempotencyKey: string): Promise<PayoutBatchPrepared> {
    return (await this.http.request<PayoutBatchPrepared>('POST', 'payouts/batches', { body: input, idempotencyKey })).data;
  }
  /** The checker step (`payout.approve`). A rejection needs a reason of at least 20 characters. */
  async decide(batchId: string, input: { decision: 'approved' | 'rejected'; note?: string }): Promise<{ batchId: string; status: string; releasedClaims: number }> {
    return (await this.http.request<{ batchId: string; status: string; releasedClaims: number }>('POST', `payouts/batches/${encodeURIComponent(batchId)}/decision`, { body: input })).data;
  }
  /** W145's Retry: requeues a failed payout with the domain's backoff, or refuses BY NAME. */
  async retry(payoutId: string): Promise<{ payoutId: string; plan: PayoutRetryPlan }> {
    return (await this.http.request<{ payoutId: string; plan: PayoutRetryPlan }>('POST', `payouts/${encodeURIComponent(payoutId)}/retry`, { body: {} })).data;
  }
}

export type PayoutRetryPlan =
  | { kind: 'retry_at'; at: string; attempt: number }
  | { kind: 'needs_human'; reason: 'account_must_be_fixed' }
  | { kind: 'exhausted'; attempts: number };

export interface PayoutQueueRow {
  id: string; payeeName: string | null; payeePhone: string | null; purposeCode: string;
  referenceType: string | null; referenceId: string | null; amountMinor: string; currencyCode: string;
  status: string; tab: string | null; lane: 'wage_priority' | 'standard' | 'wage_not_promoted';
  bankLast4: string | null; bankVerified: boolean; failureBucket: string | null;
  retry: PayoutRetryPlan | null; batchId: string | null; createdAt: string;
}
export interface PayoutQueuePage {
  items: PayoutQueueRow[]; nextCursor: string | null; counts: Record<string, number>;
  tabs: string[]; unmappedCount: number;
}
export interface PayoutBatchRow {
  id: string; tenantId: string | null; batchType: string; totalMinor: string; count: number;
  status: string; executedAt: string | null; createdAt: string;
}
export type PayoutPreflightCheck = 'payee_kyc' | 'items_sum' | 'funds_available' | 'no_frozen_payee' | 'risk_desk';
export interface PayoutPreflightLine { check: PayoutPreflightCheck; state: 'pass' | 'fail' | 'unverifiable'; detail?: string }
export interface PayoutPreflight { lines: PayoutPreflightLine[]; passed: boolean; blocking: PayoutPreflightCheck[] }
export interface PayoutBatchReview {
  batch: {
    id: string; batchType: string; status: string; itemsTotalMinor: string; settledTotalMinor: string; count: number;
    preparedBy: string | null; preparedAt: string | null; decidedBy: string | null; decidedAt: string | null;
    decisionNote: string | null; cutOffAt: string | null; executeAt: string | null; checkerThresholdMinor: string | null;
  };
  window: 'open_for_approval' | 'locked' | 'due';
  needsChecker: boolean;
  viewerIsMaker: boolean;
  preflight: PayoutPreflight;
  signedPreflight: unknown;
  items: PayoutQueueRow[];
}
export interface PayoutBatchPrepared {
  batchId: string; claimed: number; itemsTotalMinor: string; cutOffAt: string; executeAt: string;
  checkerThresholdMinor: string; needsChecker: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// PC-56 TENANT-4c · W147/W148 — the settlement cycle and the statements it produces. Every method needs
// `settlement.close` server-side; the checker must be a different person than the requester.
// ---------------------------------------------------------------------------------------------------------------
export class SettlementsResource {
  constructor(private readonly http: HttpClient) {}
  /** W147: the live cycle (opened on first read), its progress, the per-seller table and the deduction basis. */
  async overview(signal?: AbortSignal): Promise<SettlementOverview> {
    return (await this.http.request<SettlementOverview>('GET', 'settlements', { signal })).data;
  }
  /** Step one of "Close current cycle" — a REQUEST. The period must have ended and have sellers to settle. */
  async requestClose(cycleId: string): Promise<SettlementCycle> {
    return (await this.http.request<SettlementCycle>('POST', `settlements/${encodeURIComponent(cycleId)}/close-request`, { body: {} })).data;
  }
  /** Step two — a DIFFERENT person approves, or rejects with a reason of at least 20 characters. */
  async decideClose(cycleId: string, input: { decision: 'approved' | 'rejected'; note?: string }): Promise<SettlementCycle> {
    return (await this.http.request<SettlementCycle>('POST', `settlements/${encodeURIComponent(cycleId)}/close-decision`, { body: input })).data;
  }
  /** ONE bounded, resumable generation pass. Call again until `progress.kind === 'complete'`. */
  async generate(cycleId: string): Promise<SettlementCycle & { generatedNow: number; failed: number }> {
    return (await this.http.request<SettlementCycle & { generatedNow: number; failed: number }>('POST', `settlements/${encodeURIComponent(cycleId)}/generate`, { body: {} })).data;
  }
  /** W148: every statement this tenant has issued, keyset. */
  async statements(opts: { cycleId?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<SettlementStatementsPage> {
    return (await this.http.request<SettlementStatementsPage>('GET', 'settlements/statements', { query: { cycleId: opts.cycleId, cursor: opts.cursor, limit: opts.limit ?? 50 }, signal })).data;
  }
  /** W148's org monthly statement — DERIVED from the ledger, with a receipt. Refuses an open month. */
  async orgStatement(period: string, signal?: AbortSignal): Promise<OrgStatementResult> {
    return (await this.http.request<OrgStatementResult>('GET', 'settlements/org-statement', { query: { period }, signal })).data;
  }
}

export type SettlementCycleStatus = 'open' | 'pending_close' | 'closing' | 'closed' | 'rejected';
export type SettlementProgress =
  | { kind: 'not_started' }
  | { kind: 'generating'; generated: number; expected: number; remaining: number }
  | { kind: 'complete'; generated: number }
  | { kind: 'over_generated'; generated: number; expected: number };
export interface SettlementCycle {
  id: string; tenantId: string; periodStart: string; periodEnd: string; status: SettlementCycleStatus;
  requestedBy: string | null; requestedAt: string | null;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  sellersExpected: number | null; statementsGenerated: number;
  grossMinor: string; netMinor: string; closedAt: string | null; createdAt: string;
  progress: SettlementProgress;
}
export interface SettlementCycleSellerRow {
  sellerUserId: string; sellerName: string | null; orders: number;
  grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string; reconciles: boolean;
}
export interface SettlementOverview {
  cycle: SettlementCycle | null;
  recent: SettlementCycle[];
  sellers: SettlementCycleSellerRow[];
  sellerCount: number;
  cycleGrossMinor: string;
  deductionBasis: 'charged_to_buyer' | 'charged_to_seller' | 'no_rule_resolved';
  legacyDailyStatements: number;
  statementCount: number;
}
export interface SettlementStatementListRow {
  id: string; statementNo: string; sellerUserId: string; sellerName: string | null;
  periodStart: string; periodEnd: string; periodKind: 'cycle' | 'legacy_daily'; dayCount: number;
  grossMinor: string; commissionMinor: string; taxMinor: string; netMinor: string;
  reconciles: boolean; hasPdf: boolean; createdAt: string;
}
export interface SettlementStatementsPage {
  items: SettlementStatementListRow[]; nextCursor: string | null;
  counts: { total: number; cycleBased: number; legacyDaily: number };
}
export interface OrgStatementResult {
  statement: {
    period: string; openingMinor: string; closingMinor: string;
    lines: Array<{ txnType: string; creditMinor: string; debitMinor: string; count: number }>;
    reconciles: boolean; basis: 'derived_from_ledger';
  };
  receipt: { fileName: string; rowCount: number; sha256: string; digestBasis: string; generatedAt: string; requestedBy: string; coverage: string; omissions: Array<{ reason: string; count: number }> };
  header: string[];
  rows: string[][];
}

export class PaymentsResource {
  /** GST trade-invoice sub-resource: `client.payments.invoices.getByOrder(...) / .downloadUrl(...)`. */
  readonly invoices: InvoicesResource;
  /** W150's charges & taxes: `client.payments.charges.overview() / .propose(...)`. */
  readonly charges: ChargesResource;
  constructor(private readonly http: HttpClient) { this.invoices = new InvoicesResource(http); this.charges = new ChargesResource(http); }

  /** Create a payment intent (e.g. purpose 'wallet_recharge'). Returns the gateway order id to open checkout. */
  async createIntent(input: { purpose: string; amountMinor: string; currencyCode?: string; referenceType?: string; referenceId?: string }, idempotencyKey: string): Promise<PaymentIntent> {
    return (await this.http.request<PaymentIntent>('POST', 'payments', { idempotencyKey, body: input })).data;
  }
  /** Poll a payment's status (authoritative server state). */
  async get(id: string, signal?: AbortSignal): Promise<PaymentSummary> {
    return (await this.http.request<PaymentSummary>('GET', `payments/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** DEV-ONLY: complete a payment that was created against the deterministic SANDBOX gateway (no real
   *  PSP configured server-side) by driving the server's own signed-webhook capture path — see
   *  apps/api PaymentService.devCompleteSandboxPayment. The server refuses this for any non-sandbox
   *  payment and is inert in production regardless of who calls it; the HMAC secret never reaches this
   *  client. Only ever call this when `PaymentIntent.provider === 'sandbox'` (checked by the caller). */
  async devCompleteSandbox(id: string, signal?: AbortSignal): Promise<PaymentSummary> {
    return (await this.http.request<PaymentSummary>('POST', `payments/${encodeURIComponent(id)}/dev-complete-sandbox`, { body: {}, signal })).data;
  }
  async list(cursor?: string, limit = 20, signal?: AbortSignal): Promise<Page<PaymentSummary>> {
    const r = await this.http.request<PaymentSummary[]>('GET', 'payments', { query: { cursor, limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
}

export class PayoutsResource {
  constructor(private readonly http: HttpClient) {}
  /** Request a withdrawal from the caller's wallet to a tokenised bank account (ownership enforced server-side). */
  async request(input: { amountMinor: string; bankAccountId: string; purpose?: string; currencyCode?: string }, idempotencyKey: string): Promise<PayoutSummary> {
    return (await this.http.request<PayoutSummary>('POST', 'payouts', { idempotencyKey, body: input })).data;
  }
  async get(id: string, signal?: AbortSignal): Promise<PayoutSummary> {
    return (await this.http.request<PayoutSummary>('GET', `payouts/${encodeURIComponent(id)}`, { signal })).data;
  }
  async list(cursor?: string, limit = 20, signal?: AbortSignal): Promise<Page<PayoutSummary>> {
    const r = await this.http.request<PayoutSummary[]>('GET', 'payouts', { query: { cursor, limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  // --- PC-54 W54-6 payout-batch read-models (payout.approve-gated) ---
  async payoutBatches(params: { status?: string; batchType?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const r = await this.http.request<Array<Record<string, unknown>>>('GET', 'payouts/batches', { query: { status: params.status, batchType: params.batchType, cursor: params.cursor, limit: params.limit ?? 20 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async payoutBatch(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', `payouts/batches/${encodeURIComponent(id)}`, { signal })).data;
  }
}

export class WalletResource {
  constructor(private readonly http: HttpClient) {}
  /** The caller's reconciled balance (available + held), server-truth. */
  async balance(currency = 'INR', signal?: AbortSignal): Promise<WalletBalance> {
    return (await this.http.request<WalletBalance>('GET', 'wallet/balance', { query: { currency }, signal })).data;
  }
  /** The caller's wallet ledger (per-entry statement), keyset-paginated. */
  async ledger(cursor?: string, limit = 20, currency = 'INR', signal?: AbortSignal): Promise<Page<WalletLedgerEntry>> {
    const r = await this.http.request<WalletLedgerEntry[]>('GET', 'wallet/ledger', { query: { cursor, limit, currency }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** The caller's OWN earnings (credits) aggregated by month + txn type over a bounded window (defaults ~12mo).
   *  Pass `groupBy: 'crop'` to also receive `byCrop` — earnings attributed to each order's product title (P0-3). */
  async earnings(opts: { from?: string; to?: string; currency?: string; groupBy?: 'crop' } = {}, signal?: AbortSignal): Promise<WalletInsights> {
    return (await this.http.request<WalletInsights>('GET', 'wallet/earnings', { query: { from: opts.from, to: opts.to, currency: opts.currency ?? 'INR', groupBy: opts.groupBy }, signal })).data;
  }
  /** The caller's OWN spending (debits, positive magnitudes) aggregated by month + txn type over a bounded window. */
  async spendingInsights(opts: { from?: string; to?: string; currency?: string } = {}, signal?: AbortSignal): Promise<WalletInsights> {
    return (await this.http.request<WalletInsights>('GET', 'wallet/spending-insights', { query: { from: opts.from, to: opts.to, currency: opts.currency ?? 'INR' }, signal })).data;
  }
  /** P0-3 statement export: the caller's OWN ledger for a bounded window as a downloadable CSV or PDF. Returns the
   *  file inline (base64 for pdf / utf8 for csv) + a suggested filename + content type — the client saves/shares it. */
  async statement(opts: { format?: 'csv' | 'pdf'; from?: string; to?: string; currency?: string } = {}, signal?: AbortSignal): Promise<WalletStatementFile> {
    return (await this.http.request<WalletStatementFile>('GET', 'wallet/statement', { query: { format: opts.format ?? 'csv', from: opts.from, to: opts.to, currency: opts.currency ?? 'INR' }, signal })).data;
  }
  /** The caller's OWN saved payment instruments (P0-4): live UPI-AutoPay mandates (masked handle) + tokenised
   *  bank/UPI payout instruments (last-4 / IFSC only). Nothing sensitive is returned. */
  async instruments(signal?: AbortSignal): Promise<SavedInstruments> {
    return (await this.http.request<SavedInstruments>('GET', 'wallet/instruments', { signal })).data;
  }
}

// UPI AutoPay mandates (standing instructions). Always the AUTHENTICATED caller's OWN mandates (no userId param,
// zero IDOR). Registering needs an Idempotency-Key (Law 3). NO money moves on these calls — the raw VPA is masked
// server-side. Gated server-side by the `online_payments` flag.
export class AutopayResource {
  constructor(private readonly http: HttpClient) {}
  /** Register a pending UPI autopay mandate (one live mandate per purpose). vpa is "handle@psp"; never logged. */
  async register(input: { vpa: string; purpose: 'membership' | 'loan_emi' | 'general'; maxAmountMinor: string; currencyCode?: string; frequency?: 'as_presented' | 'daily' | 'weekly' | 'monthly'; validUntil?: string }, idempotencyKey: string): Promise<AutopayMandate> {
    return (await this.http.request<AutopayMandate>('POST', 'wallet/autopay', { idempotencyKey, body: input })).data;
  }
  /** The caller's own autopay mandates, keyset-paginated. */
  async list(cursor?: string, limit = 20, signal?: AbortSignal): Promise<Page<AutopayMandate>> {
    const r = await this.http.request<AutopayMandate[]>('GET', 'wallet/autopay', { query: { cursor, limit }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<AutopayMandate> {
    return (await this.http.request<AutopayMandate>('GET', `wallet/autopay/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Cancel (revoke) a mandate the caller owns. */
  async cancel(id: string, reason?: string): Promise<AutopayMandate> {
    return (await this.http.request<AutopayMandate>('DELETE', `wallet/autopay/${encodeURIComponent(id)}`, { body: reason ? { reason } : {} })).data;
  }
  /** Confirm (activate) a mandate after the user approved the standing instruction in their UPI app.
   *  Behind the `autopay_execution` flag server-side (default OFF until a live UPI-AutoPay PSP is wired). */
  async confirm(id: string): Promise<AutopayMandate> {
    return (await this.http.request<AutopayMandate>('POST', `wallet/autopay/${encodeURIComponent(id)}/confirm`, { body: {} })).data;
  }
  /** Present a capped debit against an active mandate → lands in the caller's wallet. Idempotency-Key required.
   *  Behind the `autopay_execution` flag server-side; amountMinor must be ≤ the mandate's per-debit cap. */
  async execute(id: string, amountMinor: string, idempotencyKey: string): Promise<MandateExecution> {
    return (await this.http.request<MandateExecution>('POST', `wallet/autopay/${encodeURIComponent(id)}/execute`, { idempotencyKey, body: { amountMinor } })).data;
  }
  /** Recent collection attempts against a mandate the caller owns (audit list). */
  async executions(id: string, limit = 20, signal?: AbortSignal): Promise<MandateExecution[]> {
    return (await this.http.request<MandateExecution[]>('GET', `wallet/autopay/${encodeURIComponent(id)}/executions`, { query: { limit }, signal })).data;
  }

}

// ---------------------------------------------------------------------------
// PC-56 TENANT-3c-2 · W150's charges & taxes (api: modules/payments, schema 0141)
// ---------------------------------------------------------------------------
export interface ChargeRow {
  id: string; chargeCode: string; label: string | null;
  /** Which surface prices with this code — 'not_read_by_any_code' when NO call site reads it. */
  surface: string;
  calcMethod: string; config: Record<string, unknown>; currencyCode: string;
  effectiveFrom: string; effectiveTo: string | null; isActive: boolean;
  /** false = the PLATFORM default this tenant falls back to. A tenant can never write one (0141's RLS). */
  isTenantOverride: boolean;
  /** TRUE for the row the pricing engine would pick TODAY. */
  inForce: boolean;
  pendingProposalId: string | null;
  /** false = the pricing engine would THROW on this row (an unimplemented calc_method). */
  computable: boolean;
}
export interface TaxRuleRow {
  taxCode: string; rateBps: number; hsnPrefix: string | null; split: Record<string, unknown>;
  thresholdMinor: string | null; effectiveFrom: string; legalRef: string | null;
  /** Which code path reads this rule — 'not_read_by_any_code' where none does. */
  readBy: string;
  categoryScoped: boolean;
}
export interface ChargeProposalRow {
  id: string; chargeCode: string; action: 'add' | 'change' | 'end'; label: string | null;
  calcMethod: string | null; config: Record<string, unknown> | null; currencyCode: string;
  effectiveFrom: string; supersedesId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  proposedBy: string; proposedAt: string; proposalNote: string;
  decidedBy: string | null; decidedAt: string | null; decisionNote: string | null;
  appliedAt: string | null; appliedDefinitionId: string | null;
}
export interface ChargeOverview { charges: ChargeRow[]; taxRules: TaxRuleRow[]; proposals: ChargeProposalRow[] }
export interface ChargeProposalResult {
  id: string; chargeCode: string; action: string; effectiveFrom: string; status: 'pending';
  diff: Array<{ field: string; from: string | null; to: string | null }>;
}
