// @krishalaya/i18n · the supported-language registry (mirrors the DB `languages` table). Launch set is
// Hindi / English / Gujarati; `dir` drives RTL layout; `intlLocale` is the BCP-47 tag passed to Intl for
// number/date formatting.
//
// DEV-21 (i18n infra): this file now carries the FULL, TRUTHFUL 14-entry registry (3 live + 11 canon-shipped
// target languages) as `LANGUAGE_REGISTRY` — the single source of truth for both "what's selectable today" and
// "what's coming, honestly labelled" (mirrors the canon's own honesty law: BODY-5 killed the fake "22 languages"
// site claim; this registry is the one that must never repeat that mistake). `LANGUAGES` keeps its EXACT prior
// meaning and shape (the LIVE/selectable subset, currently hi/en/gu) — every existing consumer (LocaleSwitcher,
// mobile i18n runtime, resolveLanguage/isSupported, the Translator) is UNCHANGED by this batch; this is additive.
//
// The 11 target languages mirror the 11 canon language directories (`Phase-1 all screen design/
// Krishalaya_Design_System/screens/lang-{code}/`, grep-verified to exist for all 11): mr/bn/te/ta/as/pa/kn/ml/or
// (APPLY-1..6, machine-draft, TS-003 §d "is_machine=true in spirit until reviewed_by is set") + ar (APPLY-6,
// RTL-mirroring proof, ar-AE CANDIDATE locale per SITE-023, not a ratified locale) + ur (CLOSE-2, RTL, Nastaliq,
// BRAND-018 forward canon — "the first real Urdu specimen string this design system has produced ... still not a
// launch"). `ur` carries an EXTRA boundary note (`codeCatalogAbsent: true`) — unlike the other 10 target
// languages, ur has zero app-code translation catalog anywhere (`apps/mobile/src/core/i18n/locales/` holds only
// en/hi/gu.json, grep-verified; DEV-20's own `core/mechanisms/rtl.ts` comment states this explicitly) even though
// its 15-screen canon design set already exists — the DESIGN string exists, the CODE catalog does not.
export type LanguageDir = 'ltr' | 'rtl';
export type LanguageStatus = 'live' | 'machine-draft-pending-review';

export interface LanguageDef { code: string; nameNative: string; nameEnglish: string; intlLocale: string; dir: LanguageDir; }

/** The full registry entry — everything `LanguageDef` carries, plus the truthful status/script/font-pack/
 * catalog-boundary fields a picker needs to render an honest "live" vs "coming soon" row (canon screen
 * `screens/187-language-switcher.html`). */
export interface LanguageRegistryEntry extends LanguageDef {
  script: string;         // Unicode script name (BRAND-016 script-metrics terminology)
  fontPack: string;       // id into `fontPacks.ts`'s FONT_PACKS — never a bare font-family string
  status: LanguageStatus;
  /** True only for `ur`: the canon design set (screens/lang-ur/) exists but no app-code i18n catalog does yet —
   *  see this file's header comment. Absent (undefined) means "no known extra boundary beyond `status`". */
  codeCatalogAbsent?: true;
}

export const LANGUAGE_REGISTRY: readonly LanguageRegistryEntry[] = Object.freeze([
  // --- LIVE (3) ---
  { code: 'hi', nameNative: 'हिन्दी', nameEnglish: 'Hindi', intlLocale: 'hi-IN', dir: 'ltr', script: 'Devanagari', fontPack: 'hind', status: 'live' },
  { code: 'en', nameNative: 'English', nameEnglish: 'English', intlLocale: 'en-IN', dir: 'ltr', script: 'Latin', fontPack: 'plusJakartaSans', status: 'live' },
  { code: 'gu', nameNative: 'ગુજરાતી', nameEnglish: 'Gujarati', intlLocale: 'gu-IN', dir: 'ltr', script: 'Gujarati', fontPack: 'hindVadodara', status: 'live' },
  // --- TARGET / machine-draft-pending-review (11, one per canon lang dir) ---
  { code: 'mr', nameNative: 'मराठी', nameEnglish: 'Marathi', intlLocale: 'mr-IN', dir: 'ltr', script: 'Devanagari', fontPack: 'hind', status: 'machine-draft-pending-review' },
  { code: 'bn', nameNative: 'বাংলা', nameEnglish: 'Bengali', intlLocale: 'bn-IN', dir: 'ltr', script: 'Bengali', fontPack: 'hindSiliguri', status: 'machine-draft-pending-review' },
  { code: 'te', nameNative: 'తెలుగు', nameEnglish: 'Telugu', intlLocale: 'te-IN', dir: 'ltr', script: 'Telugu', fontPack: 'hindGuntur', status: 'machine-draft-pending-review' },
  { code: 'ta', nameNative: 'தமிழ்', nameEnglish: 'Tamil', intlLocale: 'ta-IN', dir: 'ltr', script: 'Tamil', fontPack: 'hindMadurai', status: 'machine-draft-pending-review' },
  { code: 'as', nameNative: 'অসমীয়া', nameEnglish: 'Assamese', intlLocale: 'as-IN', dir: 'ltr', script: 'Bengali', fontPack: 'hindSiliguri', status: 'machine-draft-pending-review' },
  { code: 'pa', nameNative: 'ਪੰਜਾਬੀ', nameEnglish: 'Punjabi', intlLocale: 'pa-IN', dir: 'ltr', script: 'Gurmukhi', fontPack: 'balooPaaji2', status: 'machine-draft-pending-review' },
  { code: 'kn', nameNative: 'ಕನ್ನಡ', nameEnglish: 'Kannada', intlLocale: 'kn-IN', dir: 'ltr', script: 'Kannada', fontPack: 'balooTamma2', status: 'machine-draft-pending-review' },
  { code: 'ml', nameNative: 'മലയാളം', nameEnglish: 'Malayalam', intlLocale: 'ml-IN', dir: 'ltr', script: 'Malayalam', fontPack: 'balooChettan2', status: 'machine-draft-pending-review' },
  { code: 'or', nameNative: 'ଓଡ଼ିଆ', nameEnglish: 'Odia', intlLocale: 'or-IN', dir: 'ltr', script: 'Odia', fontPack: 'balooBhaina2', status: 'machine-draft-pending-review' },
  { code: 'ar', nameNative: 'العربية', nameEnglish: 'Arabic', intlLocale: 'ar-AE', dir: 'rtl', script: 'Arabic', fontPack: 'notoNaskhArabic', status: 'machine-draft-pending-review' },
  { code: 'ur', nameNative: 'اردو', nameEnglish: 'Urdu', intlLocale: 'ur-PK', dir: 'rtl', script: 'Arabic', fontPack: 'notoNastaliqUrdu', status: 'machine-draft-pending-review', codeCatalogAbsent: true },
]);

/** The LIVE/selectable subset, in registry order — same shape and meaning `LANGUAGES` has always had. Every
 *  pre-existing consumer (LocaleSwitcher forms, mobile i18n runtime, resolveLanguage/isSupported) keeps working
 *  unchanged: this is a derived view, not a new source of data. */
export const LANGUAGES: readonly LanguageDef[] = Object.freeze(
  LANGUAGE_REGISTRY.filter((l) => l.status === 'live').map(({ code, nameNative, nameEnglish, intlLocale, dir }) => ({ code, nameNative, nameEnglish, intlLocale, dir })),
);

export const DEFAULT_LANGUAGE = 'en';
const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));
const REGISTRY_BY_CODE = new Map(LANGUAGE_REGISTRY.map((l) => [l.code, l]));

/** Resolve to a LIVE `LanguageDef` (unchanged behavior: a code that's only in the target/machine-draft set still
 *  falls back to the default language here — resolveLanguage has only ever meant "a language we can actually
 *  render UI catalogs in"). Accepts 'hi-IN' → 'hi'. */
export function resolveLanguage(code: string | undefined | null): LanguageDef {
  if (code && BY_CODE.has(code)) return BY_CODE.get(code)!;
  // accept 'hi-IN' → 'hi'
  const short = code?.split('-')[0];
  return (short && BY_CODE.get(short)) || BY_CODE.get(DEFAULT_LANGUAGE)!;
}

/** True only for a LIVE language code (unchanged meaning). Use `isRegistered` for "is this any known code,
 *  live or target" — the two questions are different and this batch keeps them separately named. */
export function isSupported(code: string): boolean { return BY_CODE.has(code) || BY_CODE.has(code.split('-')[0]); }

/** The full registry entry (live OR target) for a code, or undefined for a code this platform has never named
 *  anywhere — never invents a 15th language. Pickers use this to render an honest "coming soon" row (native name,
 *  script, RTL direction) for a language that isn't selectable yet, per canon screen 187's own pattern. */
export function getRegistryEntry(code: string): LanguageRegistryEntry | undefined {
  return REGISTRY_BY_CODE.get(code) || REGISTRY_BY_CODE.get(code.split('-')[0] ?? '');
}

/** True for any of the 14 registered codes, live or target — distinct from `isSupported` (live-only). */
export function isRegistered(code: string): boolean { return REGISTRY_BY_CODE.has(code) || REGISTRY_BY_CODE.has(code.split('-')[0] ?? ''); }

/** The target/"coming soon" entries in registry order — exactly the 11 non-live rows. Pickers iterate this
 *  directly rather than re-deriving the filter, so "how many languages are coming soon" is always this array's
 *  length, never a hardcoded number. */
export const COMING_SOON_LANGUAGES: readonly LanguageRegistryEntry[] = Object.freeze(
  LANGUAGE_REGISTRY.filter((l) => l.status !== 'live'),
);
