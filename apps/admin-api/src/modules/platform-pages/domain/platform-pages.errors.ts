// apps/admin-api/src/modules/platform-pages/domain/platform-pages.errors.ts · PC-56 LEGAL-1. Every refusal names the lever the operator
// can pull (the templates plane's rule).
import { HttpException, HttpStatus } from '@nestjs/common';
import { PageProblem } from './platform-page';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ ...detail, code, message }, status);   // the error code always wins over a detail key
  }
}

export class UnknownPlatformPageSlugError extends DomainHttpError {
  constructor(slug: string) {
    super('PLATFORM_PAGE_UNKNOWN_SLUG', `'${slug}' is not a platform policy page (terms, privacy, refunds, shipping)`, HttpStatus.NOT_FOUND, { slug });
  }
}
export class PlatformPageNotFoundError extends DomainHttpError {
  constructor(id: string) { super('PLATFORM_PAGE_NOT_FOUND', `no platform page version '${id}'`, HttpStatus.NOT_FOUND, { id }); }
}
export class PlatformPageRefusedError extends DomainHttpError {
  constructor(problems: PageProblem[]) {
    super('PLATFORM_PAGE_REFUSED', problems.map((p) => p.detail).join(' '), HttpStatus.UNPROCESSABLE_ENTITY, { problems });
  }
}
export class PlatformPageDraftExistsError extends DomainHttpError {
  constructor(slug: string, version: number | null) {
    super('PLATFORM_PAGE_DRAFT_EXISTS', `${slug} already has an open draft${version ? ` (v${version})` : ''} — edit it, or archive it first`,
      HttpStatus.CONFLICT, { slug, version });
  }
}
export class PlatformPageNotDraftError extends DomainHttpError {
  constructor(status: string, version: number) {
    super('PLATFORM_PAGE_NOT_DRAFT',
      `version ${version} is ${status}: only a draft is edited or published. Start a new draft — the live version keeps serving until yours is published`,
      HttpStatus.CONFLICT, { status, version });
  }
}
export class PlatformPageTransitionError extends DomainHttpError {
  constructor(from: string, to: string) {
    super('PLATFORM_PAGE_TRANSITION_INVALID', `a ${from} version cannot become ${to}`, HttpStatus.CONFLICT, { from, to });
  }
}
export class PlatformPageChangedError extends DomainHttpError {
  constructor() {
    super('PLATFORM_PAGE_CHANGED', 'somebody saved this draft after you opened it — reload, review their change, then save again', HttpStatus.CONFLICT);
  }
}
/** The maker≠checker refusal. 409, the two-person-rule's status: the operator HAS the permission; what is missing is a second person. */
export class PlatformPageCheckerRequiredError extends DomainHttpError {
  constructor(slug: string, version: number) {
    super('PLATFORM_PAGE_CHECKER_REQUIRED',
      `${slug} v${version} is a policy page: an operator who wrote or last edited it cannot publish it — a colleague with platform.pages.publish must`,
      HttpStatus.CONFLICT, { slug, version });
  }
}
export class PlatformPageMakerUnnamedError extends DomainHttpError {
  constructor(slug: string, version: number) {
    super('PLATFORM_PAGE_MAKER_UNNAMED',
      `${slug} v${version} has no named author (a loaded draft): an operator must review and save it first, then a different operator publishes it`,
      HttpStatus.CONFLICT, { slug, version });
  }
}
export class ArchiveReasonUnknownError extends DomainHttpError {
  constructor(code: string) {
    super('PLATFORM_PAGE_ARCHIVE_REASON_UNKNOWN', `'${code}' is not a selectable archive reason`, HttpStatus.UNPROCESSABLE_ENTITY, { archiveReason: code });
  }
}
export class PlatformPagePermissionError extends DomainHttpError {
  constructor(needed: string) {
    super('PLATFORM_PAGE_PERMISSION', `taking a LIVE policy page down needs ${needed}`, HttpStatus.FORBIDDEN, { needed });
  }
}

/** The database's refusals (0242), mapped to the same typed answers — the service checks first; this is the second layer, for a race or a
 *  future caller that skipped the check. */
export function mapPageDbError(e: unknown, slug: string, version: number): unknown {
  const err = e as { code?: string; message?: string; constraint?: string } | null;
  if (!err || typeof err !== 'object') return e;
  const msg = String(err.message ?? '');
  if (err.code === '23514' && (msg.includes('[CMS_PLATFORM_MAKER_IS_CHECKER]') || err.constraint === 'ck_cms_pages_platform_maker_ne_checker')) {
    return new PlatformPageCheckerRequiredError(slug, version);
  }
  if (err.code === '23514' && msg.includes('[CMS_PLATFORM_MAKER_UNNAMED]')) return new PlatformPageMakerUnnamedError(slug, version);
  if (err.code === '23505' && err.constraint === 'uq_cms_pages_one_draft_platform') return new PlatformPageDraftExistsError(slug, null);
  return e;
}
