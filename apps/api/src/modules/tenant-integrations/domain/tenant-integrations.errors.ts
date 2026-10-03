// modules/tenant-integrations/domain/tenant-integrations.errors.ts · typed errors with stable codes — PC-56 TENANT-13c names every refusal.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

export class ProviderNotFoundError extends NotFoundError {
  constructor(code: string) { super('Integration provider not found'); (this as any).code = 'INTEGRATION_PROVIDER_NOT_FOUND'; (this as any).details = { code }; }
}
export class IntegrationNotFoundError extends NotFoundError {
  constructor(providerCode: string) { super('Integration not found'); (this as any).code = 'TENANT_INTEGRATION_NOT_FOUND'; (this as any).details = { providerCode }; }
}
export class IntegrationProposalNotFoundError extends NotFoundError {
  constructor() { super('Integration proposal not found'); (this as any).code = 'INTEGRATION_PROPOSAL_NOT_FOUND'; }
}
export class IntegrationsForbiddenError extends AppError {
  constructor(message = 'Integrations need api.manage or tenant.settings (tenant_admin).') { super('INTEGRATIONS_FORBIDDEN', message, 403); }
}
export class InvalidIntegrationError extends DomainError {
  constructor(message: string) { super('TENANT_INTEGRATION_INVALID', message, 422); }
}
/** A platform-managed provider (agmarknet, pfms, pmkisan, ikhedut, msg91, razorpayx, sandbox): refused BY NAME. */
export class ProviderNotOwnableError extends AppError {
  constructor(code: string) { super('INTEGRATION_PROVIDER_NOT_OWNABLE', `${code} is platform-managed — your organisation cannot attach its own credential to it.`, 422, { providerCode: code }); }
}
/** The credential did not verify against the provider: nothing vaulted, nothing written. */
export class IntegrationVerifyFailedError extends AppError {
  constructor(providerCode: string, errorClass: string, detail: string) {
    super('INTEGRATION_VERIFY_FAILED', `The ${providerCode} credential did not verify (${errorClass}) — nothing was stored.`, 422, { providerCode, errorClass, detail });
  }
}
export class IntegrationRefusedError extends AppError {
  constructor(refusals: { field: string | null; code: string; detail?: string }[]) { super('INTEGRATION_REFUSED', 'The provider change was refused.', 422, { refusals }); }
}
export class IntegrationActRefusedError extends AppError {
  constructor(code: string, message: string, status = 409, details?: Record<string, unknown>) { super(code, message, status, details); }
}
