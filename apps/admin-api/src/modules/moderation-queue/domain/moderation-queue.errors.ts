// apps/admin-api/src/modules/moderation-queue/domain/moderation-queue.errors.ts · PC-56 ADMIN-5f.
import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidModerationOrderError extends HttpException {
  constructor(message: string) { super({ code: 'INVALID_MODERATION_ORDER', message }, HttpStatus.BAD_REQUEST); }
}
export class InvalidReportDecisionError extends HttpException {
  constructor(message: string) { super({ code: 'INVALID_REPORT_DECISION', message }, HttpStatus.BAD_REQUEST); }
}
/** 409: the operator holds `moderation.listings` and the request is well-formed. What is missing is a second person,
 *  or a hold that should have come first. Their next move is a colleague or a different button — not an access
 *  request, which is where a 403 would send them. */
export class ModerationNotApprovableError extends HttpException {
  constructor(message: string) { super({ code: 'MODERATION_NOT_APPROVABLE', message }, HttpStatus.CONFLICT); }
}
export class ModerationSubjectNotFoundError extends HttpException {
  constructor(message: string) { super({ code: 'MODERATION_SUBJECT_NOT_FOUND', message }, HttpStatus.NOT_FOUND); }
}
