// modules/identity/domain/identity.errors.ts · typed domain errors with stable codes.
import { DomainError } from '../../../shared/errors/app-error';

export class UserNotFoundError extends DomainError {
  constructor(ref: string) { super('USER_NOT_FOUND', `User ${ref} not found`, 404); }
}
export class InvalidPhoneError extends DomainError {
  constructor() { super('INVALID_PHONE', 'Phone number is not a valid E.164 number', 422); }
}
export class UserNotActiveError extends DomainError {
  constructor(status: string) { super('USER_NOT_ACTIVE', `User is ${status}`, 403, { status }); }
}
/**
 * PC-56 TENANT-1b-2. **DISTINCT FROM `UserNotActiveError`, AND THE DIFFERENCE IS THE WHOLE FEATURE.**
 *
 * `UserNotActiveError` means the PLATFORM has stopped this person — every tenant, every surface. This one means ONE
 * organisation has suspended their membership, and the app must be able to tell the member which it is: "your access to
 * Anand FPO is paused" is actionable, "your account is suspended" when they can still trade through their other FPO is a
 * lie that sends them to the wrong support desk. The tenant is NOT named in the message the client renders from the code
 * alone — the console supplies its own name — but the code is separate so the client can choose the right sentence.
 */
export class TenantMembershipSuspendedError extends DomainError {
  constructor() {
    super('TENANT_MEMBERSHIP_SUSPENDED', 'Your membership of this organisation is currently suspended', 403,
      { scope: 'tenant' });
  }
}
export class IllegalUserTransitionError extends DomainError {
  constructor(from: string, to: string) { super('USER_ILLEGAL_TRANSITION', `Cannot move user ${from}→${to}`, 409, { from, to }); }
}
export class InvalidOtpError extends DomainError {
  constructor() { super('OTP_INVALID', 'Invalid or expired verification code', 401); }
}
export class PhoneAlreadyInUseError extends DomainError {
  constructor() { super('PHONE_IN_USE', 'That phone number is already registered to another account', 409); }
}
export class InvalidRefreshError extends DomainError {
  constructor() { super('REFRESH_INVALID', 'Refresh token is invalid, expired, or revoked', 401); }
}
export class RoleNotFoundError extends DomainError {
  constructor(ref: string) { super('ROLE_NOT_FOUND', `Role ${ref} not found`, 404); }
}
export class RoleAlreadyAssignedError extends DomainError {
  constructor() { super('ROLE_ALREADY_ASSIGNED', 'User already holds this role in this tenant', 409); }
}
export class RoleNotApprovedError extends DomainError {
  constructor() { super('ROLE_NOT_APPROVED', 'Role assignment requires approval before activation', 409); }
}
export class KycNotFoundError extends DomainError {
  constructor(id: string) { super('KYC_NOT_FOUND', `KYC document ${id} not found`, 404); }
}
export class IllegalKycTransitionError extends DomainError {
  constructor(from: string, to: string) { super('KYC_ILLEGAL_TRANSITION', `Cannot move KYC ${from}→${to}`, 409, { from, to }); }
}
export class ConcurrencyError extends DomainError {
  constructor(entity: string, id: string) { super('CONCURRENCY_CONFLICT', `${entity} ${id} was modified concurrently; retry`, 409); }
}
export class UnderageError extends DomainError {
  constructor(minAge: number) { super('UNDERAGE', `Must be at least ${minAge} years old for this role`, 422, { minAge }); }
}

// --- self-serve onboarding (KV-BL-066) ---
export type SelfServeIneligibleReason = 'platform_role' | 'invite_only' | 'not_pilot_ga' | 'unknown_role';
/** A role code submitted to POST /v1/onboarding/roles that this pilot will not self-grant. Always 403 —
 *  never 404 — so we don't leak which role codes exist vs. don't via status-code enumeration. */
export class SelfServeRoleNotEligibleError extends DomainError {
  constructor(roleCode: string, reason: SelfServeIneligibleReason) {
    const messages: Record<SelfServeIneligibleReason, string> = {
      platform_role: `'${roleCode}' is a platform role and can never be self-assigned`,
      invite_only: `'${roleCode}' is invite-only; ask your tenant admin to assign it`,
      not_pilot_ga: `'${roleCode}' is not yet available for self-serve onboarding at pilot`,
      unknown_role: `'${roleCode}' is not a recognised role`,
    };
    super('SELFSERVE_ROLE_NOT_ELIGIBLE', messages[reason], 403, { role: roleCode, reason });
  }
}

// --- bank accounts (KV-BL-067 follow-up) ---
/** S3 review finding mirrored on the identity side: adding a NEW payout destination (add /
 *  addFullBankAccount / the tokenise path) must never be reachable by a caller whose kyc_status is
 *  none/pending/rejected/expired on every active role in this tenant — only 'verified' proceeds.
 *  Mirrors modules/payments' KycRequiredError (403, deliberately generic message — never echoes back
 *  which kyc_status the caller is actually in; no enumeration of verification state). The EXISTING
 *  bank-accounts GET/list stays ungated — it's read-only and adds nothing an attacker couldn't already
 *  infer from a 403 on the write path. */
export class BankAccountKycRequiredError extends DomainError {
  constructor() { super('BANK_ACCOUNT_KYC_REQUIRED', 'Complete KYC verification before adding a payout destination', 403); }
}

// --- eKYC (P0-11) ---
/** The submitted Aadhaar/PAN failed format/checksum validation — rejected BEFORE any provider call (anti-abuse). */
export class InvalidGovIdError extends DomainError {
  constructor(docType: string) { super('EKYC_INVALID_ID', `The supplied ${docType} is not a valid number`, 422, { docType }); }
}
/** The external eKYC provider was unreachable / errored after resilience exhausted — degrade, surface 503. */
export class EkycProviderError extends DomainError {
  constructor(reason = 'eKYC provider unavailable') { super('EKYC_PROVIDER_UNAVAILABLE', reason, 503); }
}
/** No live eKYC session for this id (wrong id / not the caller's / already terminal) — 404 (no enumeration). */
export class EkycSessionNotFoundError extends DomainError {
  constructor(id: string) { super('EKYC_SESSION_NOT_FOUND', `eKYC session ${id} not found`, 404, { id }); }
}
/** OTP verification failed (wrong/expired) — the session counts the attempt and may lock. Never echoes the id. */
export class EkycVerificationFailedError extends DomainError {
  constructor(reason = 'verification failed') { super('EKYC_VERIFICATION_FAILED', reason, 422, { reason }); }
}
/** Too many failed OTP attempts — the session is locked (abuse cap). */
export class EkycTooManyAttemptsError extends DomainError {
  constructor() { super('EKYC_TOO_MANY_ATTEMPTS', 'Too many failed attempts; start a new verification', 429); }
}
export class IllegalEkycTransitionError extends DomainError {
  constructor(from: string, to: string) { super('EKYC_ILLEGAL_TRANSITION', `Cannot move eKYC session ${from}→${to}`, 409, { from, to }); }
}
