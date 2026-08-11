// apps/admin-api/src/modules/templates-ops/domain/templates-ops.errors.ts · PC-56 ADMIN-11b.
//
// Every refusal on this plane names the lever the author can pull. W2285 and W2294 promise "the failure reason and a
// retry path" — a plane that answers 422 with "invalid" satisfies the status code and not the screen.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}

export class TemplateNotFoundError extends DomainHttpError {
  constructor(id: string) { super('TEMPLATE_NOT_FOUND', `no notification template '${id}'`, HttpStatus.NOT_FOUND, { id }); }
}
export class EventNotFoundError extends DomainHttpError {
  constructor(code: string) {
    super('EVENT_NOT_FOUND', `'${code}' is not in the notification event catalogue. A template for an event nothing emits would never send`, HttpStatus.NOT_FOUND, { code });
  }
}
/** The authoring verdict, refused with every problem at once. W2282/W2291: "every invalid field is listed with its
 *  reason, values you entered are preserved, nothing was saved" — one-problem-at-a-time turns that into a guessing game
 *  in a language the author may not read. */
export class TemplateDraftRefusedError extends DomainHttpError {
  constructor(problems: { code: string; detail: string }[]) {
    super('TEMPLATE_DRAFT_REFUSED', problems.map((p) => p.detail).join(' '), HttpStatus.UNPROCESSABLE_ENTITY, { problems });
  }
}
/** **SECURITY COPY.** 403 rather than 422: the request is well formed and the refusal is about the wording's ownership,
 *  not its shape. W101 states the rule and, until this wave, nothing enforced it in either realm. */
export class SecurityCopyPlatformOnlyError extends DomainHttpError {
  constructor(eventCode: string) {
    super('SECURITY_COPY_PLATFORM_ONLY',
      `${eventCode} is opt-out-locked or critical: its wording is platform-controlled and takes no tenant override`,
      HttpStatus.FORBIDDEN, { eventCode });
  }
}
/** Sixteenth maker-checker site. Same status as the other fifteen. */
export class TemplateCheckerRequiredError extends DomainHttpError {
  constructor(detail: string) { super('TEMPLATE_CHECKER_REQUIRED', detail, HttpStatus.FORBIDDEN, {}); }
}
/** An SMS or WhatsApp version cannot be approved with no provider registration behind it: it would be a green row that
 *  fails at the operator, where the cost is undelivered messages rather than a puzzled reader. */
export class ProviderRefRequiredError extends DomainHttpError {
  constructor(channel: string) {
    super('PROVIDER_REF_REQUIRED',
      `a ${channel} template needs its provider registration (DLT template id / WhatsApp template name) before it can be approved — sending against an unregistered ref does not bounce, it silently stops delivering`,
      HttpStatus.CONFLICT, { channel });
  }
}
export class LifecycleTransitionError extends DomainHttpError {
  constructor(from: string, to: string) {
    super('TEMPLATE_LIFECYCLE_INVALID', `a ${from} version cannot become ${to}`, HttpStatus.CONFLICT, { from, to });
  }
}
/** **PUBLISHED-NEVER-EDITED, SURFACED AS A REFUSAL RATHER THAN A DATABASE ERROR.** The trigger in 0122 is the real
 *  guarantee; this is what an operator reads when a client tries to rewrite a version instead of adding one. */
export class VersionImmutableError extends DomainHttpError {
  constructor(versionNo: number) {
    super('TEMPLATE_VERSION_IMMUTABLE',
      `version ${versionNo} is published: its words never change. Author a new version — the approved one keeps serving until yours is approved, so nothing goes quiet while you work`,
      HttpStatus.CONFLICT, { versionNo });
  }
}
export class SenderIdNotFoundError extends DomainHttpError {
  constructor(id: string) { super('SENDER_ID_NOT_FOUND', `no sender registration '${id}'`, HttpStatus.NOT_FOUND, { id }); }
}
export class DuplicateSenderIdError extends DomainHttpError {
  constructor(sender: string, channel: string, country: string) {
    super('SENDER_ID_EXISTS', `'${sender}' is already registered for ${channel} in ${country}`, HttpStatus.CONFLICT, { sender, channel, country });
  }
}
