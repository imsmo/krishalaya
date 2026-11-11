// apps/mobile/src/core/i18n/dates.ts · PC-56 RTL-1h-2 (survey F-H3) — a date or a date-and-time in the APP's language, never the
// phone's. Before this wave eleven screens called `toLocaleString()` / `toLocaleDateString()` with no locale, so they printed in
// the phone's own language (Hindi month names on a Hindi phone, Arabic-Indic digits on an Arabic phone) whatever the person chose
// in the app — an implicit preference, against "opt-in only" and "Western digits". They now go through `formatDate(…, lang)`
// (`ar-AE-u-nu-latn` under a chosen Arabic: Arabic month names, Western digits). rtl1h2-money-dates-arrows.spec pins 0 no-locale
// `toLocale*` calls under src/.
// Never throws in a render path (Law 12): an unreadable value prints as it came, where `toLocaleString()` printed "Invalid Date".
import { formatDate } from '@krishalaya/i18n';

/** A date, medium style ("4 Oct 2026" in en). */
export function dateText(value: string | number | Date, lang: string): string {
  try { return formatDate(value, lang, { dateStyle: 'medium' }); } catch { return String(value); }
}
/** A date and a time, medium + short ("4 Oct 2026, 3:30 pm" in en). */
export function dateTimeText(value: string | number | Date, lang: string): string {
  try { return formatDate(value, lang, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(value); }
}
