// apps/admin-api/src/modules/schemes-registry-ops/domain/schemes-registry.errors.ts · typed errors → HTTP via
// HttpException subclasses with stable codes (mirrors the other ops modules). Covers the government-scheme master:
// scheme_authorities (issuing bodies) + schemes (the code-keyed, versioned catalogue).
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

/* ---------------- not-found (404 — never 403, no enumeration leak) ---------------- */
export class AuthorityNotFoundError extends DomainHttpError {
  constructor(id: string) { super('SCHEME_AUTHORITY_NOT_FOUND', `scheme authority '${id}' not found`, HttpStatus.NOT_FOUND, { id }); }
}
export class SchemeNotFoundError extends DomainHttpError {
  constructor(id: string) { super('SCHEME_NOT_FOUND', `scheme '${id}' not found`, HttpStatus.NOT_FOUND, { id }); }
}

/* ---------------- validation (422) ---------------- */
export class InvalidSchemeInputError extends DomainHttpError {
  constructor(detail: string) { super('SCHEME_INPUT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
/** category_id must reference an ACTIVE platform lookup_value of type 'scheme_category'. */
export class SchemeCategoryInvalidError extends DomainHttpError {
  constructor(id: string) { super('SCHEME_CATEGORY_INVALID', `category '${id}' is not an active 'scheme_category' lookup value`, HttpStatus.UNPROCESSABLE_ENTITY, { id }); }
}

/* ---------------- conflict (409) ---------------- */
export class DuplicateSchemeCodeError extends DomainHttpError {
  constructor(code: string) { super('SCHEME_CODE_EXISTS', `scheme code '${code}' already exists`, HttpStatus.CONFLICT, { code }); }
}
/** activate/deactivate (or any patch) is a no-op — the entity is already in the requested state. */
export class SchemeAlreadyInStateError extends DomainHttpError {
  constructor(kind: string, isActive: boolean) { super('SCHEME_ALREADY_IN_STATE', `${kind} is already ${isActive ? 'active' : 'inactive'}`, HttpStatus.CONFLICT, { isActive }); }
}

/* ---------------- the version plane (0105) ---------------- */
export class VersionNotFoundError extends DomainHttpError {
  constructor(id: string) { super('SCHEME_VERSION_NOT_FOUND', `scheme version '${id}' not found`, HttpStatus.NOT_FOUND, { id }); }
}
/** A draft already exists for this scheme. `uq_scheme_versions_one_draft` refuses the second one at the database;
 *  this makes the refusal a 409 that names the open draft so the operator can go and look at it, rather than a
 *  unique-violation 500 that tells them nothing. */
export class DraftAlreadyOpenError extends DomainHttpError {
  constructor(schemeId: string, versionId: string, version: number) {
    super('SCHEME_DRAFT_OPEN', `scheme '${schemeId}' already has an open draft (v${version}) — edit or discard it`, HttpStatus.CONFLICT, { schemeId, versionId, version });
  }
}
/** Only a draft can be edited, published or discarded. A published version is a historical fact somebody acted on. */
export class VersionNotDraftError extends DomainHttpError {
  constructor(id: string, status: string) {
    super('SCHEME_VERSION_NOT_DRAFT', `scheme version '${id}' is ${status} — published rule sets are immutable, draft a new version instead`, HttpStatus.CONFLICT, { id, status });
  }
}
/** The checker gate. Names the rule rather than saying "forbidden", because the operator has the permission — what
 *  they lack is a second person, and a bare 403 sends them to ask for access they already hold. */
export class SelfPublishError extends DomainHttpError {
  constructor(version: number) {
    super('SCHEME_VERSION_SELF_PUBLISH', `v${version} was drafted by you and must be published by a different operator (maker-checker)`, HttpStatus.CONFLICT, { version });
  }
}
/** A scheme with no published version cannot serve anybody. Only reachable for a scheme created before 0105 whose
 *  backfill was skipped, or one soft-deleted mid-flight — named rather than silently treated as "no rules". */
export class NoPublishedVersionError extends DomainHttpError {
  constructor(schemeId: string) { super('SCHEME_NO_PUBLISHED_VERSION', `scheme '${schemeId}' has no published version`, HttpStatus.CONFLICT, { schemeId }); }
}
/** An external_entity_refs mapping for this portal already points at a DIFFERENT authority. The table's second
 *  UNIQUE (provider_code, entity_type, external_id) is what catches it; this names the holder, because two
 *  authorities filing under one portal id is how one authority's submissions land under the other's name. */
export class PortalMappingConflictError extends DomainHttpError {
  constructor(providerCode: string, externalId: string, heldBy: string) {
    super('SCHEME_PORTAL_MAPPING_CONFLICT', `'${externalId}' on provider '${providerCode}' is already mapped to authority '${heldBy}'`, HttpStatus.CONFLICT, { providerCode, externalId, heldBy });
  }
}
/** The report name is not one this plane exports. Named explicitly so the refusal cannot be mistaken for an empty
 *  result — a blank CSV and a rejected report look identical to a downloader. */
export class ExportReportUnknownError extends DomainHttpError {
  constructor(report: string, allowed: readonly string[]) {
    super('SCHEME_EXPORT_REPORT_UNKNOWN', `'${report}' is not an exportable scheme report (${allowed.join('|')})`, HttpStatus.UNPROCESSABLE_ENTITY, { report, allowed });
  }
}
