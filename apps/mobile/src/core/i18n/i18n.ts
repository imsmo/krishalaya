// apps/mobile/src/core/i18n/i18n.ts · the app's translation runtime. Wraps @krishalaya/i18n's Translator with
// the three bundled offline catalogs (hi/en/gu) so the UI is never blank even with no network (the DB
// `ui_messages` table is the eventual source of truth; these are the shipped fallback). The active language is
// resolved from (1) the user's saved choice, else (2) the device locale, else (3) English. Changing the language
// rebuilds the Translator and notifies subscribers (the React provider re-renders).
import { Translator, resolveLanguage, DEFAULT_LANGUAGE, type Messages } from '@krishalaya/i18n';
import en from './locales/en.json';
import hi from './locales/hi.json';
import gu from './locales/gu.json';

const CATALOGS: Record<string, Messages> = { en: en as Messages, hi: hi as Messages, gu: gu as Messages };

function build(langCode: string): Translator {
  const t = new Translator(resolveLanguage(langCode).code);
  // Register English first so it's always the per-key fallback, then the active language overrides.
  t.register('en', CATALOGS.en);
  for (const code of Object.keys(CATALOGS)) if (code !== 'en') t.register(code, CATALOGS[code]);
  return t;
}

class I18nRuntime {
  private _lang: string = DEFAULT_LANGUAGE;
  private _translator: Translator = build(DEFAULT_LANGUAGE);
  private readonly listeners = new Set<() => void>();

  get lang(): string { return this._lang; }
  get translator(): Translator { return this._translator; }

  /** Set the active language (idempotent). Accepts 'hi', 'hi-IN', etc.; falls back safely. */
  setLanguage(code: string | null | undefined): void {
    const resolved = resolveLanguage(code).code;
    if (resolved === this._lang) return;
    this._lang = resolved;
    this._translator = build(resolved);
    this.listeners.forEach((l) => l());
  }
  t(key: string, vars?: Record<string, string | number>): string { return this._translator.t(key, vars); }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const i18n = new I18nRuntime();
