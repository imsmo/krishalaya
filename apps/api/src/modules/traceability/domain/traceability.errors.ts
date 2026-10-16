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
