// apps/web-storefront/src/features/store4a/data-rights.ts · PC-56 STORE-4a · C4 / C5 / C6 — "Download my data" (W3029 / W3030) and the deletion
// request (the W3031–W3033 shape, DELTA) — the pure half. No React, no Next, no I/O; unit-tested in test/store4a-account.spec.ts.
//
// • THE EXPORT (founder D2): the newest export request's `export` IS the export plane's live job — queued (position + the plane's honest ETA:
//   an `estimate` in seconds, or `no_history` — "no estimate yet"), running, ready (the receipt: file, rows, sha256, generated-at, requester),
//   expired (the file is gone after the plane's retention), failed (the plane's code, by name). Nothing here invents a state.
// • THE DELETION (founder D1 / D3): `privacy.commitments()` decides — blocked → the figures and NO submit; allowed → what is kept and for how
//   long (the platform setting), the cooling days, "this action is recorded". The request's own `coolingEndsAt` is printed once it exists.
// • NO MONEY ARITHMETIC: escrow and wallet are the API's strings, printed in the data's currency at render.
export type ExportPhase = 'none' | 'queued' | 'running' | 'ready' | 'expired' | 'failed';
export interface ExportReceiptView { fileName: string; rowCount: number; sha256: string; generatedAt: string; requestedByYou: boolean; byteSize: number }
export interface ExportView {
  phase: ExportPhase; requestId: string | null; jobId: string | null;
  position: number | null; etaSeconds: number | null; receipt: ExportReceiptView | null; failureCode: string | null; downloadable: boolean; expiresAt: string | null;
  /** The link's life as the PLANE says it (`download.linkTtlSec`) — never a literal on the page. */
  linkTtlSec: number | null;
}
type ReqLike = { id: string; kind: string; status: string; requestedAt?: string | null; coolingEndsAt?: string | null; export?: {
  jobId: string; status: string; standing?: { position: number; eta: { kind: string; seconds?: number } } | null;
  receipt?: { fileName: string; rowCount: number; sha256: string; generatedAt: string; requestedBy: string; byteSize?: number } | null;
  download?: { kind: string; linkTtlSec?: number } | null; failure?: { code: string } | null; expiresAt?: string | null } | null };

/** The newest EXPORT request (the API lists newest first) as the page draws it. `meId` decides "requester: you" — the receipt names the
 *  requester by id; a receipt for anyone else is never drawn as yours (the API serves only the requester's own, this says so twice). */
export function exportView(requests: readonly ReqLike[], meId: string | null): ExportView {
  const r = requests.find((x) => x.kind === 'export');
  const none: ExportView = { phase: 'none', requestId: null, jobId: null, position: null, etaSeconds: null, receipt: null, failureCode: null, downloadable: false, expiresAt: null, linkTtlSec: null };
  if (!r || !r.export) return r ? { ...none, requestId: r.id } : none;
  const e = r.export;
  const phase: ExportPhase = (['queued', 'running', 'ready', 'expired', 'failed'] as const).includes(e.status as 'queued') ? (e.status as ExportPhase) : 'none';
  const receipt = e.receipt ? { fileName: e.receipt.fileName, rowCount: e.receipt.rowCount, sha256: e.receipt.sha256, generatedAt: e.receipt.generatedAt,
    requestedByYou: !!meId && e.receipt.requestedBy === meId, byteSize: e.receipt.byteSize ?? 0 } : null;
  const eta = e.standing?.eta;
  return {
    phase, requestId: r.id, jobId: e.jobId,
    position: phase === 'queued' && e.standing ? e.standing.position : null,
    etaSeconds: phase === 'queued' && eta && eta.kind === 'estimate' && typeof eta.seconds === 'number' ? eta.seconds : null,
    receipt, failureCode: phase === 'failed' ? (e.failure?.code ?? 'unknown') : null,
    downloadable: phase === 'ready' && e.download?.kind === 'available' && !!receipt, expiresAt: e.expiresAt ?? null,
    linkTtlSec: e.download?.kind === 'available' && typeof e.download.linkTtlSec === 'number' ? e.download.linkTtlSec : null,
  };
}
/** The ETA in whole minutes, rounded UP (a time, not money); null = "no estimate yet" (the plane has no history — unknown is not zero). */
export function etaMinutes(seconds: number | null): number | null { return seconds === null || !Number.isFinite(seconds) || seconds < 0 ? null : Math.max(1, Math.ceil(seconds / 60)); }
/** May a NEW export be requested? Only when none is open (queued / running) — a second request while one is open is the SAME job anyway. */
export function canRequestExport(v: ExportView): boolean { return v.phase === 'none' || v.phase === 'expired' || v.phase === 'failed'; }
/** The plane's failure codes the page names (anything else → generic). */
export const EXPORT_FAILURE_CODES = ['unknown_dataset', 'dataset_disabled', 'producer_failed', 'storage_failed', 'too_many_attempts'] as const;
export function exportFailureKey(code: string | null): string { return code && (EXPORT_FAILURE_CODES as readonly string[]).includes(code) ? `store4a.data.failure.${code}` : 'store4a.data.failure.generic'; }
/** A refused download / mint, by name (the plane logged it already). */
export const DOWNLOAD_ERRORS = ['refused_expired', 'refused_bad_signature', 'refused_wrong_job', 'refused_no_token', 'refused_file_expired', 'refused_not_ready', 'EXPORT_FILE_EXPIRED', 'EXPORT_NOT_READY', 'link'] as const;
export function downloadErrorKey(code: string | null): string {
  if (!code) return 'store4a.data.downloadError.generic';
  if (code === 'refused_expired') return 'store4a.data.downloadError.linkExpired';
  if (code === 'refused_file_expired' || code === 'EXPORT_FILE_EXPIRED') return 'store4a.data.downloadError.fileExpired';
  if (code === 'refused_not_ready' || code === 'EXPORT_NOT_READY') return 'store4a.data.downloadError.notReady';
  return 'store4a.data.downloadError.generic';
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE DELETION REQUEST                                                                                                                */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export interface CommitmentsLike { openOrders: number; escrowMinor: string; walletMinor: string; currencyCode: string | null; multiCurrency: boolean; invoiceCount: number; blocked: boolean; retentionYears: number | null; coolingDays: number }
export interface DeletionView {
  blocked: boolean; openOrders: number; escrowMinor: string | null; walletMinor: string | null; currencyCode: string | null; multiCurrency: boolean;
  invoiceCount: number; retentionYears: number | null; coolingDays: number;
}
const POS = /^[1-9]\d*$/;
/** The confirm's body. A money line is drawn only when its figure is above zero (a string the API gave — compared, never computed). */
export function deletionView(c: CommitmentsLike): DeletionView {
  return {
    blocked: c.blocked, openOrders: c.openOrders,
    escrowMinor: POS.test(c.escrowMinor) ? c.escrowMinor : null, walletMinor: POS.test(c.walletMinor) ? c.walletMinor : null,
    currencyCode: c.currencyCode, multiCurrency: c.multiCurrency, invoiceCount: c.invoiceCount, retentionYears: c.retentionYears, coolingDays: c.coolingDays,
  };
}
/** The open deletion request, if any (one per person — the API dedupes). */
export function openDeletion(requests: readonly ReqLike[]): { id: string; status: string; coolingEndsAt: string | null } | null {
  const r = requests.find((x) => x.kind === 'deletion' && (x.status === 'open' || x.status === 'in_progress'));
  return r ? { id: r.id, status: r.status, coolingEndsAt: r.coolingEndsAt ?? null } : null;
}
export const DELETE_FAILURES = ['blocked', 'concurrency', 'server'] as const;
export type DeleteFailure = (typeof DELETE_FAILURES)[number];
export function deleteFailureOf(code: string | null, status: number | null): DeleteFailure {
  if (code === 'DSR_BLOCKED') return 'blocked';
  if (status === 409) return 'concurrency';
  return 'server';
}
