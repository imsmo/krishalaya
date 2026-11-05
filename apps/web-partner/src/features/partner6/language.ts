// apps/web-partner/src/features/partner6/language.ts · PC-56 PARTNER-6c · THE CONSOLE'S LANGUAGE (founder 6c-3, door Q7-A) — PURE. The one
// REAL act of PARTNER-6: a partner person chooses the language of the console for THIS BROWSER. The codes the console offers are READ from
// `@krishalaya/i18n`'s live language list (`LANGUAGES` — English, हिन्दी and ગુજરાતી today, each named in its own script by the package's
// `nameNative`) and are NEVER a literal list here, in the page, in the view or in the Server Action (Rule Zero: a language the platform adds
// to the package appears without a code change; test/language-act.spec.ts scans for a literal list). The choice is the storefront's `kv_lang`
// cookie (apps/web-storefront, STORE-4c's submitPreferencesAction): path `/`, SameSite=Lax, one year, readable by the page (HttpOnly not
// required — it holds no secret), Secure in production. No API call, no audit row, no person's data: a browser preference.
import { LANGUAGES, type LanguageDef } from '@krishalaya/i18n';

/** The cookie lib/i18n.ts reads first (cookie → Accept-Language → the default). */
export const LANG_COOKIE = 'kv_lang';
/** The page the act returns to (`?form=success|error|failure`). */
export const LANGUAGE_PAGE = '/account/notifications/preferences';
/** The languages the console offers — the package's live list itself (identity, not a copy). */
export const LANGUAGE_CHOICES: readonly LanguageDef[] = LANGUAGES;
export const ONE_YEAR_SEC = 60 * 60 * 24 * 365;

/** The posted / queried code → one of the package's live languages, EXACTLY (no 'hi-IN' widening, no case folding), or null. */
export function pickLanguage(raw: unknown): LanguageDef | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 8) return null;
  return LANGUAGE_CHOICES.find((l) => l.code === raw) ?? null;
}

/** The `kv_lang` cookie's attributes (founder 6c-3). */
export function languageCookie(): { path: string; sameSite: 'lax'; maxAge: number; httpOnly: boolean; secure: boolean } {
  return { path: '/', sameSite: 'lax', maxAge: ONE_YEAR_SEC, httpOnly: false, secure: process.env.NODE_ENV === 'production' };
}

/** Where the act sends the browser back to. */
export const languageHref = (form: 'success' | 'error' | 'failure') => `${LANGUAGE_PAGE}?form=${form}`;
