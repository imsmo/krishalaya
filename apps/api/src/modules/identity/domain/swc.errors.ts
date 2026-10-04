// modules/identity/domain/swc.errors.ts · PC-56 TENANT-SW-c · VERIFICATION DESK & TEAM — every refusal by NAME.
//
// Most walls are in the database (0199's triggers); the services NAME them instead of duplicating them, so removing a trigger turns a
// test red (the SW-a / SW-b rule). `namedSwcRefusal(e)` turns a `[CODE] …` raised by a 0199 trigger into a typed 4xx with a kind
// sentence; anything else passes through unchanged. Each code is also a console sentence (`swc.code.<CODE>`, en / hi / gu).
import { DomainError } from '../../../shared/errors/app-error';

export class SwcRefusedError extends DomainError {
  constructor(code: string, message: string, status = 409, details: Record<string, unknown> = {}) { super(code, message, status, details); }
}

/** The 0199 trigger codes (and the few service-only ones) → status + the sentence the API answers with. */
export const SWC_CODES: Readonly<Record<string, { status: number; message: string }>> = Object.freeze({
  // seats (B1)
  STAFF_SEATS_EXHAUSTED: { status: 409, message: 'All the staff seats of your plan are in use — upgrade the plan or remove someone from the team first.' },
  // recusal (A3)
  KYC_RECUSED_DECLARED: { status: 409, message: 'Recused — you declared a conflict with this member, so someone else decides their documents.' },
  KYC_RECUSED_ONBOARDER: { status: 409, message: 'No self-review — you onboarded this member, so someone else decides their documents.' },
  MAKER_IS_CHECKER: { status: 409, message: 'The person who submitted a document never decides (or claims) it.' },
  OWN_DOCUMENT: { status: 409, message: 'Nobody decides (or claims) their own document.' },
  // claims (A2)
  KYC_CLAIM_NOT_YOURS: { status: 403, message: 'A claim is taken, skipped or released by the person who holds it, in their own session.' },
  KYC_CLAIM_NOT_PENDING: { status: 409, message: 'Only a pending member document is claimed.' },
  KYC_CLAIM_FINAL: { status: 409, message: 'This claim was already released.' },
  KYC_CLAIM_NOT_STALE: { status: 409, message: 'A claim expires only after its 15 minutes.' },
  KYC_CLAIM_BORN_LIVE: { status: 409, message: 'A claim is born live.' },
  KYC_NOT_FOUND: { status: 404, message: 'This document was not found.' },
  CLAIM_NOT_FOUND: { status: 404, message: 'You hold no live claim with this id.' },
  SKIP_REASON_REQUIRED: { status: 422, message: 'Skipping a document needs a reason (and words when the reason is "other").' },
  // conflicts (A3)
  CONFLICT_FINAL: { status: 409, message: 'A declaration is only ever lifted, once, with a reason.' },
  CONFLICT_BORN_ACTIVE: { status: 409, message: 'A declaration is born active.' },
  CONFLICT_NOT_YOURS: { status: 403, message: 'A declaration (or its lift) is recorded in your own session.' },
  CONFLICT_RECORDER_NOT_ADMIN: { status: 403, message: 'Only a tenant administrator records a conflict for someone else.' },
  CONFLICT_MEMBER_NOT_IN_TENANT: { status: 422, message: 'That person holds no role in this organisation.' },
  CONFLICT_STAFF_NOT_STAFF: { status: 422, message: 'A conflict is declared by (or for) someone holding a staff role here.' },
  CONFLICT_SELF_LIFT: { status: 409, message: 'A recusal is never lifted by the recused person — a tenant administrator lifts it.' },
  CONFLICT_LIFTER_NOT_ADMIN: { status: 403, message: 'Only a tenant administrator lifts a conflict declaration.' },
  CONFLICT_ALREADY_DECLARED: { status: 409, message: 'An active declaration already exists for this person.' },
  CONFLICT_INVALID: { status: 422, message: 'The declaration cannot be recorded as entered.' },
  CONFLICT_NOT_FOUND: { status: 404, message: 'This declaration was not found.' },
  // invites (B2)
  INVITE_FINAL: { status: 409, message: 'What an invite says is fixed.' },
  INVITE_BORN_PENDING: { status: 409, message: 'An invite is born pending.' },
  INVITE_ROLE_NOT_STAFF: { status: 422, message: 'An invite carries a staff role of this organisation.' },
  INVITE_NOT_ADMIN: { status: 403, message: 'Only a tenant administrator invites staff or revokes an invite.' },
  INVITE_ALREADY_USED: { status: 409, message: 'This invite was already used (or revoked) — an invite works once.' },
  INVITE_EXPIRED: { status: 410, message: 'This invite has expired — ask your organisation for a new one.' },
  INVITE_NOT_YOURS: { status: 403, message: 'An invite is accepted by the invited person.' },
  INVITE_NOT_STALE: { status: 409, message: 'An invite expires only after its 7 days.' },
  INVITE_NOT_FOUND: { status: 404, message: 'This invite was not found (or the code is wrong).' },
  INVITE_PENDING_EXISTS: { status: 409, message: 'This phone already has a pending invite here — revoke it first.' },
  INVITE_PHONE_INVALID: { status: 422, message: 'The phone number is not a valid mobile number.' },
  INVITE_ALREADY_STAFF: { status: 409, message: 'This person already holds that role here.' },
  INVITE_OTP_INVALID: { status: 401, message: 'The one-time code for the invited phone is wrong or has expired.' },
  INVITE_DESK_INVALID: { status: 422, message: 'A chosen desk is not an active desk of this organisation.' },
  WHATSAPP_NOT_CONNECTED: { status: 422, message: 'No WhatsApp provider is connected on this platform — invites go by SMS.' },
  // 2FA (B3)
  TOTP_FINAL: { status: 409, message: 'This 2FA step is final.' },
  TOTP_BORN_UNCONFIRMED: { status: 409, message: 'A 2FA enrolment starts unconfirmed.' },
  TOTP_ALREADY_CONFIRMED: { status: 409, message: 'Two-factor sign-in is already on — turn it off (with a code) before enrolling again.' },
  TOTP_REPLAY: { status: 401, message: 'This code was already used — wait for the next code from your app.' },
  TOTP_INVALID: { status: 401, message: 'That code does not match — check the time on your phone and try the current code.' },
  TOTP_NOT_ENROLLED: { status: 409, message: 'Two-factor sign-in is not set up on this account.' },
  TOTP_NOT_CONFIRMED: { status: 409, message: 'Confirm the enrolment with a code from your app first.' },
  RECOVERY_CODE_USED: { status: 401, message: 'That recovery code was already used.' },
  RECOVERY_CODE_INVALID: { status: 401, message: 'That recovery code does not match.' },
  RECOVERY_CODE_FINAL: { status: 409, message: 'Recovery codes are retired, never deleted.' },
  RECOVERY_CODE_BORN_LIVE: { status: 409, message: 'A recovery code starts unused.' },
  TWO_FACTOR_CHALLENGE_INVALID: { status: 401, message: 'The sign-in step expired — sign in again with your phone.' },
  // overrides (C1)
  OVERRIDE_NEEDS_CHECKER: { status: 409, message: 'Granting this money or personal-data permission needs a second tenant administrator to confirm it.' },
  OVERRIDE_CHECKER_IS_MAKER: { status: 409, message: 'The person who proposed this permission cannot confirm it — a second tenant administrator must.' },
  OVERRIDE_CHECKER_IS_GRANTEE: { status: 409, message: 'Nobody confirms a permission for themselves.' },
  OVERRIDE_NOT_ADMIN: { status: 403, message: 'Only a tenant administrator proposes, confirms or refuses a privileged permission.' },
  OVERRIDE_PROPOSAL_FINAL: { status: 409, message: 'This proposal was already decided.' },
  OVERRIDE_PROPOSAL_BORN: { status: 409, message: 'A proposal is born proposed.' },
  OVERRIDE_PROPOSAL_EXPIRED: { status: 409, message: 'This proposal expired unconfirmed after 7 days — propose again.' },
  OVERRIDE_PROPOSAL_NOT_STALE: { status: 409, message: 'A proposal expires only after 7 days.' },
  OVERRIDE_PROPOSAL_NOT_FOUND: { status: 404, message: 'This proposal was not found.' },
  OVERRIDE_PROPOSAL_LIVE: { status: 409, message: 'This permission already has a proposal waiting for a second administrator.' },
  OVERRIDE_FINAL: { status: 409, message: 'An override is revoked with a reason, never deleted.' },
  OVERRIDE_NOT_FOUND: { status: 404, message: 'This override was not found (or is already revoked).' },
  NEEDS_SECOND_ADMIN: { status: 409, message: 'This needs a second tenant administrator to confirm it — your organisation has one.' },
  ROLE_NOT_FOUND: { status: 404, message: 'This role assignment was not found.' },
  // removal (C2)
  LAST_ADMIN: { status: 409, message: 'This is the last tenant administrator — appoint another before removing them.' },
  REMOVE_SELF: { status: 409, message: 'You cannot remove yourself from the team — another tenant administrator must.' },
  TEAM_RESTRICTED: { status: 403, message: 'Team restricted — only a tenant administrator manages staff.' },
  STAFF_NOT_FOUND: { status: 404, message: 'This person holds no staff role here.' },
  REASON_REQUIRED: { status: 422, message: 'A reason of 10–500 characters is required.' },
  // posture (B3 / C2)
  TWO_FACTOR_REQUIRED: { status: 403, message: 'Your organisation requires two-factor sign-in for staff. Set it up at /me/security (authenticator app), then continue.' },
  SESSION_REVOKED: { status: 401, message: 'This session has ended — your access to this organisation was changed. Sign in again.' },
});

export function swcRefused(code: string, details: Record<string, unknown> = {}): SwcRefusedError {
  const c = SWC_CODES[code] ?? { status: 409, message: code };
  return new SwcRefusedError(code, c.message, c.status, details);
}

/** `[CODE] …` from a 0199 trigger → the named refusal; a unique-index race is named too; anything else unchanged. */
export function namedSwcRefusal(e: unknown): unknown {
  const msg = String((e as Error)?.message ?? '');
  const m = /\[([A-Z_]+)\]/.exec(msg);
  if (m && SWC_CODES[m[1]]) return swcRefused(m[1]);
  if ((e as { code?: string })?.code === '23505') {
    if (/uq_si_one_pending/.test(msg)) return swcRefused('INVITE_PENDING_EXISTS');
    if (/uq_scd_live/.test(msg)) return swcRefused('CONFLICT_ALREADY_DECLARED');
    if (/uq_sop_live/.test(msg)) return swcRefused('OVERRIDE_PROPOSAL_LIVE');
  }
  return e;
}
