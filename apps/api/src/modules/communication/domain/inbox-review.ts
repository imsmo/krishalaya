// modules/communication/domain/inbox-review.ts · PC-56 TENANT-8b · the notification FORM chain's API-computed reviews —
// W2683 (form-error) → W2684 (review) → W2685 (success) → W2686 (failure), for the canon's three acts on this module:
// *Change window* (quiet hours) · *Save preferences* (the W433 matrix) · *Change language*.
//
// A REVIEW BUILT FROM WHAT WAS TYPED IS AN ECHO (shared/form-review.ts). These show what the platform WILL WRITE and
// what it will DO with it:
//   • the window: both times, the zone a member's window is read in — refused when the database does not know it (the
//     writer's own registry, `pg_timezone_names`, which `trg_uqh_timezone_known` checks) or this process cannot use it
//     (F-6), and PROPOSED from the cooperative when left blank (never an `Asia/Kolkata` literal, F-22); then the window
//     maths — its length, whether it crosses midnight, its next occurrence as two instants in that zone, which channels
//     it HOLDS (push · SMS · WhatsApp · IVR) and which never wait (in-app · email), that critical notices ignore it, and
//     the diff against the window that applies TODAY (yours, or the cooperative's default);
//   • the matrix: each changed event × channel — an event the catalogue does not hold, a channel the event is never sent
//     on, and switching off an event members may not opt out of (critical / locked) are refused by name; the diff is
//     against what is in force today (your override, else the catalogue's "on");
//   • the language: a code from the platform's ACTIVE registry (Law 6 — `users.language_code` is FK'd to `languages`, so
//     a typo would be a 23503, not a sentence), unchanged refused.
import { ReviewDiffRow, ReviewField, ReviewRefusal, ReviewResult, WriterIssue, WRITER_REFUSALS, field, reviewResult, trimOrNull, writerRefusals } from '../../../shared/form-review';
import { EffectiveWindow, crossesMidnight, nextOccurrence, toMinutes, windowLengthMinutes } from './quiet-window';
import { isUsableTimezone } from './timezone';

/* ---------------------------------------------------------------------------------------------------------- */
/* CHANGE WINDOW                                                                                              */
/* ---------------------------------------------------------------------------------------------------------- */

export const WINDOW_FIELDS = ['starts', 'ends', 'timezone'] as const;
export const WINDOW_REFUSALS = ['STARTS_INVALID', 'ENDS_INVALID', 'TIMEZONE_UNKNOWN', 'TIMEZONE_UNUSABLE', 'WINDOW_UNCHANGED', ...WRITER_REFUSALS] as const;
export type WindowRefusal = (typeof WINDOW_REFUSALS)[number];

/** The channels a quiet window HOLDS, and the ones that never wait — printed by the review, read from one place. */
export const HELD_CHANNELS = ['push', 'sms', 'whatsapp', 'ivr'] as const;
export const NEVER_HELD_CHANNELS = ['inapp', 'email'] as const;

export interface WindowMaths {
  /** Minutes the window lasts; 0 = off (starts = ends). */
  lengthMinutes: number;
  off: boolean;
  crossesMidnight: boolean;
  /** Its current-or-next occurrence, as instants in the stored zone. Null when off or not computable. */
  next: { start: string; end: string; current: boolean } | null;
  zone: string | null;
  /** True when the zone was left blank and the cooperative's will be stored. */
  zoneFromTenant: boolean;
}
export interface WindowReview extends ReviewResult { maths: WindowMaths; stored: { starts: string | null; ends: string | null; timezone: string | null } }

/** `HH:MM[:SS]` → `HH:MM` (what the column will read back as), or null. */
export function normaliseTime(raw: string | null | undefined): string | null {
  const m = toMinutes(raw);
  return m === null ? null : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function reviewWindow(i: {
  entered: { starts?: string | null; ends?: string | null; timezone?: string | null };
  /** Is the zone in the database's registry (`pg_timezone_names`)? Null when nothing was asked (blank → tenant zone). */
  zoneKnown: boolean | null;
  tenantZone: string | null;
  current: EffectiveWindow | null;
  now: Date;
  writerIssues?: readonly WriterIssue[];
}): WindowReview {
  const startsIn = trimOrNull(i.entered.starts); const endsIn = trimOrNull(i.entered.ends); const zoneIn = trimOrNull(i.entered.timezone);
  const starts = normaliseTime(startsIn); const ends = normaliseTime(endsIn);
  const zoneFromTenant = zoneIn === null;
  const zone = zoneIn ?? (i.tenantZone && isUsableTimezone(i.tenantZone) ? i.tenantZone : null);
  const refusals: ReviewRefusal[] = [];
  if (starts === null) refusals.push({ field: 'starts', code: 'STARTS_INVALID' });
  if (ends === null) refusals.push({ field: 'ends', code: 'ENDS_INVALID' });
  if (zone === null || (!zoneFromTenant && i.zoneKnown === false)) refusals.push({ field: 'timezone', code: 'TIMEZONE_UNKNOWN' });
  else if (!isUsableTimezone(zone)) refusals.push({ field: 'timezone', code: 'TIMEZONE_UNUSABLE' });
  const usable = starts !== null && ends !== null && zone !== null && isUsableTimezone(zone);
  if (usable && i.current && i.current.source === 'own' && normaliseTime(i.current.starts) === starts && normaliseTime(i.current.ends) === ends && i.current.timezone === zone) {
    refusals.push({ field: null, code: 'WINDOW_UNCHANGED' });
  }
  const len = starts !== null && ends !== null ? windowLengthMinutes(starts, ends) : 0;
  const occ = usable ? nextOccurrence(i.now, { starts: starts!, ends: ends!, timezone: zone! }) : null;
  const maths: WindowMaths = {
    lengthMinutes: len, off: starts !== null && ends !== null && len === 0, crossesMidnight: starts !== null && ends !== null && crossesMidnight(starts, ends),
    next: occ ? { start: occ.start.toISOString(), end: occ.end.toISOString(), current: occ.current } : null, zone, zoneFromTenant,
  };
  const fields: ReviewField[] = [field('starts', startsIn, starts), field('ends', endsIn, ends), field('timezone', zoneIn, zone)];
  const diff: ReviewDiffRow[] | null = i.current
    ? [
        { field: 'starts', before: normaliseTime(i.current.starts), after: starts },
        { field: 'ends', before: normaliseTime(i.current.ends), after: ends },
        { field: 'timezone', before: i.current.timezone, after: zone },
      ].filter((d) => d.before !== d.after)
    : null;
  const all = [...refusals, ...writerRefusals(i.writerIssues ?? [], WINDOW_FIELDS as unknown as string[], refusals)];
  return { ...reviewResult('quiet_hours', fields, all, diff), maths, stored: { starts, ends, timezone: zone } };
}

/* ---------------------------------------------------------------------------------------------------------- */
/* SAVE PREFERENCES                                                                                           */
/* ---------------------------------------------------------------------------------------------------------- */

export const PREFERENCE_REFUSALS = ['EVENT_UNKNOWN', 'CHANNEL_NOT_SENT', 'CANNOT_OPT_OUT', 'NOTHING_CHANGED'] as const;
export type PreferenceRefusal = (typeof PREFERENCE_REFUSALS)[number];

export interface CatalogFacts { code: string; priority: string; userCanOptOut: boolean; defaultChannels: readonly string[] }
export interface PreferenceChange { eventCode: string; channel: string; isEnabled: boolean }
export interface PreferenceReview extends ReviewResult { changes: Array<PreferenceChange & { before: boolean; locked: boolean }> }

/** The review row for one matrix cell. */
export const cellName = (eventCode: string, channel: string) => `${eventCode}::${channel}`;

/** What is in force TODAY for a cell: your explicit override, else the catalogue's "on" (a default channel is sent). */
export function inForce(explicit: ReadonlyMap<string, boolean>, eventCode: string, channel: string): boolean {
  return explicit.get(cellName(eventCode, channel)) ?? true;
}

export function reviewPreferences(i: { changes: readonly PreferenceChange[]; catalog: ReadonlyMap<string, CatalogFacts>; explicit: ReadonlyMap<string, boolean> }): PreferenceReview {
  const refusals: ReviewRefusal[] = [];
  const fields: ReviewField[] = [];
  const diff: ReviewDiffRow[] = [];
  const changes: PreferenceReview['changes'] = [];
  const seen = new Set<string>();
  for (const c of i.changes) {
    const name = cellName(c.eventCode, c.channel);
    if (seen.has(name)) continue;
    seen.add(name);
    const ev = i.catalog.get(c.eventCode) ?? null;
    const before = inForce(i.explicit, c.eventCode, c.channel);
    const locked = ev !== null && !ev.userCanOptOut;
    fields.push(field(name, c.isEnabled ? 'on' : 'off', c.isEnabled ? 'on' : 'off'));
    if (!ev) { refusals.push({ field: name, code: 'EVENT_UNKNOWN' }); continue; }
    if (!ev.defaultChannels.includes(c.channel)) { refusals.push({ field: name, code: 'CHANNEL_NOT_SENT' }); continue; }
    if (!c.isEnabled && locked) { refusals.push({ field: name, code: 'CANNOT_OPT_OUT' }); continue; }
    if (before !== c.isEnabled) {
      diff.push({ field: name, before: before ? 'on' : 'off', after: c.isEnabled ? 'on' : 'off' });
      changes.push({ ...c, before, locked });
    }
  }
  if (refusals.length === 0 && changes.length === 0) refusals.push({ field: null, code: 'NOTHING_CHANGED' });
  return { ...reviewResult('notification_preference', fields, refusals, diff), changes };
}

/* ---------------------------------------------------------------------------------------------------------- */
/* CHANGE LANGUAGE                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

export const LANGUAGE_REFUSALS = ['LANGUAGE_REQUIRED', 'LANGUAGE_UNKNOWN', 'LANGUAGE_UNCHANGED'] as const;
export interface LanguageReview extends ReviewResult { tenantSpeaks: boolean }

export function reviewLanguage(i: { entered: string | null | undefined; active: readonly string[]; tenantLanguages: readonly string[]; current: string | null }): LanguageReview {
  const raw = trimOrNull(i.entered);
  const code = raw ? raw.toLowerCase() : null;
  const refusals: ReviewRefusal[] = [];
  if (code === null) refusals.push({ field: 'languageCode', code: 'LANGUAGE_REQUIRED' });
  else if (!i.active.includes(code)) refusals.push({ field: 'languageCode', code: 'LANGUAGE_UNKNOWN' });
  else if (code === i.current) refusals.push({ field: 'languageCode', code: 'LANGUAGE_UNCHANGED' });
  const diff = i.current !== null && code !== null && code !== i.current ? [{ field: 'languageCode', before: i.current, after: code }] : null;
  return { ...reviewResult('user_language', [field('languageCode', raw, code)], refusals, diff), tenantSpeaks: code !== null && i.tenantLanguages.includes(code) };
}
