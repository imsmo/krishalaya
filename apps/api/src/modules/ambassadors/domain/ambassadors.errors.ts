// modules/ambassadors/domain/ambassadors.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';

export class AmbassadorNotFoundError extends DomainError { constructor(id: string) { super('AMBASSADOR_NOT_FOUND', `Ambassador ${id} not found`, 404, { id }); } }
export class ReferralNotFoundError extends DomainError { constructor(id: string) { super('REFERRAL_NOT_FOUND', `Referral ${id} not found`, 404, { id }); } }
export class AlreadyAmbassadorError extends DomainError { constructor(userId: string) { super('ALREADY_AMBASSADOR', `User ${userId} is already an ambassador`, 409, { userId }); } }
export class DuplicateReferralCodeError extends DomainError { constructor(code: string) { super('REFERRAL_CODE_TAKEN', `Referral code '${code}' is already in use`, 409, { code }); } }
export class SelfReferralError extends DomainError { constructor() { super('SELF_REFERRAL', 'You cannot refer yourself', 409, {}); } }
export class NoCommissionPlanError extends DomainError { constructor(eventCode: string) { super('NO_COMMISSION_PLAN', `No active commission plan for '${eventCode}'`, 422, { eventCode }); } }
export class NothingToPayoutError extends DomainError { constructor(ambassadorId: string) { super('NOTHING_TO_PAYOUT', `Ambassador ${ambassadorId} has no unpaid earnings`, 409, { ambassadorId }); } }
export class InvalidReferralError extends DomainError { constructor(detail: string) { super('REFERRAL_INVALID', detail, 422, { detail }); } }
export class AmbassadorsForbiddenError extends DomainError { constructor(detail = 'forbidden') { super('AMBASSADORS_FORBIDDEN', detail, 403, {}); } }
/** The caller is not an active ambassador — only an active ambassador may assist-onboard / log visits. */
export class NotAnAmbassadorError extends DomainError { constructor() { super('NOT_AN_AMBASSADOR', 'You must be an active ambassador to perform this action', 403, {}); } }
/** Assisted onboarding REQUIRES the farmer's recorded consent (DPDP) — refuse to create an account without it. */
export class ConsentRequiredError extends DomainError { constructor() { super('CONSENT_REQUIRED', 'Assisted onboarding requires the farmer to grant the data-processing consent', 422, {}); } }
export class OnBehalfConsentRequiredError extends DomainError { constructor() { super('ON_BEHALF_CONSENT_REQUIRED', 'The farmer must grant on-behalf-listing consent to this ambassador first', 403, {}); } }
/** A target for this ambassador + metric + period already exists (UNIQUE(ambassador_id, metric, period_start)). */
export class DuplicateTargetError extends DomainError { constructor() { super('TARGET_EXISTS', 'A target for this metric + period already exists', 409, {}); } }
/** PC-56 TENANT-10a · F-1. The payout locked N unpaid earnings and stamped a different number. THROWN INSIDE the payout's
 *  transaction, so the wallet leg posted a moment earlier rolls back with it — money never moves for rows not stamped. */
export class PayoutMarkMismatchError extends DomainError { constructor(locked: number, stamped: number) { super('PAYOUT_MARK_MISMATCH', `Payout locked ${locked} earnings but stamped ${stamped}; nothing was paid`, 409, { locked, stamped }); } }
/** PC-56 TENANT-10a · F-4. Assisted onboarding is for a person with NO account. A phone that already belongs to somebody is
 *  refused BEFORE any consent or attribution is written — an ambassador never records consents in an existing member's name. */
export class AssistedOnboardingExistingUserError extends DomainError { constructor() { super('AMB_EXISTING_USER', 'This phone number already belongs to a member — assisted onboarding is only for a person without an account', 409, {}); } }
/** PC-56 TENANT-10a · F-12. A state change the canon promises an audit reason for, sent without one (3–300 characters). */
export class ReasonRequiredError extends DomainError { constructor(act: string) { super('REASON_REQUIRED', `A reason (3–300 characters) is required to ${act}`, 422, { act }); } }
/** PC-56 TENANT-10a · F-14. The leaderboard is for the people it ranks and the people who manage them. */
export class LeaderboardForbiddenError extends DomainError { constructor() { super('LEADERBOARD_FORBIDDEN', 'The leaderboard is visible to active ambassadors and ambassador managers only', 403, {}); } }
