// modules/tenancy/domain/tenancy.errors.ts · typed errors with stable codes.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class PlanNotFoundError extends NotFoundError { constructor(id: string) { super('Plan not found'); (this as any).details = { id }; } }
export class SubscriptionNotFoundError extends NotFoundError { constructor(id: string) { super('Subscription not found'); (this as any).details = { id }; } }
/** Managing the global plan catalogue is platform-admin only (god-mode, Law 11). */
export class PlanForbiddenError extends AppError { constructor(message = 'Plan management requires platform admin') { super('PLAN_FORBIDDEN', message, 403); } }
export class SubscriptionForbiddenError extends AppError { constructor(message = 'Not allowed on this subscription') { super('SUBSCRIPTION_FORBIDDEN', message, 403); } }
export class InvalidPlanError extends DomainError { constructor(message: string) { super('PLAN_INVALID', message, 400); } }
export class InvalidSubscriptionError extends DomainError { constructor(message: string) { super('SUBSCRIPTION_INVALID', message, 400); } }
/** The chosen plan is inactive / not subscribable. */
export class PlanNotSubscribableError extends AppError { constructor() { super('PLAN_NOT_SUBSCRIBABLE', 'Plan is not available for subscription', 409); } }
/** The tenant already has a live subscription — change the plan or cancel first. */
export class AlreadySubscribedError extends AppError { constructor() { super('ALREADY_SUBSCRIBED', 'This tenant already has a live subscription', 409); } }
/** Code uniqueness (code, version, country). */
export class PlanCodeExistsError extends AppError { constructor() { super('PLAN_CODE_EXISTS', 'A plan with this code/version/country already exists', 409); } }
export class SubscriptionNotLiveError extends AppError { constructor(status: string) { super('SUBSCRIPTION_NOT_LIVE', `Subscription is not live (status: ${status})`, 409, { status }); } }

// ---- tenancy self-serve (profile / domains / settings) ----
export class TenantNotFoundError extends NotFoundError { constructor(id: string) { super('Tenant not found'); (this as any).details = { id }; } }
/** The actor lacks tenant.settings on this tenant. */
export class TenantForbiddenError extends AppError { constructor(message = 'Tenant administration requires tenant.settings') { super('TENANT_FORBIDDEN', message, 403); } }
/**
 * PC-56 TENANT-4d-3: carries EVERY invalid field, not just the first.
 *
 * W2424's own promise is "every invalid field is listed with its reason", and the previous validator threw on
 * the first bad field — so a form with three problems reported one, and the tenant learned the other two on
 * two more round trips. `fields` is what the screen renders; the message stays human for logs. The parameter is
 * optional so every existing throw site still compiles and simply carries no list.
 */
export class InvalidTenantProfileError extends DomainError {
  constructor(message: string, readonly fields?: ReadonlyArray<{ field: string; reason: string; detail?: string }>) {
    super('TENANT_PROFILE_INVALID', message, 422, fields ? { fields } : undefined);
  }
}
/** Self-serve writes refused because the tenant is suspended/archived/terminated (fail closed). */
export class TenantNotWritableError extends AppError { constructor(status: string) { super('TENANT_NOT_WRITABLE', `Tenant is not self-serve writable (status: ${status})`, 409, { status }); } }
/** submitForReview is only valid from 'pending'. */
export class TenantNotPendingError extends AppError { constructor(status: string) { super('TENANT_NOT_PENDING', `Tenant onboarding can only be submitted while pending (status: ${status})`, 409, { status }); } }
export class TenantDomainNotFoundError extends NotFoundError { constructor(id: string) { super('Tenant domain not found'); (this as any).details = { id }; } }
export class InvalidTenantDomainError extends DomainError { constructor(message: string) { super('TENANT_DOMAIN_INVALID', message, 422); } }
/** UNIQUE(domain) — already claimed (by this or another tenant). */
export class DomainExistsError extends AppError { constructor(domain: string) { super('TENANT_DOMAIN_EXISTS', `Domain ${domain} is already registered`, 409, { domain }); } }
export class UnknownSettingError extends NotFoundError { constructor(key: string) { super('Setting definition not found'); (this as any).details = { key }; } }
export class InvalidSettingError extends DomainError { constructor(key: string, message: string) { super('TENANT_SETTING_INVALID', `${key}: ${message}`, 422, { key }); } }
/** Only scope='tenant' settings are self-serve writable (platform/user-scoped keys refused — Law 11). */
export class SettingNotTenantScopedError extends AppError { constructor(key: string, scope: string) { super('SETTING_NOT_TENANT_SCOPED', `Setting ${key} is ${scope}-scoped and not tenant-editable`, 403, { key, scope }); } }

// ---- SaaS invoicing (the bill we raise TO a tenant) ----
export class SaasInvoiceNotFoundError extends NotFoundError { constructor(id: string) { super('SaaS invoice not found'); (this as any).details = { id }; } }
export class InvalidSaasInvoiceError extends DomainError { constructor(message: string) { super('SAAS_INVOICE_INVALID', message, 422); } }
/** A payment was recorded against an invoice that isn't owing (e.g. draft/void). */
export class SaasInvoiceNotPayableError extends AppError { constructor(status: string) { super('SAAS_INVOICE_NOT_PAYABLE', `Invoice is not payable (status: ${status})`, 409, { status }); } }
/** One invoice per (subscription, billing period) — the renewal run already raised this one. */
export class SaasInvoiceExistsError extends AppError { constructor(period: string) { super('SAAS_INVOICE_EXISTS', `A SaaS invoice already exists for period ${period}`, 409, { period }); } }

// ---- PC-56 TENANT-13b · settings maker-checker (F-4), floors, wiring, languages ----
/** A trust-affecting key (money_path / security / member notice) is never written by one person: propose it. */
export class SettingProposalRequiredError extends AppError {
  constructor(key: string, riskClass: string) { super('PROPOSAL_REQUIRED', `${key} is trust-affecting (${riskClass}): propose the change; a second administrator confirms it and it applies from the next midnight IST`, 409, { key, riskClass }); }
}
/** The value is outside the platform floor (tenant_min / tenant_max, 0192). */
export class SettingOutsideFloorError extends DomainError {
  constructor(key: string, problem: Record<string, unknown>) { super('SETTING_OUTSIDE_FLOOR', `${key}: the value is outside the platform floor`, 422, { key, ...problem }); }
}
/** Defined in the registry, read by nothing (F-15) — not offered, not written. */
export class SettingNotWiredError extends AppError {
  constructor(key: string, reason: string) { super('SETTING_NOT_WIRED', `${key} is defined but nothing reads it yet — it is not editable`, 409, { key, reason }); }
}
export class SettingDeprecatedError extends AppError {
  constructor(key: string) { super('SETTING_DEPRECATED', `${key} is deprecated — languages are written to tenant_languages (PUT /tenant-settings/languages)`, 409, { key }); }
}
/** Only trust-affecting keys take a proposal; an ordinary key is written directly. */
export class SettingNotGatedError extends AppError {
  constructor(key: string) { super('SETTING_NOT_GATED', `${key} is an ordinary setting — save it directly`, 409, { key }); }
}
export class SettingUnchangedError extends DomainError {
  constructor(key: string) { super('SETTING_UNCHANGED', `${key} already has this value`, 422, { key }); }
}
export class SettingReasonError extends DomainError {
  constructor(problem: string) { super('SETTING_REASON_INVALID', `reason is ${problem} (20–500 characters)`, 422, { field: 'reason', problem }); }
}
/** A tenant with ONE active tenant_admin cannot get a second signature — refused at proposal time, by name. */
export class SettingNeedsSecondAdminError extends AppError {
  constructor(admins: number) { super('NEEDS_SECOND_ADMIN', 'This change needs a second administrator to confirm it — your organisation has one', 409, { admins }); }
}
export class SettingProposalLiveError extends AppError {
  constructor(key: string, proposalId: string) { super('SETTING_PROPOSAL_LIVE', `${key} already has a proposal waiting`, 409, { key, proposalId }); }
}
export class SettingProposalNotFoundError extends NotFoundError {
  constructor(id: string) { super('Setting proposal not found'); (this as any).code = 'SETTING_PROPOSAL_NOT_FOUND'; (this as any).details = { id }; }
}
/** Maker ≠ checker — raised when 0192's trigger refuses the confirmation (the trigger is the wall; this is its name). */
export class SettingCheckerIsMakerError extends AppError {
  constructor(id: string) { super('CHECKER_IS_MAKER', 'The person who proposed this change cannot also confirm it — a second administrator must', 409, { proposalId: id }); }
}
export class SettingProposalExpiredError extends AppError {
  constructor(id: string, expiresAt: string) { super('SETTING_PROPOSAL_EXPIRED', 'This proposal expired unconfirmed after 7 days', 409, { proposalId: id, expiresAt }); }
}
export class LanguagesInvalidError extends DomainError {
  constructor(problem: string, details: Record<string, unknown> = {}) { super('LANGUAGES_INVALID', `languages: ${problem}`, 422, { problem, ...details }); }
}
/** Removing a language something published still uses — refused by name, listing what uses it (A5). */
export class LanguageInUseError extends AppError {
  constructor(uses: Array<{ code: string; kind: string; count: number }>) { super('LANGUAGE_IN_USE', 'A language you are removing is still used by published content', 409, { uses }); }
}
