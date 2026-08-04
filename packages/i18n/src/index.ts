// @krishalaya/i18n · public entry — language registry, money/number/date formatters, message translator.
export {
  LANGUAGES, LANGUAGE_REGISTRY, COMING_SOON_LANGUAGES, DEFAULT_LANGUAGE,
  resolveLanguage, isSupported, getRegistryEntry, isRegistered,
} from './languages';
export type { LanguageDef, LanguageRegistryEntry, LanguageDir, LanguageStatus } from './languages';
export { FONT_PACKS, getFontPack } from './fontPacks';
export type { FontPackDef, FontPackStatus } from './fontPacks';
export { formatMoneyMinor, formatNumber, formatDate, formatRelative } from './format';
export { Translator } from './loader';
export type { Messages } from './loader';
