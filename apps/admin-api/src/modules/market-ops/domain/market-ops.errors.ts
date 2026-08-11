// modules/market-ops/domain/market-ops.errors.ts · PC-56 ADMIN-SWEEP.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

export class PriceObservationNotFoundError extends DomainHttpError {
  constructor(id: string) {
    super('PRICE_OBSERVATION_NOT_FOUND', `no price observation '${id}' on that date — the date is part of its identity (partitioned table)`, HttpStatus.NOT_FOUND, { id });
  }
}
/** **409, NOT A SILENT SUCCESS.** Re-deciding would overwrite the note the ambassador was shown, which is the feedback
 *  this platform gives a field worker instead of a reprimand. */
export class PriceAlreadyDecidedError extends DomainHttpError {
  constructor(id: string, state: string) {
    super('PRICE_ALREADY_DECIDED', `that observation is already ${state}; deciding again would overwrite the note the reporter was shown`, HttpStatus.CONFLICT, { id, state });
  }
}
