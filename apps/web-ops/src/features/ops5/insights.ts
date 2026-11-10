// apps/web-ops/src/features/ops5/insights.ts · PC-56 OPS-5b · THE ORGANISATION'S MILK, IN NUMBERS — the pure helpers of W369 (`/insights`) and
// its two chains: the window, the addresses, the page and job states, and the two NOTATION helpers that put a server figure in the unit a person
// reads (milli-kg -> kg by moving the decimal point; the rate's centi-minor -> whole minor units for formatMoneyMinor, rounded half-up exactly as the
// organisation's console does — `web-tenant/src/features/dairy/insights.ts` ratePerLitreMinor — so one figure reads the same on both consoles).
// NOTHING ELSE IS COMPUTED: no sum, difference, share, %, goal, forecast, run or rank (brief §D "Numbers"; the view holds no arithmetic — pinned
// by test/ops5b-pages.spec.ts).
import type { DairyInsightWindow, ExportJob } from '@krishalaya/sdk-js';

export const INSIGHTS_PATH = '/insights';
export const INSIGHT_WINDOWS: readonly DairyInsightWindow[] = [30, 90, 180];
export const DEFAULT_WINDOW: DairyInsightWindow = 90;
const one = (v: unknown): string | undefined => (Array.isArray(v) ? (v[0] as string | undefined) : typeof v === 'string' ? v : undefined);

/** The window a person asked for — one of the server's three, else the server's default (90). */
export function windowParam(v: unknown): DairyInsightWindow {
  const s = one(v);
  return s === '30' ? 30 : s === '180' ? 180 : s === '90' ? 90 : DEFAULT_WINDOW;
}
export function insightsHref(w: DairyInsightWindow): string { return `${INSIGHTS_PATH}?window=${w}`; }
/** The insights re-read chain (W3323–W3325) — a query state of W369. */
export function actHref(w: DairyInsightWindow, state: 'confirm' | 'success' | 'failure'): string { return `${INSIGHTS_PATH}?act=${state}&window=${w}`; }
/** The export job's page (W3321 / W3322) — a query state of W369; the PLANE decides which of the two it is. */
export function exportHref(jobId: string, w: DairyInsightWindow): string { return `${INSIGHTS_PATH}?export=${encodeURIComponent(jobId)}&window=${w}`; }
/** The download route: a POST that mints the audited link and pipes the logged fetch. */
export function downloadPath(jobId: string): string { return `${INSIGHTS_PATH}/exports/${encodeURIComponent(jobId)}/download`; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function jobParam(v: unknown): string | null { const s = one(v); return s && UUID.test(s) ? s.toLowerCase() : null; }

/** A transport answer as a page state: 404 -> switched off (the `dairy` module flag on the route), 403 -> refused, anything else -> error. */
export type InsightsTransport = 'off' | 'forbidden' | 'error';
export function transportState(status: number | 'failed'): InsightsTransport {
  return status === 404 ? 'off' : status === 403 ? 'forbidden' : 'error';
}

/** Milli-kg (the server's three-place convention) -> kg, by moving the decimal point. Exact: no rounding, no float. Null for anything else. */
export function kgText(milli: unknown): string | null {
  const s = typeof milli === 'string' || typeof milli === 'bigint' ? String(milli) : '';
  const m = /^(-?)(\d+)$/.exec(s);
  if (!m) return null;
  const digits = m[2].padStart(4, '0');
  const whole = digits.slice(0, -3).replace(/^0+(?=\d)/, '');
  return `${m[1]}${whole}.${digits.slice(-3)}`;
}

/** The server's rate per kg in CENTI-minor units (two extra places, for comparing windows) -> whole minor units for formatMoneyMinor, rounded
 *  half-up on the magnitude (the organisation's console's own rule). Null for anything that is not an integer string. */
export function rateMinor(centiMinor: unknown): string | null {
  const s = typeof centiMinor === 'string' ? centiMinor : '';
  if (!/^-?\d+$/.test(s)) return null;
  const c = BigInt(s); const neg = c < 0n; const minor = ((neg ? -c : c) + 50n) / 100n;
  return `${neg && minor > 0n ? '-' : ''}${minor}`;
}

/** A sha256 in groups of eight, for a person to compare by eye (the characters unchanged). */
export function shaGroups(sha: unknown): string {
  return typeof sha === 'string' ? (sha.match(/.{1,8}/g) ?? []).join(' ') : '';
}

/** The export job's state as the plane says it. A job of ANOTHER dataset is not this page's: `notFound`. */
export const INSIGHTS_DATASET = 'dairy.insights';
export type ExportJobState = 'queued' | 'ready' | 'failed' | 'expired';
export function exportJobState(job: Pick<ExportJob, 'status' | 'datasetCode'>): ExportJobState | 'notFound' {
  if (job.datasetCode !== INSIGHTS_DATASET) return 'notFound';
  if (job.status === 'queued' || job.status === 'running') return 'queued';
  if (job.status === 'ready') return 'ready';
  if (job.status === 'expired') return 'expired';
  return 'failed';
}
/** A refused job read: the plane switched off (`EXPORT_PLANE_DISABLED`) or the `dairy` module off (404) -> `off`; no such job -> `notFound`. */
export function exportTransport(status: number | 'failed', code: string | null): 'off' | 'forbidden' | 'notFound' | 'error' {
  if (code === 'EXPORT_JOB_NOT_FOUND') return 'notFound';
  if (status === 404) return 'off';
  if (status === 403) return 'forbidden';
  return 'error';
}

/** "requester as you": the receipt names a user id; the page says only whether it is the person signed in. */
export function requesterKey(requestedBy: unknown, meId: string | null): string {
  if (!meId || typeof requestedBy !== 'string') return 'ops5.ins.export.requester.unknown';
  return requestedBy === meId ? 'ops5.ins.export.requester.you' : 'ops5.ins.export.requester.another';
}

/** The enqueue's refusal, carried back to W369 as a word (never the API's English). */
export const EXPORT_ERRORS = ['off', 'forbidden', 'failed'] as const;
export type ExportError = typeof EXPORT_ERRORS[number];
export function exportErrorOf(status: number | 'failed', code: string | null): ExportError {
  if (code === 'EXPORT_PLANE_DISABLED' || status === 404) return 'off';
  if (status === 403) return 'forbidden';
  return 'failed';
}
export function exportErrorParam(v: unknown): ExportError | null { const s = one(v); return (EXPORT_ERRORS as readonly string[]).includes(s ?? '') ? (s as ExportError) : null; }

/** The download route's refusal, carried back to the job page: the plane's own outcome names, else `failed`. */
export const DOWNLOAD_ERRORS = ['notReady', 'expired', 'link', 'failed'] as const;
export type DownloadError = typeof DOWNLOAD_ERRORS[number];
export function downloadErrorOf(code: string | null): DownloadError {
  if (code === 'EXPORT_NOT_READY' || code === 'refused_not_ready') return 'notReady';
  if (code === 'EXPORT_FILE_EXPIRED' || code === 'refused_file_expired' || code === 'refused_expired') return 'expired';
  if (code && code.startsWith('refused_')) return 'link';
  return 'failed';
}
export function downloadErrorParam(v: unknown): DownloadError | null { const s = one(v); return (DOWNLOAD_ERRORS as readonly string[]).includes(s ?? '') ? (s as DownloadError) : null; }
/** The download route's cross-site refusal (lead QA, OPS-5b): a POST whose Origin names another host — or an Origin that is not a URL — is
 *  cross-site; no Origin at all is a same-site form post. Pure, so the refusal is unit-tested rather than only read in the route's source. */
export function crossSite(origin: string | null, host: string): boolean {
  if (origin === null) return false;
  try { return new URL(origin).host !== host; } catch { return true; }
}

/** A shift's name in words (the API's two; anything else is shown as "another shift" — never a raw code). */
export function shiftKey(shift: string): string { return shift === 'morning' || shift === 'evening' ? `ops5.ins.shift.${shift}` : 'ops5.ins.shift.other'; }
/** An animal type in words. */
export function animalKey(a: string): string { return a === 'cow' || a === 'buffalo' || a === 'mixed' ? `ops5.ins.animal.${a}` : 'ops5.ins.animal.other'; }
