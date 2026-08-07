// apps/admin-api/src/modules/platform-reports/domain/platform-reports.errors.ts · typed errors → HTTP via
// HttpException subclasses with stable codes (mirrors the other ops modules).
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}
/** A report window must be a valid, forward, bounded range (caps the scan — abuse/DoS guard §4/§5). */
export class InvalidWindowError extends DomainHttpError {
  constructor(detail: string) { super('REPORT_WINDOW_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

/* ---------------- PC-56 ADMIN-10 ---------------- */

/** A builder input the whitelist does not contain, or a range past the builder's own cap. 422 — the request is
 *  well-formed and asks for something this plane will not compute. */
export class InvalidReportInputError extends DomainHttpError {
  constructor(detail: string) { super('REPORT_INPUT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

export class SavedReportNotFoundError extends DomainHttpError {
  constructor(slug: string) { super('SAVED_REPORT_NOT_FOUND', `no live saved report '${slug}'`, HttpStatus.NOT_FOUND, { slug }); }
}

export class DuplicateSavedReportError extends DomainHttpError {
  constructor(slug: string) {
    super('SAVED_REPORT_EXISTS', `a live saved report already uses the slug '${slug}'; archive it or pick another — a schedule points at a slug, and two definitions sharing one would make "which report did Monday's email contain" unanswerable`, HttpStatus.CONFLICT, { slug });
  }
}

export class ExportReceiptNotFoundError extends DomainHttpError {
  constructor(id: string) { super('EXPORT_RECEIPT_NOT_FOUND', `no export receipt '${id}'`, HttpStatus.NOT_FOUND, { id }); }
}

/** The stored artefact no longer matches the digest on its receipt. **A 409 rather than a 500**: the request is fine and
 *  the platform is refusing to serve bytes it cannot vouch for, which is a different fact for whoever reads the log. */
export class ExportDigestMismatchError extends DomainHttpError {
  constructor(id: string, expected: string, actual: string) {
    super('EXPORT_DIGEST_MISMATCH',
      'this file no longer matches the digest recorded when it was generated, so it will not be served. The mismatch has been recorded.',
      HttpStatus.CONFLICT, { id, expected, actual });
  }
}
