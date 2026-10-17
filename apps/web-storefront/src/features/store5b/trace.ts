// apps/web-storefront/src/features/store5b/trace.ts · PC-56 STORE-5b · C1 / C3 / C7 — THE TRACE PAGES' PURE HALF (no React, no I/O; unit-tested
// in test/store5b-trace.spec.ts).
//
// • THE CHROME (founder D7 / Q15): the trace, verify, export, dairy and certificate pages live under BOTH chromes — the platform's /trace/… and
//   an organisation's /<slug>/trace/… — one screen component per page with a `chrome` prop (the 4a `AccountChrome`); `traceHref` /
//   `certificateHref` are the only places a path is built. On a STORE chrome a lot of ANOTHER organisation is never rendered under this store's
//   mark: `isOwnLot` decides, the page redirects to the platform's own route (`platformTraceHref` — the site's origin when one is configured;
//   never a brand-domain literal).
// • THE STEP LABELS (Law 7, survey F-17): EVERY value of the API's `TRACE_STEPS` (apps/api traceability/domain/traceability.events.ts — the
//   spec reads that file by path) has a `trace.step.<code>` key in all three catalogues; a code nobody labelled reads `trace.step.unknown`,
//   never the raw code.
// • THE META (B15): the allow-listed keys a step may carry, each with a label key; `quantity` + `unit` print together; values are DATA (the
//   organisation's words — a variety, a pack type), printed as given.
// • THE FARMER LINE (founder D4): "Grown by a verified member farmer of <organisation>, <village>" is the ONLY shape — never a person.
// • THE SEAL (founder D3): "sealed by the platform at <time>" only when the seal stamps the chain head as it stands; else "not yet sealed".
import type { AccountChrome } from '../store4a/account';

/** MIRROR of apps/api `TRACE_STEPS` (the spec asserts equality by reading the API source). */
export const TRACE_STEPS = ['harvested', 'listed', 'sold', 'packed', 'picked', 'in_transit', 'delivered', 'recalled'] as const;
export type TraceStep = (typeof TRACE_STEPS)[number];
export const TRACE_STEP_KEYS: Readonly<Record<TraceStep, string>> = Object.freeze({
  harvested: 'trace.step.harvested', listed: 'trace.step.listed', sold: 'trace.step.sold', packed: 'trace.step.packed',
  picked: 'trace.step.picked', in_transit: 'trace.step.in_transit', delivered: 'trace.step.delivered', recalled: 'trace.step.recalled',
});
/** The label key of a step code — never the raw code. */
export function stepLabelKey(code: string): string {
  return (TRACE_STEP_KEYS as Record<string, string>)[code] ?? 'trace.step.unknown';
}

/** MIRROR of the allow-listed meta keys (apps/api trace-meta.ts) and their label keys. */
export const TRACE_META_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  variety: 'trace.meta.variety', season: 'trace.meta.season', gradeLabel: 'trace.meta.gradeLabel', quantity: 'trace.meta.quantity',
  packType: 'trace.meta.packType', packCount: 'trace.meta.packCount', mode: 'trace.meta.mode', reasonCode: 'trace.meta.reasonCode',
});
export interface MetaLine { key: string; labelKey: string; value: string }
/** The event's allow-listed meta as label/value lines, in a fixed order; quantity + unit as one line; unknown keys dropped (never printed). */
export function metaLines(meta: Record<string, string | number> | null | undefined): MetaLine[] {
  const m = meta ?? {};
  const out: MetaLine[] = [];
  for (const k of Object.keys(TRACE_META_LABEL_KEYS)) {
    const v = m[k];
    if (v === undefined || v === null || v === '') continue;
    const value = k === 'quantity' && m.unit !== undefined && m.unit !== '' ? `${v} ${m.unit}` : String(v);
    out.push({ key: k, labelKey: TRACE_META_LABEL_KEYS[k], value });
  }
  return out;
}

/** "3f9a…c21e" — the canon's short hash (the full hash is on the verify page). */
export function shortHash(h: string | null | undefined): string {
  if (!h) return '';
  return h.length <= 10 ? h : `${h.slice(0, 4)}…${h.slice(-4)}`;
}

/** The place as one line ("Vanthali, Junagadh"), or null — never a coordinate (none is ever in the answer). */
export function placeLine(place: { village: string | null; district: string | null } | null | undefined): string | null {
  const parts = [place?.village, place?.district].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return parts.length ? parts.join(', ') : null;
}
/** The ONLY farmer line (founder D4): the organisation, and the village when one is recorded. */
export function farmerLine(org: string, place: { village: string | null; district: string | null } | null | undefined): { key: string; vars: Record<string, string> } {
  const where = placeLine(place);
  return where ? { key: 'store5b.trace.grownBy', vars: { org, place: where } } : { key: 'store5b.trace.grownByOrg', vars: { org } };
}

export type SealState = 'sealed' | 'not_sealed';
export function sealState(anchor: { matchesHead?: boolean; anchoredAt?: string | null } | null | undefined): SealState {
  return anchor?.matchesHead === true && Boolean(anchor.anchoredAt) ? 'sealed' : 'not_sealed';
}

/** What a failed trace read means, by the API's code. */
export type TraceLoad = 'not_found' | 'not_published' | 'no_longer' | 'error';
export function traceFailureOf(code: string | null | undefined, status: number | null | undefined): TraceLoad {
  if (code === 'TRACE_NOT_PUBLISHED') return 'not_published';
  if (code === 'TRACE_NO_LONGER_PUBLISHED') return 'no_longer';
  if (code === 'TRACE_SCAN_NOT_FOUND' || status === 404) return 'not_found';
  return 'error';
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* PATHS UNDER A CHROME                                                                                                                */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
const TOKEN = /^[A-Za-z0-9_-]{4,128}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export type TracePage = '' | 'verify' | 'export' | 'dairy';
const base = (c: AccountChrome) => (c.kind === 'tenant' ? `/${encodeURIComponent(c.slug)}` : '');
const qs = (q: Record<string, string | null | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v !== '') p.set(k, v.slice(0, 160));
  const s = p.toString();
  return s ? `?${s}` : '';
};
export function isTraceToken(t: unknown): t is string { return typeof t === 'string' && TOKEN.test(t); }
export function traceHref(c: AccountChrome, token: string, page: TracePage = '', q: Record<string, string | null | undefined> = {}): string {
  if (!isTraceToken(token)) return '/trace';   // the platform's code-entry page (no store has a /trace of its own)
  return `${base(c)}/trace/${encodeURIComponent(token)}${page ? `/${page}` : ''}${qs(q)}`;
}
/** The trace record's download through THIS app (the signed link beside the session). */
export function traceDownloadHref(c: AccountChrome, token: string, jobId: string, linkToken: string): string {
  if (!isTraceToken(token) || !UUID.test(jobId) || !/^[A-Za-z0-9._~-]{16,2048}$/.test(linkToken)) return traceHref(c, token, 'export');
  return `${base(c)}/trace/${encodeURIComponent(token)}/export/${jobId}/download?token=${encodeURIComponent(linkToken)}`;
}
export function certificateHref(c: AccountChrome, id: string, q: { lot?: string | null } = {}): string {
  if (!UUID.test(id)) return `${base(c)}/certificates`;
  return `${base(c)}/certificates/${id}${qs({ lot: isTraceToken(q.lot) ? q.lot : null })}`;
}
export function certificateLookupHref(c: AccountChrome, q: { no?: string | null; org?: string | null } = {}): string {
  return `${base(c)}/certificates${qs({ no: q.no ?? null, org: c.kind === 'platform' ? q.org ?? null : null })}`;
}

/** Is this lot THIS store's (the slug the answer names)? On the platform chrome every lot is shown. */
export function isOwnLot(c: AccountChrome, lotSlug: string | null | undefined): boolean {
  return c.kind === 'platform' || (typeof lotSlug === 'string' && lotSlug === c.slug);
}
/** The platform's own route for a lot (a store host's request for another organisation's lot goes here) — the configured site origin, or the
 *  path alone (path mode). Never a brand-domain literal. */
export function platformTraceHref(siteUrl: string, token: string, page: TracePage = ''): string {
  const origin = /^https?:\/\/[^/\s]+$/i.test(siteUrl.replace(/\/+$/, '')) ? siteUrl.replace(/\/+$/, '') : '';
  return `${origin}/trace/${encodeURIComponent(token)}${page ? `/${page}` : ''}`;
}
export function platformCertificateHref(siteUrl: string, id: string): string {
  const origin = /^https?:\/\/[^/\s]+$/i.test(siteUrl.replace(/\/+$/, '')) ? siteUrl.replace(/\/+$/, '') : '';
  return `${origin}/certificates/${id}`;
}

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE EXPORT (W3154 / W3155)                                                                                                         */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
export interface TraceJobLike {
  id: string; status: string; requestedBy?: string;
  standing?: { position?: number; eta?: { kind: string; seconds?: number } } | null;
  receipt?: { fileName: string; rowCount: number; sha256: string; generatedAt: string; requestedBy: string } | null;
  failure?: { code: string } | null; expiresAt?: string | null;
  download?: { kind: string; linkTtlSec?: number } | null;
}
export type ExportPhase = 'queued' | 'running' | 'ready' | 'expired' | 'failed';
export interface TraceExportView {
  phase: ExportPhase; jobId: string; position: number | null; etaSeconds: number | null;
  receipt: { fileName: string; rowCount: number; sha256: string; generatedAt: string; requestedByYou: boolean } | null;
  failureCode: string | null; downloadable: boolean; linkTtlSec: number | null; expiresAt: string | null;
}
export function traceExportView(j: TraceJobLike, meId: string | null): TraceExportView {
  const phase: ExportPhase = (['queued', 'running', 'ready', 'expired', 'failed'] as const).includes(j.status as ExportPhase) ? (j.status as ExportPhase) : 'queued';
  const eta = j.standing?.eta;
  return {
    phase, jobId: j.id,
    position: typeof j.standing?.position === 'number' ? j.standing.position : null,
    etaSeconds: eta && eta.kind === 'estimate' && typeof eta.seconds === 'number' ? eta.seconds : null,
    receipt: j.receipt ? { fileName: j.receipt.fileName, rowCount: j.receipt.rowCount, sha256: j.receipt.sha256, generatedAt: j.receipt.generatedAt,
      requestedByYou: meId !== null && j.receipt.requestedBy === meId } : null,
    failureCode: j.failure?.code ?? null,
    downloadable: j.download?.kind === 'available',
    linkTtlSec: j.download?.kind === 'available' && typeof j.download.linkTtlSec === 'number' ? j.download.linkTtlSec : null,
    expiresAt: j.expiresAt ?? null,
  };
}
/** A failed enqueue, by name. */
export type ExportFailure = 'unavailable' | 'not_published' | 'no_longer' | 'not_found' | 'signin' | 'server';
export const EXPORT_FAILURES: readonly ExportFailure[] = ['unavailable', 'not_published', 'no_longer', 'not_found', 'signin', 'server'];
export function exportFailureOf(code: string | null | undefined, status: number | null | undefined): ExportFailure {
  if (code === 'TRACE_EXPORT_UNAVAILABLE' || status === 503) return 'unavailable';
  if (code === 'TRACE_NOT_PUBLISHED') return 'not_published';
  if (code === 'TRACE_NO_LONGER_PUBLISHED') return 'no_longer';
  if (code === 'TRACE_SCAN_NOT_FOUND' || status === 404) return 'not_found';
  if (status === 401) return 'signin';
  return 'server';
}
const KEY = /^trace-export:[0-9a-f-]{36}$/;
/** The key carried back on a Retry (the SAME key — one job however often it is pressed), or null for a fresh one. */
export function carriedExportKey(raw: unknown): string | null { return typeof raw === 'string' && KEY.test(raw) ? raw : null; }
