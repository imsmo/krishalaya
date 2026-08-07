// apps/admin-api/src/modules/ledger-ops/domain/ledger-ops.errors.ts · PC-56 ADMIN-6.
import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidLedgerQueryError extends HttpException {
  constructor(message: string) { super({ code: 'INVALID_LEDGER_QUERY', message }, HttpStatus.BAD_REQUEST); }
}
export class LedgerSubjectNotFoundError extends HttpException {
  constructor(message: string) { super({ code: 'LEDGER_SUBJECT_NOT_FOUND', message }, HttpStatus.NOT_FOUND); }
}
/** 507 would be dramatic and 400 would be wrong: the request is fine and the platform's own data is too large to
 *  answer it live. W064's error state says so — "Historic months need the signed-export path rather than live scan" —
 *  and 413 is the closest honest code for "your window asks for more than a live query may return". */
export class LedgerWindowTooWideError extends HttpException {
  constructor(message: string) { super({ code: 'LEDGER_WINDOW_TOO_WIDE', message }, HttpStatus.PAYLOAD_TOO_LARGE); }
}
