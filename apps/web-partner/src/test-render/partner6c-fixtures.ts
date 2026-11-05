// apps/web-partner/src/test-render/partner6c-fixtures.ts · PC-56 PARTNER-6c · WHAT THE PLATFORM TELLS A PARTNER PERSON — the render tests'
// shared fixtures: the two pages read nothing, so there is no data fixture at all — only the languages (the PACKAGE's list, never a literal
// here either), a stand-in for the Server Action, the canon's false words as visible-text regexes (the refusal list is stripped first — it
// names what it refuses) and the control counters. No person, place, institution, phone, claim reference or event code from the canon.
import { LANGUAGES, resolveLanguage, DEFAULT_LANGUAGE } from '@krishalaya/i18n';

export const CHOICES = LANGUAGES;
export const CURRENT = resolveLanguage(DEFAULT_LANGUAGE);
/** A stand-in for `chooseLanguageAction` (the render tests never call it). */
export const ACT = async (_fd: FormData): Promise<void> => undefined;

/** W270 / W271's false words in VISIBLE text (outside the refusal list). */
export const FALSE_6C = /inbox|unread|\d+ of \d+|digest|quiet hours|\b22:00\b|\b07:00\b|critical|same engine|survey clock|assign within|policy ?holder|\bDr\.|payout|₹|%|\bDND\b|fallback|renewal|reachability|\blocked\b|a farmer is waiting|defaults active|saved preferences|one click|every template|see plan settings|claim\.intimated|payout\.completed|consent\.expiring|security\.otp|Priti|Mehta|Bhavna|Rathod|Kesar|Vanthali|Bhesan|\bPM\b/i;

/** Controls: every `<input>` with its type, every `<select>` / `<textarea>`, every submit button. */
export const inputs = (html: string) => [...html.matchAll(/<input\b[^>]*>/g)].map(([m]) => (m.match(/type="([^"]+)"/) ?? [])[1] ?? 'text');
export const selects = (html: string) => (html.match(/<select\b|<textarea\b/g) ?? []).length;
export const submits = (html: string) => (html.match(/<button\b[^>]*type="submit"/g) ?? []).length;
export const forms = (html: string) => (html.match(/<form\b/g) ?? []).length;
