// modules/cms/domain/cms.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';

export class PageNotFoundError extends DomainError { constructor(id: string) { super('CMS_PAGE_NOT_FOUND', `Page ${id} not found`, 404, { id }); } }
export class BannerNotFoundError extends DomainError { constructor(id: string) { super('CMS_BANNER_NOT_FOUND', `Banner ${id} not found`, 404, { id }); } }
export class InvalidPageError extends DomainError { constructor(detail: string) { super('CMS_PAGE_INVALID', detail, 422, { detail }); } }
export class InvalidBannerError extends DomainError { constructor(detail: string) { super('CMS_BANNER_INVALID', detail, 422, { detail }); } }
export class CmsForbiddenError extends DomainError { constructor(detail = 'forbidden') { super('CMS_FORBIDDEN', detail, 403, {}); } }
// PC-56 TENANT-8c · THE PAGES. Each refusal carries the CODES the review / verdict computed, so the console prints the
// sentence the review would have printed — a 422 / 409 with words, never a bare status (8a's shape).
export class PageFormRefusedError extends DomainError {
  constructor(refusals: ReadonlyArray<{ field: string | null; code: string }>) {
    super('CMS_PAGE_FORM_REFUSED', `Page write refused: ${refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).join(', ')}`, 422, { refusals });
  }
}
export class PageActRefusedError extends DomainError {
  constructor(act: string, refusals: readonly string[]) {
    super('CMS_PAGE_ACT_REFUSED', `Page act ${act} refused: ${refusals.join(', ')}`, 409, { act, refusals });
  }
}
/** F-20: the write the review promised (`new_page:1`, `new_version:3`, `edit_draft:3`) is no longer the write the
 *  database would make — a colleague wrote first. A typed 409, never the raw 23505 → 500 it used to be. */
export class PageChangedError extends DomainError {
  constructor(slug: string, expected: string, actual: string | null) {
    super('CMS_PAGE_CHANGED', `Page ${slug} changed since it was reviewed (reviewed ${expected}, now ${actual ?? 'not writable'})`, 409, { slug, expected, actual, refusals: ['VERSION_CHANGED'] });
  }
}
/** The backstop: a UNIQUE (version, one draft, one live) refused the write — still a 409 with a code, never a 500. */
export class PageVersionTakenError extends DomainError {
  constructor(slug: string, constraint: string | null) {
    super('CMS_PAGE_VERSION_TAKEN', `Page ${slug}: ${constraint ?? 'a unique rule'} refused the write — another write of this slug got there first`, 409, { slug, constraint });
  }
}
export class FaqMoveRefusedError extends DomainError {
  constructor(refusals: readonly string[]) {
    super('CMS_FAQ_MOVE_REFUSED', `FAQ reorder refused: ${refusals.join(', ')}`, 409, { refusals });
  }
}
// PC-56 TENANT-8d · THE BANNERS. The same shape: each refusal carries the codes the review / verdict computed.
export class BannerFormRefusedError extends DomainError {
  constructor(refusals: ReadonlyArray<{ field: string | null; code: string }>) {
    super('CMS_BANNER_FORM_REFUSED', `Banner write refused: ${refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).join(', ')}`, 422, { refusals });
  }
}
/** F-8: the image is not the cooperative's own clean image — a typed refusal, never a bare FK pass. */
export class BannerMediaRefusedError extends DomainError {
  constructor(code: string) { super('CMS_BANNER_MEDIA_REFUSED', `Banner image refused: ${code}`, 422, { refusals: [{ field: 'mediaId', code }] }); }
}
export class BannerActRefusedError extends DomainError {
  constructor(act: string, refusals: readonly string[], missingLanguages: readonly string[] = []) {
    super('CMS_BANNER_ACT_REFUSED', `Banner act ${act} refused: ${refusals.join(', ')}`, 409, { act, refusals, missingLanguages });
  }
}
/** An edit reviewed against a version of the banner a colleague has since changed. */
export class BannerChangedError extends DomainError {
  constructor(id: string, expected: string, actual: string | null) {
    super('CMS_BANNER_CHANGED', `Banner ${id} changed since it was reviewed`, 409, { id, expected, actual, refusals: ['VERSION_CHANGED'] });
  }
}
export class BannerSlotRefusedError extends DomainError {
  constructor(refusals: readonly string[]) { super('CMS_BANNER_SLOT_REFUSED', `Banner reorder refused: ${refusals.join(', ')}`, 409, { refusals }); }
}
