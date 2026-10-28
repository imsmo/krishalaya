// @krishalaya/sdk-js · the PARTNER CONSOLE realm (`/v1/partner/*`) — PC-56 PARTNER-0 · a partner is an organisation (founder D1–D8).
//
// A bank / NBFC person signs in TO THEIR PARTNER ORGANISATION (not to a tenant): `auth.verify` answers a token carrying `pid` + `realm:
// 'partner'` and no `tid`. The host stores it like any session (httpOnly cookie server-side) and passes it through `getToken` — the API
// refuses a tenant token on every partner route and a partner token on every tenant route. Distinct from `partnerApi` (the machine realm,
// API keys, `/v1/partner-api/*`).
//   • several partners → `SdkError` code `PARTNER_CHOICE_REQUIRED`, `details: { choiceToken, partners: [{ id, name }], expiresInSec }`;
//     finish with `auth.choose(choiceToken, partnerId)`;
//   • confirmed TOTP → `SdkError` code `TWO_FACTOR_PENDING`, `details.challengeToken`; finish with `auth.verifyTwoFactor`;
//   • the applications read is consent-gated: no applicant id, no name; the purpose text and a masked phone only after approval;
//   • every decision needs an Idempotency-Key (mint it when the form renders); `decide.disburse` is REFUSED by name
//     (`PARTNER_CANNOT_DISBURSE`) — it exists so a console can show the refusal, never to move money;
//   • `team.invite` answers the raw token ONCE (`token: null` on a replayed key).
//   • PC-56 PARTNER-1b: `keys.list` (the partner's own keys — there is NO hash field on `PartnerKey`), `keys.revoke` (an Idempotency-Key and a
//     reason of 20–300 characters; the only write), `webhooks.list` / `.deliveries` / `.delivery` (read-only: no secret, no payload, no tenant),
//     `readiness()` (six facts, counts only); `invites.lookup` is a POST — the token travels in the body, never in a URL (founder D4).
//   • PC-56 PARTNER-2c: `loanProducts.{list, get}` — a lender's OWN loan products' terms (integer bps, minor-unit strings, the product's
//     currency) and the COUNT of its consented applications in the last 30 days; read-only (no create / change exists — the platform authors
//     loan products); another lender's or an absent id → 404 `PARTNER_LOAN_PRODUCT_NOT_FOUND`.
//   • PC-56 PARTNER-3a: + `insurance.claims.{list, get, counts}` — the claim FACTS on the insurer's own products (oldest first) and their COUNTS
//     in an FY window; the types carry no claimant, description, surveyor, report, note, payout or tenant field. Read-only: no decide /
//     settle / assign / flag method exists.
//   • PC-56 PARTNER-4a: + `loans.{list, get, repayments, counts}` — the LOAN FACTS on the lender's OWN book (newest first), one loan's
//     RECORDED repayment history and the COUNTS + bigint sums in an FY window. The types carry no borrower, channel, bank account,
//     narrative, fee anchor or tenant field. Read-only: no disburse / write-off / restructure / KCC method exists, and none ever will from
//     a console — `decide.disburse` above is the refusal, not the act. Another lender's or an absent id → 404 `PARTNER_LOAN_NOT_FOUND`.
//   • PC-56 PARTNER-2b: + `insurance.issuance(q)` — the `proposed` queue on the insurer's own products (a read; nothing is issued).
//   • PC-56 PARTNER-2a: `insurance.{dashboard, products, product, policies, policy}` — an insurer's own book, policy facts only (no holder,
//     subject, payment or tenant field exists on the types); `insurance` OFF → 404 `PARTNER_INSURANCE_SWITCHED_OFF`.
// Money is a bigint minor-unit STRING (Law 2).
import { HttpClient } from '../http';
import { AuthTokens } from '../types';

export type PartnerRoleCode = 'partner_admin' | 'partner_checker' | 'partner_maker' | 'partner_viewer';
export interface PartnerChoice { id: string; name: string }
export interface PartnerMe {
  /** PC-56 PARTNER-1a: + `code` and `slaDecisionHours` (the published decision promise, `sla.decision_hours`, or null). */
  organisation: { id: string; code: string; name: string; kind: string; regulatorRefMasked: string | null; sla: Record<string, unknown>; slaDecisionHours: number | null } | null;
  person: { userId: string; roles: string[]; permissions: string[]; phoneMasked: string | null };
  realm: 'partner';
}
export type PartnerApplicationStatus = 'submitted' | 'under_review' | 'approved' | 'rejected' | 'withdrawn' | 'disbursed';
/** PC-56 PARTNER-4a — the FIVE loan statuses the platform can produce. `loan_status` holds a sixth, `transferred`, which NOTHING writes;
 *  it is refused by name and is not offered as a filter. */
export type PartnerBookLoanStatus = 'active' | 'overdue' | 'restructured' | 'closed' | 'written_off';
export interface PartnerApplication {
  id: string;
  /** Opaque: the application id. There is never an applicant user id or a name. */
  applicantRef: string;
  /** The organisation (FPO) the application belongs to. */
  tenantId: string;
  product: { id: string; name: string };
  /** The loan kind (crop, kcc, tractor …) — the purpose CATEGORY. */
  purposeCategory: string | null;
  /** The applicant's own words — null until the application is approved. */
  purposeText: string | null;
  amountRequestedMinor: string; amountApprovedMinor: string | null;
  status: PartnerApplicationStatus | string;
  createdAt: string; decisionAt: string | null; coolingOffUntil: string | null;
  /** `••••••318` — null until the application is approved. */
  applicantPhoneMasked: string | null;
}
export interface PartnerApplicationsPage { items: PartnerApplication[]; nextCursor: string | null; limit: number; asOf: string | null }
export interface PartnerDecisionResult {
  id: string; applicantRef: string; status: string; amountRequestedMinor: string; amountApprovedMinor: string | null; decisionAt: string | null; coolingOffUntil: string | null;
}
export interface PartnerTeamMember {
  membershipId: string; userId: string; name: string | null; phoneMasked: string; roleCode: PartnerRoleCode | string; active: boolean;
  since: string | null; removedAt: string | null; removedReason: string | null; twoFactor: boolean;
}
export interface PartnerPendingInvite { id: string; phoneMasked: string; roleCode: string; invitedBy: string | null; expiresAt: string | null; sentAt: string | null; sendFailure: string | null; createdAt: string | null }
export interface PartnerTeam { members: PartnerTeamMember[]; invites: PartnerPendingInvite[] }
export interface PartnerInviteCreated { id: string; expiresAt: string; phoneMasked: string; roleCode: string; days: number; token: string | null; tokenShown: boolean }
export interface PartnerInviteLookup { organisation: string; roleCode: string; phoneMasked: string | null; status: 'pending' | 'used' | 'revoked' | 'expired'; expiresAt: string }

/** PC-56 PARTNER-1a · founder D1 — the dashboard's figures, computed on the server from the partner's OWN book (the consented applications on
 *  its products + its 0090 loan book). Money: bigint minor-unit STRINGS. Rates: integer BASIS POINTS (null = nothing in the denominator).
 *  Latencies: whole SECONDS. `fpos[].name` is the organisation's PUBLIC display name (null for one that is not live). No applicant name,
 *  no `LA-…` number exists anywhere in it. */
export interface PartnerDashboard {
  computedAt: string;
  applicationsTotal: number;
  awaitingDecision: number;
  decidedThisMonth: { decided: number; approved: number; rejected: number; approvedAmountMinor: string; approvalRateBps: number | null; monthStartsAt: string; timeZone: string };
  portfolio: { outstandingMinor: string; activeLoans: number };
  onTime: { windowDays: number; due: number; onTime: number; shareBps: number | null; basis: 'recorded_instalments' };
  sla: { decisionPromiseHours: number | null; windowDays: number; decided: number; medianSec: number | null; p90Sec: number | null; withinPromise: number | null };
  fpos: Array<{ tenantId: string; name: string | null }>;
  needsYouToday: Array<{ id: string; tenantId: string; fpoName: string | null; productName: string; amountRequestedMinor: string; status: string; createdAt: string }>;
}

/** PC-56 PARTNER-1b · founder D1 — one of the partner's own API keys as the console reads it. No hash, no secret: the field does not exist. */
export interface PartnerKey {
  id: string; name: string; keyPrefix: string; scopes: string[]; rateLimitPerHour: number; status: 'active' | 'inactive' | 'revoked';
  lastUsedAt: string | null; revokedAt: string | null; revokedReason: string | null; createdAt: string | null;
}
export interface PartnerKeyRevoked { id: string; keyPrefix: string; revokedAt: string; status: 'revoked' }
/** PC-56 PARTNER-1b · founder D2 — one of the partner's own endpoints: the URL as stored (its own), the events, active — never a secret. */
export interface PartnerWebhookEndpoint { id: string; url: string; eventTypes: string[]; active: boolean; createdAt: string | null }
export interface PartnerWebhookEndpoints { items: PartnerWebhookEndpoint[]; subscribableEvents: string[]; retentionDays: number; computedAt: string | null }
export type PartnerDeliveryState = 'pending' | 'retrying' | 'delivered' | 'held' | 'exhausted' | 'cancelled';
/** One delivery: no payload body (the partner received it on the wire) and never the originating tenant. */
export interface PartnerDelivery {
  id: string; endpointId: string; eventType: string; state: PartnerDeliveryState | string; attempts: number; lastStatusCode: number | null;
  lastError: string | null; createdAt: string; lastAttemptAt: string | null; deliveredAt: string | null; replayCount: number;
}
export interface PartnerDeliveriesPage { items: PartnerDelivery[]; nextCursor: string | null; limit: number; retentionDays: number | null; computedAt: string | null }
export interface PartnerDeliveryAttempt { attemptNo: number; outcome: string; statusCode: number | null; durationMs: number; error: string | null; signedAt: string | null; createdAt: string | null }
export interface PartnerDeliveryDetail extends PartnerDelivery { attemptsList: PartnerDeliveryAttempt[] }
/** PC-56 PARTNER-1b · founder D3 — what the platform has set up for the partner, from facts (counts and yes / no; no names). */
export interface PartnerReadiness {
  computedAt: string;
  organisation: { active: boolean; ready: boolean };
  administrators: { count: number; withTwoFactor: number; ready: boolean };
  keys: { active: number; ready: boolean };
  endpoints: { active: number; ready: boolean };
  deliveries: { windowDays: number; deliveredWithinWindow: boolean; lastDeliveredAt: string | null; ready: boolean };
  sla: { published: boolean; decisionHours: number | null; ready: boolean };
}

// ── PC-56 PARTNER-2a · THE INSURER READS ITS OWN BOOK (founder Q6) — read-only; policy FACTS only. There is NO holder, subject, payment or
//    tenant field on these types: the API never answers one (0228's definers + column grant), and the types do not offer one to print.
export type PartnerInsurancePolicyStatus = 'proposed' | 'active' | 'lapsed' | 'cancelled' | 'expired' | 'claimed';
export interface PartnerInsurancePolicy {
  id: string;
  /** NULL on every activated policy today — nobody issues on the platform (founder Q5); print "no policy number yet". */
  policyNo: string | null;
  productId: string; productName: string | null;
  /** The FPO's PUBLIC display name, or null for a non-live organisation. */
  fpoName: string | null;
  subjectType: string;
  status: PartnerInsurancePolicyStatus | string;
  sumInsuredMinor: string;
  /** The farmer's premium share as stored on the policy. */
  premiumMinor: string;
  validFrom: string | null; validUntil: string | null; createdAt: string | null;
}
export interface PartnerInsurancePoliciesPage { items: PartnerInsurancePolicy[]; nextCursor: string | null; limit: number; computedAt: string | null }
export type PartnerFormula = { kind: 'pct_of_sum_insured'; bps: number } | { kind: 'flat_minor'; amountMinor: string } | { kind: 'not_priceable' };
export interface PartnerInsuranceProduct {
  id: string; productName: string; kind: { id: string | null; code: string | null };
  formula: PartnerFormula; storedTerms: unknown; sumInsuredRules: unknown;
  /** Recorded on the product; nothing is charged against it today (founder Q4). */
  govtSubsidyBps: number; ourCommissionBps: number;
  isParametric: boolean; active: boolean; createdAt: string | null; updatedAt: string | null;
  policies: Record<string, number>;
}
export interface PartnerInsuranceDashboard {
  computedAt: string; policies: number; inForce: { count: number; sumInsuredMinor: string }; proposed: number; fpos: number; products: number;
}
/** PC-56 PARTNER-2b (founder Q5) — one row of the issuance QUEUE: a `proposed` policy on the insurer's own products, awaiting the farmer's
 *  premium payment. A READ: the insurer issues nothing on the platform. No holder, subject, payment, tenant, number or status field exists. */
export interface PartnerInsuranceQueueRow {
  id: string; productId: string; productName: string | null;
  /** The FPO's PUBLIC display name, or null for a non-live organisation. */
  fpoName: string | null;
  subjectType: string;
  sumInsuredMinor: string;
  /** The premium the FARMER will pay (as stored on the proposal). */
  premiumMinor: string;
  proposedAt: string | null;
  /** The cover window the proposal carries, if any; nothing starts until the farmer's payment is confirmed. */
  validFrom: string | null; validUntil: string | null;
}
export interface PartnerInsuranceIssuancePage { items: PartnerInsuranceQueueRow[]; nextCursor: string | null; limit: number; computedAt: string | null }

/** PC-56 PARTNER-3a (founder Q4) — the claim statuses of the platform's state machine. */
export type PartnerInsuranceClaimStatus = 'intimated' | 'docs_pending' | 'survey_scheduled' | 'surveyed' | 'approved' | 'partially_approved' | 'rejected' | 'paid' | 'closed';
/** PC-56 PARTNER-3a (founder Q4) — one claim on the insurer's own products: claim FACTS only. No claimant, description, surveyor, survey report,
 *  note, media, payout or tenant field exists on this type. */
export interface PartnerInsuranceClaim {
  /** The claim's id — its REFERENCE (there is no claim number). */
  id: string;
  policyId: string;
  /** NULL today on every policy (nobody issues on the platform): "no policy number yet". */
  policyNo: string | null;
  productId: string; productName: string | null;
  /** The FPO's PUBLIC display name, or null. */
  fpoName: string | null;
  subjectType: string;
  sumInsuredMinor: string;
  /** A platform `claim_event` code, or null ("not recorded"). */
  eventTypeCode: string | null;
  eventDate: string | null;
  status: PartnerInsuranceClaimStatus | string;
  /** The recorded yes / no, or null. */
  reportedWithin72h: boolean | null;
  /** The approved amount AS RECORDED (minor units), or null. */
  approvedMinor: string | null;
  /** The survey's damage percentage (whole number) when recorded. */
  damagePercent: number | null;
  filedAt: string | null; lastChangedAt: string | null; closedAt: string | null;
  /** Whole days since filing for an open claim; null once rejected / paid / closed. */
  waitingDays: number | null;
}
export interface PartnerInsuranceClaimsPage { items: PartnerInsuranceClaim[]; nextCursor: string | null; limit: number; computedAt: string | null }
/** PC-56 PARTNER-3a — COUNTS of the claims filed in [from, to) (IST days; by default the current FY): no amount, no ratio. */
export interface PartnerInsuranceClaimCounts {
  from: string; to: string; timeZone: string; fy: string | null; total: number;
  byStatus: Record<string, number>; byEvent: Record<string, number>;
  decided: { approved: number; partiallyApproved: number; rejected: number };
  computedAt: string;
}

class PartnerInsuranceClaimsApi {
  constructor(private readonly http: HttpClient) {}
  /** The queue — oldest first, keyset; the status filter is the machine's own list. */
  async list(q: { status?: PartnerInsuranceClaimStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerInsuranceClaimsPage> {
    const r = await this.http.request<PartnerInsuranceClaim[]>('GET', 'partner/insurance/claims', { query: { status: q.status, cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; computedAt?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, computedAt: m.computedAt ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<PartnerInsuranceClaim & { computedAt: string }> {
    return (await this.http.request<PartnerInsuranceClaim & { computedAt: string }>('GET', `partner/insurance/claims/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** Counts in [from, to) — both or neither (neither = the current FY, answered by the platform's database). */
  async counts(q: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<PartnerInsuranceClaimCounts> {
    return (await this.http.request<PartnerInsuranceClaimCounts>('GET', 'partner/insurance/claims/counts', { query: { from: q.from, to: q.to }, signal })).data;
  }
}

class PartnerInsuranceApi {
  /** PC-56 PARTNER-3a — the claims on the insurer's own products (read-only). */
  readonly claims: PartnerInsuranceClaimsApi;
  constructor(private readonly http: HttpClient) { this.claims = new PartnerInsuranceClaimsApi(http); }
  async dashboard(signal?: AbortSignal): Promise<PartnerInsuranceDashboard> {
    return (await this.http.request<PartnerInsuranceDashboard>('GET', 'partner/insurance/dashboard', { signal })).data;
  }
  async products(signal?: AbortSignal): Promise<{ items: PartnerInsuranceProduct[]; computedAt: string | null }> {
    const r = await this.http.request<PartnerInsuranceProduct[]>('GET', 'partner/insurance/products', { signal });
    return { items: r.data, computedAt: ((r.meta ?? {}) as { computedAt?: string }).computedAt ?? null };
  }
  async product(id: string, signal?: AbortSignal): Promise<PartnerInsuranceProduct & { computedAt: string }> {
    return (await this.http.request<PartnerInsuranceProduct & { computedAt: string }>('GET', `partner/insurance/products/${encodeURIComponent(id)}`, { signal })).data;
  }
  async policies(q: { status?: PartnerInsurancePolicyStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerInsurancePoliciesPage> {
    const r = await this.http.request<PartnerInsurancePolicy[]>('GET', 'partner/insurance/policies', { query: { status: q.status, cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; computedAt?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, computedAt: m.computedAt ?? null };
  }
  async policy(id: string, signal?: AbortSignal): Promise<PartnerInsurancePolicy & { computedAt: string }> {
    return (await this.http.request<PartnerInsurancePolicy & { computedAt: string }>('GET', `partner/insurance/policies/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** PC-56 PARTNER-2b — the issuance queue (`proposed` only, keyset newest first). */
  async issuance(q: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerInsuranceIssuancePage> {
    const r = await this.http.request<PartnerInsuranceQueueRow[]>('GET', 'partner/insurance/issuance', { query: { cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; computedAt?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, computedAt: m.computedAt ?? null };
  }
}

/** PC-56 PARTNER-2c (founder Q7) — one of the lender's OWN loan products, as the platform holds it (read-only). No person field exists on the
 *  type (no author, no applicant); rates are integer basis points; money is a bigint minor-unit STRING in `currencyCode`. */
export interface PartnerLoanProduct {
  id: string;
  /** The product's own name. */
  defaultName: string;
  /** The platform's `loan_kind` registry code, or null when the kind id does not resolve ("kind not registered"). */
  kind: { id: string | null; code: string | null };
  currencyCode: string;
  minAmountMinor: string; maxAmountMinor: string;
  interestAprBps: number; subventionBps: number;
  /** interestAprBps − subventionBps (an integer — "net of subsidy"). */
  netAprBps: number;
  tenureMonthsMin: number | null; tenureMonthsMax: number | null;
  ltvBps: number | null;
  collateralKind: string | null;
  /** Recorded on the product; the platform's fee leg is not live — nothing is charged today. */
  originationFeeMinor: string; originationFeeBps: number;
  /** The lender's own stored rules, as stored (nothing is evaluated). */
  eligibilityRules: unknown;
  requiredDocuments: { count: number; codes: string[] };
  repaymentStyle: string;
  active: boolean;
  createdAt: string | null; updatedAt: string | null;
  /** This lender's CONSENTED applications on the product created in the last `windowDays` days — a count. */
  applications30d: number;
}
export interface PartnerLoanShelf { items: PartnerLoanProduct[]; computedAt: string | null; windowDays: number | null }

class PartnerLoanProductsApi {
  constructor(private readonly http: HttpClient) {}
  async list(signal?: AbortSignal): Promise<PartnerLoanShelf> {
    const r = await this.http.request<PartnerLoanProduct[]>('GET', 'partner/loan-products', { signal });
    const m = (r.meta ?? {}) as { computedAt?: string; windowDays?: number };
    return { items: r.data, computedAt: m.computedAt ?? null, windowDays: m.windowDays ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<PartnerLoanProduct & { computedAt: string; windowDays: number }> {
    return (await this.http.request<PartnerLoanProduct & { computedAt: string; windowDays: number }>('GET', `partner/loan-products/${encodeURIComponent(id)}`, { signal })).data;
  }
}

/** PC-56 PARTNER-4a (founder 4a-2) — ONE loan on the lender's own book: LOAN FACTS ONLY. No person field exists on the type (no borrower,
 *  no applicant, no author), no repayment channel, no bank account, no narrative, no ledger anchor and no `tenantId` — the cooperative is
 *  named by its PUBLIC display name in `fpoName`. Money is a bigint minor-unit STRING; the rate is INTEGER basis points, never a
 *  percentage. `maturityDate` and `nextDueDate` are NULL on every loan the platform opens: there is no instalment schedule. */
export interface PartnerBookLoan {
  /** The loan's id — its REFERENCE (there is no loan number on the platform). */
  id: string;
  /** The application's id — its REFERENCE (`partner_app_ref` is never written). */
  applicationId: string;
  productId: string;
  productName: string | null;
  /** A platform `loan_kind` code (kcc, crop, dairy …), or null ("not recorded"). */
  kindCode: string | null;
  /** The cooperative's (FPO's) PUBLIC display name, or null. */
  fpoName: string | null;
  principalMinor: string;
  /** INTEGER basis points, stamped at disbursal. */
  interestAprBps: number;
  disbursedAt: string | null;
  /** NULL on every loan the platform opens — "no maturity date recorded". */
  maturityDate: string | null;
  status: string;
  outstandingMinor: string;
  /** NULL likewise — "no next due date recorded". */
  nextDueDate: string | null;
  openedAt: string | null;
  lastChangedAt: string | null;
}
export interface PartnerBookPage { items: PartnerBookLoan[]; nextCursor: string | null; limit: number; computedAt: string | null }
/** One RECORDED repayment. A row is created AT PAYMENT, so `dueDate` is not an instalment date and nothing here is "on time". */
export interface PartnerBookRepayment {
  id: string; loanId: string; dueDate: string | null; amountDueMinor: string; amountPaidMinor: string;
  paidAt: string | null; recordedAt: string | null;
}
export interface PartnerBookRepaymentsPage { items: PartnerBookRepayment[]; limit: number; computedAt: string | null }
/** PC-56 PARTNER-4a — COUNTS and bigint SUMS of the loans OPENED in [from, to) (IST days; by default the current FY): no ratio, no
 *  percentage, no average, no PAR. */
export interface PartnerBookCounts {
  from: string; to: string; timeZone: string; fy: string | null; total: number;
  byStatus: Record<string, number>; byKind: Record<string, number>;
  outstandingByKindMinor: Record<string, string>; principalByKindMinor: Record<string, string>;
  servicing: { count: number; outstandingMinor: string };
  restructured: number;
  writtenOff: { count: number; outstandingMinor: string };
  computedAt: string;
}

class PartnerBookApi {
  constructor(private readonly http: HttpClient) {}
  /** This lender's own book, NEWEST first. Loop while `nextCursor` is non-null. */
  async list(q: { status?: PartnerBookLoanStatus; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerBookPage> {
    const r = await this.http.request<PartnerBookLoan[]>('GET', 'partner/loans', { query: { status: q.status, cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; computedAt?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, computedAt: m.computedAt ?? null };
  }
  /** One loan of this lender's book; another lender's or an absent id → 404 `PARTNER_LOAN_NOT_FOUND`. */
  async get(id: string, signal?: AbortSignal): Promise<PartnerBookLoan & { computedAt: string }> {
    return (await this.http.request<PartnerBookLoan & { computedAt: string }>('GET', `partner/loans/${encodeURIComponent(id)}`, { signal })).data;
  }
  /** One loan's RECORDED repayment history (never the channel). An unowned loan answers the same 404 as an absent one. */
  async repayments(id: string, q: { limit?: number } = {}, signal?: AbortSignal): Promise<PartnerBookRepaymentsPage> {
    const r = await this.http.request<PartnerBookRepayment[]>('GET', `partner/loans/${encodeURIComponent(id)}/repayments`, { query: { limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { limit?: number; computedAt?: string };
    return { items: r.data, limit: m.limit ?? r.data.length, computedAt: m.computedAt ?? null };
  }
  /** The counts and bigint sums in a window of IST days; omit both dates for the current FY (the database answers it). */
  async counts(q: { from?: string; to?: string } = {}, signal?: AbortSignal): Promise<PartnerBookCounts> {
    return (await this.http.request<PartnerBookCounts>('GET', 'partner/loans/counts', { query: { from: q.from, to: q.to }, signal })).data;
  }
}

class PartnerAuth {
  constructor(private readonly http: HttpClient) {}
  /** The phone OTP (the platform's — enumeration-safe). Anonymous. */
  async otp(phone: string): Promise<{ sent: true; resendInSec: number; ttlSec: number; devCode?: string }> {
    return (await this.http.request<{ sent: true; resendInSec: number; ttlSec: number; devCode?: string }>('POST', 'partner/auth/otp', { anonymous: true, body: { phone } })).data;
  }
  /** Phone + code (+ a partner id when already known). Several partners → SdkError PARTNER_CHOICE_REQUIRED. Anonymous. */
  async verify(phone: string, code: string, partnerId?: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/verify', { anonymous: true, body: { phone, code, ...(partnerId ? { partnerId } : {}) } })).data;
  }
  /** The chooser's second step: the single-use choice token + the chosen partner. Anonymous. */
  async choose(choiceToken: string, partnerId: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/verify', { anonymous: true, body: { choiceToken, partnerId } })).data;
  }
  async verifyTwoFactor(input: { challengeToken: string; code?: string; recoveryCode?: string }): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/2fa/verify', { anonymous: true, body: input })).data;
  }
  /** Rotate a PARTNER refresh token (a tenant one is refused). Anonymous — the refresh token is the credential. */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    return (await this.http.request<AuthTokens>('POST', 'partner/auth/refresh', { anonymous: true, body: { refreshToken } })).data;
  }
  async logout(): Promise<{ ok: true }> { return (await this.http.request<{ ok: true }>('POST', 'partner/auth/logout')).data; }
}

class PartnerApplications {
  constructor(private readonly http: HttpClient) {}
  async list(q: { status?: PartnerApplicationStatus; reviewQueue?: boolean; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerApplicationsPage> {
    const r = await this.http.request<PartnerApplication[]>('GET', 'partner/applications', {
      query: { status: q.status, reviewQueue: q.reviewQueue === undefined ? undefined : String(q.reviewQueue), cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; asOf?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, asOf: m.asOf ?? null };
  }
  async get(id: string, signal?: AbortSignal): Promise<PartnerApplication & { asOf: string }> {
    return (await this.http.request<PartnerApplication & { asOf: string }>('GET', `partner/applications/${encodeURIComponent(id)}`, { signal })).data;
  }
}

class PartnerDecide {
  constructor(private readonly http: HttpClient) {}
  async review(id: string, idempotencyKey: string): Promise<PartnerDecisionResult> {
    return (await this.http.request<PartnerDecisionResult>('POST', `partner/applications/${encodeURIComponent(id)}/review`, { idempotencyKey })).data;
  }
  async approve(id: string, input: { amountApprovedMinor: string; coolingOffHours?: number }, idempotencyKey: string): Promise<PartnerDecisionResult> {
    return (await this.http.request<PartnerDecisionResult>('POST', `partner/applications/${encodeURIComponent(id)}/approve`, { idempotencyKey, body: input })).data;
  }
  async reject(id: string, input: { note?: string }, idempotencyKey: string): Promise<PartnerDecisionResult> {
    return (await this.http.request<PartnerDecisionResult>('POST', `partner/applications/${encodeURIComponent(id)}/reject`, { idempotencyKey, body: input })).data;
  }
  /** ALWAYS refused (403 PARTNER_CANNOT_DISBURSE): the FPO is the lender of record and disburses from its console. */
  async disburse(id: string, idempotencyKey: string): Promise<never> {
    await this.http.request('POST', `partner/applications/${encodeURIComponent(id)}/disburse`, { idempotencyKey });
    throw new Error('partner.decide.disburse: the API refuses a partner disbursal');
  }
}

class PartnerTeamApi {
  constructor(private readonly http: HttpClient) {}
  async list(signal?: AbortSignal): Promise<PartnerTeam> { return (await this.http.request<PartnerTeam>('GET', 'partner/team', { signal })).data; }
  async invite(input: { phone: string; roleCode: PartnerRoleCode; languageCode?: 'en' | 'hi' | 'gu' }, idempotencyKey: string): Promise<PartnerInviteCreated> {
    return (await this.http.request<PartnerInviteCreated>('POST', 'partner/team/invites', { idempotencyKey, body: input })).data;
  }
  async revokeInvite(id: string, reason: string): Promise<{ id: string; status: 'revoked' }> {
    return (await this.http.request<{ id: string; status: 'revoked' }>('POST', `partner/team/invites/${encodeURIComponent(id)}/revoke`, { body: { reason } })).data;
  }
  async removeMember(membershipId: string, reason: string): Promise<{ id: string; active: false; sessionsEnded: number }> {
    return (await this.http.request<{ id: string; active: false; sessionsEnded: number }>('POST', `partner/team/members/${encodeURIComponent(membershipId)}/remove`, { body: { reason } })).data;
  }
}

class PartnerInvites {
  constructor(private readonly http: HttpClient) {}
  /** PC-56 PARTNER-1b · D4: a POST — the token is in the body, never in a URL (a URL lands in access logs). Anonymous. */
  async lookup(token: string): Promise<PartnerInviteLookup> {
    return (await this.http.request<PartnerInviteLookup>('POST', 'partner/invites/lookup', { anonymous: true, body: { token } })).data;
  }
  /** Accept: the token AND the OTP sent to the INVITED phone → a partner session. Anonymous. */
  async accept(input: { token: string; phone: string; code: string; fullName?: string }): Promise<AuthTokens & { invite: { id: string; roleCode: string } }> {
    return (await this.http.request<AuthTokens & { invite: { id: string; roleCode: string } }>('POST', 'partner/invites/accept', { anonymous: true, body: input })).data;
  }
}

class PartnerMe2fa {
  constructor(private readonly http: HttpClient) {}
  async state(): Promise<{ enrolled: boolean; confirmed: boolean; confirmedAt: string | null; recoveryLeft: number }> {
    return (await this.http.request<{ enrolled: boolean; confirmed: boolean; confirmedAt: string | null; recoveryLeft: number }>('GET', 'partner/me/2fa')).data;
  }
  async enrol(): Promise<{ secret: string; otpauthUri: string; shownOnce: true }> {
    return (await this.http.request<{ secret: string; otpauthUri: string; shownOnce: true }>('POST', 'partner/me/2fa/enrol')).data;
  }
  async confirm(code: string): Promise<{ confirmed: true; recoveryCodes: string[] }> {
    return (await this.http.request<{ confirmed: true; recoveryCodes: string[] }>('POST', 'partner/me/2fa/confirm', { body: { code } })).data;
  }
}

class PartnerKeysApi {
  constructor(private readonly http: HttpClient) {}
  async list(signal?: AbortSignal): Promise<PartnerKey[]> { return (await this.http.request<PartnerKey[]>('GET', 'partner/keys', { signal })).data; }
  /** Revoke one of this partner's keys — PERMANENT; every call with it fails at once. Mint the Idempotency-Key when the confirm renders. */
  async revoke(id: string, input: { reason: string }, idempotencyKey: string): Promise<PartnerKeyRevoked> {
    return (await this.http.request<PartnerKeyRevoked>('POST', `partner/keys/${encodeURIComponent(id)}/revoke`, { idempotencyKey, body: { reason: input.reason } })).data;
  }
}

class PartnerWebhooksApi {
  constructor(private readonly http: HttpClient) {}
  async list(signal?: AbortSignal): Promise<PartnerWebhookEndpoints> {
    const r = await this.http.request<PartnerWebhookEndpoint[]>('GET', 'partner/webhooks', { signal });
    const m = (r.meta ?? {}) as { subscribableEvents?: string[]; retentionDays?: number; computedAt?: string };
    return { items: r.data, subscribableEvents: m.subscribableEvents ?? [], retentionDays: m.retentionDays ?? 0, computedAt: m.computedAt ?? null };
  }
  async deliveries(q: { endpointId?: string; state?: PartnerDeliveryState; eventType?: string; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<PartnerDeliveriesPage> {
    const r = await this.http.request<PartnerDelivery[]>('GET', 'partner/webhooks/deliveries', {
      query: { endpointId: q.endpointId, state: q.state, eventType: q.eventType, cursor: q.cursor, limit: q.limit }, signal });
    const m = (r.meta ?? {}) as { nextCursor?: string | null; limit?: number; retentionDays?: number; computedAt?: string };
    return { items: r.data, nextCursor: m.nextCursor ?? null, limit: m.limit ?? r.data.length, retentionDays: m.retentionDays ?? null, computedAt: m.computedAt ?? null };
  }
  async delivery(id: string, signal?: AbortSignal): Promise<PartnerDeliveryDetail> {
    return (await this.http.request<PartnerDeliveryDetail>('GET', `partner/webhooks/deliveries/${encodeURIComponent(id)}`, { signal })).data;
  }
}

export class PartnerResource {
  readonly auth: PartnerAuth;
  readonly applications: PartnerApplications;
  readonly decide: PartnerDecide;
  readonly team: PartnerTeamApi;
  readonly invites: PartnerInvites;
  readonly twoFactor: PartnerMe2fa;
  readonly keys: PartnerKeysApi;
  readonly webhooks: PartnerWebhooksApi;
  /** PC-56 PARTNER-2a · an insurer's own products and the policy facts on them (read-only; every read audited server-side). */
  readonly insurance: PartnerInsuranceApi;
  /** PC-56 PARTNER-2c · a lender's own loan products' terms + the consented 30-day count (read-only; every read audited server-side). */
  readonly loanProducts: PartnerLoanProductsApi;
  /** PC-56 PARTNER-4a · a lender's own loan book: loan facts, one loan's recorded repayments, the FY counts (read-only; every read audited). */
  readonly loans: PartnerBookApi;
  constructor(private readonly http: HttpClient) {
    this.auth = new PartnerAuth(http); this.applications = new PartnerApplications(http); this.decide = new PartnerDecide(http);
    this.team = new PartnerTeamApi(http); this.invites = new PartnerInvites(http); this.twoFactor = new PartnerMe2fa(http);
    this.keys = new PartnerKeysApi(http); this.webhooks = new PartnerWebhooksApi(http); this.insurance = new PartnerInsuranceApi(http);
    this.loanProducts = new PartnerLoanProductsApi(http); this.loans = new PartnerBookApi(http);
  }
  /** PC-56 PARTNER-1b · the six readiness facts + computedAt (any member of the partner). */
  async readiness(signal?: AbortSignal): Promise<PartnerReadiness> { return (await this.http.request<PartnerReadiness>('GET', 'partner/readiness', { signal })).data; }
  /** PC-56 PARTNER-1a · the dashboard's six figures + as-of, the SLA promise beside the actual latency, the FPOs, the oldest awaiting. */
  async dashboard(signal?: AbortSignal): Promise<PartnerDashboard> { return (await this.http.request<PartnerDashboard>('GET', 'partner/dashboard', { signal })).data; }
  /** The organisation and the signed-in person. */
  async me(signal?: AbortSignal): Promise<PartnerMe> { return (await this.http.request<PartnerMe>('GET', 'partner/me', { signal })).data; }
}
