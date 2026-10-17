// apps/web-partner/src/features/partner/application.ts · PC-56 PARTNER-0 · founder D2 — the PARTNER read of an application, as the console
// prints it. PURE. Mirrors the SDK's `PartnerApplication` (no applicant id, no name; purpose text and a masked phone only after approval) and
// the dashboard's honest counting over ONE page of the list (B3 — a server-computed dashboard read — is PARTNER-1a's).
export interface PartnerAppRow {
  id: string; applicantRef: string; tenantId: string; product: { id: string; name: string }; purposeCategory: string | null; purposeText: string | null;
  amountRequestedMinor: string; amountApprovedMinor: string | null; status: string; createdAt: string; decisionAt: string | null;
  coolingOffUntil: string | null; applicantPhoneMasked: string | null;
}

/** A count over one page: exact when the page was not full (no next cursor), else "N+" — never a number the read did not establish. */
export function pageCount(rows: number, nextCursor: string | null | undefined): { n: number; atLeast: boolean } {
  return { n: rows, atLeast: Boolean(nextCursor) };
}

/** Sum of requested amounts (bigint minor strings, Law 2 — never a float). */
export function sumRequestedMinor(rows: ReadonlyArray<{ amountRequestedMinor: string }>): string {
  return rows.reduce((s, r) => s + BigInt(/^\d+$/.test(r.amountRequestedMinor) ? r.amountRequestedMinor : '0'), 0n).toString();
}

/** The queue's box → the partner read's filter: `review` = the review queue (submitted + under review); `all` = everything consented. */
export function partnerListFilter(box: 'review' | 'all', status?: string): { reviewQueue?: boolean; status?: string } {
  return { ...(box === 'review' ? { reviewQueue: true } : {}), ...(status ? { status } : {}) };
}
