// apps/web-admin/src/features/catalogue/translations.ts · the TRANSLATIONS plane, console side
// (PC-56 ADMIN-3b, canon W028).
//
// THE ONE THING THIS FILE MUST NEVER DO is let a draft read as live text. Everything else here is form shape.
//
// `isServable` is duplicated from admin-api's domain deliberately — see that file's own note. The SQL in apps/api
// ENFORCES; admin-api's copy and this one LABEL. All three are asserted against the same four cases in their own specs,
// so a change to any of them fails the others.
//
// DEV-60 (UI Port Program batch 3, Part 1, Slice A): `stateClass`/`coverageClass` now return a `StatusTone` instead
// of a raw `kv-status--X` string — disposition (c), same pattern as `ai-governance.ts`. Call sites render
// `<StatusPill tone={...} label={...} />`.

import type { StatusTone } from '@krishalaya/ui';

export const REVIEW_DECISIONS = ['approve', 'approve_with_edit', 'reject'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const TRANSLATABLE_ENTITIES = [
  'category', 'attribute', 'attribute_option', 'lookup_value', 'scheme', 'region', 'listing', 'insurance_claim',
] as const;

export const MIN_REASON = 10;
export const MAX_TEXT = 4000;

export interface TranslationRow {
  id: string; entityType: string; entityId: string; field: string; languageCode: string; text: string;
  isMachine: boolean; source?: string | null;
  reviewedBy?: string | null; reviewedAt?: string | null; reviewNote?: string | null;
  createdAt?: string | null; sourceText?: string | null;
  stateNote?: string | null; reviewableByYou?: boolean; servable?: boolean;
}
export interface CoverageRow {
  entityType: string; keys: number;
  byLanguage: Array<{ languageCode: string; translated: number; pct: number | null }>;
}
export interface LanguageRow { code: string; nameNative: string; nameEnglish: string }
export interface ReviewerRow {
  id: string; adminUserId: string; languageCode: string; grantedBy: string; grantedAt: string;
  revokedAt?: string | null; note?: string | null; isLive?: boolean;
}
export interface RunRow {
  id: string; entityTypes: string[]; languageCodes: string[]; gapCount: number; status: string;
  producedCount: number | null; detail?: string | null; requestedAt: string; reason: string;
}

/* ------------------------------------------------------------------ reading */

/** ONLY a human row, or a reviewed machine row, is servable. An unknown shape is NOT — the safe reading. */
export function isServable(row: Pick<TranslationRow, 'isMachine' | 'reviewedAt'>): boolean {
  if (row.isMachine !== true) return true;
  return !!row.reviewedAt;
}

/** The rows the queue is for. */
export function isAwaitingReview(row: Pick<TranslationRow, 'isMachine' | 'reviewedAt'>): boolean {
  return row.isMachine === true && !row.reviewedAt;
}

/** The status class for a row. A DRAFT is amber, not green — it is not an error and it is not live either, and the
 *  distinction is the whole point of the screen. */
export function stateTone(row: Pick<TranslationRow, 'isMachine' | 'reviewedAt'>): StatusTone {
  if (row.isMachine !== true) return 'success';
  return row.reviewedAt ? 'success' : 'warning';
}

/** The i18n key for a row's state. */
export function stateKey(row: Pick<TranslationRow, 'isMachine' | 'reviewedAt'>): 'human' | 'reviewed' | 'draft' {
  if (row.isMachine !== true) return 'human';
  return row.reviewedAt ? 'reviewed' : 'draft';
}

/**
 * A coverage cell's CSS class. `null` — no keys — is styled as NEUTRAL, never as a failure: a red cell next to a kind
 * nobody has created yet is a criticism of nothing, and it would sit there for ever.
 */
export function coverageTone(pct: number | null): StatusTone {
  if (pct === null) return 'neutral';
  if (pct >= 90) return 'success';
  if (pct >= 40) return 'warning';
  return 'danger';
}

/** A percentage as text, or null when the question does not apply. NEVER "0%" for a kind with no keys. */
export function pctText(pct: number | null): string | null {
  return pct === null ? null : `${pct}%`;
}

/** Languages a row's reviewer may act on — used to render the form or a reason it is absent, never a disabled button. */
export function canReview(row: TranslationRow, scopes: readonly string[]): boolean {
  if (typeof row.reviewableByYou === 'boolean') return row.reviewableByYou;
  return scopes.includes(row.languageCode);
}

/** Total drafts pending across languages — the number that must not be confused with coverage. */
export function totalPending(rows: ReadonlyArray<{ pending: number }>): number {
  return rows.reduce((a, r) => a + Number(r.pending || 0), 0);
}

/* ------------------------------------------------------------------ forms */

export type FormBag = (name: string) => string;
export type FormMulti = (name: string) => string[];
export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANG_RE = /^[a-z]{2}(-[a-z0-9]{2,8})?$/i;

function reason(get: FormBag): string | null {
  const r = get('reason').trim();
  return r.length >= MIN_REASON && r.length <= 1000 ? r : null;
}

export interface TranslationPayload {
  entityType: string; entityId: string; field: string; languageCode: string; text: string; reason: string;
}

export function buildTranslation(get: FormBag): Built<TranslationPayload> {
  const entityType = get('entityType').trim();
  if (!(TRANSLATABLE_ENTITIES as readonly string[]).includes(entityType)) return { ok: false, error: 'entityType' };
  const entityId = get('entityId').trim();
  if (!UUID_RE.test(entityId)) return { ok: false, error: 'entityId' };
  const field = get('field').trim().toLowerCase();
  if (field.length < 2 || field.length > 60) return { ok: false, error: 'field' };
  const languageCode = get('languageCode').trim().toLowerCase();
  if (!LANG_RE.test(languageCode)) return { ok: false, error: 'language' };
  // TRIMMED ONLY. No normalising: Indic combining marks and joiners are meaning, not noise.
  const text = get('text').trim();
  if (text.length < 1) return { ok: false, error: 'text' };
  if (text.length > MAX_TEXT) return { ok: false, error: 'textLong' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  return { ok: true, value: { entityType, entityId, field, languageCode, text, reason: r } };
}

export interface ReviewPayload { decision: string; text?: string; note?: string }

/** The three-way review. `approve_with_edit` needs both the text and a note; `reject` needs a note and NO text. Checked
 *  here so the operator does not lose their typing to a round trip. */
export function buildReview(get: FormBag): Built<ReviewPayload> {
  const decision = get('decision').trim();
  if (!(REVIEW_DECISIONS as readonly string[]).includes(decision)) return { ok: false, error: 'decision' };
  const text = get('text').trim();
  const note = get('note').trim();
  if (decision === 'approve_with_edit') {
    if (!text) return { ok: false, error: 'editText' };
    if (text.length > MAX_TEXT) return { ok: false, error: 'textLong' };
    if (note.length < MIN_REASON) return { ok: false, error: 'editNote' };
    return { ok: true, value: { decision, text, note } };
  }
  if (decision === 'reject') {
    if (text) return { ok: false, error: 'rejectText' };
    if (note.length < MIN_REASON) return { ok: false, error: 'rejectNote' };
    return { ok: true, value: { decision, note } };
  }
  if (text) return { ok: false, error: 'approveText' };
  return { ok: true, value: note ? { decision, note } : { decision } };
}

export interface GrantPayload { adminUserId: string; languageCode: string; note?: string; reason: string }

export function buildGrant(get: FormBag): Built<GrantPayload> {
  const adminUserId = get('adminUserId').trim();
  if (!UUID_RE.test(adminUserId)) return { ok: false, error: 'adminUserId' };
  const languageCode = get('languageCode').trim().toLowerCase();
  if (!LANG_RE.test(languageCode)) return { ok: false, error: 'language' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  const note = get('note').trim();
  return { ok: true, value: { adminUserId, languageCode, ...(note ? { note } : {}), reason: r } };
}

export interface RunPayload { entityTypes: string[]; languageCodes: string[]; reason: string }

export function buildRun(get: FormBag, getAll: FormMulti): Built<RunPayload> {
  const entityTypes = getAll('entityTypes').map((e) => e.trim())
    .filter((e) => (TRANSLATABLE_ENTITIES as readonly string[]).includes(e));
  if (entityTypes.length === 0) return { ok: false, error: 'entityTypes' };
  if (entityTypes.length > 8) return { ok: false, error: 'tooManyKinds' };
  const languageCodes = Array.from(new Set(getAll('languageCodes').map((l) => l.trim().toLowerCase()).filter(Boolean)));
  if (languageCodes.length === 0) return { ok: false, error: 'languages' };
  if (languageCodes.length > 14) return { ok: false, error: 'tooManyLanguages' };
  if (languageCodes.some((l) => !LANG_RE.test(l))) return { ok: false, error: 'language' };
  const r = reason(get);
  if (!r) return { ok: false, error: 'reason' };
  return { ok: true, value: { entityTypes, languageCodes, reason: r } };
}

/* ------------------------------------------------------------------ the taxonomy export */

export const TAXONOMY_REPORTS = ['category_tree', 'attributes', 'lookup_values', 'missing_translations'] as const;
export type TaxonomyReport = (typeof TAXONOMY_REPORTS)[number];

/** The report that is meaningless without a language. */
export function reportNeedsLanguage(report: string): boolean { return report === 'missing_translations'; }

export const MAX_EXPORT_ROWS = 20_000;
export const DEFAULT_EXPORT_ROWS = 5_000;

export interface ExportPayload { report: string; languageCode?: string; limit: number }

export function buildTaxonomyExport(raw: { report: string; languageCode?: string; limit?: string }): Built<ExportPayload> {
  const report = raw.report.trim();
  if (!(TAXONOMY_REPORTS as readonly string[]).includes(report)) return { ok: false, error: 'report' };
  const value: ExportPayload = { report, limit: DEFAULT_EXPORT_ROWS };
  const languageCode = (raw.languageCode ?? '').trim().toLowerCase();
  if (reportNeedsLanguage(report)) {
    if (!languageCode || !LANG_RE.test(languageCode)) return { ok: false, error: 'exportLanguage' };
    value.languageCode = languageCode;
  } else if (languageCode) {
    // DROPPED for a report that cannot use it, rather than silently sent — the file would not match what was asked for
    if (!LANG_RE.test(languageCode)) return { ok: false, error: 'language' };
  }
  const limitRaw = (raw.limit ?? '').trim();
  if (limitRaw) {
    if (!/^\d{1,7}$/.test(limitRaw)) return { ok: false, error: 'limit' };
    // CLAMPED: a row ceiling is a request about the transfer, not a question about the data
    value.limit = Math.min(Math.max(Number(limitRaw), 1), MAX_EXPORT_ROWS);
  }
  return { ok: true, value };
}

export function taxonomyExportFileName(report: string, receiptId: string, generatedAt: string, lang?: string): string {
  const day = /^\d{4}-\d{2}-\d{2}/.test(generatedAt) ? generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const short = receiptId.replace(/[^0-9a-zA-Z]/g, '').slice(0, 8) || 'receipt';
  return `krishalaya-taxonomy-${report}${lang ? `-${lang}` : ''}-${day}-${short}.csv`;
}
