// apps/admin-api/src/modules/trust-safety/domain/trust-safety.errors.ts · PC-56 ADMIN-5d.
//
// Every one of these is a 400/409 an operator can act on. None is a 403: the operator on these screens HAS the
// permission — what they are missing is a second person, a dry run, an expiry date or a reason. A bare 403 sends
// somebody to request access they already hold, and the commonest outcome of that is a permission being widened to
// solve a problem it was not (the reasoning is written out in core/approval/two-person-rule.ts).
import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidBlocklistEntryError extends HttpException {
  constructor(message: string) { super({ code: 'INVALID_BLOCKLIST_ENTRY', message }, HttpStatus.BAD_REQUEST); }
}
export class InvalidRiskRuleChangeError extends HttpException {
  constructor(message: string) { super({ code: 'INVALID_RISK_RULE_CHANGE', message }, HttpStatus.BAD_REQUEST); }
}
export class DryRunRequiredError extends HttpException {
  /** 409, not 400: the request is well-formed, the platform's STATE is not ready for it. W095's own failure line —
   *  "changes cannot ship without a dry run" — is a state fact, and the operator's next move is to run one. */
  constructor(message: string) { super({ code: 'DRY_RUN_REQUIRED', message }, HttpStatus.CONFLICT); }
}
export class InvalidBandChangeError extends HttpException {
  constructor(message: string) { super({ code: 'INVALID_BAND_CHANGE', message }, HttpStatus.BAD_REQUEST); }
}
export class TrustSubjectNotFoundError extends HttpException {
  constructor(message: string) { super({ code: 'TRUST_SUBJECT_NOT_FOUND', message }, HttpStatus.NOT_FOUND); }
}
