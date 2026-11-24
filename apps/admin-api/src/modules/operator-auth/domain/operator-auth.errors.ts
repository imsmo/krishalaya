// apps/admin-api/src/modules/operator-auth/domain/operator-auth.errors.ts · PC-56 ADMIN-AUTH-1.
//
// NO ORACLE. The sign-in endpoints answer with as few distinct outcomes as the operator needs to act on: "start again at
// the IdP" (the ticket is gone), "that key was not accepted" (try again / another key), "that enrollment code was not
// accepted", and a generic refusal. WHY a step failed (unbound email, suspended operator, wrong domain, nonce mismatch,
// counter regression, which enrollment rule) goes to the audit log, never to the response — a response that said "this
// email is not an operator" would be a free directory of who is.
import { HttpException, HttpStatus } from '@nestjs/common';

export type AuthErrorCode =
  | 'AUTH_TICKET_INVALID'       // start again at /login
  | 'AUTH_KEY_REJECTED'         // the WebAuthn response did not verify for this operator
  | 'AUTH_ENROLLMENT_REFUSED'   // the enrollment code was not accepted
  | 'AUTH_REFUSED'              // anything else (generic)
  | 'AUTH_RATE_LIMITED'
  | 'AUTH_KEY_REVOKE_REFUSED'
  | 'AUTH_CODE_ISSUE_REFUSED';

const STATUS: Record<AuthErrorCode, number> = {
  AUTH_TICKET_INVALID: HttpStatus.UNAUTHORIZED,
  AUTH_KEY_REJECTED: HttpStatus.UNAUTHORIZED,
  AUTH_ENROLLMENT_REFUSED: HttpStatus.FORBIDDEN,
  AUTH_REFUSED: HttpStatus.FORBIDDEN,
  AUTH_RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  AUTH_KEY_REVOKE_REFUSED: HttpStatus.CONFLICT,
  AUTH_CODE_ISSUE_REFUSED: HttpStatus.CONFLICT,
};

const MESSAGE: Record<AuthErrorCode, string> = {
  AUTH_TICKET_INVALID: 'this sign-in has expired or was already used; start again',
  AUTH_KEY_REJECTED: 'the security key response was not accepted',
  AUTH_ENROLLMENT_REFUSED: 'the enrollment code was not accepted',
  AUTH_REFUSED: 'sign-in refused',
  AUTH_RATE_LIMITED: 'too many attempts; wait a minute and try again',
  AUTH_KEY_REVOKE_REFUSED: 'this key cannot be revoked',
  AUTH_CODE_ISSUE_REFUSED: 'an enrollment code cannot be issued for this email',
};

export class OperatorAuthError extends HttpException {
  /** `auditReason` is for the audit row only; it is NOT part of the response body. */
  constructor(public readonly code: AuthErrorCode, public readonly auditReason: string = code, detail?: string) {
    super({ code, message: detail ?? MESSAGE[code] }, STATUS[code]);
  }
}
