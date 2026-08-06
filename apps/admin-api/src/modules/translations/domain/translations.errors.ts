// apps/admin-api/src/modules/translations/domain/translations.errors.ts · PC-56 ADMIN-3b.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

/** A translation or a review the rules refuse. 422 with the specific rule named — the operator has just typed something
 *  in a language they were trusted with and needs to know what to change. */
export class InvalidTranslationError extends DomainHttpError {
  constructor(detail: string) { super('TRANSLATION_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}

/**
 * THE LANGUAGE-SCOPE REFUSAL. 403, not 422: the request was well-formed and the caller genuinely holds
 * `translations.review` — what they do not hold is THIS LANGUAGE.
 *
 * The message says which languages they DO hold, because the commonest cause is a reviewer opening the wrong queue, and
 * "forbidden" alone would send them to ask an administrator for a permission they already have.
 */
export class ReviewerScopeError extends DomainHttpError {
  constructor(languageCode: string, held: readonly string[]) {
    super('TRANSLATION_REVIEWER_SCOPE',
      held.length === 0
        ? `you are not a reviewer for any language, so you cannot approve ${languageCode} — a reviewer who cannot read the language cannot tell a correct translation from a fluent-sounding wrong one`
        : `you review ${held.join(', ')} — not ${languageCode}`,
      HttpStatus.FORBIDDEN, { languageCode, held });
  }
}

export class TranslationNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('TRANSLATION_NOT_FOUND', `translation ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}

/** A translation already reviewed. 409: the request was legal, somebody got there first — and an approval must never be
 *  silently overwritten by a second reviewer's different opinion. */
export class AlreadyReviewedError extends DomainHttpError {
  constructor(ref: string, at: string) {
    super('TRANSLATION_ALREADY_REVIEWED',
      `translation ${ref} was already reviewed at ${at} — reload to see what was decided rather than deciding again`,
      HttpStatus.CONFLICT, { ref, at });
  }
}

export class DuplicateTranslationError extends DomainHttpError {
  constructor(detail: string) { super('TRANSLATION_DUPLICATE', detail, HttpStatus.CONFLICT, { detail }); }
}
