// apps/admin-api/src/modules/compliance-ops/domain/compliance-ops.errors.ts · typed errors → HTTP via
// HttpException subclasses with stable codes (mirrors recon-monitor / tenant-ops).
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}
export class DsrNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('DSR_NOT_FOUND', `data-subject request ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class ErasureCoolingActiveError extends DomainHttpError {
  constructor(coolingEndsAt: string) { super('DSR_ERASURE_COOLING_ACTIVE', `erasure cannot complete until the cooling window ends`, HttpStatus.CONFLICT, { coolingEndsAt }); }
}
export class ExportJobNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('EXPORT_JOB_NOT_FOUND', `data export job ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class ExportAlreadyDecidedError extends DomainHttpError {
  constructor(status: string) { super('EXPORT_ALREADY_DECIDED', `export job already ${status}`, HttpStatus.CONFLICT, { status }); }
}
export class BreachNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('BREACH_NOT_FOUND', `breach ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class InvalidRetentionPolicyError extends DomainHttpError {
  constructor(detail: string) { super('RETENTION_POLICY_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
export class InvalidBreachUpdateError extends DomainHttpError {
  constructor(detail: string) { super('BREACH_UPDATE_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

/* ---------------- the erasure plane (0107 / ADMIN-5) ---------------- */

/** Generic 422 for this plane's inputs (rejection grounds, acknowledge shape). */
export class InvalidDsrInputError extends DomainHttpError {
  constructor(detail: string) { super('DSR_INPUT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

/** THE GUARD THIS WAVE EXISTS FOR. An erasure may not be marked completed while in-scope data classes have no recorded
 *  action — because until 0107 an operator could record a discharged statutory obligation that had not been discharged.
 *  The message NAMES THE MISSING CLASSES rather than saying "not allowed": the operator has done nothing wrong, and the
 *  list is the actual work outstanding. */
export class ErasureNotEvidencedError extends DomainHttpError {
  constructor(missing: string[], classesInScope: number) {
    super(
      'ERASURE_NOT_EVIDENCED',
      `this erasure cannot be marked completed: ${missing.length} of ${classesInScope} data classes have no recorded `
      + `action (${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', …' : ''}). Nothing has erased them. `
      + 'Recording a completion now would state that a statutory obligation was discharged when it was not.',
      HttpStatus.CONFLICT,
      { missing, classesInScope },
    );
  }
}

/** No retention policy is configured, so "what will be erased" has no answer to check a completion against. */
export class ErasureScopeUnavailableError extends DomainHttpError {
  constructor() {
    super('ERASURE_SCOPE_UNAVAILABLE',
      'no active data-retention policy is configured, so the erasure scope cannot be computed and a completion cannot '
      + 'be checked against it. Configure retention policies first — an unscoped erasure is an unbounded one.',
      HttpStatus.CONFLICT);
  }
}

/** An acknowledgement was attempted twice. Not an error the operator caused — the SMS may have been sent by the
 *  worker — so it names the existing timestamp instead of scolding. */
export class DsrAlreadyAcknowledgedError extends DomainHttpError {
  constructor(at: string) { super('DSR_ALREADY_ACKNOWLEDGED', `this request was already acknowledged at ${at}`, HttpStatus.CONFLICT, { acknowledgedAt: at }); }
}
