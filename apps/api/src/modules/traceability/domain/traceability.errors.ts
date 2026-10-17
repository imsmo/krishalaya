// modules/traceability/domain/traceability.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';

export class TraceLotNotFoundError extends DomainError { constructor(id: string) { super('TRACE_LOT_NOT_FOUND', `Trace lot ${id} not found`, 404, { id }); } }
export class InvalidTraceLotError extends DomainError { constructor(detail: string) { super('TRACE_LOT_INVALID', detail, 422, { detail }); } }
export class InvalidTraceEventError extends DomainError { constructor(detail: string) { super('TRACE_EVENT_INVALID', detail, 422, { detail }); } }
export class TraceForbiddenError extends DomainError { constructor(detail = 'forbidden') { super('TRACE_FORBIDDEN', detail, 403, {}); } }
export class ScanNotFoundError extends DomainError { constructor() { super('TRACE_SCAN_NOT_FOUND', 'No provenance found for this code', 404, {}); } }
/** PC-56 HOTFIX-7 · B25: the trace exists but its organisation has not published traceability (the flag is OFF — platform-wide or for this
 *  organisation). A NAMED reason, distinct from an unknown token (TRACE_SCAN_NOT_FOUND): OFF is not "not found". */
export class TraceNotPublishedError extends DomainError { constructor() { super('TRACE_NOT_PUBLISHED', 'This organisation has not published farm-to-fork traces', 404, {}); } }
/** PC-56 STORE-5b · D8 (founder Q19): the lot exists and its organisation WAS live — suspended, archived, terminated or removed. The record is
 *  kept (rows and hashes are never deleted); it is no longer published. ≠ TRACE_SCAN_NOT_FOUND (an unknown token, or an organisation that
 *  never went live). */
export class TraceNoLongerPublishedError extends DomainError { constructor() { super('TRACE_NO_LONGER_PUBLISHED', 'This trace is no longer published: its organisation is not live on the platform', 404, {}); } }
/** PC-56 STORE-5b · D2: the trace record cannot be queued on the export plane (the dataset is not registered, or the plane refused it). */
export class TraceExportUnavailableError extends DomainError { constructor(detail = 'the export plane cannot take this request now') { super('TRACE_EXPORT_UNAVAILABLE', detail, 503, {}); } }
