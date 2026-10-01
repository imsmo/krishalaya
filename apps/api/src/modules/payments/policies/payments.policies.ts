// modules/payments/policies/payments.policies.ts · permission keys (DB-backed RBAC, Law 6).
import { RequestContext } from '../../../core/tenancy-context/request-context';

export const PaymentPermissions = {
  // Creating a payment intent needs only authentication (a user pays for themselves); refunds are
  // privileged (manual wallet adjustment / moderation).
  Refund: 'wallet.adjust',
} as const;

/** Moderator (tenant-admin) able to refund / view any payment in the tenant. NOT god-mode. */
export function canModeratePayment(ctx: RequestContext): boolean {
  return ctx.permissions.has('wallet.adjust') || ctx.permissions.has('payout.approve') || ctx.permissions.has('*');
}

/** Finance admin able to manage the tenant's OWN commission-rule overrides. Platform defaults stay god-mode. */
export function canManageCommissionRules(ctx: RequestContext): boolean {
  return ctx.permissions.has('payout.approve') || ctx.permissions.has('wallet.adjust') || ctx.permissions.has('*');
}

/**
 * FINANCE SCOPE, as W151 and W152 name it ("GST exports need finance scope", "Full GSTIN reveal and credit notes
 * need finance scope"). Mapped onto `report.view` — an EXISTING seeded permission — rather than inventing a code the
 * canon never names: this wave already learned from 0139 that a permission string on a screen with no row behind it
 * is its own defect, and the inverse (a row nobody asked for) is how a role catalogue becomes noise.
 */
export function canReadFinance(ctx: RequestContext): boolean {
  return ctx.permissions.has('report.view') || ctx.permissions.has('*');
}

/**
 * [PC-56 TENANT-9c · F-8] ISSUING A GST CREDIT NOTE IS A MONEY VERB OF ITS OWN. It was `canReadFinance` (`report.view`) — a
 * READ code the auditor, the gov officer and the support agent hold — so the role the canon defines by having no write could
 * issue a tax document. `payments.credit_note.issue` (0181, tenant_admin; no tenant finance role exists). The approval it
 * spends is still a second person's (0139); this is who may be the hand that issues it.
 */
export const CREDIT_NOTE_ISSUE = 'payments.credit_note.issue';
export function canIssueCreditNote(ctx: RequestContext): boolean {
  return ctx.permissions.has(CREDIT_NOTE_ISSUE) || ctx.permissions.has('*');
}
