// apps/mobile/src/core/i18n/i18n.ts · the app's translation runtime. Wraps @krishalaya/i18n's Translator with
// the bundled offline catalogs (hi/en/gu, plus the Arabic machine draft) so the UI is never blank even with no network (the DB
// `ui_messages` table is the eventual source of truth; these are the shipped fallback). The active language comes ONLY from
// (1) the person's saved choice on this phone (`kv.lang`, written only by a tap in a language picker), else (2) English.
// The phone's own language (device locale) is NEVER read — no `expo-localization` call exists anywhere in the app (pinned by
// core/__tests__/rtl1h1-plumbing.spec.ts). Changing the language rebuilds the Translator and notifies subscribers.
//
// PC-56 RTL-1h-1: Arabic (`ar`, a PREVIEW language — machine draft, not reviewed) is served only through
// `resolveServable(code, 'explicit')`. `setLanguage` takes the choice kind and DEFAULTS to 'implicit', so a caller that does
// not say "a person chose this" can never reach Arabic by omission. Keys missing from the Arabic draft fall back to English
// through the Translator (the RTL-1b-1 pattern).
import { Translator, resolveServable, DEFAULT_LANGUAGE, type Messages, type LanguageChoice, type LanguageDir } from '@krishalaya/i18n';
import en from './locales/en.json';
import hi from './locales/hi.json';
import gu from './locales/gu.json';
import ar from './locales/ar';

const CATALOGS: Record<string, Messages> = { en: en as Messages, hi: hi as Messages, gu: gu as Messages, ar };

/** `langCode` is already a resolved, servable code (see `setLanguage`). */
function build(langCode: string): Translator {
  const t = new Translator(langCode);
  // Register English first so it's always the per-key fallback, then the active language overrides.
  t.register('en', CATALOGS.en);
  for (const code of Object.keys(CATALOGS)) if (code !== 'en') t.register(code, CATALOGS[code]);
  return t;
}

class I18nRuntime {
  private _lang: string = DEFAULT_LANGUAGE;
  private _translator: Translator = build(DEFAULT_LANGUAGE);
  private _pending: string | null = null;
  private readonly listeners = new Set<() => void>();

  get lang(): string { return this._lang; }
  /** The writing direction of the language on screen now (`ltr` for en/hi/gu, `rtl` only for a chosen Arabic). */
  get dir(): LanguageDir { return resolveServable(this._lang, 'explicit').dir; }
  get translator(): Translator { return this._translator; }
  /** A language the person chose that only takes over after the app is closed and reopened (a switch across directions,
   *  RTL-1h Q1 → A), or null. Drives the restart notice on the app shell. */
  get pending(): string | null { return this._pending; }

  /** Set the active language (idempotent). Accepts 'hi', 'hi-IN', etc.; falls back safely. `choice` says how the code reached
   *  us: only 'explicit' (a person's tap, or their saved `kv.lang`) may serve a preview language (Arabic). */
  setLanguage(code: string | null | undefined, choice: LanguageChoice = 'implicit'): void {
    const resolved = resolveServable(code, choice).code;
    if (resolved === this._lang) return;
    this._lang = resolved;
    this._translator = build(resolved);
    this.listeners.forEach((l) => l());
  }
  /** Record (or clear, with null) the language waiting for the next open. */
  setPending(code: string | null): void {
    if (code === this._pending) return;
    this._pending = code;
    this.listeners.forEach((l) => l());
  }
  t(key: string, vars?: Record<string, string | number>): string { return this._translator.t(key, vars); }
  /** The English catalogue value for a key, whatever the active language (the machine-draft banner's English line). */
  english(key: string): string { return CATALOGS.en[key] ?? key; }
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}

export const i18n = new I18nRuntime();
