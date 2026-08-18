// @krishalaya/sdk-js · tenancy resource (P-17 — tenant-admin-lite). Plans catalogue + the tenant's subscription
// (apply / current / list). create is idempotent (Law 3; a paid plan moves money SERVER-SIDE — the app never
// does, Law 11). Money is bigint minor strings (Law 2). Gated server-side by the tenant's own permissions.
import { HttpClient } from '../http';
import { Plan, Subscription, TenantAnalytics, TenantBroadcast, Page } from '../types';

export class TenancyResource {
  /** W120's billing surface: `client.tenancy.billing.console() / .invoices(tab) / .invoice(id) / .payQuote(id)`.
   *  Before PC-56 TENANT-4d-2 there was no route to a tenant's own SaaS invoices at all. */
  readonly billing: SaasBillingResource;
  /** W2424-W2427's tax-identity chain: `client.tenancy.profile.taxIdentity() / .preview(patch) / .update(...)`. */
  readonly profile: TenantProfileResource;
  constructor(private readonly http: HttpClient) { this.billing = new SaasBillingResource(http); this.profile = new TenantProfileResource(http); }

  /** Public plan catalogue (apply screen). */
  async plans(signal?: AbortSignal): Promise<Plan[]> {
    return (await this.http.request<Plan[]>('GET', 'plans', { signal })).data;
  }
  /** The tenant's current subscription (+ limits/usage), or { subscription: null } before applying. */
  async currentSubscription(signal?: AbortSignal): Promise<{ subscription: Subscription | null; limits?: Record<string, string>; usage?: Record<string, string> }> {
    return (await this.http.request<{ subscription: Subscription | null; limits?: Record<string, string>; usage?: Record<string, string> }>('GET', 'subscriptions/current', { signal })).data;
  }
  async listSubscriptions(cursor?: string, signal?: AbortSignal): Promise<Page<Subscription>> {
    const r = await this.http.request<Subscription[]>('GET', 'subscriptions', { query: { cursor }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }
  /** Apply for a plan (create a subscription). Idempotent (Law 3). */
  async apply(input: { planId: string; billingCycle?: 'monthly' | 'annual' }, idempotencyKey: string): Promise<Subscription> {
    return (await this.http.request<Subscription>('POST', 'subscriptions', { idempotencyKey, body: input })).data;
  }
  /** Change the plan on an existing subscription (server prices it; the app never computes money — Law 2/11). */
  /**
   * Create an organisation from a verified phone — W113's door.
   *
   * **PUBLIC: no session is needed, and none could exist.** `verifyOtp` requires a tenant id, so somebody who belongs to no
   * organisation cannot authenticate; this route verifies the phone itself and returns the first session.
   *
   * `resumed: true` means this phone already administers an organisation and was returned to it rather than given a second
   * one (W113: "one active storefront per verified phone number"). Requires an Idempotency-Key.
   */
  async signUp(input: TenantSignupInput, idempotencyKey: string): Promise<TenantSignupResult> {
    return (await this.http.request<TenantSignupResult>('POST', 'tenant-signup', { body: input, idempotencyKey })).data;
  }

  /** W119's compare table, the current plan, live usage, and any scheduled change. Read-only. */
  async comparePlans(signal?: AbortSignal): Promise<PlanCompareView> {
    return (await this.http.request<PlanCompareView>('GET', 'subscriptions/plans/compare', { signal })).data;
  }

  /**
   * What a plan change would cost and what it would break. **CHARGES NOTHING** — W119: "proration always previews before
   * any payment".
   */
  async planPreview(subscriptionId: string, planId: string, signal?: AbortSignal): Promise<PlanChangePreview> {
    return (await this.http.request<PlanChangePreview>('GET', `subscriptions/${encodeURIComponent(subscriptionId)}/plan-preview`, { query: { planId }, signal })).data;
  }

  /**
   * Change plan. An upgrade applies now and is invoiced with to-the-day proration; a downgrade is SCHEDULED for the period
   * end (W119: "no clawbacks mid-cycle").
   *
   * **NO AMOUNT IS SENT.** The API recomputes every figure — a client that could post the total due could post a smaller
   * one. `replayed: true` means this exact change was already recorded and the SAME invoice is being returned, which is what
   * "a double click cannot charge twice" has to mean to somebody on a slow connection.
   */
  async changePlan(subscriptionId: string, planId: string, reason?: string): Promise<{ change: PlanChangeRecord; replayed: boolean }> {
    return (await this.http.request<{ change: PlanChangeRecord; replayed: boolean }>('POST', `subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, { body: { planId, ...(reason ? { reason } : {}) } })).data;
  }

  /** Every plan change on this subscription, with each component of its arithmetic kept. */
  async planChanges(subscriptionId: string, signal?: AbortSignal): Promise<PlanChangeRecord[]> {
    return (await this.http.request<PlanChangeRecord[]>('GET', `subscriptions/${encodeURIComponent(subscriptionId)}/plan-changes`, { signal })).data;
  }

  /** Cancel a scheduled downgrade before its effective date. */
  async cancelPendingPlanChange(subscriptionId: string): Promise<{ cancelled: boolean }> {
    return (await this.http.request<{ cancelled: boolean }>('DELETE', `subscriptions/${encodeURIComponent(subscriptionId)}/pending-change`, {})).data;
  }

  /** @deprecated superseded by `changePlan` above — kept only so the old shape is not silently re-added. */
  async changePlanLegacy(subscriptionId: string, planId: string): Promise<Subscription> {
    return (await this.http.request<Subscription>('POST', `subscriptions/${encodeURIComponent(subscriptionId)}/change-plan`, { body: { planId } })).data;
  }
  /** Cancel a subscription — at period end (default, keeps access until renewal) or immediately. */
  async cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<Subscription> {
    return (await this.http.request<Subscription>('POST', `subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { body: { atPeriodEnd } })).data;
  }

  // --- analytics + broadcast (API-W10) ---
  /** The calling tenant's own analytics dashboard over a window (default last 30 days). Money is bigint minor. */
  async analytics(params: { from?: string; to?: string; currency?: string } = {}, signal?: AbortSignal): Promise<TenantAnalytics> {
    return (await this.http.request<TenantAnalytics>('GET', 'tenancy/analytics', { query: { from: params.from, to: params.to, currency: params.currency }, signal })).data;
  }
  /** Send a broadcast to an audience (all active members, or one role). Async fan-out via the notification spine. Idempotent (Law 3). */
  async broadcast(input: { title: string; body: string; audienceRoleCode?: string }, idempotencyKey: string): Promise<TenantBroadcast> {
    return (await this.http.request<TenantBroadcast>('POST', 'communication/broadcasts', { idempotencyKey, body: input })).data;
  }
  /** The tenant's broadcast history (keyset). */
  async listBroadcasts(params: { cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<TenantBroadcast>> {
    const r = await this.http.request<TenantBroadcast[]>('GET', 'communication/broadcasts', { query: { cursor: params.cursor, limit: params.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  // --- PC-55 A1 `tenant-registration-public` — the PUBLIC door (no token, no tenant) ---
  /** Apply to become a tenant. ANONYMOUS + Idempotency-Keyed: a retried tap returns the same reference,
   *  never a second case. The reply carries only a reference + status (no queue data ever leaks outward). */
  async applyAsTenant(input: {
    orgName: string; orgTypeId?: string; orgTypeOther?: string; countryCode?: string; regionIds?: string[];
    contactName: string; contactPhone: string; contactEmail?: string; memberCountEstimate?: number;
    pitchText?: string; docMediaIds?: string[];
  }, idempotencyKey: string): Promise<{ reference: string; status: string }> {
    return (await this.http.request<{ reference: string; status: string }>('POST', 'tenant-applications', {
      body: input, idempotencyKey, anonymous: true,
    })).data;
  }

  /* ---------------------------------------------------------------------------------------------------------
   * PC-56 TENANT-4d-1 · W118's meters and W115's plan cards. Read-only.
   * ------------------------------------------------------------------------------------------------------- */
  /** W118: the plan (with the version it is price-locked to), the four meters with an HONEST STATE each
   *  (enforced / counted_only / not_measured), the notice threshold in force, the projection, and the metrics
   *  thirteen modules gate on that no plan prices. */
  async planUsage(signal?: AbortSignal): Promise<PlanUsageView> {
    return (await this.http.request<PlanUsageView>('GET', 'plan-usage', { signal })).data;
  }
  /** The member-seat pre-check, so a roster screen can withhold "Add member" instead of letting it fail. */
  async memberSeat(signal?: AbortSignal): Promise<{ used: number; limit: number | null; state: PlanMeterState }> {
    return (await this.http.request<{ used: number; limit: number | null; state: PlanMeterState }>('GET', 'plan-usage/member-seat', { signal })).data;
  }
  /** W115's cards: public active plans for a country, newest version of each code. */
  async choosablePlans(country = 'IN', signal?: AbortSignal): Promise<ChoosablePlanRow[]> {
    return (await this.http.request<ChoosablePlanRow[]>('GET', 'plan-usage/plans', { query: { country }, signal })).data;
  }

}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE CONSOLE HOME — W117's dashboard and W116's go-live checklist (PC-56 TENANT-1c)                             */
/* ------------------------------------------------------------------------------------------------------------ */

export interface DashboardTiles {
  gmvThisMonthMinor: string;
  /** The SAME elapsed interval into the previous month, so a comparison on the 13th is 13 days against 13 days. */
  gmvPrevMonthSameDayMinor: string;
  /** Basis points. **null when the previous window was zero** — a percentage against nothing is not a fact. */
  gmvChangeBp: number | null;
  payoutsPendingMinor: string;
  payoutsPendingFarmers: number;
  liveListings: number;
  listingsNewToday: number;
  listingsInQc: number;
  openDisputes: number;
  /** Age of the oldest open dispute in hours — what makes it urgent rather than merely present. */
  oldestDisputeHours: number | null;
}

export type DashboardActionKind = 'qc_queue' | 'payout_batch' | 'dispute';

export interface DashboardAction {
  kind: DashboardActionKind;
  count: number;
  oldestHours: number | null;
  amountMinor: string | null;
  href: string;
}

export interface TenantPlanHealth {
  planCode: string | null;
  planName: string | null;
  status: string | null;
  membersUsed: number;
  /** **null means NO CAP** (or an unconfigured one). Never a negative number on screen: -1 is 0002's "unlimited". */
  memberLimit: number | null;
  currentPeriodEnd: string | null;
}

export interface TenantDashboard {
  tiles: DashboardTiles;
  /** **EMPTY ON A QUIET DAY.** W117: "The dashboard stays honest — no manufactured urgency." */
  needsYouToday: DashboardAction[];
  planHealth: TenantPlanHealth;
}

export type GoLiveStepKey = 'organisation' | 'plan' | 'kyc' | 'team' | 'members' | 'payouts';

export interface GoLiveStep {
  key: GoLiveStepKey;
  done: boolean;
  /** The underlying FACT's own timestamp. Never invented, and null while the step is not done. */
  doneAt: string | null;
  /** Only ever `kyc`, and only for `payouts` — money genuinely cannot move before the organisation is verified. */
  blockedBy: GoLiveStepKey | null;
  /** Exactly one step carries this: the first that is neither done nor blocked. */
  isNext: boolean;
}

export interface GoLiveState {
  steps: GoLiveStep[];
  progress: { done: number; total: number };
  live: boolean;
  blocked: { key: GoLiveStepKey; blockedBy: GoLiveStepKey }[];
  staffCount: number;
  memberCount: number;
}

/**
 * The tenant console's home reads.
 *
 * **THE CHECKLIST IS DERIVED FROM FACTS, NOT READ FROM A CHECKLIST TABLE.** There is no table: each of W116's six steps is a
 * row that already exists (the tenant, the subscription, a verified business KYC profile, two staff, one member, a
 * penny-verified bank account), so the state cannot drift from reality and the timestamps cannot be backdated.
 */
export class ConsoleHomeResource {
  constructor(private readonly http: HttpClient) {}

  async dashboard(signal?: AbortSignal): Promise<TenantDashboard> {
    return (await this.http.request<TenantDashboard>('GET', 'tenancy/console/dashboard', { signal })).data;
  }

  async goLive(signal?: AbortSignal): Promise<GoLiveState> {
    return (await this.http.request<GoLiveState>('GET', 'tenancy/console/go-live', { signal })).data;
  }
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* PC-56 TENANT-1d-2 · W119 — the upgrade that used to be free                                                        */
/* ---------------------------------------------------------------------------------------------------------------- */

export interface ComparePlan {
  id: string;
  code: string;
  name: string;
  monthlyPriceMinor: string;
  annualPriceMinor: string;
  currencyCode: string;
  isCurrent: boolean;
  /** limit_code → value. `-1` is unlimited (0002) and stays -1: the console decides the word. */
  limits: Record<string, string>;
  features: Record<string, boolean>;
}

export interface PlanCompareView {
  plans: ComparePlan[];
  limitCodes: string[];
  features: Array<{ code: string; name: string }>;
  current: {
    subscriptionId: string; planId: string; planName: string; billingCycle: string;
    priceMinor: string; currencyCode: string; periodStart: string; periodEnd: string; status: string;
  } | null;
  /** Live counts of members and staff — not a monthly counter. */
  usage: Record<string, string>;
  /** W119's "Custom plan in force": the subscription's price differs from its plan's list price. Derived, never a flag. */
  customPricing: boolean;
  pending: { planId: string; planName: string; priceMinor: string; effectiveDate: string; reason: string | null } | null;
}

export interface PlanLimitBreach { limitCode: string; limitValue: string; currentUsage: string }

export interface PlanChangePreview {
  subscriptionId: string;
  fromPlan: { id: string; code: string; name: string; priceMinor: string };
  toPlan: { id: string; code: string; name: string; priceMinor: string };
  currencyCode: string;
  periodStart: string;
  periodEnd: string;
  today: string;
  taxBp: number;
  /** No platform override exists, so the shipped rate applies. Normal. */
  taxUsedDefault: boolean;
  /** The rate could not be READ. A preview renders with the caveat; an upgrade refuses rather than invoicing a guess. */
  taxUnavailable: boolean;
  lines: {
    direction: 'upgrade' | 'downgrade' | 'lateral';
    daysInPeriod: number;
    daysRemaining: number;
    newPlanChargeMinor: string;
    unusedCreditMinor: string;
    netDueMinor: string;
    taxMinor: string;
    /** **RENDER THIS, never the sum of the lines above** — the parts are rounded for display, the total is not. */
    totalDueMinor: string;
    effectiveDate: string;
    scheduled: boolean;
  };
  breaches: PlanLimitBreach[];
  idempotencyKey: string;
}

/** One row of `subscription_plan_changes` — every input kept, so an invoice can be explained a year later. */
export interface PlanChangeRecord {
  id: string;
  subscriptionId: string;
  fromPlanId: string;
  toPlanId: string;
  direction: 'upgrade' | 'downgrade' | 'lateral';
  effectiveDate: string;
  /** NULL while a scheduled downgrade waits for its date. */
  appliedAt: string | null;
  daysInPeriod: number;
  daysRemaining: number;
  newPlanChargeMinor: string;
  unusedCreditMinor: string;
  netDueMinor: string;
  taxBp: number;
  taxMinor: string;
  totalDueMinor: string;
  currencyCode: string;
  invoiceId: string | null;
  idempotencyKey: string;
  limitBreaches: unknown;
  reason: string | null;
  createdAt: string;
}

/** W113's form. **No plan, price or status is sendable** — a public route that could set those could provision terms nobody agreed. */
export interface TenantSignupInput {
  phone: string;
  code: string;
  fullName: string;
  orgName: string;
  /** A `lookup_values` id from the `tenant_type` registry — the list comes from the platform, not from the app. */
  orgTypeId: string;
  lang?: 'en' | 'hi' | 'gu';
  countryCode?: string;
  device?: { fingerprint: string; platform?: 'android' | 'ios' | 'web'; model?: string; appVersion?: string };
}

export interface TenantSignupResult {
  tenantId: string;
  slug: string;
  displayName: string;
  /** True when the phone already administered an organisation and was resumed into it. Nothing was created. */
  resumed: boolean;
  /** null on a resume — the existing organisation's trial, if any, is its own business. */
  trialEndsOn: string | null;
  tokens: { accessToken: string; refreshToken: string; expiresInSec: number };
}

// PC-56 TENANT-4d-1 · W118/W115.
export type PlanMeterState = 'enforced' | 'counted_only' | 'not_measured';
export type PlanMeterVerdict =
  | { kind: 'not_measured'; reason: 'no_source' | 'no_limit' }
  | { kind: 'unlimited'; used: number }
  | { kind: 'within'; used: number; limit: number; pct: number; atNotice: boolean }
  | { kind: 'at_limit'; used: number; limit: number; pct: 100 }
  | { kind: 'over_limit'; used: number; limit: number; pct: number };
export interface PlanMeter {
  code: string; shape: 'stock' | 'flow'; state: PlanMeterState; verdict: PlanMeterVerdict;
  limitCode: string | null; enforcedBy: string | null;
}
export type PlanProjection =
  | { kind: 'not_available'; reason: 'insufficient_history' | 'no_limit' | 'not_growing' }
  | { kind: 'reaches'; monthsAway: number; perMonth: number };
export interface PlanUsageView {
  planName: string | null; planLabel: string | null; planVersion: number | null;
  subscriptionStatus: string | null; limitsApply: boolean; thresholdPct: number; enforcementOn: boolean;
  meters: PlanMeter[]; projection: PlanProjection; unpricedGatedMetrics: string[];
}
export interface ChoosablePlanRow {
  code: string; version: number; name: string; monthlyPriceMinor: string; annualPriceMinor: string;
  currencyCode: string; isPublic: boolean; isActive: boolean; countryCode: string | null;
  limits: Record<string, number>;
}


/* ------------------------------------------------------------------------------------------------------------ */
/* W120 — THE TENANT'S OWN SAAS INVOICES (PC-56 TENANT-4d-2)                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

export const SAAS_INVOICE_TABS = ['all', 'issued', 'paid', 'overdue'] as const;
export type SaasInvoiceTab = (typeof SAAS_INVOICE_TABS)[number];

/** The four sentences W120 states about the billing MECHANISM. Not one of them has a subject in the platform
 *  today, so each carries the verdict the code can actually support and the console prints THAT. */
export type BillingMechanismVerdict = 'exists' | 'no_saas_mandate' | 'not_scheduled' | 'no_grace_state';

export interface SaasInvoiceRow {
  id: string; invoiceNo: string; subscriptionId: string | null; status: string; currencyCode: string;
  subtotalMinor: string; taxMinor: string; totalMinor: string;
  /** Money actually RECEIVED — the SUM of the invoice's payment rows, not an inference from one payment. */
  paidMinor: string; outstandingMinor: string; overpaidMinor: string;
  dueDate: string; paidAt: string | null; dunningAttempts: number;
  periodTag: string | null;
  /** The rate the invoice was raised at, frozen. null = none recorded, which is NOT "0% GST". */
  taxBp: number | null;
  billToGstin: string | null; billToLegalName: string | null;
  lineItems: Array<{ desc: string; qty: number; unitMinor: string; totalMinor: string }>;
  createdAt: string | null;
}

export interface SaasInvoiceDetail extends SaasInvoiceRow {
  receipts: Array<{ id: string; amountMinor: string; currencyCode: string; method: string; reference: string; receivedAt: string; isReversal: boolean }>;
}

export interface BillingConsoleView {
  openBalanceMinor: string | null;
  openBalanceCurrency: string;
  openBalanceCurrencies: string[];
  openInvoiceCount: number;
  openBalancePartial: boolean;
  oldestOpen: {
    id: string; invoiceNo: string; status: string; dueDate: string; outstandingMinor: string; currencyCode: string;
    description: string; taxLine: 'stated' | 'zero_rated' | 'not_recorded'; taxBp: number | null; taxMinor: string;
  } | null;
  paidToDate: {
    year: number; minor: string; currencyCode: string; invoiceCount: number;
    onTime: number; late: number; unknown: number; allOnTime: boolean; mixedCurrencies: string[];
  };
  tabCounts: Record<string, number>;
  billTo: { gstinMasked: string | null; legalName: string | null; source: 'snapshot' | 'not_on_invoice' };
  subscription: { id: string; status: string; billingCycle: string; priceMinor: string; currencyCode: string; currentPeriodEnd: string | null } | null;
  mechanism: { autopay: BillingMechanismVerdict; nextDebit: BillingMechanismVerdict; gracePeriod: BillingMechanismVerdict; retryAndNotify: BillingMechanismVerdict };
  selfPayEnabled: boolean;
}

export type SaasPayQuote =
  | { payable: true; invoiceNo: string; amountMinor: string; currencyCode: string }
  | { payable: false; invoiceNo: string; reason: 'already_paid' | 'voided' | 'not_yet_issued' | 'nothing_outstanding' | 'self_pay_off' };

export class SaasBillingResource {
  constructor(private readonly http: HttpClient) {}

  /** W120's header in one read: open balance, oldest-due invoice, paid-to-date, tab counts, billed identity. */
  async console(signal?: AbortSignal): Promise<BillingConsoleView> {
    return (await this.http.request<BillingConsoleView>('GET', 'billing/console', { signal })).data;
  }

  /** The keyset page behind a tab. Keyset only — never an offset, so the page cannot drift as invoices are raised. */
  async invoices(opts: { tab?: SaasInvoiceTab; cursor?: string; limit?: number } = {}, signal?: AbortSignal): Promise<Page<SaasInvoiceRow>> {
    const r = await this.http.request<SaasInvoiceRow[]>('GET', 'billing/invoices', { query: { tab: opts.tab, cursor: opts.cursor, limit: opts.limit ?? 50 }, signal });
    return { items: r.data, nextCursor: (r.meta?.nextCursor as string | null) ?? null };
  }

  async invoice(id: string, signal?: AbortSignal): Promise<SaasInvoiceDetail> {
    return (await this.http.request<SaasInvoiceDetail>('GET', `billing/invoices/${encodeURIComponent(id)}`, { signal })).data;
  }

  /**
   * What is outstanding on this invoice, resolved SERVER-SIDE, or the reason it cannot be paid. The AMOUNT IS
   * NEVER SENT BY THE CALLER: pass this quote's `amountMinor` straight to `payments.createIntent` and the API
   * re-checks it against the invoice before any gateway order is created.
   */
  async payQuote(id: string, signal?: AbortSignal): Promise<SaasPayQuote> {
    return (await this.http.request<SaasPayQuote>('GET', `billing/invoices/${encodeURIComponent(id)}/pay-quote`, { signal })).data;
  }
}


/* ------------------------------------------------------------------------------------------------------------ */
/* W2424-W2427 — THE TENANT'S OWN TAX IDENTITY (PC-56 TENANT-4d-3)                                              */
/*                                                                                                              */
/* `GET /v1/tenants/me` and `PATCH /v1/tenants/me` have existed since TENANT-1 and this SDK had NO METHOD for    */
/* either, so no console screen could reach the profile plane even if one existed — which is why W120's "Update  */
/* GST details" button led nowhere. These are those methods.                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

export const TAX_FIELD_CODES = ['gstin', 'pan', 'cin_or_reg_no', 'fssai_license'] as const;
export type TaxFieldCode = (typeof TAX_FIELD_CODES)[number];

/** Whether a check digit was actually verified. `failed` is an ADVISORY the review step shows — the API stores
 *  the value and lets a human decide, because a checksum that is subtly wrong would refuse correct numbers. */
export type ChecksumVerdict = 'verified' | 'failed' | 'not_applicable' | 'not_verifiable';

export type TaxFieldErrorReason = 'malformed' | 'too_long' | 'not_plain_text' | 'required';

export interface TaxFieldError { field: string; reason: TaxFieldErrorReason; detail?: string }

export interface TaxIdentityField {
  fieldCode: TaxFieldCode;
  /** An i18n KEY, never a label: "GSTIN" is India's word for this field and Bangladesh's row says BIN. */
  labelKey: string;
  maxLength: number;
  example: string | null;
  isRequired: boolean;
  checksum: Exclude<ChecksumVerdict, 'verified' | 'failed'>;
}

export interface TaxIdentityForm {
  countryCode: string;
  /** EMPTY is a real state the screen must render — this country's formats are not recorded, so identifiers are
   *  accepted as length-capped plain text. It is never a reason to fall back to another country's rules. */
  fields: TaxIdentityField[];
  current: {
    gstin: string | null; pan: string | null; cinOrRegNo: string | null; fssaiLicense: string | null;
    legalName: string; ownerName: string | null; ownerPhone: string | null; ownerEmail: string | null;
  };
}

export interface TenantProfilePatch {
  legalName?: string; displayName?: string; regionId?: string | null;
  gstin?: string | null; pan?: string | null; cinOrRegNo?: string | null; fssaiLicense?: string | null;
  ownerName?: string | null; ownerPhone?: string | null; ownerEmail?: string | null;
  /** W2426's audit reason. Required by the API exactly when a value is REPLACED or CLEARED. */
  reason?: string;
}

export interface ProfileDiffRow { field: string; from: string | null; to: string | null }

export interface ProfilePreview {
  /** False when the tenant's status forbids self-serve writes — learned BEFORE filling in a form. */
  writable: boolean;
  /** EVERY invalid field with its reason (W2424), not just the first. */
  errors: TaxFieldError[];
  verdicts: Partial<Record<TaxFieldCode, { kind: 'ok'; checksum: ChecksumVerdict } | { kind: 'cleared' }>>;
  /** W2425's diff, computed from the CLEANED values — what would actually be stored. */
  diff: ProfileDiffRow[];
  noOp: boolean;
  reasonRequired: boolean;
  reasonProblem: TaxFieldErrorReason | null;
}

export class TenantProfileResource {
  constructor(private readonly http: HttpClient) {}

  /** The tenant's own row. */
  async get(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('GET', 'tenants/me', { signal })).data;
  }

  /** W2424's field list for THIS TENANT'S COUNTRY, plus its current values. */
  async taxIdentity(signal?: AbortSignal): Promise<TaxIdentityForm> {
    return (await this.http.request<TaxIdentityForm>('GET', 'tenants/me/tax-identity', { signal })).data;
  }

  /** W2424 + W2425: validate everything and diff it, WITHOUT saving. */
  async preview(patch: TenantProfilePatch, signal?: AbortSignal): Promise<ProfilePreview> {
    return (await this.http.request<ProfilePreview>('POST', 'tenants/me/preview', { body: patch, signal })).data;
  }

  /** The audited write. Idempotency-keyed (Law 3), so W2427's Retry cannot apply a change twice. */
  async update(patch: TenantProfilePatch, idempotencyKey: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return (await this.http.request<Record<string, unknown>>('PATCH', 'tenants/me', { idempotencyKey, body: patch, signal })).data;
  }
}
