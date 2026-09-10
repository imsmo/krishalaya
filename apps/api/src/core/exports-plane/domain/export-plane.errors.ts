// core/exports-plane/domain/export-plane.errors.ts · typed errors, stable codes → HTTP (PC-56 TENANT-6e-2).
import { DomainError } from '../../../shared/errors/app-error';

/** 404 for a job the caller cannot see — a non-member must not learn that the id exists (no cross-tenant enumeration). */
export class ExportJobNotFoundError extends DomainError { constructor(id: string) { super('EXPORT_JOB_NOT_FOUND', `Export job ${id} not found`, 404, { id }); } }
export class UnknownDatasetError extends DomainError { constructor(code: string) { super('EXPORT_DATASET_UNKNOWN', `No dataset registered as "${code}"`, 422, { dataset: code }); } }
export class ExportParamsInvalidError extends DomainError { constructor(detail: string) { super('EXPORT_PARAMS_INVALID', detail, 422, { detail }); } }
/** The requester's open-job cap — a bound on write amplification, not a quota anybody buys. */
export class TooManyOpenExportsError extends DomainError { constructor(max: number) { super('EXPORT_TOO_MANY_OPEN', `Too many exports waiting (max ${max}); wait for one to finish`, 429, { max }); } }
/** The plane's own flag is off. Distinct from a dataset's flag, which fails the JOB (a receipt with a reason) rather than
 *  the request — a request refused here never becomes a row. */
export class ExportPlaneDisabledError extends DomainError { constructor() { super('EXPORT_PLANE_DISABLED', 'Exports are not switched on for this tenant', 404, {}); } }
/** A link can only be minted for a file that exists and is still served. The code says which of the two it was. */
export class ExportNotReadyError extends DomainError { constructor(status: string) { super('EXPORT_NOT_READY', `Export is ${status}, not ready`, 409, { status }); } }
export class ExportFileExpiredError extends DomainError { constructor(expiredAt: Date | null) { super('EXPORT_FILE_EXPIRED', 'The file has passed its retention and is no longer served', 410, { expiredAt: expiredAt?.toISOString() ?? null }); } }
/**
 * The download was refused, with the reason the LOG ROW carries (`tenant_export_downloads.outcome`). One class, one HTTP
 * status, several codes — because the screen's sentence for "your link has expired, make a new one" and "this link is for
 * a different file" are different sentences, and because a refused fetch is logged BEFORE this is thrown.
 */
export class ExportDownloadRefusedError extends DomainError {
  constructor(readonly outcome: string) { super('EXPORT_DOWNLOAD_REFUSED', `Download refused: ${outcome}`, 403, { outcome }); }
}
