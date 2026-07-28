// apps/mobile/src/features/insurance/insurance.api.ts · data layer for the worker PMSBY flow (KV-BL-055,
// DEV-24), consuming the REAL insurance module DEV-22/23 shipped (`apps/api/src/modules/insurance`, `insurance`
// DB-backed feature flag — QA-PASSED, queued for founder merge). `packages/sdk-js` carries NO dedicated
// `.insurance` resource yet (this batch does not touch `packages/*` — see spec_dev24.md's gate note), so every
// call here rides `KrishiVerseClient.request<T>()`, the SAME documented "escape hatch for endpoints without a
// dedicated resource method yet" every other module used before its own typed resource shipped (`packages/sdk-js/
// src/client.ts` line 147-150). All reads degrade-never-die (empty/null on failure — Law 12). The two REAL money
// actions this module owns are enrolment premium-payment initiation and (indirectly) claim filing/evidence —
// NEITHER is offline-queued (Law 6): both are bare, idempotent `request()` calls that throw on failure, exactly
// the "direct-only" pattern `features/wallet/wallet.api.ts`'s `requestWithdrawal` and
// `features/payments/payments.api.ts`'s `addMoney` already establish (DEV-14's own verified convention) — this
// file never imports `core/offline/sync-queue.ts`.
//
// FLAG RELATIONSHIP (DEV-24 judgment call, see spec_dev24.md §flag-decision): these calls are gated ONLY by the
// existing worker-realm `worker_app` FlagKey at the screen level (unchanged — every sibling worker screen already
// gates this way; this is NOT a third flag). The API's OWN separate `insurance` DB flag (seeded OFF) is enforced
// SERVER-SIDE — when off, every endpoint below 404s (disabled -> 404 not 403, DEV-22/23's own convention) and
// every function here degrades to its documented empty/null/failed outcome rather than crashing. No mobile
// FlagKey mirrors the server's `insurance` flag (none of `fintech`/`worker_app`/any other existing key is
// renamed or duplicated for this) — see DEV-22 QA's fintech-vs-insurance naming-split flag, left exactly as
// filed for the founder queue; this batch does not invent a resolution for the FARMER-side `InsuranceScreen.tsx`.
import { SdkError } from '@krishi-verse/sdk-js';
import { apiClient } from '../../core/api/client';
import { newId } from '../../core/util/ids';
import { openCheckout } from '../../core/payments/checkout';
import { paymentOutcome, isSandboxProvider, isTerminal, type PaymentOutcome } from '../../core/payments/money';

export type PolicyStatus = 'proposed' | 'active' | 'lapsed' | 'cancelled' | 'expired' | 'claimed';
export type ClaimStatus =
  | 'intimated' | 'docs_pending' | 'survey_scheduled' | 'surveyed'
  | 'approved' | 'partially_approved' | 'rejected' | 'paid' | 'closed';

export interface InsuranceProductView {
  id: string; partnerId: string; productKindId: string; name: string;
  sumInsuredRules: Record<string, unknown>; govtSubsidyBps: number; ourCommissionBps: number;
  isParametric: boolean; isActive: boolean; premiumCalc: unknown;
}
export interface InsurancePolicyView {
  id: string; holderUserId: string; productId: string; policyNo: string | null;
  subjectType: string; subjectId: string | null; sumInsuredMinor: string; premiumMinor: string;
  premiumPaymentId: string | null; status: PolicyStatus; validFrom: string; validUntil: string;
  parametricTriggers: Record<string, unknown> | null; createdAt?: string;
}
export interface InsuranceClaimView {
  id: string; policyId: string; claimantUserId: string; eventDate: string; eventTypeId: string;
  description: string | null; status: ClaimStatus; intimatedWithin72h: boolean;
  surveyorUserId: string | null; surveyReport: Record<string, unknown> | null;
  approvedMinor: string | null; payoutId: string | null; closedAt: string | null; createdAt?: string;
}
export interface Keyset<T> { items: T[]; nextCursor: string | null }

/** True when the failure is the server's OWN honest "this module is off" signal — a 404 with the `insurance`
 * flag disabled (DEV-22/23's documented convention, mirrors `autopay_execution`'s "disabled outcome, never a
 * crash" precedent in `wallet.api.ts`). Never distinguishes flag-off from a genuinely-missing row — both 404 the
 * same way server-side, and the caller only needs "there is nothing here yet" either way. */
function isUnavailable(e: unknown): boolean {
  return e instanceof SdkError && e.status === 404;
}

/** Resolves the PMSBY product's server-side ID via the shared `insurance_kind` lookup vocabulary (never a
 * hardcoded UUID) then the read-only product catalogue. Degrades to null on any failure (flag off / no PMSBY
 * product configured / network) — the screen shows an honest "not available yet" state, never a fabricated
 * product. There is exactly one PMSBY product expected platform-wide (screen 145 shows no product picker, unlike
 * crop/livestock enrolment's own screens 283/284) — the first active match is used. */
export async function findPmsbyProduct(): Promise<InsuranceProductView | null> {
  try {
    const kinds = await apiClient().lookups.values('insurance_kind');
    const pmsbyKind = kinds.find((k) => k.code === 'pmsby');
    if (!pmsbyKind) return null;
    const res = await apiClient().request<InsuranceProductView[]>('GET', 'insurance/products', {
      query: { productKindId: pmsbyKind.id, activeOnly: true, limit: 5 },
    });
    return res.data[0] ?? null;
  } catch {
    return null;
  }
}

/** The caller's own PMSBY policy, if any (screen 39/287's "your policy" card). The list endpoint has no
 * server-side product filter (`QueryInsurancePoliciesSchema` only carries `status`/`cursor`/`limit` — grep-
 * verified against `apps/api/src/modules/insurance/dto/query-insurance-policy.dto.ts`), so this fetches the
 * caller's first page (a worker realistically holds 0-1 PMSBY policies) and filters client-side to the given
 * product id — an honest, disclosed boundary (see spec_dev24.md), not a fabricated server capability. Returns
 * the most recently created match. Degrades to null on failure (flag off / no policy yet / network). */
export async function myPmsbyPolicy(productId: string): Promise<InsurancePolicyView | null> {
  try {
    const res = await apiClient().request<InsurancePolicyView[]>('GET', 'insurance/policies', { query: { limit: 50 } });
    const mine = res.data.filter((p) => p.productId === productId);
    if (mine.length === 0) return null;
    return mine.reduce((latest, p) => ((p.createdAt ?? '') > (latest.createdAt ?? '') ? p : latest));
  } catch {
    return null;
  }
}

/** ENROL (propose) — screen 145's "Enroll" CTA. Idempotent (Law 3); `subjectType: 'person'` + no `subjectId`
 * defaults server-side to the caller (self, matching the single-holder scope DEV-22 shipped for this subject
 * type). `sumInsuredMinor` is the PMSBY statutory cover figure the CLIENT supplies (the DTO's own documented
 * shape — sum insured depends on cross-module facts the schema doesn't carry); `premiumMinor` is ALWAYS
 * server-computed and never trusted from the client. Throws on a real error (quota/validation/network) so the
 * screen shows the precise outcome — this is an ONLINE transition, never offline-queued. */
export interface ProposedPolicySummary { id: string; subjectId: string | null; sumInsuredMinor: string; premiumMinor: string; govtShareMinor: string }

export async function proposePmsbyPolicy(input: {
  productId: string; sumInsuredMinor: string; validFrom: string; validUntil: string;
}): Promise<{ policies: ProposedPolicySummary[] }> {
  const res = await apiClient().request<{ policies: ProposedPolicySummary[] }>(
    'POST',
    'insurance/policies',
    {
      idempotencyKey: newId(),
      body: {
        productId: input.productId,
        subjectType: 'person',
        subjects: [{ sumInsuredMinor: input.sumInsuredMinor }],
        validFrom: input.validFrom,
        validUntil: input.validUntil,
      },
    },
  );
  return res.data;
}

export interface PremiumPaymentResult { outcome: PaymentOutcome; paymentId?: string }

/** INITIATE + DRIVE the premium payment (KV-BL-053's endpoint, `POST .../initiate-premium-payment`) through the
 * SAME real gateway checkout loop `features/payments/payments.api.ts`'s `addMoney` already established
 * (idempotent createIntent-equivalent -> Razorpay checkout sheet OR the dev-only sandbox completion -> poll our
 * own authoritative payment status). Law 6: this is a REAL, online, direct money action — it either succeeds or
 * fails visibly in this call; it is NEVER queued offline (no `core/offline/sync-queue.ts` import anywhere in
 * this file). The policy activates ONLY once the API's own `PremiumPaymentSucceededHandler` confirms a captured,
 * amount-matching payment (DEV-23) — this function's job ends at "payment outcome", never "policy is now active"
 * (the screen re-fetches `myPmsbyPolicy` afterwards to see the server's own truth). */
export async function payPmsbyPremium(
  policyId: string,
  prefill?: { name?: string; contact?: string },
): Promise<PremiumPaymentResult> {
  const intentRes = await apiClient().request<{ policyId: string; paymentId: string; gatewayOrderId: string; provider: string; amountMinor: string; status: string }>(
    'POST',
    `insurance/policies/${encodeURIComponent(policyId)}/initiate-premium-payment`,
    { idempotencyKey: newId() },
  );
  const intent = intentRes.data;

  if (isSandboxProvider(intent.provider)) {
    const summary = await apiClient().payments.devCompleteSandbox(intent.paymentId);
    return { outcome: paymentOutcome(summary.status), paymentId: intent.paymentId };
  }

  const checkout = await openCheckout({
    gatewayOrderId: intent.gatewayOrderId, amountMinor: intent.amountMinor, description: 'PMSBY premium', prefill,
  });
  if (!checkout.ok) return { outcome: checkout.cancelled ? 'pending' : 'failed', paymentId: intent.paymentId };

  for (let i = 0; i < 5; i++) {
    try {
      const p = await apiClient().payments.get(intent.paymentId);
      if (isTerminal(p.status)) return { outcome: paymentOutcome(p.status), paymentId: intent.paymentId };
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return { outcome: 'pending', paymentId: intent.paymentId };
}

/** WITHDRAW an enrolment before payment (screen 287's "Cancelled" example, reachable from screen 39 as a
 * future affordance — not wired to a button this batch; exported for completeness/tests). Idempotent, online,
 * throws on a real error. */
export async function cancelPmsbyPolicy(policyId: string): Promise<{ id: string; status: PolicyStatus }> {
  const res = await apiClient().request<{ id: string; status: PolicyStatus }>(
    'POST', `insurance/policies/${encodeURIComponent(policyId)}/cancel`, { idempotencyKey: newId() },
  );
  return res.data;
}

/** FILE a claim (screens 146/289-290). `eventTypeCode` is the shared `claim_event` lookup CODE (never a raw
 * UUID — resolved server-side, per `create-insurance-claim.dto.ts`'s own documented rule). Idempotent, online,
 * throws on a real error (e.g. the policy isn't `active`/on-cover) so the screen shows the precise outcome. */
export async function fileClaim(input: {
  policyId: string; eventDate: string; eventTypeCode: string; description?: string; evidenceMediaIds?: string[];
}): Promise<InsuranceClaimView> {
  const res = await apiClient().request<InsuranceClaimView>('POST', 'insurance/claims', {
    idempotencyKey: newId(),
    body: {
      policyId: input.policyId, eventDate: input.eventDate, eventTypeCode: input.eventTypeCode,
      description: input.description, evidenceMediaIds: input.evidenceMediaIds,
    },
  });
  return res.data;
}

/** ADD evidence to an already-filed claim (screen 290's "add more" path) — `mediaId`s come from the EXISTING
 * upload socket (`core/media/uploader.ts`'s `uploadPickedImage`), never a new upload primitive. Throws on error. */
export async function addClaimEvidence(claimId: string, mediaIds: string[]): Promise<InsuranceClaimView> {
  const res = await apiClient().request<InsuranceClaimView>(
    'POST', `insurance/claims/${encodeURIComponent(claimId)}/evidence`, { body: { mediaIds } },
  );
  return res.data;
}

/** The caller's OWN claims (screen 146's post-filing status, screen 39's future "track your claim" affordance).
 * Keyset-paged; degrades to an empty page on failure (flag off / none filed / network). */
export async function myClaims(cursor?: string): Promise<Keyset<InsuranceClaimView>> {
  try {
    const res = await apiClient().request<InsuranceClaimView[]>('GET', 'insurance/claims', { query: { cursor, limit: 20 } });
    return { items: res.data, nextCursor: (res.meta?.nextCursor as string | undefined) ?? null };
  } catch {
    return { items: [], nextCursor: null };
  }
}

export { isUnavailable as isInsuranceUnavailable };
