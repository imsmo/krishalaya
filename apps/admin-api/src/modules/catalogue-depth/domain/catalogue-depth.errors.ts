// apps/admin-api/src/modules/catalogue-depth/domain/catalogue-depth.errors.ts · PC-56 ADMIN-3.
// One error per refusal class, each carrying the specific rule in its message — an operator mid-edit needs to know WHAT
// to change, and "invalid attribute" tells them nothing.
import { HttpException, HttpStatus } from '@nestjs/common';

// Declared locally, as every other ops module in this realm does (support-oversight, billing-ops). There is no shared
// core/http/domain-error module: the duplication is four lines and the alternative — one shared base class every module
// imports — would make a change to error shape a change to every module at once.
class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

/** An attribute definition, option or binding the rules refuse: a validation blob that smuggles pricing keys, a unit on
 *  a boolean, a binding that is both always-required and conditional. 422 with the rule named. */
export class InvalidAttributeError extends DomainHttpError {
  constructor(detail: string) { super('CATALOGUE_ATTRIBUTE_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
/** A unit or conversion the rules refuse — a cross-class conversion, a zero factor, a self-conversion that is not 1. */
export class InvalidUnitError extends DomainHttpError {
  constructor(detail: string) { super('CATALOGUE_UNIT_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
export class AttributeNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('CATALOGUE_ATTRIBUTE_NOT_FOUND', `attribute ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
export class UnitNotFoundError extends DomainHttpError {
  constructor(ref: string) { super('CATALOGUE_UNIT_NOT_FOUND', `unit ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); }
}
/** The code is already taken. 409, not 422: the request was fine, it collided — and saying so is how an author discovers
 *  the attribute they were about to define already exists. */
export class DuplicateCatalogueCodeError extends DomainHttpError {
  constructor(kind: string, code: string) {
    super('CATALOGUE_CODE_DUPLICATE', `a ${kind} with code "${code}" already exists`, HttpStatus.CONFLICT, { kind, code });
  }
}
/** An edit that re-interprets data already stored, attempted without the checker acknowledgement. 409: the request is
 *  legal, it just cannot be done in one step by one person. */
export class CheckerRequiredError extends DomainHttpError {
  constructor(consequences: string[]) {
    super('CATALOGUE_CHECKER_REQUIRED',
      `this change needs a second pair of eyes: ${consequences.join('; ')}`,
      HttpStatus.CONFLICT, { consequences });
  }
}
