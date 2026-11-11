// apps/web-storefront/src/features/rtl/intl.ts · PC-56 RTL-1c (survey F-7 / G-9) — the Intl tag for a page language, digits pinned under rtl.
//
// Four sites build `new Intl.*(lang, …)` with the BARE app code (two of them client components, so the BROWSER's ICU decides): a bare `ar` there
// may print Arabic-Indic digits, against founder Q4 "Western digits". Under a preview language the tag is the registry's pinned
// `ar-AE-u-nu-latn`; under en/hi/gu it is the bare code exactly as before (byte-identical — `en` stays `en`, never re-mapped to en-IN). Pure.
import { PREVIEW_LANGUAGES, resolveServable } from '@krishalaya/i18n';

export function intlTag(lang: string): string {
  return PREVIEW_LANGUAGES.includes(lang) ? resolveServable(lang, 'explicit').intlLocale : lang;
}
