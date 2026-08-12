// apps/admin-api/src/modules/safety-desk/domain/safety-desk.errors.ts · PC-56 ADMIN-SWEEP-b3.
import { HttpException, HttpStatus } from '@nestjs/common';
import { SafetyRuleError } from './safety-desk';

export class SafetyCaseNotFoundError extends HttpException {
  constructor() { super({ code: 'SAFETY_CASE_NOT_FOUND', message: 'no such case on the safety desk' }, HttpStatus.NOT_FOUND); }
}
/** 409/422 split as everywhere: wrong CASE state is a conflict; a malformed record is unprocessable. */
export class SafetyCaseConflictError extends HttpException {
  constructor(e: SafetyRuleError) { super({ code: e.code, message: e.message }, HttpStatus.CONFLICT); }
}
export class InvalidSafetyStepError extends HttpException {
  constructor(e: SafetyRuleError) { super({ code: e.code, message: e.message }, HttpStatus.UNPROCESSABLE_ENTITY); }
}
