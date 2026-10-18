// modules/partner-console/domain/partner-console.errors.ts · PC-56 PARTNER-0 — every refusal of the partner realm BY NAME.
// The 0225 triggers raise `[CODE] …`; `namedPartnerRefusal(e)` turns those (and the two unique-index races) into the typed 4xx below, the
// SW-c pattern. Anything else passes through unchanged.
import { DomainError } from '../../../shared/errors/app-error';

export class PartnerRefusedError extends DomainError {
  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) { super(code, message, status, details); }
}

export const PARTNER_CODES: Readonly<Record<string, { status: number; message: string }>> = Object.freeze({
  // the session
  PARTNER_SESSION_REQUIRED: { status: 401, message: 'Sign in to your partner organisation (a partner session is required).' },
  PARTNER_SESSION_ENDED: { status: 401, message: 'This partner session has ended — sign in again.' },
  PARTNER_ROUTE_UNDECLARED: { status: 401, message: 'This partner route declares no permission and is refused.' },
  PARTNER_PERMISSION_MISSING: { status: 403, message: 'Your role in this partner organisation does not allow this.' },
  // sign-in
  PARTNER_ACCESS_NONE: { status: 403, message: 'This phone has no access to a partner organisation.' },
  PARTNER_CHOICE_REQUIRED: { status: 403, message: 'You belong to more than one partner organisation — choose one to continue.' },
  PARTNER_CHOICE_INVALID: { status: 401, message: 'The choice step expired — sign in again with your phone.' },
  // applications
  PARTNER_APPLICATION_NOT_FOUND: { status: 404, message: 'This application was not found.' },
  PARTNER_CANNOT_DISBURSE: { status: 403, message: 'A partner never disburses: disbursal moves the organisation\'s (FPO\'s) wallet money, and the FPO is the lender of record — it disburses from its own console once you approve.' },
  PARTNER_IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'An Idempotency-Key header is required.' },
  // team
  PARTNER_REASON_REQUIRED: { status: 422, message: 'A reason of 10–500 characters is required.' },
  PARTNER_ROLE_REQUIRED: { status: 422, message: 'Choose one of the partner roles (administrator, checker, maker, viewer).' },
  PARTNER_INVITE_PHONE_INVALID: { status: 422, message: 'The phone number is not a valid mobile number.' },
  PARTNER_INVITE_PENDING_EXISTS: { status: 409, message: 'This phone already has a pending invite here — revoke it first.' },
  PARTNER_INVITE_NOT_FOUND: { status: 404, message: 'This invite was not found (or the code is wrong).' },
  PARTNER_INVITE_ALREADY_USED: { status: 409, message: 'This invite was already used — an invite works once.' },
  PARTNER_INVITE_REVOKED: { status: 409, message: 'This invite was revoked by the partner organisation.' },
  PARTNER_INVITE_EXPIRED: { status: 410, message: 'This invite has expired — ask the partner organisation for a new one.' },
  PARTNER_INVITE_OTP_INVALID: { status: 401, message: 'The one-time code for the invited phone is wrong or has expired.' },
  PARTNER_INVITE_FINAL: { status: 409, message: 'What an invite says is fixed, and a closed invite never moves again.' },
  PARTNER_INVITE_BORN_PENDING: { status: 409, message: 'An invite is born pending.' },
  PARTNER_INVITE_NOT_ADMIN: { status: 403, message: 'Only a partner administrator invites or revokes an invite.' },
  PARTNER_INVITE_NOT_YOURS: { status: 403, message: 'An invite is accepted by the invited person.' },
  PARTNER_INVITE_NOT_STALE: { status: 409, message: 'An invite expires only after its 7 days.' },
  PARTNER_ALREADY_MEMBER: { status: 409, message: 'This person already holds that role in this partner organisation.' },
  PARTNER_MEMBER_NOT_FOUND: { status: 404, message: 'This membership was not found.' },
  PARTNER_MEMBERSHIP_FINAL: { status: 409, message: 'A membership is removed with a reason, never deleted.' },
  PARTNER_LAST_ADMIN: { status: 409, message: 'This is the last administrator of the partner organisation — appoint another first.' },
  PARTNER_REMOVE_SELF: { status: 409, message: 'You cannot remove yourself — another administrator must.' },
  PARTNER_ROLE_NOT_TENANT: { status: 422, message: 'A partner role is held inside a partner organisation, never inside a tenant.' },
  // PC-56 PARTNER-1b · keys (founder D1) and webhooks (D2) — 0227's `[CODE]` refusals and the service's own
  PARTNER_KEY_NOT_FOUND: { status: 404, message: 'This API key was not found.' },
  PARTNER_KEY_ALREADY_REVOKED: { status: 409, message: 'This API key is revoked already — revocation is permanent.' },
  PARTNER_KEY_REASON_REQUIRED: { status: 422, message: 'A reason of 20–300 characters is required to revoke a key.' },
  PARTNER_DELIVERY_NOT_FOUND: { status: 404, message: 'This delivery was not found.' },
  // PC-56 PARTNER-2a · the insurer's own book (founder Q6) — another insurer's policy and an absent id answer the same 404 (never "not yours")
  PARTNER_POLICY_NOT_FOUND: { status: 404, message: 'This policy was not found.' },
  PARTNER_PRODUCT_NOT_FOUND: { status: 404, message: 'This product was not found.' },
  /** The platform's `insurance` flag is OFF: the insurer routes answer 404 with this code, so the console prints "switched off — nothing is broken". */
  PARTNER_INSURANCE_SWITCHED_OFF: { status: 404, message: 'Insurance is switched off on the platform — nothing is broken.' },
  // PC-56 PARTNER-2c · the lender's own shelf (founder Q7) — another lender's product and an absent id answer the same 404 (never "not yours")
  PARTNER_LOAN_PRODUCT_NOT_FOUND: { status: 404, message: 'This loan product was not found.' },
});

export function partnerRefused(code: string, details: Record<string, unknown> = {}): PartnerRefusedError {
  const c = PARTNER_CODES[code] ?? { status: 409, message: code };
  return new PartnerRefusedError(code, c.message, c.status, details);
}

/** `[CODE] …` from a 0225 trigger → the named refusal; the two unique-index races are named too; anything else unchanged. */
export function namedPartnerRefusal(e: unknown): unknown {
  if (e instanceof PartnerRefusedError) return e;
  const msg = String((e as Error)?.message ?? '');
  const m = /\[([A-Z_]+)\]/.exec(msg);
  if (m && PARTNER_CODES[m[1]]) return partnerRefused(m[1]);
  if ((e as { code?: string })?.code === '23505') {
    if (/uq_pi_one_pending/.test(msg)) return partnerRefused('PARTNER_INVITE_PENDING_EXISTS');
    if (/uq_pm_user_partner_role/.test(msg)) return partnerRefused('PARTNER_ALREADY_MEMBER');
  }
  return e;
}
