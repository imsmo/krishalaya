// apps/web-partner/src/features/rtl/boundary-words.ts · PC-56 RTL-1g (owed since RTL-1d) — THE ERROR BOUNDARY'S WORDS, in the language the
// person chose. The storefront's boundary-words pattern (apps/web-storefront/src/features/sweep/boundary-words.ts), ported: PURE (the catalogues
// are plain objects), because `app/error.tsx` must be a client component and cannot call the server translator.
//
// Before RTL-1g the boundary read the en catalogue only and never the cookie, so a page error on an Arabic page was English inside
// <html dir="rtl">. Now it reads the `kv_lang` cookie (LANG_COOKIE, defined once in features/partner6/language.ts) and resolves it as EXPLICIT —
// the cookie is a person's own choice, so it may serve the Arabic machine draft; nothing here reads Accept-Language, so a browser that merely
// prefers Arabic still gets English (founder Q1 "opt-in only"). A key a catalogue lacks falls back to en, exactly as the server Translator does:
// partner hi/gu are PARTIAL (the four boundary keys are among the 378 pre-PARTNER-0 keys owed to the hi/gu backfill wave), so a Hindi or
// Gujarati page error is still English until that wave — unchanged. Only a PREVIEW language (Arabic) carries `lang`/`dir` on the boundary, so
// the en/hi/gu markup is byte-identical to before.
import { resolveServable, PREVIEW_LANGUAGES } from '@krishalaya/i18n';
import { en } from '../../i18n/en';
import { hi } from '../../i18n/hi';
import { gu } from '../../i18n/gu';
import { ar } from '../../i18n/ar';
import { LANG_COOKIE } from '../partner6/language';

const CATALOGS: Record<string, Record<string, string>> = { en, hi, gu, ar };

/** The `kv_lang` cookie from a `document.cookie` string → a servable language code (explicit: Arabic only when chosen; else en). */
export function cookieLang(cookie: string | null | undefined): string {
  const raw = String(cookie ?? '').split(/;\s*/).find((c) => c.startsWith(`${LANG_COOKIE}=`))?.slice(LANG_COOKIE.length + 1);
  return resolveServable(raw ? decodeURIComponent(raw) : undefined, 'explicit').code;
}

/** One boundary string in `code`'s catalogue, falling back to en (then the key) — the Translator's own fallback. */
export function boundaryText(code: string, key: string): string {
  return CATALOGS[code]?.[key] ?? en[key] ?? key;
}

export interface BoundaryWords {
  /** `lang`/`dir` for the boundary's root — set ONLY under a preview language (undefined otherwise, so React renders no attribute). */
  lang: string | undefined; dir: 'ltr' | 'rtl' | undefined;
  title: string; body: string; retry: string; signIn: string;
}

/** The error boundary's words for the person's chosen language (read from the cookie string). */
export function boundaryWords(cookie: string | null | undefined): BoundaryWords {
  const code = cookieLang(cookie);
  const preview = PREVIEW_LANGUAGES.includes(code);
  const def = resolveServable(code, 'explicit');
  return {
    lang: preview ? def.code : undefined,
    dir: preview ? def.dir : undefined,
    title: boundaryText(code, 'common.errorTitle'),
    body: boundaryText(code, 'common.errorBody'),
    retry: boundaryText(code, 'common.retry'),
    signIn: boundaryText(code, 'common.signInAgain'),
  };
}
