// core/exports-plane/domain/export-job.state.ts · the `tenant_export_jobs.status` state machine (Law 5 — the ONLY
// place a transition is decided). Mirrors the CHECK in db/migrations/0169:
//
//   queued  → running            the worker claimed it (FOR UPDATE SKIP LOCKED, one per tick)
//   running → ready | failed     the file exists with its digest, or a reason code
//   running → queued             a stale claim released: the pod died mid-run and `attempts` counts it
//   ready   → expired            retention passed; the receipt stays, the download stops
//
// There is deliberately NO `cancelled`. An export is a read; cancelling one saves seconds of worker time and adds a
// state the receipt would have to explain. A job nobody wants is left to become `expired` like every other.
import { DomainError } from '../../../shared/errors/app-error';

export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed', 'expired'] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<ExportStatus, readonly ExportStatus[]>> = Object.freeze({
  queued:  ['running'],
  running: ['ready', 'failed', 'queued'],
  ready:   ['expired'],
  failed:  [],
  expired: [],
});

export class IllegalExportTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('EXPORT_ILLEGAL_TRANSITION', `Cannot move export job ${from}→${to}`, 409, { from, to });
  }
}

export function canTransition(from: ExportStatus, to: ExportStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: ExportStatus, to: ExportStatus): void { if (!canTransition(from, to)) throw new IllegalExportTransitionError(from, to); }

/** Waiting or being made — the two states `uq_texp_open_request` treats as "this request is already on the queue". */
export function isOpen(s: ExportStatus): boolean { return s === 'queued' || s === 'running'; }
export function isTerminal(s: ExportStatus): boolean { return s === 'failed' || s === 'expired'; }
/** The file can be fetched: ready AND not past its retention instant. `expires_at` is checked at the moment of the
 *  fetch as well as by the sweep, because the sweep runs on a cadence and a link can be clicked between two ticks. */
export function isDownloadable(s: ExportStatus, expiresAt: Date | null, now: Date): boolean {
  return s === 'ready' && expiresAt !== null && expiresAt.getTime() > now.getTime();
}
