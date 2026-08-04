// @krishalaya/i18n · a tiny message catalog + translator. Frontends register per-language message dictionaries
// (loaded as JSON, code-split per locale) and call t(key, vars). Falls back to the default language, then to the
// key itself, so a missing translation degrades gracefully (never a blank UI). {placeholder} interpolation.
import { DEFAULT_LANGUAGE, resolveLanguage } from './languages';

export type Messages = Record<string, string>;
export class Translator {
  private readonly catalogs = new Map<string, Messages>();
  constructor(private readonly langCode: string = DEFAULT_LANGUAGE) {}
  register(langCode: string, messages: Messages): this { this.catalogs.set(resolveLanguage(langCode).code, { ...(this.catalogs.get(resolveLanguage(langCode).code) ?? {}), ...messages }); return this; }

  t(key: string, vars: Record<string, string | number> = {}): string {
    const active = resolveLanguage(this.langCode).code;
    const template = this.catalogs.get(active)?.[key] ?? this.catalogs.get(DEFAULT_LANGUAGE)?.[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_m, name) => (name in vars ? String(vars[name]) : `{${name}}`));
  }
}
