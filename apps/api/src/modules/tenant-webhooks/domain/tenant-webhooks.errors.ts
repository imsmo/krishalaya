// modules/tenant-webhooks/domain/tenant-webhooks.errors.ts · typed errors with stable codes. PC-56 TENANT-13a: every refusal is a
// sentence with a code (WEBHOOK_REFUSED + every code by name, the console renders each), never a bare 403/500.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export interface WebhookRefusal { field: string | null; code: string }

export class WebhookRefusedError extends DomainError {
  constructor(refusals: WebhookRefusal[]) {
    super('WEBHOOK_REFUSED', `refused: ${refusals.map((r) => r.code).join(', ')}`, 422, { refusals });
  }
}
export class WebhookNotFoundError extends NotFoundError {
  constructor(id: string) { super('Webhook endpoint not found'); (this as any).code = 'WEBHOOK_ENDPOINT_NOT_FOUND'; (this as any).details = { id }; }
}
export class WebhookDeliveryNotFoundError extends NotFoundError {
  constructor(id: string) { super('Webhook delivery not found'); (this as any).code = 'WEBHOOK_DELIVERY_NOT_FOUND'; (this as any).details = { id }; }
}
/** Kept for the legacy codes the console already maps. */
export class WebhookUrlUnsafeError extends DomainError {
  constructor(reason: string) { super('WEBHOOK_URL_UNSAFE', `Webhook URL rejected: ${reason}`, 422, { reason }); }
}
export class WebhookEventUnknownError extends DomainError {
  constructor(code: string) { super('WEBHOOK_EVENT_UNKNOWN', `Unknown webhook event: ${code}`, 422, { code }); }
}
export class WebhooksForbiddenError extends AppError {
  constructor(message = 'Developer settings need api.manage') { super('WEBHOOKS_FORBIDDEN', message, 403, { permission: 'api.manage' }); }
}
