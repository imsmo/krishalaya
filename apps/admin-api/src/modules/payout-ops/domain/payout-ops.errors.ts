// apps/admin-api/src/modules/payout-ops/domain/payout-ops.errors.ts (PC-56 ADMIN-6b)
import { HttpException, HttpStatus } from '@nestjs/common';

/** A refusal on the money door. 409 rather than 400 for the same reason `SecondPersonRequiredError` is a 409: almost
 *  every refusal here is about the STATE of the batch (already decided, empty, preflight failing) rather than about a
 *  malformed request, and an operator reading 400 goes looking for a typo in their own input. */
export class InvalidPayoutOpsError extends HttpException {
  constructor(message: string) {
    super({ code: 'PAYOUT_OPS_REFUSED', message }, HttpStatus.CONFLICT);
  }
}

/** A malformed query — a bad cursor, an unparseable date, a window beyond the allowed span. Genuinely 400. */
export class InvalidPayoutQueryError extends HttpException {
  constructor(message: string) {
    super({ code: 'PAYOUT_QUERY_INVALID', message }, HttpStatus.BAD_REQUEST);
  }
}
