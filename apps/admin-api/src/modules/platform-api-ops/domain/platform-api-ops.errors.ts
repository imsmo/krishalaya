// modules/platform-api-ops/domain/platform-api-ops.errors.ts · PC-56 ADMIN-11c.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

export class ApiKeyNotFoundError extends DomainHttpError {
  constructor(id: string) { super('API_KEY_NOT_FOUND', `no API key '${id}'`, HttpStatus.NOT_FOUND, { id }); }
}
/** Revoking a key that is already revoked. **409 AND NOT A SILENT SUCCESS**: a second revocation would overwrite the
 *  first one's reason and timestamp, which is the record of why an integration stopped working. */
export class ApiKeyAlreadyRevokedError extends DomainHttpError {
  constructor(id: string, at: string) {
    super('API_KEY_ALREADY_REVOKED', `that key was revoked at ${at}; revoking again would overwrite the reason the first revocation recorded`, HttpStatus.CONFLICT, { id, at });
  }
}
export class UnknownRegistryError extends DomainHttpError {
  constructor(registry: string) {
    super('UNKNOWN_KEY_REGISTRY', `'${registry}' is not a key registry on this platform (tenant | partner)`, HttpStatus.UNPROCESSABLE_ENTITY, { registry });
  }
}
