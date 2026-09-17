// modules/education/domain/live-session.state.ts · STATE MACHINE for live_sessions.status (Law 5).
//
//   scheduled → live       `start` — ONLY when a stream provider is configured (this platform has none; the noop
//                          gateway answers `provider_not_configured`), so in production this edge is never taken.
//   scheduled → ended      `end` — PC-56 TENANT-7c: the class was HELD ELSEWHERE (on the join link the host pasted) and
//                          the host marks it ended once its start has passed. Without this edge a class on this
//                          platform could never be over, never take attendance, never carry its recording. W414's own
//                          row reads *"held Mon 06 Jul, 20:30 … recorded → lesson 7"* — held, not streamed.
//   live      → ended      `end`, as before.
//   scheduled → cancelled  `cancel` — a started or held class cannot be cancelled, only ended.
import { DomainError } from '../../../shared/errors/app-error';
import { LiveStatus } from './creator.events';

const TRANSITIONS: Readonly<Record<LiveStatus, readonly LiveStatus[]>> = Object.freeze({
  scheduled: ['live', 'ended', 'cancelled'],
  live:      ['ended'],
  ended:     [],
  cancelled: [],
});
export class IllegalLiveTransitionError extends DomainError {
  constructor(from: string, to: string) { super('LIVE_ILLEGAL_TRANSITION', `Cannot move live session ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: LiveStatus, to: LiveStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: LiveStatus, to: LiveStatus): void { if (!canTransition(from, to)) throw new IllegalLiveTransitionError(from, to); }
/** A class still on the calendar — the ones a clash is computed against and a reminder is sent for. */
export function isOnCalendar(s: LiveStatus): boolean { return s === 'scheduled' || s === 'live'; }
