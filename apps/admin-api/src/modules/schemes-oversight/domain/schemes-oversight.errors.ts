// apps/admin-api/src/modules/schemes-oversight/domain/schemes-oversight.errors.ts · typed errors → HTTP, with stable
// codes (mirrors the other ops modules).
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

export class ApplicationNotFoundError extends DomainHttpError {
  constructor(id: string) { super('SCHEME_APPLICATION_NOT_FOUND', `scheme application '${id}' not found`, HttpStatus.NOT_FOUND, { id }); }
}
export class InvalidOversightQueryError extends DomainHttpError {
  constructor(detail: string) { super('OVERSIGHT_QUERY_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
// `UnmaskReasonRequiredError` moved to core/pii/mask.ts with the mask itself (ADMIN-5b) — the reason floor is a property
// of disclosure, not of the scheme register. Re-exported from domain/pii-mask.ts for existing importers.
export class OversightExportUnknownError extends DomainHttpError {
  constructor(report: string, allowed: readonly string[]) {
    super('OVERSIGHT_EXPORT_UNKNOWN', `'${report}' is not an oversight export (${allowed.join('|')})`, HttpStatus.UNPROCESSABLE_ENTITY, { report, allowed });
  }
}
