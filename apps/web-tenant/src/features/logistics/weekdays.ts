// apps/web-tenant/src/features/logistics/weekdays.ts · the seven days, once (PC-56 TENANT-5b).
//
// `delivery_routes.run_weekday` is 0=Sunday … 6=Saturday (its own CHECK, and `Date.getUTCDay()`'s convention), and
// the API returns an i18n KEY for the day rather than a name — because "Sat" is a word in three launch languages
// and a weekday typed into a template is a hardcoded string (Law 7).
//
// This is the console's side of that: the option list a form offers, in ONE place, so a picker and a review step
// cannot disagree about which number means Thursday.

export interface WeekdayOption { value: number; code: 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' }

export const WEEKDAY_OPTIONS: readonly WeekdayOption[] = [
  { value: 0, code: 'sun' },
  { value: 1, code: 'mon' },
  { value: 2, code: 'tue' },
  { value: 3, code: 'wed' },
  { value: 4, code: 'thu' },
  { value: 5, code: 'fri' },
  { value: 6, code: 'sat' },
];

/** The i18n key for a stored weekday number, or null when the route runs on demand rather than on a day. */
export function weekdayKeyOf(value: number | null): string | null {
  const hit = value === null ? undefined : WEEKDAY_OPTIONS.find((w) => w.value === value);
  return hit ? `route.day.${hit.code}` : null;
}
