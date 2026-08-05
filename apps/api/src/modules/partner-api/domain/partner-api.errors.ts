// modules/partner-api/domain/partner-api.errors.ts · PC-55 A10. Typed failures for the partner realm.
// DELIBERATE UNIFORMITY: a missing, malformed, unknown, inactive or revoked key all surface the SAME
// 401 'Invalid partner API key' with NO detail about which. Distinguishing them would tell an attacker
// probing prefixes whether a key EXISTS (an oracle worth having); the honest detail goes to our logs and
// metrics, not to the caller. A wrong SCOPE is different — that caller is authenticated, and telling a real
// partner which scope their key lacks is help, not leakage.
import { ForbiddenError, TooManyRequestsError, UnauthorizedError } from '../../../shared/errors/app-error';

export class PartnerKeyRejectedError extends UnauthorizedError {
  constructor() { super('Invalid partner API key'); }
}
export class PartnerScopeMissingError extends ForbiddenError {
  constructor(required: string) { super(`Partner API key lacks the required scope '${required}'`, { requiredScope: required }); }
}
export class PartnerRateLimitError extends TooManyRequestsError {
  constructor(limitPerHour: number) {
    super('Partner API hourly quota exceeded for this key', { limitPerHour, windowSec: 3600 });
  }
}
