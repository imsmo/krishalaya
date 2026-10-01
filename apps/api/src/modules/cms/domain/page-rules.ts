// modules/cms/domain/page-rules.ts · PC-56 TENANT-8c · THE PAGES — the slug, version and body rules, pure, in ONE place.
//
// W175 *"markdown body, versioned (a new publish = a new version, history kept)"* · *"UNIQUE tenant + slug + version"*.
//
//   • THE SLUG. Anchored kebab-case (ReDoS-safe, the module's own rule since PC-27), at most 150 characters (0012's
//     column). The review NORMALISES what a person typed the way a person means it — trimmed, lower-cased, spaces and
//     underscores to hyphens, runs of hyphens collapsed — and prints the stored value beside the entered one; anything
//     else (a Gujarati title pasted into the slug, a `!`) is refused by name rather than silently stripped, because a
//     slug is an address members will be sent to and nobody should discover theirs was rewritten. `new` is RESERVED:
//     `/content/pages/new` is the form chain, so a page called `new` could never be opened in this console.
//   • THE VERSION. The next version is max + 1 of the tenant's OWN versions of the slug (a platform page's versions are
//     the platform's — a cooperative's first `about` is its v1 whatever the platform is on). The allocation runs under a
//     transaction-scoped advisory lock on (tenant, slug) in the service, so versions are contiguous by construction;
//     `versionsContiguous` is the property a spec and the live suite assert.
//   • THE BODY. The canon says *"markdown body"*, and markdown is what is stored: line endings normalised, control
//     characters dropped, trailing whitespace trimmed (the review shows it), and RAW HTML and script / data link targets
//     refused BY NAME — never stripped, because a body silently edited by the platform is a body its author did not
//     write. 0177's `cms_body_is_markdown` is the same rule in the database (the second layer).
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX = 150;
export const TITLE_MAX = 250;
export const BODY_MAX = 200_000;
export const RESERVED_SLUGS: readonly string[] = ['new'];

/** What a person typed, as the slug the platform would store — or null for blank. */
export function normaliseSlug(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return s.length === 0 ? null : s;
}

export type SlugIssue = 'SLUG_REQUIRED' | 'SLUG_TOO_LONG' | 'SLUG_INVALID' | 'SLUG_RESERVED';

/** The one reason a stored slug is refused, or null. Order: blank · too long · shape · reserved. */
export function slugIssue(slug: string | null): SlugIssue | null {
  if (slug === null || slug.length === 0) return 'SLUG_REQUIRED';
  if (slug.length > SLUG_MAX) return 'SLUG_TOO_LONG';
  if (!SLUG_RE.test(slug)) return 'SLUG_INVALID';
  if (RESERVED_SLUGS.includes(slug)) return 'SLUG_RESERVED';
  return null;
}

/** A title as stored: trimmed, inner runs of whitespace collapsed to one space. */
export function normaliseTitle(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim();
  return s.length === 0 ? null : s;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** A markdown body as stored: CRLF / CR → LF, control characters (not tab, not newline) dropped, trailing blanks off. */
export function normaliseBody(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  return s.trim().length === 0 ? null : s;
}

// The SQL function `cms_body_is_markdown` (0177) is the same three patterns.
const TAG_RE = /<\/?([a-z][a-z0-9-]*)(\s[^<>]*)?\/?\s*>/gi;
const COMMENT_RE = /<!--/;
const UNSAFE_LINK_RE = /\]\(\s*<?\s*(javascript|vbscript|data)\s*:/gi;

/** The raw HTML tag names in a body (lower-cased, unique, in order). A tag's name follows `<` (or `</`) directly, as a
 *  browser reads it: `a < b > c` is prose, and `<https://x>` is a markdown autolink (the colon ends the name). */
export function rawHtmlTags(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(TAG_RE)) { const n = m[1].toLowerCase(); if (!out.includes(n)) out.push(n); }
  if (COMMENT_RE.test(body) && !out.includes('!--')) out.push('!--');
  return out;
}

/** The link schemes in a body that would run script or inline a payload (lower-cased, unique). */
export function unsafeLinkSchemes(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(UNSAFE_LINK_RE)) { const n = m[1].toLowerCase(); if (!out.includes(n)) out.push(n); }
  return out;
}

/** True when the body is storable markdown: no raw HTML, no HTML comment, no unsafe link target. */
export function bodyIsMarkdown(body: string): boolean {
  return rawHtmlTags(body).length === 0 && unsafeLinkSchemes(body).length === 0;
}

/** The version the next write mints: one past the highest the tenant holds for this slug; 1 when it holds none. */
export function nextVersion(versions: readonly number[]): number {
  return versions.reduce((m, v) => (v > m ? v : m), 0) + 1;
}

/** 1..n with no gap and no repeat — what the advisory lock guarantees and the live suite asserts. */
export function versionsContiguous(versions: readonly number[]): boolean {
  const s = [...versions].sort((a, b) => a - b);
  return s.every((v, i) => v === i + 1);
}
