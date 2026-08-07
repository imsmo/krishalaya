// apps/admin-api/src/modules/ai-models-ops/domain/ai-models.errors.ts · typed errors → HTTP status via the
// HttpException subclasses (admin-api uses Nest's exception filter). Stable codes in the body.
import { HttpException, HttpStatus } from '@nestjs/common';

class DomainHttpError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, detail: Record<string, unknown> = {}) {
    super({ code, message, ...detail }, status);
  }
}
export class AiModelNotFoundError extends DomainHttpError { constructor(ref: string) { super('AI_MODEL_NOT_FOUND', `AI model ${ref} not found`, HttpStatus.NOT_FOUND, { ref }); } }
export class InvalidAiModelError extends DomainHttpError { constructor(detail: string) { super('AI_MODEL_INVALID', detail, HttpStatus.UNPROCESSABLE_ENTITY, { detail }); } }
export class DuplicateAiModelError extends DomainHttpError { constructor(code: string, version: string) { super('AI_MODEL_DUPLICATE', `model ${code}@${version} already registered`, HttpStatus.CONFLICT, { code, version }); } }

/** PC-56 ADMIN-7 — a refusal on the governance plane: a closed fairness gate, a missing proposal, a case another
 *  reviewer holds, a verdict that cannot be established.
 *
 *  409 rather than 403, for the same reason `SecondPersonRequiredError` is a 409: almost every refusal here is about the
 *  STATE of the model or the case (never audited, gap too wide, already claimed) and not about authorisation. An
 *  operator reading 403 goes to ask for access they already hold, and the commonest outcome of that is a permission
 *  being widened to solve a problem it was not. */
export class AiGovernanceRefusedError extends DomainHttpError {
  constructor(message: string) { super('AI_GOVERNANCE_REFUSED', message, HttpStatus.CONFLICT); }
}
