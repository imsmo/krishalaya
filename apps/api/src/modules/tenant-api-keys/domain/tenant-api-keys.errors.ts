// modules/tenant-api-keys/domain/tenant-api-keys.errors.ts · PC-56 TENANT-13c · typed failures for the tenant key realm.
//
// TWO FAMILIES, DELIBERATELY DIFFERENT.
//   • Credential failures on the KEY path: a missing, malformed, unknown or wrong-secret key all answer the SAME opaque 401
//     `API_KEY_INVALID` — telling a prefix-prober that a key exists hands them an oracle (the partner realm's rule). Only a caller who
//     presented the RIGHT secret learns more, and then plainly: `KEY_REVOKED` (with the re-issue path), `KEY_EXPIRED`,
//     `KEY_PENDING_CHECKER`, `KEY_OWNER_LOST_ACCESS` — "fail closed, explain kindly" (canon W190).
//   • Console failures (the human managing keys): named refusals the chain prints field by field.
import { AppError, ForbiddenError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../../../shared/errors/app-error';

export const REISSUE_HINT = 'Ask an administrator of your organisation to create a replacement key in Settings › Developers › API keys and update your integration.';

export class ApiKeyInvalidError extends UnauthorizedError {
  constructor() { super('Invalid API key'); (this as { code: string }).code = 'API_KEY_INVALID'; }
}
export class ApiKeyRevokedError extends AppError {
  constructor(prefix?: string) {
    super('KEY_REVOKED', 'This API key has been revoked and no longer works.', 401, { error: 'key_revoked', keyPrefix: prefix ?? null, reissue: REISSUE_HINT });
  }
}
export class ApiKeyExpiredError extends AppError {
  constructor(prefix?: string) { super('KEY_EXPIRED', 'This API key has expired.', 401, { error: 'key_expired', keyPrefix: prefix ?? null, reissue: REISSUE_HINT }); }
}
export class ApiKeyPendingCheckerError extends AppError {
  constructor(prefix?: string) {
    super('KEY_PENDING_CHECKER', 'This API key carries a member-data scope and works only after a second administrator confirms it.', 401,
      { error: 'key_pending_checker', keyPrefix: prefix ?? null });
  }
}
export class ApiKeyOwnerLostAccessError extends AppError {
  constructor(prefix?: string) {
    super('KEY_OWNER_LOST_ACCESS', 'The administrator who created this key no longer manages API access, so the key no longer works.', 401,
      { error: 'key_owner_lost_access', keyPrefix: prefix ?? null, reissue: REISSUE_HINT });
  }
}
/** A key presented on a route that does not accept key auth (not in the scope catalogue). */
export class ApiKeyRouteNotAcceptedError extends ForbiddenError {
  constructor() { super('This route does not accept API keys.', { error: 'key_not_accepted_here' }); (this as { code: string }).code = 'API_KEY_ROUTE_NOT_ACCEPTED'; }
}
export class ApiKeyScopeMissingError extends ForbiddenError {
  constructor(required: string) { super(`This API key lacks the scope '${required}'.`, { requiredScope: required }); (this as { code: string }).code = 'API_KEY_SCOPE_MISSING'; }
}
export class ApiKeyQuotaError extends TooManyRequestsError {
  constructor(limitPerHour: number, retryAfterSec: number) {
    super('Hourly quota exceeded for this API key.', { limitPerHour, windowSec: 3600, retryAfterSec });
    (this as { code: string }).code = 'API_KEY_QUOTA_EXCEEDED';
  }
}
export class ApiKeyIdempotencyRequiredError extends AppError {
  constructor() { super('IDEMPOTENCY_KEY_REQUIRED', 'A write made with an API key needs an Idempotency-Key header (8–64 of [A-Za-z0-9_-]).', 400); }
}
export class ApiKeysDisabledError extends NotFoundError {
  constructor() { super('Not found'); }
}
export class PlanFeatureRequiredError extends AppError {
  constructor(feature = 'api_access') {
    super('PLAN_FEATURE_REQUIRED', 'API access is not part of your plan.', 403, { feature });
  }
}

// ---- console ----
export class ApiKeysForbiddenError extends AppError {
  constructor() { super('API_KEYS_FORBIDDEN', 'Managing API keys needs api.manage (tenant_admin).', 403, { required: 'api.manage' }); }
}
export class ApiKeyRefusedError extends AppError {
  constructor(refusals: { field: string | null; code: string; detail?: string }[]) { super('API_KEY_REFUSED', 'The key request was refused.', 422, { refusals }); }
}
export class ApiKeyNotFoundError extends NotFoundError {
  constructor() { super('API key not found'); (this as { code: string }).code = 'API_KEY_NOT_FOUND'; }
}
export class ApiKeyProposalNotFoundError extends NotFoundError {
  constructor() { super('Key proposal not found'); (this as { code: string }).code = 'API_KEY_PROPOSAL_NOT_FOUND'; }
}
/** A trigger refusal surfaced by name (`[API_KEY_CHECKER_IS_MAKER]` → CHECKER_IS_MAKER …). */
export class ApiKeyActRefusedError extends AppError {
  constructor(code: string, message: string, status = 409) { super(code, message, status); }
}
