// apps/admin-api/src/modules/settings-ops/domain/settings-ops.errors.ts · PC-56 ADMIN-11.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

export class SettingNotFoundError extends DomainHttpError {
  constructor(key: string) { super('SETTING_NOT_FOUND', `no setting definition '${key}'`, HttpStatus.NOT_FOUND, { key }); }
}
export class InvalidSettingError extends DomainHttpError {
  constructor(detail: string) { super('SETTING_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); }
}
export class DuplicateSettingError extends DomainHttpError {
  constructor(key: string) {
    super('SETTING_EXISTS', `'${key}' is already defined. A new setting is an INSERT and a definition is never silently replaced — retype or lock the existing one`, HttpStatus.CONFLICT, { key });
  }
}
/** A platform-scoped key cannot take a tenant override. */
export class SettingLockedError extends DomainHttpError {
  constructor(key: string, detail: string) { super('SETTING_LOCKED', detail, HttpStatus.CONFLICT, { key }); }
}
/** The second-person rule on money-path and security keys — 403 rather than 409, because the request is well formed and
 *  the refusal is about WHO is asking (the same status the other fourteen sites return). */
export class SettingCheckerRequiredError extends DomainHttpError {
  constructor(key: string, detail: string) { super('SETTING_CHECKER_REQUIRED', detail, HttpStatus.FORBIDDEN, { key }); }
}
/** **A RETYPE THAT WOULD ORPHAN LIVE VALUES.** Changing `int` → `bool` on a key 312 tenants have set makes every one of
 *  those rows invalid, and `tenant_settings.value` is jsonb so the database will not catch it. */
export class SettingRetypeUnsafeError extends DomainHttpError {
  constructor(key: string, rows: number) {
    super('SETTING_RETYPE_UNSAFE',
      `'${key}' has ${rows} stored value(s) that would not satisfy the new type. A retype that invalidates live rows is refused: those tenants would read a value their own code cannot parse.`,
      HttpStatus.CONFLICT, { key, rows });
  }
}
