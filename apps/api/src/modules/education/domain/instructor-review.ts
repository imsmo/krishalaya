// modules/education/domain/instructor-review.ts · PC-56 TENANT-7d · the instructor form's review step — W2637 (review),
// W2636 (form-error) — computed from the facts the writer uses, never an echo of what was typed (7a's rule, 6d-4's shape).
//
// The canon's instructor module names two actions on this chain: *"Add credential · Save profile"*. They are TWO forms
// over TWO rows, so this file holds two reviewers with one shape:
//   • PROFILE — the instructor's own fields (W419: *"only bio, languages and credentials are yours to edit"*): the
//     display name learners see, the bio, the LANGUAGES TAUGHT as codes the platform registry holds (Law 6 — never a
//     free string, and a code the registry does not have is refused by name), and who may see the profile.
//   • CREDENTIAL — a qualification with its scan: a title, an issuer, a year, and a DOCUMENT in this tenant's media
//     bucket (an image or a pdf, scanned by core/media). A rejected credential is RE-FILED through the same form
//     (`?credential=` — W419 *"Re-upload a clearer scan"*), which is the edit mode of this chain.
//
// WHAT THE REVIEW SHOWS THAT THE FORM NEVER ASKED: the language's own name from the registry beside each code; for a
// re-upload, the desk's note that the new document answers. WHAT IT DOES NOT COMPUTE, BY NAME: *"verified against the
// certificate face"* — no face is matched here; the desk's ACCEPT is a person's act, and the review says only that the
// document will be queued for the desk.
import { ReviewDiffRow, ReviewField, ReviewRefusal, ReviewResult, WRITER_REFUSALS, WriterIssue, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';
import { INSTRUCTOR_VISIBILITIES, InstructorVisibility } from './instructor.entity';
import { CREDENTIAL_DOCUMENT_KINDS, CredentialStatus } from './instructor-credential.entity';

export const INSTRUCTOR_REVIEW_REFUSALS = [
  'NO_AUTHOR', 'NO_INSTRUCTOR_PROFILE', 'NOT_OWNER',
  'DISPLAY_NAME_INVALID', 'BIO_REQUIRED', 'LANGUAGE_UNKNOWN', 'LANGUAGE_INACTIVE', 'LANGUAGES_TOO_MANY', 'VISIBILITY_INVALID',
  'CREDENTIAL_NOT_FOUND', 'CREDENTIAL_NOT_REJECTED', 'TITLE_REQUIRED', 'YEAR_INVALID', 'DOCUMENT_REQUIRED', 'MEDIA_UNKNOWN', 'MEDIA_KIND_MISMATCH', 'MEDIA_INFECTED',
  ...WRITER_REFUSALS,
] as const;
export type InstructorReviewRefusal = (typeof INSTRUCTOR_REVIEW_REFUSALS)[number];

export const PROFILE_FORM_FIELDS = ['displayName', 'bio', 'languages', 'visibility'] as const;
export type ProfileFormField = (typeof PROFILE_FORM_FIELDS)[number];
export const CREDENTIAL_FORM_FIELDS = ['title', 'issuer', 'yearAwarded', 'documentMediaId'] as const;
export type CredentialFormField = (typeof CREDENTIAL_FORM_FIELDS)[number];

export const MAX_LANGUAGES = 6;
export const MIN_DISPLAY_NAME = 2;
export const MAX_DISPLAY_NAME = 120;
export const MIN_CREDENTIAL_YEAR = 1900;

/** One row of the platform's language registry, as the review needs it. */
export interface RegistryLanguage { code: string; nameEnglish: string; nameNative: string; isActive: boolean }

/** `gu,hi, en` → `['gu','hi','en']`, deduplicated, lower-cased, blanks dropped. The chain carries the codes as one comma-joined value. */
export function parseLanguageCodes(s: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of (s ?? '').split(',')) { const c = raw.trim().toLowerCase(); if (c.length > 0 && !out.includes(c)) out.push(c); }
  return out;
}

/* ------------------------------------------------------------------------------------------------------------- */
/* THE PROFILE                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------- */

export interface CurrentProfile { displayName: string | null; bio: string | null; languages: string[]; visibility: InstructorVisibility }

export interface ProfileReviewInput {
  canAuthor: boolean;
  /** The row as it stands; null on the first save (the form CREATES the instructor row — PC-26's `become`). */
  current: CurrentProfile | null;
  entered: Partial<Record<ProfileFormField, string | null | undefined>>;
  /** The platform registry (every row — the review names an inactive code by name rather than "unknown"). */
  registry: readonly RegistryLanguage[];
  writerIssues?: readonly WriterIssue[];
}
export interface ProfileStored { displayName: string | null; bio: string; languages: string[]; visibility: InstructorVisibility }

const langLine = (l: RegistryLanguage) => `${l.code} · ${l.nameNative} (${l.nameEnglish})`;

export function reviewInstructorProfile(i: ProfileReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  if (!i.canAuthor) refusals.push({ field: null, code: 'NO_AUTHOR' });

  const name = trimOrNull(i.entered.displayName);
  if (name !== null && (name.length < MIN_DISPLAY_NAME || name.length > MAX_DISPLAY_NAME)) refusals.push({ field: 'displayName', code: 'DISPLAY_NAME_INVALID' });

  // W419 puts the bio first (*"Bio (ગુજરાતીમાં પ્રથમ)"*): a profile with no bio is not a profile learners can trust a person by.
  const bio = trimOrNull(i.entered.bio);
  if (bio === null) refusals.push({ field: 'bio', code: 'BIO_REQUIRED' });

  const codes = parseLanguageCodes(i.entered.languages);
  const resolved: RegistryLanguage[] = [];
  for (const c of codes) {
    const row = i.registry.find((l) => l.code === c);
    if (!row) { if (!refusals.some((r) => r.field === 'languages' && r.code === 'LANGUAGE_UNKNOWN')) refusals.push({ field: 'languages', code: 'LANGUAGE_UNKNOWN' }); continue; }
    if (!row.isActive) { if (!refusals.some((r) => r.field === 'languages' && r.code === 'LANGUAGE_INACTIVE')) refusals.push({ field: 'languages', code: 'LANGUAGE_INACTIVE' }); continue; }
    resolved.push(row);
  }
  if (codes.length > MAX_LANGUAGES) refusals.push({ field: 'languages', code: 'LANGUAGES_TOO_MANY' });

  const visTyped = trimOrNull(i.entered.visibility);
  const visibility: InstructorVisibility | null = visTyped === null ? (i.current?.visibility ?? 'public') : ((INSTRUCTOR_VISIBILITIES as readonly string[]).includes(visTyped.toLowerCase()) ? (visTyped.toLowerCase() as InstructorVisibility) : null);
  if (visibility === null) refusals.push({ field: 'visibility', code: 'VISIBILITY_INVALID' });

  const fields: ReviewField[] = [
    field('displayName', i.entered.displayName ?? null, name),
    field('bio', i.entered.bio ?? null, bio),
    field('languages', i.entered.languages ?? null, resolved.length === 0 ? null : resolved.map(langLine).join('\n')),
    field('visibility', i.entered.visibility ?? null, visibility),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));

  let diff: ReviewDiffRow[] | null = null;
  if (i.current) {
    diff = [];
    const c = i.current;
    const push = (f: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: f, before, after }); };
    push('displayName', c.displayName, name);
    push('bio', c.bio, bio);
    push('languages', c.languages.length === 0 ? null : c.languages.join(', '), resolved.length === 0 ? null : resolved.map((l) => l.code).join(', '));
    push('visibility', c.visibility, visibility);
  }
  return reviewResult('instructor', fields, refusals, diff);
}

/** The row the writer receives when `ready` — the same values the review showed. */
export function storedProfile(i: ProfileReviewInput): ProfileStored | null {
  const r = reviewInstructorProfile(i);
  if (!r.ready) return null;
  const visTyped = trimOrNull(i.entered.visibility);
  return {
    displayName: trimOrNull(i.entered.displayName),
    bio: trimOrNull(i.entered.bio) as string,
    languages: parseLanguageCodes(i.entered.languages),
    visibility: visTyped === null ? (i.current?.visibility ?? 'public') : (visTyped.toLowerCase() as InstructorVisibility),
  };
}

/** The form's own view of a stored profile — the values the EDIT step opens with. */
export function profileFormValues(c: CurrentProfile): Record<ProfileFormField, string> {
  return { displayName: c.displayName ?? '', bio: c.bio ?? '', languages: c.languages.join(','), visibility: c.visibility };
}

/* ------------------------------------------------------------------------------------------------------------- */
/* THE CREDENTIAL                                                                                                */
/* ------------------------------------------------------------------------------------------------------------- */

export interface CurrentCredential { id: string; status: CredentialStatus; title: string; issuer: string | null; yearAwarded: number | null; documentMediaId: string; reviewNote: string | null }
/** What the review knows of the document named: undefined = nothing named; null = named and not in THIS tenant's bucket. */
export interface DocumentFacts { kind: string; scanStatus: string; mimeType: string }

export interface CredentialReviewInput {
  canAuthor: boolean;
  /** The caller has an instructor row in this tenant (a credential belongs to one). */
  hasProfile: boolean;
  /** Re-upload mode: the credential as it stands (undefined = a new credential; null = an id was named and no such credential is the caller's). */
  current?: CurrentCredential | null;
  entered: Partial<Record<CredentialFormField, string | null | undefined>>;
  document: DocumentFacts | null | undefined;
  /** The year the review runs in — a certificate awarded next year is a typo. */
  thisYear: number;
  writerIssues?: readonly WriterIssue[];
}
export interface CredentialStored { title: string; issuer: string | null; yearAwarded: number | null; documentMediaId: string }

/** A four-digit year from MIN_CREDENTIAL_YEAR to this year; anything else is null. */
export function parseCredentialYear(s: string, thisYear: number): number | null {
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  return y >= MIN_CREDENTIAL_YEAR && y <= thisYear ? y : null;
}

export function reviewCredential(i: CredentialReviewInput): ReviewResult {
  const refusals: ReviewRefusal[] = [];
  const isRefile = i.current !== undefined;
  if (!i.canAuthor) refusals.push({ field: null, code: 'NO_AUTHOR' });
  else if (!i.hasProfile) refusals.push({ field: null, code: 'NO_INSTRUCTOR_PROFILE' });
  if (isRefile) {
    if (!i.current) refusals.push({ field: null, code: 'CREDENTIAL_NOT_FOUND' });
    else if (i.current.status !== 'rejected') refusals.push({ field: null, code: 'CREDENTIAL_NOT_REJECTED' });
  }

  const title = trimOrNull(i.entered.title);
  if (title === null) refusals.push({ field: 'title', code: 'TITLE_REQUIRED' });
  const issuer = trimOrNull(i.entered.issuer);
  const yearTyped = trimOrNull(i.entered.yearAwarded);
  const year = yearTyped === null ? null : parseCredentialYear(yearTyped, i.thisYear);
  if (yearTyped !== null && year === null) refusals.push({ field: 'yearAwarded', code: 'YEAR_INVALID' });

  const docTyped = trimOrNull(i.entered.documentMediaId);
  if (docTyped === null) refusals.push({ field: 'documentMediaId', code: 'DOCUMENT_REQUIRED' });
  else if (i.document === null || i.document === undefined) refusals.push({ field: 'documentMediaId', code: 'MEDIA_UNKNOWN' });
  else if (!CREDENTIAL_DOCUMENT_KINDS.has(i.document.kind)) refusals.push({ field: 'documentMediaId', code: 'MEDIA_KIND_MISMATCH' });
  else if (i.document.scanStatus === 'infected') refusals.push({ field: 'documentMediaId', code: 'MEDIA_INFECTED' });
  const docOk = docTyped !== null && !refusals.some((r) => r.field === 'documentMediaId');

  const fields: ReviewField[] = [
    field('title', i.entered.title ?? null, title),
    field('issuer', i.entered.issuer ?? null, issuer),
    field('yearAwarded', i.entered.yearAwarded ?? null, year === null ? null : String(year)),
    field('documentMediaId', i.entered.documentMediaId ?? null, docOk ? `${docTyped} · ${i.document!.kind} · ${i.document!.mimeType} · ${i.document!.scanStatus}` : null),
    // NEVER TYPED, ALWAYS SHOWN: what happens next — the desk's queue, not a face match
    field('status', null, 'submitted'),
    field('answersNote', null, isRefile && i.current ? i.current.reviewNote : null),
  ];
  refusals.push(...writerRefusals(i.writerIssues ?? [], fields.map((f) => f.name), refusals));

  let diff: ReviewDiffRow[] | null = null;
  if (isRefile && i.current) {
    diff = [];
    const c = i.current;
    const push = (f: string, before: string | null, after: string | null) => { if (before !== after) diff!.push({ field: f, before, after }); };
    push('title', c.title, title);
    push('issuer', c.issuer, issuer);
    push('yearAwarded', c.yearAwarded === null ? null : String(c.yearAwarded), year === null ? null : String(year));
    push('documentMediaId', c.documentMediaId, docOk ? docTyped : null);
    push('status', c.status, 'submitted');
  }
  return reviewResult('instructor_credential', fields, refusals, diff);
}

export function storedCredential(i: CredentialReviewInput): CredentialStored | null {
  const r = reviewCredential(i);
  if (!r.ready) return null;
  const yearTyped = trimOrNull(i.entered.yearAwarded);
  return {
    title: trimOrNull(i.entered.title) as string,
    issuer: trimOrNull(i.entered.issuer),
    yearAwarded: yearTyped === null ? null : parseCredentialYear(yearTyped, i.thisYear),
    documentMediaId: trimOrNull(i.entered.documentMediaId) as string,
  };
}

/** The re-upload form's first values: the credential as filed, WITHOUT the rejected document — a re-upload asks for a new scan. */
export function credentialFormValues(c: CurrentCredential): Record<CredentialFormField, string> {
  return { title: c.title, issuer: c.issuer ?? '', yearAwarded: c.yearAwarded === null ? '' : String(c.yearAwarded), documentMediaId: '' };
}

/* ------------------------------------------------------------------------------------------------------------- */
/* W410 · PROFILE COMPLETENESS — facts, not a percentage                                                          */
/* ------------------------------------------------------------------------------------------------------------- */

export const COMPLETENESS_CHECKS = ['bio', 'languages', 'credentialFiled', 'credentialAccepted', 'verified'] as const;
export type CompletenessCheck = (typeof COMPLETENESS_CHECKS)[number];
export interface CompletenessInput { bio: string | null; languages: readonly string[]; credentials: ReadonlyArray<{ status: CredentialStatus }>; isVerified: boolean }
/**
 * W410's sidebar line *"verified instructor"* and W419's *"Add at least one qualification to apply for verified-instructor
 * status"*, as a checklist. Each item is a fact the row holds; the page prints them, never an average of them.
 */
export function profileCompleteness(i: CompletenessInput): Array<{ check: CompletenessCheck; done: boolean }> {
  const live = i.credentials.filter((c) => c.status !== 'withdrawn');
  return [
    { check: 'bio', done: (i.bio ?? '').trim().length > 0 },
    { check: 'languages', done: i.languages.length > 0 },
    { check: 'credentialFiled', done: live.length > 0 },
    { check: 'credentialAccepted', done: live.some((c) => c.status === 'accepted') },
    { check: 'verified', done: i.isVerified },
  ];
}
