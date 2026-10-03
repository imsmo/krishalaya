// modules/payments/domain/commission.errors.ts · typed errors for settlement pricing.
import { DomainError } from '../../../shared/errors/app-error';

/** No commission rule resolved for the order (platform default missing) — fail closed, don't settle. */
export class NoCommissionRuleError extends DomainError {
  constructor(details: Record<string, unknown>) { super('NO_COMMISSION_RULE', 'No commission rule applies to this order', 500, details); }
}
/** The resolved rules would leave the seller a negative net — misconfigured rates. Fail closed. */
export class SettlementConfigError extends DomainError {
  constructor(details: Record<string, unknown>) { super('SETTLEMENT_CONFIG_INVALID', 'Settlement rates exceed the gross amount', 500, details); }
}
/** A commission-rule catalog entry failed its invariants (rates out of range, bad window). */
export class InvalidCommissionRuleError extends DomainError {
  constructor(message: string) { super('COMMISSION_RULE_INVALID', message, 422); }
}
/** A tax-rule value object failed validation (rate out of range, split inconsistent). */
export class InvalidTaxRuleError extends DomainError {
  constructor(message: string) { super('TAX_RULE_INVALID', message, 422); }
}
/** A charge-definition config is malformed for its calc_method. Fail closed. */
export class InvalidChargeDefinitionError extends DomainError {
  constructor(message: string) { super('CHARGE_DEFINITION_INVALID', message, 422); }
}
/** Managing the PLATFORM-default rule catalog (tenant_id NULL) is god-mode (admin-api) — refused here. */
export class CommissionRuleForbiddenError extends DomainError {
  constructor(message = 'platform-default commission rules are managed in admin-api') { super('COMMISSION_RULE_FORBIDDEN', message, 403); }
}
export class CommissionRuleNotFoundError extends DomainError {
  constructor(id: string) { super('COMMISSION_RULE_NOT_FOUND', 'Commission rule not found', 404, { id }); }
}

// ── PC-56 TENANT-SW-a · A3 — commission rule proposals (refused BY NAME; the database trigger is the wall) ──
export class CommissionProposalNotFoundError extends DomainError {
  constructor(id: string) { super('COMMISSION_PROPOSAL_NOT_FOUND', 'Commission rule proposal not found', 404, { id }); }
}
/** effective_from earlier than the next IST midnight + 7 days (W149 "7-day notice enforced", never back-dated). */
export class CommissionNoticeError extends DomainError {
  constructor(earliest: string) { super('COMMISSION_NOTICE_7_DAYS', `A commission change takes effect at an IST midnight at least 7 days out — the earliest date is ${earliest}`, 422, { earliest }); }
}
/** A tenant with one administrator cannot get a second signature (13b's NEEDS_SECOND_ADMIN). */
export class CommissionNeedsSecondAdminError extends DomainError {
  constructor() { super('NEEDS_SECOND_ADMIN', 'This change needs a second administrator to confirm it — your organisation has one', 409); }
}
/** A move the proposal's state does not allow (already confirmed / refused / expired / applied). */
export class CommissionProposalStateError extends DomainError {
  constructor(status: string) { super('COMMISSION_PROPOSAL_STATE', `This proposal is already ${status}`, 409, { status }); }
}
/** The database refused a move (maker = checker, session, expiry, floor …) — its bracketed code, carried to the console. */
export class CommissionGateError extends DomainError {
  constructor(code: string, message: string) { super(code, message, 409, { code }); }
}
/** A partial dispute/return refund on an order whose commission the BUYER paid — not modelled (refused by name; full refunds work). */
export class BuyerCommissionPartialRefundError extends DomainError {
  constructor(details: Record<string, unknown>) { super('BUYER_COMMISSION_PARTIAL_REFUND_UNSUPPORTED', 'A partial refund of an order whose commission the buyer paid is not modelled on this platform — refund in full or resolve manually', 500, details); }
}
/** The completion payload's buyer commission disagrees with the order's frozen snapshot — fail closed, never guess. */
export class FrozenSnapshotMismatchError extends DomainError {
  constructor(details: Record<string, unknown>) { super('COMMISSION_SNAPSHOT_MISMATCH', 'The order total disagrees with its frozen commission snapshot', 500, details); }
}
