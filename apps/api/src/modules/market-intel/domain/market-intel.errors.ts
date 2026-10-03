// modules/market-intel/domain/market-intel.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';

export class MandiNotFoundError extends DomainError { constructor(id: string) { super('MANDI_NOT_FOUND', `Mandi ${id} not found`, 404, { id }); } }
export class PriceAlertNotFoundError extends DomainError { constructor(id: string) { super('PRICE_ALERT_NOT_FOUND', `Price alert ${id} not found`, 404, { id }); } }
export class InvalidPriceError extends DomainError { constructor(detail: string) { super('PRICE_INVALID', detail, 422, { detail }); } }
export class InvalidAlertError extends DomainError { constructor(detail: string) { super('ALERT_INVALID', detail, 422, { detail }); } }
export class NoPriceDataError extends DomainError { constructor(detail = 'not enough price data to predict') { super('NO_PRICE_DATA', detail, 422, { detail }); } }
export class MarketForbiddenError extends DomainError { constructor(detail = 'forbidden') { super('MARKET_FORBIDDEN', detail, 403, {}); } }
/** PC-56 TENANT-12 (F-4 / F-1): a fair-price band typed through the tenant API would be a global, AI-shaped figure no registered
 *  model produced. Refused by name (409) — bands come from a governed producer or not at all. */
export class PredictionRefusedError extends DomainError {
  constructor() { super('MARKET_PREDICTION_REFUSED', 'a price band cannot be generated from the tenant API — no registered model produces it (PC-56 TENANT-12)', 409, { gate: 'ai_models', reason: 'no_registered_model' }); }
}
