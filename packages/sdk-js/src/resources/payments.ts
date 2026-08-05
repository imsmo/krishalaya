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
}

export class PaymentsResource {
  /** GST trade-invoice sub-resource: `client.payments.invoices.getByOrder(...) / .downloadUrl(...)`. */
  readonly invoices: InvoicesResource;
  constructor(private readonly http: HttpClient) { this.invoices = new InvoicesResource(http); }

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
