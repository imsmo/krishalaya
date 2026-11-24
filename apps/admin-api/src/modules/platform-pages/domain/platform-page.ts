// apps/admin-api/src/modules/platform-pages/domain/platform-page.ts · PC-56 LEGAL-1 (migration 0242). PURE.
//
// The words of a platform POLICY page (terms · privacy · refunds · shipping) and the review an author's draft passes before it is stored.
//
// THE MARKDOWN RULE IS apps/api's, REPLICATED (Law 11: the admin realm never imports tenant-realm code). The three patterns below are the
// same characters as apps/api/src/modules/cms/domain/page-rules.ts and 0177's SQL `cms_body_is_markdown` — and
// __tests__/legal1-platform-pages.spec.ts READS the api file and fails if the sources drift. The database refuses the same bodies again
// (0242 `cms_pages_platform_guard`); this layer exists so the author is told WHAT is wrong, every problem at once, before anything is saved.

export const PLATFORM_POLICY_SLUGS = Object.freeze(['terms', 'privacy', 'refunds', 'shipping'] as const);
export type PlatformPolicySlug = (typeof PLATFORM_POLICY_SLUGS)[number];
export function isPlatformPolicySlug(raw: unknown): raw is PlatformPolicySlug {
  return typeof raw === 'string' && (PLATFORM_POLICY_SLUGS as readonly string[]).includes(raw);
}

/** The ELEVEN platform facts (migration 0223) a policy body may cite as `{{key}}`. The storefront substitutes them from the platform-facts
 *  read and prints "not published yet" for an unset one; anything else in braces would print literally, so it is refused here by name. */
export const PLATFORM_FACT_TOKENS = Object.freeze([
  'platform.legal.entity_name', 'platform.legal.registered_office',
  'platform.grievance.officer_name', 'platform.grievance.address', 'platform.grievance.email',
  'platform.grievance.ack_hours', 'platform.grievance.resolve_days',
  'platform.contact.security_email', 'platform.contact.partners_email', 'platform.contact.press_email', 'platform.contact.general_email',
] as const);

export const TITLE_MAX = 250;
export const BODY_MAX = 100_000;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
// ↓ identical to apps/api/src/modules/cms/domain/page-rules.ts (the spec compares the sources)
const TAG_RE = /<\/?([a-z][a-z0-9-]*)(\s[^<>]*)?\/?\s*>/gi;
const COMMENT_RE = /<!--/;
const UNSAFE_LINK_RE = /\]\(\s*<?\s*(javascript|vbscript|data)\s*:/gi;
export const MARKDOWN_RULE_SOURCES = Object.freeze({ tag: TAG_RE.source, comment: COMMENT_RE.source, unsafeLink: UNSAFE_LINK_RE.source });

const TOKEN_RE = /\{\{\s*([^{}]{0,80}?)\s*\}\}/g;

/** A title as stored: trimmed, inner whitespace collapsed; null when empty. */
export function normaliseTitle(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim();
  return s.length === 0 ? null : s;
}
/** A markdown body as stored: CRLF / CR → LF, control characters (not tab / newline) dropped, trailing blanks off; null when empty. */
export function normaliseBody(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\r\n?/g, '\n').replace(CONTROL, '').replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  return s.trim().length === 0 ? null : s;
}
export function rawHtmlTags(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(TAG_RE)) { const n = m[1].toLowerCase(); if (!out.includes(n)) out.push(n); }
  if (COMMENT_RE.test(body) && !out.includes('!--')) out.push('!--');
  return out;
}
export function unsafeLinkSchemes(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(UNSAFE_LINK_RE)) { const n = m[1].toLowerCase(); if (!out.includes(n)) out.push(n); }
  return out;
}
export function bodyIsMarkdown(body: string): boolean {
  return rawHtmlTags(body).length === 0 && unsafeLinkSchemes(body).length === 0;
}
/** The `{{…}}` tokens in a body that are NOT one of the eleven facts (unique, in order). */
export function unknownTokens(body: string): string[] {
  const known = new Set<string>(PLATFORM_FACT_TOKENS);
  const out: string[] = [];
  for (const m of body.matchAll(TOKEN_RE)) { const k = m[1].trim(); if (!known.has(k) && !out.includes(k)) out.push(k); }
  return out;
}

export interface PageProblem { code: string; detail: string }
export interface TranslationInput { languageCode: string; title?: string | null; body: string }
export interface PageWords { title: string; body: string; translations: { languageCode: string; title: string | null; body: string }[] }

function bodyProblems(body: string | null, where: string): PageProblem[] {
  if (body === null) return [{ code: 'body_required', detail: `${where}: the body is empty.` }];
  const out: PageProblem[] = [];
  if (body.length > BODY_MAX) out.push({ code: 'body_too_long', detail: `${where}: the body is ${body.length} characters; at most ${BODY_MAX}.` });
  const tags = rawHtmlTags(body);
  if (tags.length) out.push({ code: 'raw_html', detail: `${where}: raw HTML is not stored (found ${tags.map((t) => `<${t}>`).join(', ')}) — write markdown.` });
  const schemes = unsafeLinkSchemes(body);
  if (schemes.length) out.push({ code: 'unsafe_link', detail: `${where}: a link target may not be ${schemes.map((s) => `${s}:`).join(', ')}.` });
  const unknown = unknownTokens(body);
  if (unknown.length) {
    out.push({ code: 'unknown_token', detail: `${where}: ${unknown.map((u) => `{{${u}}}`).join(', ')} is not a platform fact; the allowed tokens are ${PLATFORM_FACT_TOKENS.map((t) => `{{${t}}}`).join(', ')}.` });
  }
  return out;
}

/**
 * The review: every problem at once (the templates plane's W2282 rule — one-at-a-time is a guessing game). `knownLanguages` is the
 * `languages` table's active codes (Law 6: never a list in code); `sourceLanguage` is the version's own language, which a translation
 * may not repeat.
 */
export function assessWords(input: { title: string | null | undefined; body: string | null | undefined; translations?: TranslationInput[] },
  sourceLanguage: string, knownLanguages: readonly string[]): { ok: true; words: PageWords } | { ok: false; problems: PageProblem[] } {
  const problems: PageProblem[] = [];
  const title = normaliseTitle(input.title);
  if (title === null) problems.push({ code: 'title_required', detail: 'The title is empty.' });
  else if (title.length > TITLE_MAX) problems.push({ code: 'title_too_long', detail: `The title is ${title.length} characters; at most ${TITLE_MAX}.` });
  const body = normaliseBody(input.body);
  problems.push(...bodyProblems(body, 'Body'));
  const translations: PageWords['translations'] = [];
  const seen = new Set<string>();
  for (const t of input.translations ?? []) {
    const lang = String(t.languageCode ?? '').trim().toLowerCase();
    const where = `Translation (${lang || '?'})`;
    if (!knownLanguages.includes(lang)) { problems.push({ code: 'unknown_language', detail: `${where}: not an active language.` }); continue; }
    if (lang === sourceLanguage) { problems.push({ code: 'translation_is_source', detail: `${where}: the page is already written in this language.` }); continue; }
    if (seen.has(lang)) { problems.push({ code: 'duplicate_language', detail: `${where}: given twice.` }); continue; }
    seen.add(lang);
    const tTitle = normaliseTitle(t.title ?? null);
    if (tTitle !== null && tTitle.length > TITLE_MAX) problems.push({ code: 'title_too_long', detail: `${where}: the title is too long.` });
    const tBody = normaliseBody(t.body);
    problems.push(...bodyProblems(tBody, where));
    if (tBody !== null) translations.push({ languageCode: lang, title: tTitle, body: tBody });
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, words: { title: title as string, body: body as string, translations } };
}
