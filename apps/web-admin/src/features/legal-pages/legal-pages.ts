// apps/web-admin/src/features/legal-pages/legal-pages.ts · PC-56 LEGAL-1 view + request logic (pure, framework-free).
//
// The four platform POLICY pages the public storefront serves at /terms, /privacy, /refunds and /shipping. Drafts are
// seeded from lawyer-review copy; the words go live only when a SECOND operator publishes them (maker ≠ checker,
// enforced by a database trigger and by admin-api — this module only decides what the console DRAWS).
//
// Everything a server action sends is assembled here, so the spec can prove every write carries a reason within the
// server's bounds without a Next runtime.

import type { StatusTone } from '@krishalaya/ui';

/** The only four slugs admin-api accepts (anything else is 404 PLATFORM_PAGE_UNKNOWN_SLUG). Order = the storefront's. */
export const PLATFORM_PAGE_SLUGS = ['terms', 'privacy', 'refunds', 'shipping'] as const;
export type PlatformPageSlug = (typeof PLATFORM_PAGE_SLUGS)[number];
export function isPlatformPageSlug(s: string): s is PlatformPageSlug {
  return (PLATFORM_PAGE_SLUGS as readonly string[]).includes(s);
}

/** Bounds mirrored from admin-api's DTOs so an operator learns before the round trip — the server stays the authority. */
export const REASON_MIN = 20;
export const REASON_MAX = 2000;
export const TITLE_MAX = 250;
export const BODY_MAX = 100_000;

/** The translation blocks the edit form always offers. Any OTHER language already stored on a version is offered too
 *  (see `translationLanguages`), so a save never silently drops a translation this form did not know about. */
export const DEFAULT_TRANSLATION_LANGS = ['hi', 'gu'] as const;

/** The platform-fact tokens the storefront fills from Settings. Anything else in `{{…}}` is refused by admin-api. */
export const PLATFORM_FACT_TOKENS = [
  'platform.legal.entity_name',
  'platform.legal.registered_office',
  'platform.grievance.officer_name',
  'platform.grievance.address',
  'platform.grievance.email',
  'platform.grievance.ack_hours',
  'platform.grievance.resolve_days',
  'platform.contact.security_email',
  'platform.contact.partners_email',
  'platform.contact.press_email',
  'platform.contact.general_email',
] as const;

export type VersionStatus = 'draft' | 'published' | 'archived';

export interface VersionSummary {
  id: string; slug: string; version: number; status: VersionStatus; title: string; languageCode: string | null;
  createdByAdminId: string | null; lastEditedByAdminId: string | null; publishedByAdminId: string | null;
  publishedAt: string | null; archivedAt: string | null; archivedReason: string | null; archivedByAdminId: string | null;
  updatedAt: string;
}
export interface Translation { languageCode: string; title: string | null; body: string }
export interface VersionDetail extends VersionSummary { body: string; translations: Translation[] }

export interface PageListRow { slug: string; live: VersionSummary | null; draft: VersionSummary | null; versionCount: number }
export interface PageViewer { adminId: string; canPublishDraft: boolean; draftHasNamedMaker: boolean }
export interface PageDetail {
  slug: string;
  versions: VersionDetail[];
  archiveReasons: { code: string; name: string }[];
  viewer: PageViewer;
}

/* ------------------------------------------------------------------------------------------------ */
/* What the console draws                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export const slugKey = (slug: string): string => (isPlatformPageSlug(slug) ? `lp.slug.${slug}` : 'lp.slug.other');
export const statusKey = (s: string): string =>
  (s === 'draft' || s === 'published' || s === 'archived' ? `lp.status.${s}` : 'lp.status.other');
export function statusTone(s: string): StatusTone {
  if (s === 'published') return 'success';
  if (s === 'draft') return 'warning';
  return 'neutral';
}

export const liveVersion = (d: Pick<PageDetail, 'versions'>): VersionDetail | null =>
  d.versions.find((v) => v.status === 'published') ?? null;
export const openDraft = (d: Pick<PageDetail, 'versions'>): VersionDetail | null =>
  d.versions.find((v) => v.status === 'draft') ?? null;

/**
 * **PUBLISH BY ABSENCE.** null = draw the publish form. Otherwise the i18n key of the line that replaces it, so a missing
 * button is never mistaken for an unbuilt feature. admin-api's `viewer.canPublishDraft` is the input — it already knows
 * who authored and last edited the draft; this console does not second-guess it.
 */
export function publishWithheldKey(viewer: PageViewer, draft: VersionSummary | null): string | null {
  if (!draft) return 'lp.publish.noDraft';
  if (viewer.canPublishDraft) return null;
  if (!viewer.draftHasNamedMaker) return 'lp.publish.makerUnnamed';
  return 'lp.publish.checkerRequired';
}

/** A short, honest label for an operator id: "you" for the viewer, the id prefix otherwise, "nobody yet" for null. */
export function whoLabel(id: string | null, viewerId: string | null): { key: string; who: string } {
  if (!id) return { key: 'lp.who.nobody', who: '' };
  if (viewerId && id === viewerId) return { key: 'lp.who.you', who: id.slice(0, 8) };
  return { key: 'lp.who.other', who: id.slice(0, 8) };
}

/** Every language a translation block is drawn for: the defaults plus whatever the version already carries. */
export function translationLanguages(existing: readonly Translation[] = []): string[] {
  const out: string[] = [...DEFAULT_TRANSLATION_LANGS];
  for (const t of existing) if (t.languageCode && !out.includes(t.languageCode)) out.push(t.languageCode);
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Typed refusals → i18n keys                                                                        */
/* ------------------------------------------------------------------------------------------------ */

export const ERROR_KINDS = [
  'reason', 'title', 'body', 'translation', 'archiveReason',
  'idempotency', 'unknownSlug', 'draftExists', 'notDraft', 'changed', 'checkerRequired', 'makerUnnamed',
  'refused', 'invalid', 'permission', 'elevation', 'notFound', 'conflict', 'generic',
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];
export const isErrorKind = (s: string): s is ErrorKind => (ERROR_KINDS as readonly string[]).includes(s);
export const errorKey = (k: ErrorKind): string => `lp.err.${k}`;

const CODE_KIND: Record<string, ErrorKind> = {
  IDEMPOTENCY_KEY_REQUIRED: 'idempotency',
  PLATFORM_PAGE_UNKNOWN_SLUG: 'unknownSlug',
  PLATFORM_PAGE_DRAFT_EXISTS: 'draftExists',
  PLATFORM_PAGE_NOT_DRAFT: 'notDraft',
  PLATFORM_PAGE_CHANGED: 'changed',
  PLATFORM_PAGE_CHECKER_REQUIRED: 'checkerRequired',
  // The shared maker-checker helper's code means the same thing to the operator: find a colleague.
  SECOND_PERSON_REQUIRED: 'checkerRequired',
  PLATFORM_PAGE_MAKER_UNNAMED: 'makerUnnamed',
  PLATFORM_PAGE_REFUSED: 'refused',
  VALIDATION_ERROR: 'invalid',
};

/** Map an admin-api refusal (code, HTTP status, message) to the kind the page renders. The typed code wins; the status
 *  is the fallback. A 403 means two different things on this plane and the message decides: a missing owner permission
 *  (ask for access) or a stale hardware-key / step-up elevation (re-authenticate). */
export function errorKindFor(code: string | undefined, status: number | undefined, message?: string): ErrorKind {
  const byCode = code ? CODE_KIND[code] : undefined;
  if (byCode) return byCode;
  const msg = String(message ?? '');
  if (status === 403) {
    if (/missing owner permission/i.test(msg)) return 'permission';
    if (/second|checker/i.test(msg)) return 'checkerRequired';
    return 'elevation';
  }
  if (status === 404) return 'notFound';
  if (status === 409) return 'conflict';
  if (status === 422) return 'invalid';
  if (status === 400) return 'invalid';
  return 'generic';
}

/** 422 PLATFORM_PAGE_REFUSED carries EVERY problem at once. They travel to the page on the redirect URL, bounded. */
export interface Problem { code: string; detail: string }
export const MAX_PROBLEMS = 12;
const PROBLEM_DETAIL_MAX = 240;

export function problemsFrom(details: unknown): Problem[] {
  const raw = (details as { problems?: unknown } | null | undefined)?.problems;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_PROBLEMS).map((p) => ({
    code: String((p as Problem)?.code ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64) || 'UNKNOWN',
    detail: String((p as Problem)?.detail ?? '').slice(0, PROBLEM_DETAIL_MAX),
  }));
}
export function encodeProblems(ps: Problem[]): string {
  return Buffer.from(JSON.stringify(ps.slice(0, MAX_PROBLEMS)), 'utf8').toString('base64url');
}
export function decodeProblems(s: string | undefined): Problem[] {
  if (!s) return [];
  try { return problemsFrom({ problems: JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) }); } catch { return []; }
}

/* ------------------------------------------------------------------------------------------------ */
/* Request bodies (every write carries a bounded reason)                                             */
/* ------------------------------------------------------------------------------------------------ */

export type Built<T> = { ok: true; value: T } | { ok: false; error: ErrorKind };
type Fields = { get(k: string): unknown; getAll?(k: string): unknown[] };

const str = (f: Fields, k: string) => String(f.get(k) ?? '').trim();
const raw = (f: Fields, k: string) => String(f.get(k) ?? '');

function reasonOf(f: Fields): string | null {
  const r = str(f, 'reason');
  return r.length >= REASON_MIN && r.length <= REASON_MAX ? r : null;
}

/** Translations from `tr_<lang>_title` / `tr_<lang>_body`, for each language listed in the `trLang` fields. A block with
 *  an empty body is left out (that removes the translation); a title with no body is refused, not silently dropped. */
export function translationsFrom(f: Fields): Built<Translation[]> {
  const langs = (f.getAll ? f.getAll('trLang') : []).map((l) => String(l).trim()).filter((l) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(l));
  const out: Translation[] = [];
  for (const lang of [...new Set(langs)]) {
    const title = str(f, `tr_${lang}_title`);
    const body = raw(f, `tr_${lang}_body`);
    if (body.trim().length === 0) {
      if (title) return { ok: false, error: 'translation' };
      continue;
    }
    if (title.length > TITLE_MAX || body.length > BODY_MAX) return { ok: false, error: 'translation' };
    out.push({ languageCode: lang, title: title || null, body });
  }
  return { ok: true, value: out };
}

export interface DraftBody { title: string; body: string; translations: Translation[]; reason: string }

/** POST /platform-pages/:slug/drafts */
export function buildCreateDraft(f: Fields): Built<DraftBody> {
  const title = str(f, 'title');
  const body = raw(f, 'body');
  if (!title || title.length > TITLE_MAX) return { ok: false, error: 'title' };
  if (body.trim().length === 0 || body.length > BODY_MAX) return { ok: false, error: 'body' };
  const tr = translationsFrom(f);
  if (!tr.ok) return tr;
  const reason = reasonOf(f);
  if (!reason) return { ok: false, error: 'reason' };
  return { ok: true, value: { title, body, translations: tr.value, reason } };
}

/** PATCH /platform-pages/versions/:id — the full form is sent (translations replace the set), with the optimistic
 *  `expectUpdatedAt` the page rendered, so a colleague's concurrent save is refused instead of overwritten. */
export function buildSaveDraft(f: Fields): Built<DraftBody & { expectUpdatedAt?: string }> {
  const created = buildCreateDraft(f);
  if (!created.ok) return created;
  const expectUpdatedAt = str(f, 'expectUpdatedAt');
  return { ok: true, value: { ...created.value, ...(expectUpdatedAt ? { expectUpdatedAt } : {}) } };
}

/** POST /platform-pages/versions/:id/publish */
export function buildPublish(f: Fields): Built<{ reason: string }> {
  const reason = reasonOf(f);
  return reason ? { ok: true, value: { reason } } : { ok: false, error: 'reason' };
}

/** POST /platform-pages/versions/:id/archive */
export function buildArchive(f: Fields): Built<{ reason: string; archiveReason: string }> {
  const archiveReason = str(f, 'archiveReason');
  if (!/^[a-z0-9_.-]{1,64}$/i.test(archiveReason)) return { ok: false, error: 'archiveReason' };
  const reason = reasonOf(f);
  return reason ? { ok: true, value: { reason, archiveReason } } : { ok: false, error: 'reason' };
}

export const OK_KINDS = ['drafted', 'saved', 'published', 'archived'] as const;
export const isOkKind = (s: string): boolean => (OK_KINDS as readonly string[]).includes(s);
