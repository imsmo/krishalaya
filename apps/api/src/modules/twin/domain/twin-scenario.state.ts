// modules/twin/domain/twin-scenario.state.ts · PC-56 TENANT-12 · STATE MACHINE for twin_scenarios.status (Law 5). PURE.
//   draft → ready     (every key its template names carries a cited value; a scenario with no template: at least one)
//   ready → draft     (a template key is no longer set — cannot happen today: assumptions are edited, never removed)
//   draft | ready → archived (with a reason; final — 0190's trigger refuses any edit after it)
// "ready" means READY TO ASK FOR A RUN — not that a run can happen: no twin model is registered (twin-rules.gateVerdict).
import { DomainError } from '../../../shared/errors/app-error';

export const SCENARIO_STATUSES = ['draft', 'ready', 'archived'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

const TRANSITIONS: Readonly<Record<ScenarioStatus, readonly ScenarioStatus[]>> = Object.freeze({
  draft: ['ready', 'archived'],
  ready: ['draft', 'archived'],
  archived: [],
});

export class IllegalScenarioTransitionError extends DomainError {
  constructor(from: string, to: string) { super('TWIN_SCENARIO_ILLEGAL_TRANSITION', `Cannot move scenario ${from}→${to}`, 409, { from, to }); }
}
export const isScenarioStatus = (s: unknown): s is ScenarioStatus => typeof s === 'string' && (SCENARIO_STATUSES as readonly string[]).includes(s);
export function canTransition(from: ScenarioStatus, to: ScenarioStatus): boolean { return from === to ? from !== 'archived' : TRANSITIONS[from].includes(to); }
export function assertTransition(from: ScenarioStatus, to: ScenarioStatus): void { if (!canTransition(from, to)) throw new IllegalScenarioTransitionError(from, to); }

/** The status a scenario takes after its assumptions change (never archives — that is its own act). */
export function statusAfterAssumptions(current: ScenarioStatus, templateKeys: readonly string[] | null, setKeys: readonly string[]): ScenarioStatus {
  if (current === 'archived') return 'archived';
  const set = new Set(setKeys);
  const complete = templateKeys && templateKeys.length > 0 ? templateKeys.every((k) => set.has(k)) : set.size > 0;
  return complete ? 'ready' : 'draft';
}

/** The acts the console may offer on a scenario in this status (the API re-decides each). "run" is offered on a draft too (the
 *  canon's SC-016 "draft · Run scenario"): the attempt is recorded and refused by name — today always by the model gate. */
export function actsFor(status: ScenarioStatus): Array<'edit' | 'run' | 'archive'> {
  if (status === 'archived') return [];
  return ['edit', 'run', 'archive'];
}
