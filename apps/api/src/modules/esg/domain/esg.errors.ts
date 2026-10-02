// modules/esg/domain/esg.errors.ts · PC-56 TENANT-9d · every ESG refusal is a sentence with a code, never a bare 403.
import { DomainError, NotFoundError } from '../../../shared/errors/app-error';

/** The review or the act said no — every code by name (the console renders each). */
export class EsgRefusedError extends DomainError {
  constructor(refusals: Array<{ field: string | null; code: string }>) {
    super('ESG_REFUSED', `refused: ${refusals.map((r) => r.code).join(', ')}`, 422, { refusals });
  }
}
export class DisclosureNotFoundError extends NotFoundError {
  constructor(id: string) { super('ESG disclosure not found', { id }); }
}
export class MetricNotFoundError extends NotFoundError {
  constructor(code: string) { super('ESG metric not found', { code }); }
}
