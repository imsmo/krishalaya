// @krishalaya/sdk-js · fintech servicing resource (PC-54 W54-8). The post-disbursal book, loan.manage-gated
// server-side: DPD buckets, collections queue, the KCC drawl ledger (signed entries, server-run balance),
// restructures (maker-checker), write-offs. Money bigint minor STRINGS (Law 2).
import { HttpClient } from '../http';

export class FintechResource {
  constructor(private readonly http: HttpClient) {}

  async dpdBuckets(signal?: AbortSignal): Promise<Array<{ bucket: string; loans: number; outstandingMinor: string }>> {
    return (await this.http.request<Array<{ bucket: string; loans: number; outstandingMinor: string }>>('GET', 'fintech/servicing/dpd', { signal })).data;
  }
  async collectionsQueue(limit = 100, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'fintech/servicing/collections', { query: { limit }, signal })).data;
  }
  /** Signed KCC entry: +drawl/+interest, −repayment; the SERVER computes the running balance under lock. */
  async kccEntry(loanId: string, input: { entryKind: 'drawl' | 'repayment' | 'interest'; amountMinor: string; narrative: string; destinationKind?: 'supplier_direct' | 'other'; repaymentChannel?: string }): Promise<{ loanId: string; balanceAfterMinor: string }> {
    return (await this.http.request<{ loanId: string; balanceAfterMinor: string }>('POST', `fintech/servicing/loans/${encodeURIComponent(loanId)}/kcc/entries`, { body: input })).data;
  }
  async kccLedger(loanId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', `fintech/servicing/loans/${encodeURIComponent(loanId)}/kcc/ledger`, { signal })).data;
  }
  async proposeRestructure(loanId: string, input: Record<string, unknown>): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `fintech/servicing/loans/${encodeURIComponent(loanId)}/restructures`, { body: input })).data;
  }
  async restructures(loanId: string, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', `fintech/servicing/loans/${encodeURIComponent(loanId)}/restructures`, { signal })).data;
  }
  /** Maker-checker: the server refuses checker_approved from the proposer. */
  async transitionRestructure(id: string, to: 'mediation' | 'accepted' | 'checker_approved' | 'activated' | 'rejected' | 'expired'): Promise<{ id: string; status: string }> {
    return (await this.http.request<{ id: string; status: string }>('POST', `fintech/servicing/restructures/${encodeURIComponent(id)}/transition`, { body: { to } })).data;
  }
  async writeOff(loanId: string, reason: string): Promise<{ loanId: string; status: string; outstandingMinor: string }> {
    return (await this.http.request<{ loanId: string; status: string; outstandingMinor: string }>('POST', `fintech/servicing/loans/${encodeURIComponent(loanId)}/write-off`, { body: { reason } })).data;
  }

  // --- PC-55 A9 `loan-disbursement-batches`. Approved loans → QUEUED payouts. The COOLING-OFF window is
  // sacred: an application still inside it is held back and reported with the instant it becomes eligible.
  // Nothing executes without live payout credentials — a borrower must never owe money they did not receive. ---
  async disbursementPreview(signal?: AbortSignal): Promise<{ candidates: number; queued: number; totalMinor: string; skipped: Array<{ applicationId: string; reason: string; coolingOffUntil?: string }>; lines: Array<Record<string, unknown>>; note: string }> {
    return (await this.http.request<{ candidates: number; queued: number; totalMinor: string; skipped: Array<{ applicationId: string; reason: string; coolingOffUntil?: string }>; lines: Array<Record<string, unknown>>; note: string }>('GET', 'fintech/servicing/disbursement-preview', { signal })).data;
  }
  async createDisbursementRun(input: { confirmedBy: string; applicationIds?: string[] }, idempotencyKey: string): Promise<{ id: string; batchId: string; queuedTotalMinor: string; queuedCount: number; skipped: Array<{ applicationId: string; reason: string; coolingOffUntil?: string }>; execution: { executed: boolean; note: string } }> {
    return (await this.http.request<{ id: string; batchId: string; queuedTotalMinor: string; queuedCount: number; skipped: Array<{ applicationId: string; reason: string; coolingOffUntil?: string }>; execution: { executed: boolean; note: string } }>('POST', 'fintech/servicing/disbursement-batches', { body: input, idempotencyKey })).data;
  }
  async disbursementRuns(limit = 50, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'fintech/servicing/disbursement-batches', { query: { limit }, signal })).data;
  }
  async disbursementRun(id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', `fintech/servicing/disbursement-batches/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Refuses honestly (executed:false + reason) until the payout rail is configured. */
  async executeDisbursementRun(id: string): Promise<{ executed: boolean; reason: string; itemsProcessed: number }> {
    return (await this.http.request<{ executed: boolean; reason: string; itemsProcessed: number }>('POST', `fintech/servicing/disbursement-batches/${encodeURIComponent(id)}/execute`, { body: {} })).data;
  }
}

// PC-54 W54-9 · the tenant's insurance desk reads (insurance.manage-gated server-side, behind the `insurance` flag). PC-56 PARTNER-2a (survey
// F-1, founder Q5 + Q7): `createProduct`, `updateProduct` and `issuePolicy` are REMOVED — the API refuses them by name from the tenant realm
// (INSURANCE_PRODUCT_PLATFORM_AUTHORED / INSURANCE_ISSUE_NOT_ON_PLATFORM): products are authored by the platform, and nobody issues on the
// platform in Phase 1. What is left are the tenant's own book and insights reads.
export class InsuranceAuthoringResource {
  constructor(private readonly http: HttpClient) {}
  async book(params: { status?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Array<Record<string, unknown>>> {
    return (await this.http.request<Array<Record<string, unknown>>>('GET', 'insurance/authoring/book', { query: { status: params.status, limit: params.limit ?? 100 }, signal })).data;
  }
  async insights(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', 'insurance/authoring/insights', { signal })).data;
  }
}
