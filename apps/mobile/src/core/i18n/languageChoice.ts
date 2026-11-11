// apps/mobile/src/core/i18n/languageChoice.ts · PC-56 RTL-1h-1 · the ONE place the app turns a language choice into words and
// layout direction. Zero React Native imports (the RN `I18nManager` glue is injected as `applyDirection` — core/mechanisms/rtlBoot.ts
// in the app), so every rule here is unit-tested under the "core" jest project.
//
// Rules (07_RTL.md "RTL-1h SPLIT", lead-applied):
//  - Arabic only on an explicit choice. The saved `kv.lang` (written only by a tap) and a tap are explicit; nothing else is. The
//    phone's own language is never read.
//  - Right-to-left layout is ALLOWED only when the chosen language is right-to-left (Arabic). Otherwise the layout is locked
//    left-to-right — this closes the live leak where React Native mirrored the whole app on a phone set to Arabic/Urdu/Persian/
//    Hebrew. React Native reads these flags when the app starts, so they are written at the tap (for the next open) and again
//    at every start from the restored choice (so an affected phone is corrected from its next open).
//  - Q1 → A: a switch ACROSS directions (into or out of Arabic) is saved and shown as "close and reopen" — words and layout switch
//    together on the next open. A switch within left-to-right (en ↔ hi ↔ gu) stays instant, as before.
import { resolveServable, type LanguageDir } from '@krishalaya/i18n';
import { i18n } from './i18n';

export type ApplyDirection = (dir: LanguageDir) => unknown;

/** Start-up: read the saved choice FIRST, apply it, THEN set the layout direction from the language now on screen.
 *  Returns the saved code (or the default when nothing was saved). */
export async function restoreSavedLanguage(readSaved: () => Promise<string | undefined>, applyDirection: ApplyDirection): Promise<string> {
  const saved = await readSaved();
  const language = saved ?? i18n.lang;
  i18n.setLanguage(language, saved !== undefined ? 'explicit' : 'implicit');
  i18n.setPending(null);
  applyDirection(i18n.dir);
  return language;
}

/** A person tapped a language. Saves it on this phone, writes the layout flags for the next open, and either switches the words
 *  now (same direction) or marks the choice pending behind the restart notice (a different direction). */
export async function chooseLanguage(
  code: string,
  save: (code: string) => Promise<void>,
  applyDirection: ApplyDirection,
): Promise<{ restartRequired: boolean }> {
  const target = resolveServable(code, 'explicit');
  await save(code);
  applyDirection(target.dir);
  if (target.dir !== i18n.dir) {
    i18n.setPending(target.code);
    return { restartRequired: true };
  }
  i18n.setPending(null);
  i18n.setLanguage(code, 'explicit');
  return { restartRequired: false };
}

/** The native name to SHOW for a language code a person chose (live or the Arabic preview), or undefined for any other code —
 *  exactly the old `LANGUAGES.find((l) => l.code === code)?.nameNative`, plus Arabic. */
export function chosenLanguageName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  const def = resolveServable(code, 'explicit');
  return def.code === code ? def.nameNative : undefined;
}

/** The restart notice for a pending language, in the language on screen now. */
export function restartNoticeText(pending: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const target = resolveServable(pending, 'explicit');
  if (target.dir === 'rtl') return t('system.language.restart.toArabic');
  // Inside a right-to-left sentence the left-to-right name is isolated (FSI … PDI) so it cannot reorder the punctuation.
  const name = i18n.dir === 'rtl' ? `\u2068${target.nameNative}\u2069` : target.nameNative;
  return t('system.language.restart.toOther', { language: name });
}

