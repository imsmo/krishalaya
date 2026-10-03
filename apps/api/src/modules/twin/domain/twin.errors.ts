// modules/twin/domain/twin.errors.ts · PC-56 TENANT-12 · every twin refusal is a sentence with a code, never a bare 403.
import { AppError, DomainError, NotFoundError } from '../../../shared/errors/app-error';

/** The review or the act said no — every code by name (the console renders each). */
export class TwinRefusedError extends DomainError {
  constructor(refusals: Array<{ field: string | null; code: string }>) {
    super('TWIN_REFUSED', `refused: ${refusals.map((r) => r.code).join(', ')}`, 422, { refusals });
  }
}
/**
 * THE GATE (F-1): a run was asked for and none can happen. 409, with the gate named — the attempt IS recorded (twin_runs, status
 * refused) and audited before this is thrown, so "nothing happened" is itself a fact on file.
 */
export class TwinRunRefusedError extends AppError {
  constructor(code: 'TWIN_NO_MODEL_REGISTERED' | 'TWIN_NO_RUNNER', runId: string, scenarioId: string) {
    super(code, code === 'TWIN_NO_MODEL_REGISTERED'
      ? 'no scenario model is registered (ai_models: none at production/canary for twin.scenario) — the twin prints no figure a registered model and a recorded run did not produce'
      : 'a scenario model is registered but no runner exists to execute it — refused by name', 409,
    { gate: code === 'TWIN_NO_MODEL_REGISTERED' ? 'ai_models' : 'runner', modelCode: 'twin.scenario', runId, scenarioId, recorded: true });
  }
}
export class TwinForbiddenError extends AppError { constructor(permission: string) { super('TWIN_FORBIDDEN', `requires ${permission}`, 403, { permission }); } }
export class ScenarioNotFoundError extends NotFoundError { constructor(id: string) { super('Twin scenario not found', { id }); } }
export class DeviceNotFoundError extends NotFoundError { constructor(id: string) { super('Twin device not found', { id }); } }
