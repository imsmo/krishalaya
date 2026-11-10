// modules/gov-console/domain/gov-console.errors.ts · PC-56 GOV-0 — every refusal of the government realm BY NAME (the partner-console shape).
// Each message states a fact only (the wording rule). The 0239 triggers raise `[CODE] …`; `namedGovRefusal(e)` turns those (and the one
// unique-index race) into the typed 4xx below. Anything else passes through unchanged. The API's refusal messages are English here, as every
// other realm's; the console translates by CODE (GOV-1a's registry).
import { DomainError } from '../../../shared/errors/app-error';

export class GovRefusedError extends DomainError {
  constructor(code: string, message: string, status: number, details: Record<string, unknown> = {}) { super(code, message, status, details); }
}

export const GOV_CODES: Readonly<Record<string, { status: number; message: string }>> = Object.freeze({
  // the session
  GOV_SESSION_REQUIRED: { status: 401, message: 'A government console session is required.' },
  GOV_SESSION_ENDED: { status: 401, message: 'This government console session has ended.' },
  GOV_ROUTE_UNDECLARED: { status: 401, message: 'This route declares no permission and is refused.' },
  GOV_PERMISSION_MISSING: { status: 403, message: 'Your role in this authority does not include this.' },
  // sign-in (Q5-A: phone code, then the authenticator code; nothing else)
  GOV_ACCESS_NONE: { status: 403, message: 'This phone holds no active role in a government authority on this platform.' },
  GOV_CHOICE_REQUIRED: { status: 403, message: 'This phone holds a role in more than one authority. Choose one.' },
  GOV_CHOICE_INVALID: { status: 401, message: 'The choice step is no longer valid. Sign in again with your phone.' },
  GOV_TWO_FACTOR_REQUIRED: { status: 403, message: 'A government account needs a confirmed authenticator app before any session is opened.' },
  GOV_ENROL_TOKEN_INVALID: { status: 401, message: 'The authenticator set-up step is no longer valid. Sign in again with your phone.' },
  GOV_IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'An Idempotency-Key header is required.' },
  // memberships (Q4-A)
  GOV_ROLE_REQUIRED: { status: 422, message: 'The role must be one of the authority roles.' },
  GOV_TERM_INVALID: { status: 422, message: 'The term is a whole number of months from 1 to 12.' },
  GOV_REASON_REQUIRED: { status: 422, message: 'A reason of 10 to 500 characters is required.' },
  GOV_PHONE_INVALID: { status: 422, message: 'The phone number is not a valid mobile number.' },
  GOV_PERSON_UNKNOWN: { status: 404, message: 'No platform account holds this phone number.' },
  GOV_ALREADY_REQUESTED: { status: 409, message: 'This person already holds or has a pending request for this role in this authority.' },
  GOV_MEMBERSHIP_NOT_FOUND: { status: 404, message: 'This membership was not found.' },
  GOV_REQUEST_NOT_PENDING: { status: 409, message: 'This request is not pending.' },
  GOV_APPROVER_IS_REQUESTER: { status: 403, message: 'The person who asked for a role cannot approve it. A second person approves.' },
  GOV_APPROVER_IS_GRANTEE: { status: 403, message: 'A person cannot approve a role for themselves. A second person approves.' },
  GOV_APPROVER_NOT_HEAD: { status: 403, message: 'Only a current head of this authority approves a role.' },
  GOV_REQUESTER_NOT_MEMBER: { status: 403, message: 'Only a current member of this authority requests a role.' },
  GOV_REMOVE_SELF: { status: 409, message: 'A person cannot remove their own role. Another head removes it.' },
  GOV_REMOVER_NOT_HEAD: { status: 403, message: 'Only a current head of this authority removes a role.' },
  GOV_REQUEST_BORN_PENDING: { status: 409, message: 'A role request is created pending.' },
  GOV_AUTHORITY_HAS_HEAD: { status: 409, message: 'This authority already has a current head.' },
  GOV_PLATFORM_APPOINTS_FIRST_HEAD_ONLY: { status: 409, message: 'The platform appoints an authority\'s first head and nothing else.' },
  GOV_MEMBERSHIP_FINAL: { status: 409, message: 'A membership is removed with a reason and is never deleted or edited.' },
  GOV_ROLE_NOT_TENANT: { status: 422, message: 'An authority role is held inside an authority, never inside an organisation.' },
  // applications (Q3-A)
  GOV_APPLICATION_NOT_FOUND: { status: 404, message: 'This application was not found.' },
});

export function govRefused(code: string, details: Record<string, unknown> = {}): GovRefusedError {
  const c = GOV_CODES[code] ?? { status: 409, message: code };
  return new GovRefusedError(code, c.message, c.status, details);
}

/** `[CODE] …` from a 0239 trigger → the named refusal; the live-row unique index → GOV_ALREADY_REQUESTED; anything else unchanged. */
export function namedGovRefusal(e: unknown): unknown {
  if (e instanceof GovRefusedError) return e;
  const msg = String((e as Error)?.message ?? '');
  const m = /\[([A-Z_]+)\]/.exec(msg);
  if (m && GOV_CODES[m[1]]) return govRefused(m[1]);
  if ((e as { code?: string })?.code === '23505' && /uq_am_live/.test(msg)) return govRefused('GOV_ALREADY_REQUESTED');
  return e;
}
