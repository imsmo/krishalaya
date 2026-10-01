// modules/cms/domain/banner-rules.ts · PC-56 TENANT-8d · THE BANNERS — the record's own rules, pure.
//
// W173: *"Text lives in the banner record, never baked into the image (i18n law)."* W174: *"Members see exactly their
// language. Missing variant = banner hidden for that language, never English-forced."* So a banner's words are
// `banner_texts` rows (0178), one per language — a headline, an optional line of body, a CTA label — and three
// languages are required before it reaches anyone: `REQUIRED_LANGUAGES`, the same list as 0178's
// `banner_required_languages()` (a console spec reads both).
//
// The words are PLAIN TEXT (a member's app renders them over the image): no `<` / `>` at all — 0178's CHECK, here first.
// The link is https only: W174's `app://catalogue/…` deep link has no registry of app routes to validate against and no
// reader to open it — refused by name in the console, never stored as a free string.

export const REQUIRED_LANGUAGES = ['en', 'hi', 'gu'] as const;
export const HEADLINE_MAX = 120;
export const BODY_MAX = 300;
export const CTA_MAX = 40;
export const GROUP_KEY_MAX = 60;
export const TARGET_MAX = 400;
export const MIN_REASON = 3;
export const MAX_REASON = 300;
/** One banner's audience lists are bounded (0178: `AUDIENCE_TOO_MANY` above this). */
export const AUDIENCE_LIST_MAX = 20;

const GROUP_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Collapse inner whitespace runs, trim; null when nothing is left. */
export function normaliseText(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/\s+/g, ' ').trim();
  return s.length === 0 ? null : s;
}

/** A word of a banner carrying markup (any `<` or `>`): the member app renders text, never HTML. */
export function hasMarkup(s: string | null): boolean { return s !== null && /[<>]/.test(s); }

/**
 * The variant group, as stored: lower case, spaces and underscores become hyphens, anything else outside [a-z0-9-] is
 * dropped, hyphen runs collapse, edge hyphens go. Null when nothing is left.
 */
export function normaliseGroupKey(raw: string | null | undefined): string | null {
  const s = (raw ?? '').toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return s.length === 0 ? null : s;
}
export function groupKeyIssue(key: string | null): 'GROUP_KEY_TOO_LONG' | 'GROUP_KEY_INVALID' | null {
  if (key === null) return null;
  if (key.length > GROUP_KEY_MAX) return 'GROUP_KEY_TOO_LONG';
  return GROUP_RE.test(key) ? null : 'GROUP_KEY_INVALID';
}

export type TargetIssue = 'TARGET_NOT_HTTPS' | 'TARGET_INVALID' | 'TARGET_TOO_LONG';
/** The link a banner opens: https, a host, no whitespace, ≤ 400. Empty → no link (null, no issue). */
export function parseTargetUrl(raw: string | null | undefined): { url: string | null; issue: TargetIssue | null } {
  const s = (raw ?? '').trim();
  if (s.length === 0) return { url: null, issue: null };
  if (s.length > TARGET_MAX) return { url: null, issue: 'TARGET_TOO_LONG' };
  if (/\s/.test(s)) return { url: null, issue: 'TARGET_INVALID' };
  let u: URL;
  try { u = new URL(s); } catch { return { url: null, issue: 'TARGET_INVALID' }; }
  if (u.protocol !== 'https:') return { url: null, issue: 'TARGET_NOT_HTTPS' };
  if (u.hostname.length === 0) return { url: null, issue: 'TARGET_INVALID' };
  return { url: s, issue: null };
}

/** One language's words as the writer stores them. */
export interface BannerText { languageCode: string; headline: string; body: string | null; ctaLabel: string | null }

/** The required languages a set of texts does not speak, in the required order. */
export function missingLanguages(present: readonly string[]): string[] {
  return REQUIRED_LANGUAGES.filter((l) => !present.includes(l));
}

/** The languages a member's app could show this banner in, required first, then any other the tenant added. */
export function orderedLanguages(languages: readonly string[]): string[] {
  const req = REQUIRED_LANGUAGES.filter((l) => languages.includes(l));
  const rest = languages.filter((l) => !(REQUIRED_LANGUAGES as readonly string[]).includes(l));
  return [...req, ...[...new Set(rest)].sort()];
}

/** The reason an act or a write is recorded with: 3–300 characters after trimming. */
export function reasonIssue(raw: string | null | undefined): 'REASON_REQUIRED' | 'REASON_TOO_LONG' | null {
  const s = (raw ?? '').trim();
  if (s.length < MIN_REASON) return 'REASON_REQUIRED';
  return s.length > MAX_REASON ? 'REASON_TOO_LONG' : null;
}

/** `"farmer, dairy_farmer farmer"` → `['farmer', 'dairy_farmer']` — the console's list inputs (comma or space). */
export function parseList(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const x of (raw ?? '').split(/[\s,]+/)) {
    const v = x.trim().toLowerCase();
    if (v.length > 0 && !out.includes(v)) out.push(v);
  }
  return out;
}
