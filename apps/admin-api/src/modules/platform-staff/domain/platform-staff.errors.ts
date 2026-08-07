// apps/admin-api/src/modules/platform-staff/domain/platform-staff.errors.ts · typed errors → HTTP (mirrors the other
// ops modules). This plane governs access to the god-mode realm itself, so every guard fails CLOSED: a refusal here
// costs an operator a retry, and a wrongly-granted request costs the platform its access control.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

/* ---------------- not-found (404) ---------------- */
export class OperatorNotFoundError extends DomainHttpError {
  constructor(id: string) {
    // The 404 wording matters on this plane: an operator absent from this table is not an operator who does not exist —
    // it is one the realm has never seen. The registry is observed, not a directory.
    super('OPERATOR_NOT_FOUND', `the platform realm has no record of operator '${id}' — it has never seen a request from them`, HttpStatus.NOT_FOUND, { id });
  }
}
export class RestrictionNotFoundError extends DomainHttpError {
  constructor(id: string) { super('RESTRICTION_NOT_FOUND', `restriction '${id}' not found`, HttpStatus.NOT_FOUND, { id }); }
}

/* ---------------- validation (422) ---------------- */
export class InvalidStaffInputError extends DomainHttpError {
  constructor(detail: string) { super('STAFF_INPUT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

/* ---------------- conflict (409) ---------------- */
export class OperatorStateError extends DomainHttpError {
  constructor(detail: string) { super('OPERATOR_STATE', detail, HttpStatus.CONFLICT, { detail }); }
}
export class DuplicateRestrictionError extends DomainHttpError {
  constructor(code: string) {
    super('RESTRICTION_EXISTS', `a live restriction on '${code}' already exists for this operator; lift it rather than adding a second`, HttpStatus.CONFLICT, { code });
  }
}

/* ---------------- forbidden (403) ---------------- */
/** The two-person rule, pointed at reinstatement. 403 rather than 409 because the request is well-formed and the
 *  refusal is about WHO is asking — the same status the other thirteen sites return. */
export class SelfActionError extends DomainHttpError {
  constructor(detail: string) { super('SECOND_PERSON_REQUIRED', detail, HttpStatus.FORBIDDEN, { detail }); }
}

/** Raised by the guard, not by a controller: the operator is suspended, dormant past the line, or holding a revoked
 *  session. 403 and not 401 — the credential is valid and the realm is refusing it, which is a different fact for
 *  whoever reads the log, and a 401 would send the console into a re-authentication loop against an IdP that would
 *  happily issue another perfectly good token. */
export class AccessRefusedError extends DomainHttpError {
  constructor(reason: string, detail: string) {
    super('ADMIN_ACCESS_REFUSED', detail, HttpStatus.FORBIDDEN, { reason });
  }
}
