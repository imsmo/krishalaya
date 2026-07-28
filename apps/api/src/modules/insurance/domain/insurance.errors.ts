// modules/insurance/domain/insurance.errors.ts · typed errors with stable codes (mapped to HTTP/i18n).
// Mirrors modules/fintech/domain/fintech.errors.ts exactly (same schema family, same error-shape convention).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class InsuranceProductNotFoundError extends NotFoundError {
  constructor(id: string) { super('Insurance product not found'); (this as any).code = 'INSURANCE_PRODUCT_NOT_FOUND'; (this as any).details = { id }; }
}
export class InsurancePartnerNotFoundError extends NotFoundError {
  constructor(id: string) { super('Insurance partner not found'); (this as any).code = 'INSURANCE_PARTNER_NOT_FOUND'; (this as any).details = { id }; }
}
export class InsurancePolicyNotFoundError extends NotFoundError {
  constructor(id: string) { super('Insurance policy not found'); (this as any).code = 'INSURANCE_POLICY_NOT_FOUND'; (this as any).details = { id }; }
}
/** The referenced partner exists but is not an insurer (IRDAI-partner gating — Law 12: never fabricate a
 *  compliance claim; this only enforces partner_kind='insurer', it does not assert any IRDAI status itself). */
export class PartnerNotAnInsurerError extends DomainError {
  constructor(partnerId: string) { super('PARTNER_NOT_AN_INSURER', 'Referenced partner is not an insurer', 422, { partnerId }); }
}
export class InsuranceProductInactiveError extends DomainError {
  constructor(id: string) { super('INSURANCE_PRODUCT_INACTIVE', 'Insurance product is not active', 422, { id }); }
}
/** premium_calc jsonb did not match either supported shape (pct_of_sum_insured | flat_minor). */
export class InvalidPremiumCalcError extends DomainError {
  constructor() { super('INSURANCE_INVALID_PREMIUM_CALC', 'Product premium_calc is malformed', 500); }
}
export class InvalidSumInsuredError extends DomainError {
  constructor(message = 'Sum insured must be greater than zero') { super('INSURANCE_INVALID_SUM_INSURED', message, 422); }
}
export class InvalidPolicyValidityError extends DomainError {
  constructor(message = 'valid_until must be after valid_from') { super('INSURANCE_INVALID_VALIDITY', message, 422); }
}
export class InsuranceForbiddenError extends AppError {
  constructor(message = 'Not allowed on this insurance resource') { super('INSURANCE_FORBIDDEN', message, 403); }
}

// ---- DEV-23 (KV-BL-053/054): premium collection + claims ------------------------------------------------

/** Premium payment can only be initiated while the policy is 'proposed' (screen 288's payment step; a
 *  cancelled/active/lapsed/expired/claimed policy has nothing to collect). */
export class PolicyNotAwaitingPremiumError extends DomainError {
  constructor(status: string) { super('INSURANCE_POLICY_NOT_AWAITING_PREMIUM', `Policy is not awaiting premium payment (status=${status})`, 422, { status }); }
}
/** Money-safety tamper guard (Law 2/12): the captured payment's amountMinor did not match the policy's own
 *  premiumMinor at the moment of activation — never silently activate a policy on a wrong amount. Mirrors
 *  payments' own PaymentAmountMismatchError shape. Routed to the outbox DLQ, not swallowed. */
export class InsurancePremiumAmountMismatchError extends DomainError {
  constructor(expectedMinor: bigint, actualMinor: bigint) {
    super('INSURANCE_PREMIUM_AMOUNT_MISMATCH', `Captured payment amount (${actualMinor}) does not match policy premium (${expectedMinor})`, 409, { expectedMinor: expectedMinor.toString(), actualMinor: actualMinor.toString() });
  }
}
/** A claim can only be filed against a policy that is currently ON COVER (screen 289's policy picker only
 *  ever lists ACTIVE policies) — never a proposed/cancelled/lapsed/expired/already-claimed one. */
export class PolicyNotOnCoverError extends DomainError {
  constructor(policyId: string, status: string) { super('INSURANCE_POLICY_NOT_ON_COVER', `Policy is not on cover (status=${status})`, 422, { policyId, status }); }
}
export class InsuranceClaimNotFoundError extends NotFoundError {
  constructor(id: string) { super('Insurance claim not found'); (this as any).code = 'INSURANCE_CLAIM_NOT_FOUND'; (this as any).details = { id }; }
}
/** Unknown/inactive `claim_event` lookup code (event-type chips, screen 289). */
export class InvalidClaimEventTypeError extends DomainError {
  constructor(code: string) { super('INSURANCE_INVALID_CLAIM_EVENT', `Unknown claim event type '${code}'`, 422, { code }); }
}
/** A claim decision's approvedMinor must be >0 (approved/partially_approved) or absent (rejected), and can
 *  never exceed the policy's sum insured (screen 293's settlement math never invents money beyond cover). */
export class InvalidClaimDecisionError extends DomainError {
  constructor(message: string) { super('INSURANCE_INVALID_CLAIM_DECISION', message, 422); }
}
/** Settlement (money-out) requires a prior approved/partially_approved decision with approvedMinor set. */
export class ClaimNotApprovedError extends DomainError {
  constructor(status: string) { super('INSURANCE_CLAIM_NOT_APPROVED', `Claim is not in an approved state (status=${status})`, 422, { status }); }
}
/** Screen 292's agree/disagree only makes sense once a survey has actually been recorded. */
export class ClaimNotAwaitingAcknowledgementError extends DomainError {
  constructor(status: string) { super('INSURANCE_CLAIM_NOT_AWAITING_ACK', `Claim has no assessment awaiting acknowledgement (status=${status})`, 422, { status }); }
}
/** Evidence media must be the caller's own, clean-scanned image/video (Law 1/10: no attaching someone
 *  else's asset, no attaching an unscanned/infected one). */
export class ClaimEvidenceNotAttachableError extends DomainError {
  constructor(mediaId: string) { super('INSURANCE_CLAIM_EVIDENCE_NOT_ATTACHABLE', `Media ${mediaId} is not attachable to this claim`, 422, { mediaId }); }
}

// ---- DEV-25 (KV-BL-057, Wave 7): external-integration errors -------------------------------------------

/** Vet-cert verification only applies to a livestock claim (policy subjectType==='animal') — a crop/
 *  equipment/person/shipment claim has no veterinary certificate to check (Law 12: never call an
 *  irrelevant "verification" on an unrelated claim type just because the endpoint exists). */
export class VetCertNotApplicableError extends DomainError {
  constructor(claimId: string) { super('INSURANCE_VET_CERT_NOT_APPLICABLE', 'Vet-certificate verification only applies to a livestock (animal) claim', 422, { claimId }); }
}

/** The autopay-link endpoint is gated behind the EXISTING `autopay_execution` flag (reused + disclosed per
 *  the founder's own instruction — no 4th flag invented for a thin link onto existing money machinery). */
export class AutopayLinkDisabledError extends DomainError {
  constructor() { super('INSURANCE_AUTOPAY_LINK_DISABLED', 'Autopay mandate linking is disabled (autopay_execution flag is OFF)', 403); }
}

/** The mandate cited for an autopay link must belong to the SAME user as the policy holder, be registered
 *  for the 'insurance_premium' purpose, and not already be cancelled — never silently link a stranger's or
 *  wrong-purpose mandate (money-safety, Law 2/6). */
export class AutopayMandateInvalidError extends DomainError {
  constructor(reason: string) { super('INSURANCE_AUTOPAY_MANDATE_INVALID', `Mandate cannot be linked for premium autopay: ${reason}`, 422, { reason }); }
}
