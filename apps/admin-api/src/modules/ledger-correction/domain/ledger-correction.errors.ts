// apps/admin-api/src/modules/ledger-correction/domain/ledger-correction.errors.ts · PC-56 ADMIN-5e.
import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidCorrectionError extends HttpException {
  constructor(message: string) { super({ code: 'INVALID_CORRECTION', message }, HttpStatus.BAD_REQUEST); }
}

/** 409 rather than 403 or 400. The request is well-formed and the operator holds `ledger.correct` — what is wrong is
 *  the STATE: nobody else has drafted it, the legs have moved since submission, or the founder has not been told.
 *  The operator's next move is to find a colleague or fix the legs, not to request access they already have. */
export class CorrectionNotApprovableError extends HttpException {
  constructor(message: string) { super({ code: 'CORRECTION_NOT_APPROVABLE', message }, HttpStatus.CONFLICT); }
}

export class CorrectionNotFoundError extends HttpException {
  constructor(message: string) { super({ code: 'CORRECTION_NOT_FOUND', message }, HttpStatus.NOT_FOUND); }
}

/** The wallet-service refused or could not be reached. Deliberately NOT collapsed into a generic 500: the operator
 *  needs to know that no money moved and that retrying is SAFE, because the draft carries the idempotency key and a
 *  replay returns the same transaction rather than posting a second correction. */
export class CorrectionPostFailedError extends HttpException {
  constructor(message: string) {
    super({
      code: 'CORRECTION_POST_FAILED',
      message: `${message} No money moved. Retrying is safe — this correction carries a fixed idempotency key, so a `
        + 'replay returns the same transaction and cannot post twice.',
    }, HttpStatus.BAD_GATEWAY);
  }
}
