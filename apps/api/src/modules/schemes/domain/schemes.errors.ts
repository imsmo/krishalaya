// modules/schemes/domain/schemes.errors.ts · typed errors with stable codes (mapped to HTTP/i18n).
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class SchemeAuthorityNotFoundError extends NotFoundError { constructor(id: string) { super('Scheme authority not found'); (this as any).code = 'SCHEME_AUTHORITY_NOT_FOUND'; (this as any).details = { id }; } }
export class SchemeNotFoundError extends NotFoundError { constructor(id: string) { super('Scheme not found'); (this as any).code = 'SCHEME_NOT_FOUND'; (this as any).details = { id }; } }
export class ApplicationNotFoundError extends NotFoundError { constructor(id: string) { super('Scheme application not found'); (this as any).code = 'SCHEME_APPLICATION_NOT_FOUND'; (this as any).details = { id }; } }

export class SchemeInactiveError extends DomainError { constructor(code: string) { super('SCHEME_INACTIVE', `Scheme '${code}' is not currently active`, 409, { code }); } }
export class InvalidApplicationError extends DomainError { constructor(message: string) { super('SCHEME_APPLICATION_INVALID', message, 422); } }
export class InvalidDbtError extends DomainError { constructor(message: string) { super('DBT_TRANSFER_INVALID', message, 422); } }
export class SchemesForbiddenError extends AppError { constructor(message = 'Not allowed on this scheme resource') { super('SCHEMES_FORBIDDEN', message, 403); } }
export class DocumentsNotEditableError extends DomainError { constructor(status: string) { super('SCHEME_DOCS_NOT_EDITABLE', `Documents cannot be changed while the application is '${status}'`, 409, { status }); } }
export class DocumentMediaInvalidError extends DomainError { constructor(message = 'Media not found, not yours, or not clean — cannot attach') { super('SCHEME_DOC_MEDIA_INVALID', message, 422); } }
export class DocumentNotFoundError extends NotFoundError { constructor(id: string) { super('Scheme application document not found'); (this as any).code = 'SCHEME_APPLICATION_DOCUMENT_NOT_FOUND'; (this as any).details = { id }; } }
/** PC-56 GOV-2a (GOV-2 Q2-A, lead-applied 2026-11-10 — the founder may reopen): checking and deciding an application belong to the government
 *  authority that runs the scheme (`POST /v1/gov/applications/:id/act`, a second person decides). The organisation's own verify / approve /
 *  reject / close acts are CLOSED, refused by name for every caller. Field visits and the DBT record stay (GOV-3 / GOV-4 own them). */
export class SchemeDecisionsAreTheAuthoritysError extends DomainError {
  constructor(act: string) { super('SCHEME_DECISIONS_ARE_THE_AUTHORITYS', 'Applications are checked and decided by the government authority that runs the scheme, not by the organisation.', 403, { act }); }
}
/** PC-56 GOV-3a (GOV-3 Q2-A, lead-applied 2026-11-11 — the founder may reopen): nobody records payments here. The tenant DBT acts and reads —
 *  record a credit, record / resolve / list a returned payment, the returns desk, the monitor, the recent list and the exports — are CLOSED,
 *  refused by name for every caller, before anything is read or written. A farmer's own read of her application's past credit records stays. */
export class DbtIsNotRecordedHereError extends DomainError {
  constructor(act: string) { super('DBT_IS_NOT_RECORDED_HERE', 'Payments and returned payments are not recorded on this platform. Benefits are paid by PFMS and the banks, outside this platform.', 403, { act }); }
}
