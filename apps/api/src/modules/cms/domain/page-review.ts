// modules/cms/domain/page-review.ts · PC-56 TENANT-8c · THE PAGES — the review of a page write, the FORM chain's
// API-computed review for all three canon chains that write one: pages-form W2703–W2706 (*"New page"*, from W175),
// page-form W2696–W2699 (*"Choose kind"*, the editor's chain on a slug that exists) and faq-form W2605–W2608 (*"New FAQ
// entry · New entry"*).
//
// A REVIEW BUILT FROM WHAT THE AUTHOR TYPED IS AN ECHO (shared/form-review.ts). This one shows what the platform WILL
// WRITE:
//   • the slug, normalised the way the writer normalises it, refused by name when it is not an address (page-rules.ts);
//     on the New-page chain a slug the cooperative already has is refused (`SLUG_TAKEN` — open it instead), and a slug
//     only the PLATFORM has is allowed: writing your own version of a platform page is exactly W175's *"your own pages
//     replace them as you publish"*, and the review says which platform version it will replace;
//   • WHICH WRITE it is — a new page (v1), a new version (vN+1 of a slug whose versions are history), or an edit of the
//     open draft — and the version number, so *"publishing creates v3, v2 stays in history"* (W176) is a computed fact;
//   • the kind, from the module's four, FIXED per slug once the cooperative has a version of it: a policy page that
//     could be re-filed as `static` would drop its checker on the way (W176 *"policy pages get stricter review"*);
//     a POLICY page is flagged "needs a second person to publish";
//   • the language the body is written in — one this tenant speaks (`tenant_languages`, else the platform's active
//     registry: never a free string, Law 6);
//   • the body as stored markdown — raw HTML and script / data link targets refused BY NAME, with the tags found;
//   • the FAQ topic from its vocabulary (required on an FAQ entry, refused on any other kind) and the place the entry
//     takes in its topic;
//   • the reason (the audit row's sentence — W2698 *"actor · time · reason · before/after"*);
//   • the diff against the current values where applicable: the open draft (edit), the latest version (new version);
//     none for a new page — *"where applicable"*, and a create has nothing to differ from.
import { ReviewField, ReviewRefusal, ReviewResult, WriterIssue, WRITER_REFUSALS, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';
import { PAGE_KINDS } from './cms.events';
import { needsChecker } from './page-acts';
import { nextVersion, normaliseBody, normaliseSlug, normaliseTitle, rawHtmlTags, slugIssue, unsafeLinkSchemes } from './page-rules';
import { Serving, servingFor } from './page-serving';

export const PAGE_FORM_FIELDS = ['slug', 'pageKind', 'defaultTitle', 'body', 'languageCode', 'topic', 'reason'] as const;
export type PageFormField = (typeof PAGE_FORM_FIELDS)[number];
/** Rows the review shows that the form never asked. */
export const PAGE_DERIVED_ROWS = ['version', 'status'] as const;

/** `new` — the New page / New FAQ entry chains; `version` — the editor's chain on a slug the cooperative may hold. */
export const PAGE_INTENTS = ['new', 'version'] as const;
export type PageIntent = (typeof PAGE_INTENTS)[number];
export type PageWriteMode = 'new_page' | 'new_version' | 'edit_draft';

export const PAGE_REVIEW_REFUSALS = [
  'NO_PERMISSION', 'NOTHING_CHANGED',
  'SLUG_REQUIRED', 'SLUG_TOO_LONG', 'SLUG_INVALID', 'SLUG_RESERVED', 'SLUG_TAKEN',
  'KIND_REQUIRED', 'KIND_UNKNOWN', 'KIND_FIXED',
  'TITLE_REQUIRED',
  'BODY_REQUIRED', 'BODY_RAW_HTML', 'BODY_UNSAFE_LINK',
  'LANGUAGE_REQUIRED', 'LANGUAGE_NOT_TENANT',
  'TOPIC_REQUIRED', 'TOPIC_UNKNOWN', 'TOPIC_NOT_FAQ',
  'REASON_REQUIRED', ...WRITER_REFUSALS,
] as const;
export type PageReviewRefusal = (typeof PAGE_REVIEW_REFUSALS)[number];

export const MIN_PAGE_REASON = 3;

export interface PageFormEntered {
  slug?: string; pageKind?: string; defaultTitle?: string; body?: string; languageCode?: string; topic?: string; reason?: string;
}

/** One of the tenant's own versions of the slug, as the review needs it. */
export interface OwnVersionFact {
  id: string; version: number; status: string; pageKind: string; defaultTitle: string; body: string;
  languageCode: string | null; topic: string | null; sortOrder: number;
}

export interface PageReviewInput {
  canAuthor: boolean;
  intent: PageIntent;
  entered: PageFormEntered;
  topics: readonly string[];
  tenantLanguages: readonly string[];
  /** The tenant's OWN versions of the normalised slug (empty when it holds none, or the slug is not a slug). */
  own: readonly OwnVersionFact[];
  /** The platform's published version of the slug, when there is one. */
  platform: { version: number; pageKind: string; defaultTitle: string } | null;
  /** FAQ only: how many entries the chosen topic already holds (the new entry's place is one past them). */
  topicEntries?: number;
  writerIssues?: readonly WriterIssue[];
}

export interface PagePreview {
  mode: PageWriteMode | null;
  version: number | null;
  /** The open draft this write edits (edit_draft only). */
  draftId: string | null;
  /** What the form carries back to the writer: the writer refuses with VERSION_CHANGED when it no longer holds. */
  expect: string | null;
  kind: string | null;
  needsChecker: boolean;
  /** What a member asking for this slug would be served today, and after this version is published. */
  servingToday: Serving;
  replacesPlatformVersion: number | null;
  /** The versions that stay in history unchanged. */
  historyVersions: number[];
  faqPlace: number | null;
  rawHtmlTags: string[];
  unsafeLinkSchemes: string[];
}

export type PageReview = ReviewResult & { preview: PagePreview };

/** The values the writer will store, normalised by the functions it uses. */
export function storedPage(e: PageFormEntered) {
  return {
    slug: normaliseSlug(e.slug),
    pageKind: trimOrNull(e.pageKind),
    defaultTitle: normaliseTitle(e.defaultTitle),
    body: normaliseBody(e.body),
    languageCode: trimOrNull(e.languageCode),
    topic: trimOrNull(e.topic),
    reason: trimOrNull(e.reason),
  };
}

/** Which write this is, from the tenant's own versions of the slug. */
export function writeMode(own: readonly Pick<OwnVersionFact, 'version' | 'status'>[]): { mode: PageWriteMode; version: number } {
  if (own.length === 0) return { mode: 'new_page', version: 1 };
  const draft = own.find((v) => v.status === 'draft');
  if (draft) return { mode: 'edit_draft', version: draft.version };
  return { mode: 'new_version', version: nextVersion(own.map((v) => v.version)) };
}

export function expectToken(mode: PageWriteMode, version: number): string { return `${mode}:${version}`; }

export function reviewPage(i: PageReviewInput): PageReview {
  const refusals: ReviewRefusal[] = [];
  const s = storedPage(i.entered);
  if (!i.canAuthor) refusals.push({ field: null, code: 'NO_PERMISSION' });

  // THE SLUG
  const si = slugIssue(s.slug);
  if (si) refusals.push({ field: 'slug', code: si });
  const own = si ? [] : i.own;
  const taken = !si && i.intent === 'new' && own.length > 0;
  if (taken) refusals.push({ field: 'slug', code: 'SLUG_TAKEN' });

  // THE WRITE — computed, never asked (none when the slug is not writable from this chain)
  const w = si || taken ? null : writeMode(own);
  const latest = own.length > 0 ? own.reduce((a, b) => (b.version > a.version ? b : a)) : null;
  const draft = own.find((v) => v.status === 'draft') ?? null;

  // THE KIND — the slug's own, once the cooperative holds a version of it
  const fixedKind = latest?.pageKind ?? null;
  if (s.pageKind === null) refusals.push({ field: 'pageKind', code: 'KIND_REQUIRED' });
  else if (!(PAGE_KINDS as readonly string[]).includes(s.pageKind)) refusals.push({ field: 'pageKind', code: 'KIND_UNKNOWN' });
  else if (fixedKind !== null && fixedKind !== s.pageKind) refusals.push({ field: 'pageKind', code: 'KIND_FIXED' });

  // THE TITLE AND THE BODY
  if (s.defaultTitle === null) refusals.push({ field: 'defaultTitle', code: 'TITLE_REQUIRED' });
  const tags = s.body ? rawHtmlTags(s.body) : [];
  const schemes = s.body ? unsafeLinkSchemes(s.body) : [];
  if (s.body === null) refusals.push({ field: 'body', code: 'BODY_REQUIRED' });
  else {
    if (tags.length > 0) refusals.push({ field: 'body', code: 'BODY_RAW_HTML' });
    if (schemes.length > 0) refusals.push({ field: 'body', code: 'BODY_UNSAFE_LINK' });
  }

  // THE LANGUAGE — one this tenant speaks
  if (s.languageCode === null) refusals.push({ field: 'languageCode', code: 'LANGUAGE_REQUIRED' });
  else if (!i.tenantLanguages.includes(s.languageCode)) refusals.push({ field: 'languageCode', code: 'LANGUAGE_NOT_TENANT' });

  // THE TOPIC — an FAQ entry's, from the vocabulary
  const isFaq = s.pageKind === 'faq';
  if (isFaq && s.topic === null) refusals.push({ field: 'topic', code: 'TOPIC_REQUIRED' });
  else if (s.topic !== null && !isFaq) refusals.push({ field: 'topic', code: 'TOPIC_NOT_FAQ' });
  else if (s.topic !== null && !i.topics.includes(s.topic)) refusals.push({ field: 'topic', code: 'TOPIC_UNKNOWN' });

  // THE REASON
  if (s.reason === null || s.reason.length < MIN_PAGE_REASON) refusals.push({ field: 'reason', code: 'REASON_REQUIRED' });

  // THE DIFF — against the open draft (edit) or the latest version (a new version); none for a new page
  const base = w?.mode === 'edit_draft' ? draft : w?.mode === 'new_version' ? latest : null;
  const diff = base === null ? null : [
    ...(base.pageKind !== s.pageKind ? [{ field: 'pageKind', before: base.pageKind, after: s.pageKind }] : []),
    ...(base.defaultTitle !== s.defaultTitle ? [{ field: 'defaultTitle', before: base.defaultTitle, after: s.defaultTitle }] : []),
    ...(base.body !== s.body ? [{ field: 'body', before: base.body, after: s.body }] : []),
    ...(base.languageCode !== s.languageCode ? [{ field: 'languageCode', before: base.languageCode, after: s.languageCode }] : []),
    ...(base.topic !== s.topic ? [{ field: 'topic', before: base.topic, after: s.topic }] : []),
  ];
  // Editing a draft into itself is no write at all; a new version identical to the last is a version nobody needs.
  if (diff !== null && diff.length === 0) refusals.push({ field: null, code: 'NOTHING_CHANGED' });

  const rows = [...PAGE_FORM_FIELDS, ...PAGE_DERIVED_ROWS];
  for (const r of writerRefusals(i.writerIssues ?? [], rows, refusals)) refusals.push(r);

  const fields: ReviewField[] = [
    field('slug', i.entered.slug ?? null, s.slug),
    field('pageKind', i.entered.pageKind ?? null, s.pageKind),
    field('defaultTitle', i.entered.defaultTitle ?? null, s.defaultTitle),
    field('body', i.entered.body ?? null, s.body),
    field('languageCode', i.entered.languageCode ?? null, s.languageCode),
    field('topic', i.entered.topic ?? null, s.topic),
    field('reason', i.entered.reason ?? null, s.reason),
    // The two rows the form never asked: which version this is, and that it is a DRAFT — nothing is published from a
    // form; publishing is the mutate chain's act, and for a policy page a second person's.
    { name: 'version', entered: null, stored: w ? `v${w.version}` : null, normalised: false },
    { name: 'status', entered: null, stored: 'draft', normalised: false },
  ];

  const ownPublished = own.find((v) => v.status === 'published')?.version ?? null;
  const kind = fixedKind ?? s.pageKind;
  const preview: PagePreview = {
    mode: w?.mode ?? null,
    version: w?.version ?? null,
    draftId: w?.mode === 'edit_draft' ? draft?.id ?? null : null,
    expect: w ? expectToken(w.mode, w.version) : null,
    kind,
    needsChecker: kind !== null && needsChecker(kind),
    servingToday: servingFor(ownPublished, i.platform?.version ?? null),
    replacesPlatformVersion: ownPublished === null && i.platform ? i.platform.version : null,
    historyVersions: own.filter((v) => v.status !== 'draft').map((v) => v.version).sort((a, b) => a - b),
    faqPlace: isFaq ? (w?.mode === 'new_page' ? (i.topicEntries ?? 0) + 1 : null) : null,
    rawHtmlTags: tags,
    unsafeLinkSchemes: schemes,
  };
  return { ...reviewResult('cms_page', fields, refusals, diff), preview };
}
