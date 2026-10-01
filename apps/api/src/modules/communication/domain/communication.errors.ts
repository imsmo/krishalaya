// modules/communication/domain/communication.errors.ts · typed errors, stable codes → HTTP.
import { DomainError } from '../../../shared/errors/app-error';

export class NotificationNotFoundError extends DomainError {
  constructor(id: string) { super('NOTIFICATION_NOT_FOUND', `Notification ${id} not found`, 404, { id }); }
}
export class NotificationEventNotFoundError extends DomainError {
  constructor(code: string) { super('NOTIFICATION_EVENT_NOT_FOUND', `Notification event '${code}' not in the catalog`, 404, { code }); }
}
export class NoTemplateError extends DomainError {
  constructor(eventCode: string, channel: string, languageCode: string) {
    super('NOTIFICATION_NO_TEMPLATE', `No active template for ${eventCode}/${channel}/${languageCode}`, 422, { eventCode, channel, languageCode });
  }
}
export class InvalidChannelError extends DomainError {
  constructor(channel: string) { super('NOTIFICATION_INVALID_CHANNEL', `Unknown channel '${channel}'`, 400, { channel }); }
}
export class CannotOptOutError extends DomainError {
  constructor(eventCode: string) { super('NOTIFICATION_CANNOT_OPT_OUT', `Event '${eventCode}' is mandatory and cannot be disabled`, 409, { eventCode }); }
}
export class IllegalNotificationTransitionError extends DomainError {
  constructor(from: string, to: string) { super('NOTIFICATION_ILLEGAL_TRANSITION', `Cannot move notification ${from}→${to}`, 409, { from, to }); }
}
export class CommForbiddenError extends DomainError {
  constructor(detail = 'forbidden') { super('COMM_FORBIDDEN', detail, 403, {}); }
}
/**
 * **SECURITY COPY IS PLATFORM-CONTROLLED (PC-56 ADMIN-11b).** W101 states the rule — "auth.otp and dispute events are
 * opt-out-locked and tenant overrides are disabled on them; security copy stays platform-controlled" — and until that
 * wave nothing enforced it in either realm: `TemplateAdminService.upsert` (PC-27; replaced by TENANT-8a's `TemplateOverrideService`) checked only that the event existed, and
 * `resolve()` sorts `tenant_id NULLS LAST`, so a tenant row BEAT the platform default for every event including
 * `auth.otp`. A tenant holding `notification.manage` could replace the wording of the one-time-password message its
 * farmers receive.
 *
 * 403 rather than 422: the request is well formed and the refusal is about who owns the words.
 */
export class SecurityCopyPlatformOnlyError extends DomainError {
  constructor(eventCode: string) {
    super('SECURITY_COPY_PLATFORM_ONLY',
      `'${eventCode}' is opt-out-locked or critical: its wording is platform-controlled and cannot be overridden per tenant`,
      403, { eventCode });
  }
}
export class InvalidPushDeviceError extends DomainError {
  constructor(detail = 'Invalid push device registration') { super('PUSH_DEVICE_INVALID', detail, 400, {}); }
}
// PC-56 TENANT-8a · THE OVERRIDE. Each refusal carries the CODES the review/verdict computed, so the console prints the
// sentence the review would have printed — a 422/409 with words, never a bare status.
export class TemplateFormRefusedError extends DomainError {
  constructor(refusals: ReadonlyArray<{ field: string | null; code: string }>) {
    super('TEMPLATE_FORM_REFUSED', `Template override refused: ${refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).join(', ')}`, 422, { refusals });
  }
}
export class TemplateActRefusedError extends DomainError {
  constructor(act: string, refusals: readonly string[]) {
    super('TEMPLATE_ACT_REFUSED', `Template act ${act} refused: ${refusals.join(', ')}`, 409, { act, refusals });
  }
}
export class TemplateNotFoundError extends DomainError {
  constructor(id: string) { super('TEMPLATE_NOT_FOUND', `Template ${id} not found`, 404, { id }); }
}
// PC-56 TENANT-8b · THE INBOX. A form-chain write refused with the review's own codes (the console prints the sentence).
export class InboxFormRefusedError extends DomainError {
  constructor(form: string, refusals: ReadonlyArray<{ field: string | null; code: string }>) {
    super('INBOX_FORM_REFUSED', `${form} refused: ${refusals.map((r) => (r.field ? `${r.field}/${r.code}` : r.code)).join(', ')}`, 422, { form, refusals });
  }
}
export class NotificationUpdateLostError extends DomainError {
  constructor(id: string) { super('NOTIFICATION_UPDATE_LOST', `Notification ${id}: the update matched no row`, 409, { id }); }
}
