// apps/admin-api/src/modules/consent-ops/domain/consent-ops.errors.ts · typed errors → HTTP with stable codes.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

export class ConsentPurposeNotFoundError extends DomainHttpError {
  constructor(code: string) { super('CONSENT_PURPOSE_NOT_FOUND', `consent purpose '${code}' not found`, HttpStatus.NOT_FOUND, { code }); }
}
export class ConsentVersionNotFoundError extends DomainHttpError {
  constructor(id: string) { super('CONSENT_VERSION_NOT_FOUND', `consent purpose version '${id}' not found`, HttpStatus.NOT_FOUND, { id }); }
}
export class InvalidConsentInputError extends DomainHttpError {
  constructor(detail: string) { super('CONSENT_INPUT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
export class ConsentVersionNotDraftError extends DomainHttpError {
  constructor(id: string, status: string) {
    super('CONSENT_VERSION_NOT_DRAFT',
      `consent purpose version '${id}' is ${status} — its words are what people agreed to and can never change. Draft a new version instead.`,
      HttpStatus.CONFLICT, { id, status });
  }
}
export class ConsentDraftExistsError extends DomainHttpError {
  constructor(purposeCode: string, versionId: string, version: string) {
    super('CONSENT_DRAFT_OPEN',
      `'${purposeCode}' already has an open draft (${version}) — edit or discard it. Two rival notices for one purpose means whichever publishes second silently discards the other author's legal text.`,
      HttpStatus.CONFLICT, { purposeCode, versionId, version });
  }
}
/** Publishing without the languages it needs. NAMES THE MISSING LANGUAGES, because the operator's next action is to
 *  write those notices and a bare "incomplete" does not say which. */
export class NoticeLanguageMissingError extends DomainHttpError {
  constructor(purposeCode: string, missing: string[], mandatory: boolean) {
    super('CONSENT_NOTICE_LANGUAGE_MISSING',
      mandatory
        ? `'${purposeCode}' is MANDATORY — a farmer cannot create an account without agreeing to it, so it may not publish `
          + `without a notice in every active language. Missing: ${missing.join(', ') || 'all of them'}. Asking somebody to `
          + 'agree to something they cannot read, as a condition of entry, is consent obtained without a notice.'
        : `'${purposeCode}' has no notice in: ${missing.join(', ')}.`,
      HttpStatus.CONFLICT, { purposeCode, missing, mandatory });
  }
}
/** A purpose whose current published version has NO recorded notice. Every backfilled purpose is in this state, and it
 *  is the strongest argument for authoring real ones — so it is an error with a name rather than a blank cell. */
export class NoticeNeverRecordedError extends DomainHttpError {
  constructor(purposeCode: string, version: string) {
    super('CONSENT_NOTICE_NEVER_RECORDED',
      `'${purposeCode}' ${version} has no recorded notice text. The platform had no column to store one before migration `
      + '0108, so the words the existing consents were given against were never recorded anywhere. Draft a new version '
      + 'with real notices — this one cannot be reconstructed.',
      HttpStatus.CONFLICT, { purposeCode, version });
  }
}
