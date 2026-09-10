// apps/web-tenant/src/features/dairy/exports.ts · W2553 (export queued) + W2554 (export ready), as sentences —
// PC-56 TENANT-6e-2. Pure.
//
// THE PAGE IS ONE ROUTE WITH THE JOB'S STATE DECIDING WHICH CANON SCREEN IT IS. W2553 and W2554 are the canon's shared
// "chain-export" pattern: one job, two pages. The console draws them as one URL (`/dairy/insights/exports/[id]`) whose
// body is the queued state while the file is being made and the receipt once it exists — because "Check ready page" on
// W2553 is, in code, a reload of the job, and a second URL for the ready state would be a link that 404s until the
// worker has run.
//
// WHAT EVERY HELPER HERE REFUSES TO DO: turn an unknown into a number. The ETA is `no_history` until the platform has
// finished an export, and the page says "no estimate yet" — never "0 s". The position is 1-based, because "you are
// number 0" is a sentence nobody says.
import type { ExportEta, ExportJob } from '@krishalaya/sdk-js';

export const EXPORTS_HREF = '/dairy/insights/exports';
export function exportHref(id: string): string { return `${EXPORTS_HREF}/${encodeURIComponent(id)}`; }
export function exportDownloadHref(id: string, token: string): string { return `${exportHref(id)}/download?token=${encodeURIComponent(token)}`; }

/* ------------------------------------------------------------------------------------------------------------- */
/* THE PAGE'S OWN STATE — six states, four of them the job's                                                     */
/* ------------------------------------------------------------------------------------------------------------- */

/**
 * `queued` and `running` are W2553; `ready` and `expired` are W2554 (the receipt stays on an expired job — the word
 * changes, the numbers do not); `failed` is honest and names its code; `notEnabled` is the plane's flag (or the dairy
 * module's) OFF, which arrives as a 404 with a CODE the page can distinguish from a mistyped id; `restricted` a member
 * without `dairy.manage`; `notFound` a job this tenant does not own (RLS, 404 without the plane's code); `error` transport.
 */
export type ExportPageState = 'queued' | 'running' | 'ready' | 'expired' | 'failed' | 'notEnabled' | 'restricted' | 'notFound' | 'error';

export function exportTransportState(code: string | null | undefined, status?: number): ExportPageState | null {
  if (!code && status === undefined) return null;
  if (code === 'FORBIDDEN' || status === 403) return 'restricted';
  // The plane's own refusal carries its code; a bare 404 is the module guard (dairy OFF) or a job that is not ours.
  if (code === 'EXPORT_PLANE_DISABLED') return 'notEnabled';
  if (code === 'EXPORT_JOB_NOT_FOUND') return 'notFound';
  if (code === 'NOT_FOUND' || status === 404) return 'notEnabled';
  return 'error';
}

export function exportState(job: ExportJob): ExportPageState {
  switch (job.status) {
    case 'queued': return 'queued';
    case 'running': return 'running';
    case 'ready': return 'ready';
    case 'expired': return 'expired';
    case 'failed': return 'failed';
  }
}
export function exportStateKey(s: ExportPageState): string { return `dairy.export.state.${s}`; }

/** Which canon screen the state IS, so the title can say "Export queued" or "Export ready" in the canon's own words. */
export function exportTitleKey(s: ExportPageState): string {
  return s === 'ready' || s === 'expired' ? 'dairy.export.title.ready' : s === 'failed' ? 'dairy.export.title.failed' : 'dairy.export.title.queued';
}

/* ------------------------------------------------------------------------------------------------------------- */
/* POSITION AND ETA                                                                                              */
/* ------------------------------------------------------------------------------------------------------------- */

/** *"no estimate yet"* or a duration — and the duration is the estimate's own seconds, ceiled upward by the API. */
export function etaKey(eta: ExportEta): string { return eta.kind === 'no_history' ? 'dairy.export.eta.none' : 'dairy.export.eta.estimate'; }

/**
 * Seconds to a coarse human duration: under a minute in seconds, under an hour in whole minutes ROUNDED UP, else hours
 * and minutes. Rounded up throughout: an estimate that reads "1 min" for 90 seconds is the estimate somebody refreshes on.
 */
export function etaParts(seconds: number): { unit: 'seconds' | 'minutes' | 'hours'; value: number; minutes?: number } {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return { unit: 'seconds', value: s };
  const m = Math.ceil(s / 60);
  if (m < 60) return { unit: 'minutes', value: m };
  return { unit: 'hours', value: Math.floor(m / 60), minutes: m % 60 };
}
export function etaUnitKey(unit: 'seconds' | 'minutes' | 'hours'): string { return `dairy.export.eta.unit.${unit}`; }

/* ------------------------------------------------------------------------------------------------------------- */
/* THE RECEIPT, THE FAILURE, THE DOWNLOAD                                                                        */
/* ------------------------------------------------------------------------------------------------------------- */

/** The failure code's sentence. Unknown codes get the generic one — with the code itself printed beside it in mono. */
export const EXPORT_FAILURE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  unknown_dataset: 'dairy.export.failure.unknownDataset',
  dataset_disabled: 'dairy.export.failure.datasetDisabled',
  money_shape_missing: 'dairy.export.failure.moneyShapeMissing',
  producer_failed: 'dairy.export.failure.producerFailed',
  storage_failed: 'dairy.export.failure.storageFailed',
  too_many_attempts: 'dairy.export.failure.tooManyAttempts',
});
export function failureKeyFor(code: string): string { return EXPORT_FAILURE_KEYS[code] ?? 'dairy.export.failure.generic'; }

/** What the download control says when it is not a button. */
export function downloadStateKey(d: ExportJob['download']): string | null {
  switch (d.kind) {
    case 'available': return null;
    case 'not_ready': return 'dairy.export.download.notReady';
    case 'file_expired': return 'dairy.export.download.fileExpired';
    case 'failed': return 'dairy.export.download.failed';
  }
}

/** The download route's own refusals, carried back to the page as `?error=` — each a sentence, none a stack trace. */
export const DOWNLOAD_OUTCOME_KEYS: Readonly<Record<string, string>> = Object.freeze({
  refused_expired: 'dairy.export.refused.expired',
  refused_no_token: 'dairy.export.refused.noToken',
  refused_bad_signature: 'dairy.export.refused.badSignature',
  refused_wrong_job: 'dairy.export.refused.wrongJob',
  refused_not_ready: 'dairy.export.refused.notReady',
  refused_file_expired: 'dairy.export.refused.fileExpired',
  storage_failed: 'dairy.export.refused.storage',
});
export function downloadErrorKey(codeOrOutcome: string | null | undefined): string | null {
  if (!codeOrOutcome) return null;
  return DOWNLOAD_OUTCOME_KEYS[codeOrOutcome] ?? (codeOrOutcome === 'EXPORT_FILE_EXPIRED' ? 'dairy.export.refused.fileExpired' : codeOrOutcome === 'EXPORT_NOT_READY' ? 'dairy.export.refused.notReady' : 'dairy.export.refused.generic');
}

/** A sha256 as the eye reads it: groups of eight, so two receipts can be compared by a person without counting sixty-four
 *  characters. The value is unchanged — spaces only. */
export function shaGroups(sha: string): string { return sha.replace(/(.{8})(?=.)/g, '$1 '); }

/** Bytes to a coarse size with the unit KEY, never a locale-formatted float: `1234` → `{ value: 2, unit: 'kb' }`. Rounded
 *  UP, so a 1,025-byte file is never "1 KB" when it will not fit in one. */
export function byteParts(bytes: number): { value: number; unit: 'b' | 'kb' | 'mb' | 'gb' } {
  if (bytes < 1024) return { value: bytes, unit: 'b' };
  if (bytes < 1024 ** 2) return { value: Math.ceil(bytes / 1024), unit: 'kb' };
  if (bytes < 1024 ** 3) return { value: Math.ceil(bytes / 1024 ** 2), unit: 'mb' };
  return { value: Math.ceil(bytes / 1024 ** 3), unit: 'gb' };
}
export function byteUnitKey(unit: 'b' | 'kb' | 'mb' | 'gb'): string { return `dairy.export.bytes.${unit}`; }

/** The enqueue's refusal, carried back to W172 as `?exportError=`. */
export function exportEnqueueErrorKey(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case 'EXPORT_PLANE_DISABLED': return 'dairy.export.enqueue.planeOff';
    case 'FORBIDDEN': return 'dairy.export.enqueue.forbidden';
    case 'EXPORT_TOO_MANY_OPEN': return 'dairy.export.enqueue.tooMany';
    case 'NOT_FOUND': return 'dairy.export.enqueue.moduleOff';
    default: return 'dairy.export.enqueue.generic';
  }
}
