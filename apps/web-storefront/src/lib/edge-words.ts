// apps/web-storefront/src/lib/edge-words.ts · PC-56 STORE-SWEEP-b · C1 (founder D4, survey F-6 / B12 / E4) — THE MIDDLEWARE'S OWN WORDS. EDGE-SAFE:
// no `server-only`, no `next/headers`, no import from lib/i18n (that module is a Server Component API the Edge runtime does not provide —
// middleware.ts:27-29), and not the 2,600-key catalogues: three sentences in three languages, written here as literals.
//
// A request on a STORE's own host whose organisation cannot be looked up (the API is unreachable) answered bare English text, and an unknown host
// the same (middleware.ts, TENANT-13d): no language, no `lang`/`dir`, no page (Law 7, Law 12; canon W320 "when WE'RE the problem"). Now each is a
// small HTML page: `lang` and `dir` from the `kv_lang` cookie (else the default), the words of the three questions W316 asks — what happened, is my
// stuff safe, what do I do now — and the status code in small print for support. NO brand and NO organisation name (the host may belong to nobody;
// the platform is not this organisation). The 503 keeps `retry-after`. test/edge-words.spec.ts pins every literal below to the catalogues'
// `sweep.edge.*` values (en/hi/gu), so the two can never drift.
import { resolveServable, PREVIEW_LANGUAGES } from '@krishalaya/i18n';

export type EdgeWordKey = 'lookupFailed' | 'noOrganisation' | 'tryAgain';
export const EDGE_WORD_KEYS: readonly EdgeWordKey[] = Object.freeze(['lookupFailed', 'noOrganisation', 'tryAgain'] as EdgeWordKey[]);

export const EDGE_WORDS: Readonly<Record<'en' | 'hi' | 'gu', Readonly<Record<EdgeWordKey, string>>>> = Object.freeze({
  en: Object.freeze({
    lookupFailed: 'The store at this address could not be looked up just now. The problem is on our side; nothing you saved or ordered is affected.',
    noOrganisation: 'No organisation’s store is served at this address. Check the address, or open the link the organisation gave you again.',
    tryAgain: 'Try again in a few seconds.',
  }),
  hi: Object.freeze({
    lookupFailed: 'इस पते का स्टोर अभी खोजा नहीं जा सका। समस्या हमारी ओर से है; आपने जो सहेजा या ऑर्डर किया है, उस पर कोई असर नहीं है।',
    noOrganisation: 'इस पते पर किसी संगठन का स्टोर नहीं चलता। पता जाँचें, या संगठन का दिया हुआ लिंक फिर से खोलें।',
    tryAgain: 'कुछ सेकंड बाद फिर से कोशिश करें।',
  }),
  gu: Object.freeze({
    lookupFailed: 'આ સરનામાનો સ્ટોર હમણાં શોધી શકાયો નહીં. સમસ્યા અમારી બાજુ છે; તમે જે સાચવ્યું કે ઑર્ડર કર્યું છે તેના પર કોઈ અસર નથી.',
    noOrganisation: 'આ સરનામે કોઈ સંસ્થાનો સ્ટોર ચાલતો નથી. સરનામું તપાસો, અથવા સંસ્થાએ આપેલી લિંક ફરી ખોલો.',
    tryAgain: 'થોડી સેકંડ પછી ફરી પ્રયાસ કરો.',
  }),
});

// PC-56 RTL-1c (founder Q1 "Draft all, opt-in only"): the ARABIC machine draft of the same three sentences, plus the machine-draft banner line —
// served only when the `kv_lang` cookie (a person's own choice) is `ar`, never from a browser preference (the Edge page reads no Accept-Language).
// Kept apart from EDGE_WORDS (the three LIVE languages, which test/edge-words.spec.ts pins); test/rtl-edge-words.spec.ts pins every literal below
// to the ar catalogue's `sweep.edge.*` / `rtl.draftBanner` values and the English banner line to en's.
export const EDGE_WORDS_PREVIEW: Readonly<Record<'ar', Readonly<Record<EdgeWordKey | 'draftBanner', string>>>> = Object.freeze({
  ar: Object.freeze({
    lookupFailed: 'تعذّر البحث عن المتجر على هذا العنوان الآن. المشكلة من جهتنا؛ لا شيء مما حفظته أو طلبته تأثّر.',
    noOrganisation: 'لا يوجد متجر لأي منظمة على هذا العنوان. تحقق من العنوان، أو افتح الرابط الذي أعطتك إياه المنظمة مرة أخرى.',
    tryAgain: 'حاول مرة أخرى بعد بضع ثوانٍ.',
    draftBanner: 'هذا النص العربي مسودة آلية ولم تتم مراجعته.',
  }),
});
/** The English line of the machine-draft banner (en's `rtl.draftBanner`), printed under the preview language's own line. */
export const EDGE_DRAFT_BANNER_EN = 'This Arabic text is a machine draft and has not been reviewed.';

type EdgeCode = 'en' | 'hi' | 'gu' | 'ar';
const wordsOf = (code: EdgeCode): Readonly<Record<EdgeWordKey, string>> => (code === 'ar' ? EDGE_WORDS_PREVIEW.ar : EDGE_WORDS[code]);

/** The page's language from the `kv_lang` cookie value (a person's choice, so EXPLICIT — the Arabic preview may be served): a language with
 *  words here, else the default. */
export function edgeLang(cookie: string | null | undefined): { code: EdgeCode; dir: 'ltr' | 'rtl' } {
  const def = resolveServable(cookie || undefined, 'explicit');
  const code = (def.code in EDGE_WORDS || def.code in EDGE_WORDS_PREVIEW ? def.code : 'en') as EdgeCode;
  return { code, dir: code === def.code ? def.dir : 'ltr' };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The answer's HTML: 503 = the lookup failed (+ try again), 404 = no organisation here. Under a preview language (Arabic) the machine-draft
 *  banner (`role="note"`, its own line and the English line) leads the page, as in the root layout. */
export function edgeHtml(kind: 'unavailable' | 'unknown_host', cookie: string | null | undefined): string {
  const { code, dir } = edgeLang(cookie);
  const w = wordsOf(code);
  const head = kind === 'unavailable' ? w.lookupFailed : w.noOrganisation;
  const status = kind === 'unavailable' ? '503' : '404';
  const body = kind === 'unavailable' ? `<p>${esc(w.tryAgain)}</p>` : '';
  const banner = PREVIEW_LANGUAGES.includes(code)
    ? `<div class="kv-md-banner" role="note" data-kv-md-banner="${code}"><p lang="${code}" dir="${dir}">${esc(EDGE_WORDS_PREVIEW.ar.draftBanner)}</p>`
      + `<p lang="en" dir="ltr">${esc(EDGE_DRAFT_BANNER_EN)}</p></div>`
    : '';
  return `<!doctype html><html lang="${code}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="robots" content="noindex"><title>${esc(head)}</title></head>`
    + `<body>${banner}<main data-kv-edge="${kind}"><h1>${esc(head)}</h1>${body}<p><small>${status}</small></p></main></body></html>`;
}

/** The headers of an edge answer. */
export function edgeHeaders(kind: 'unavailable' | 'unknown_host'): Record<string, string> {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    ...(kind === 'unavailable' ? { 'retry-after': '10' } : {}),
  };
}
