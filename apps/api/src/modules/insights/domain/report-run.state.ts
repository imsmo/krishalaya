// modules/insights/domain/report-run.state.ts · PC-56 TENANT-SW-f · the report run's status machine (Law 5). Mirrors 0202's
// `ck_rr_status`: queued → running → ready | failed | refused, and queued → refused | failed (a run refused before it reads, e.g. its
// dataset switched off since it was asked for). ready / failed / refused are terminal — a retry is a NEW run (the console's "Retry").
import { AppError } from '../../../shared/errors/app-error';

export const REPORT_RUN_STATUSES = ['queued', 'running', 'ready', 'failed', 'refused'] as const;
export type ReportRunStatus = (typeof REPORT_RUN_STATUSES)[number];

const TRANSITIONS: Readonly<Record<ReportRunStatus, readonly ReportRunStatus[]>> = Object.freeze({
  queued: ['running', 'refused', 'failed'],
  running: ['ready', 'failed', 'refused'],
  ready: [],
  failed: [],
  refused: [],
});

export class IllegalReportRunTransitionError extends AppError {
  constructor(from: string, to: string) { super('REPORT_RUN_ILLEGAL_TRANSITION', `Cannot move a report run ${from}→${to}`, 409, { from, to }); }
}
export function canTransition(from: ReportRunStatus, to: ReportRunStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: ReportRunStatus, to: ReportRunStatus): void { if (!canTransition(from, to)) throw new IllegalReportRunTransitionError(from, to); }
export function isTerminal(s: ReportRunStatus): boolean { return TRANSITIONS[s].length === 0; }
