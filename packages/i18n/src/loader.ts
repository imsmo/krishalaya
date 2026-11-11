// @krishalaya/i18n · a tiny message catalog + translator. Frontends register per-language message dictionaries
// (loaded as JSON, code-split per locale) and call t(key, vars). Falls back to the default language, then to the
// key itself, so a missing translation degrades gracefully (never a blank UI). {placeholder} interpolation.
//
// PC-56 RTL-1a (survey F-1): catalogues are keyed by the REGISTRY code (`getRegistryEntry`), never by the LIVE
// resolution. Before, `register('ar', …)` keyed by `resolveLanguage('ar').code` — which is 'en' for any non-live
// code — so an Arabic catalogue would have been merged OVER English for every user. Now a non-live or unknown code
// keeps its own slot and can never touch 'en'. The active language is the SERVABLE one (`resolveServable`, explicit):
// the code a Translator is built with is the app's already-resolved choice, so a preview language (`ar`) is served
// when the app passes it, and every other non-live or unknown code still falls back to en, exactly as before.
import { DEFAULT_LANGUAGE, getRegistryEntry, resolveServable } from './languages';

export type Messages = Record<string, string>;

/** The catalogue slot for a code: its registry code ('hi-IN' → 'hi', 'ar' → 'ar'), or the code itself if unknown. */
function catalogKey(langCode: string): string { return getRegistryEntry(langCode)?.code ?? langCode; }

export class Translator {
  private readonly catalogs = new Map<string, Messages>();
  constructor(private readonly langCode: string = DEFAULT_LANGUAGE) {}
  register(langCode: string, messages: Messages): this {
    const key = catalogKey(langCode);
    this.catalogs.set(key, { ...(this.catalogs.get(key) ?? {}), ...messages });
    return this;
  }

  t(key: string, vars: Record<string, string | number> = {}): string {
    const active = resolveServable(this.langCode, 'explicit').code;
    const template = this.catalogs.get(active)?.[key] ?? this.catalogs.get(DEFAULT_LANGUAGE)?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_m, name) => (name in vars ? String(vars[name]) : `{${name}}`));
  }
}
