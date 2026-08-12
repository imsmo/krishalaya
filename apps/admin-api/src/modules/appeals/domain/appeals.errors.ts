// apps/admin-api/src/modules/appeals/domain/appeals.errors.ts · PC-56 ADMIN-SWEEP-b1.
import { HttpException, HttpStatus } from '@nestjs/common';
import { AppealRuleError } from './appeal';

export class AppealNotFoundError extends HttpException {
  constructor(message: string) { super({ code: 'APPEAL_NOT_FOUND', message }, HttpStatus.NOT_FOUND); }
}
/** 409, not 403: the operator holds `moderation.appeals` and the request is well-formed. What is wrong is WHICH
 *  appeal (already decided, not theirs, their own original call) — the next move is a different appeal, not an
 *  access request. The rule's own sentence rides through untouched. */
export class AppealNotDecidableError extends HttpException {
  constructor(e: AppealRuleError) { super({ code: e.code, message: e.message }, HttpStatus.CONFLICT); }
}
export class InvalidAppealDecisionError extends HttpException {
  constructor(e: AppealRuleError) { super({ code: e.code, message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY); }
}
/** The subject_ref could not be resolved to a restorable object. This is a filing-integrity failure and the overturn
 *  REFUSES rather than deciding an appeal whose restore step would be a no-op that reads as done. */
export class AppealSubjectUnresolvableError extends HttpException {
  constructor(message: string) { super({ code: 'APPEAL_SUBJECT_UNRESOLVABLE', message }, HttpStatus.CONFLICT); }
}
