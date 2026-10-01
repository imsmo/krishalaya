// modules/cms/domain/banner-window.ts · PC-56 TENANT-8d · W174 "Window & link" — the window as the cooperative types it,
// and the PHASE a banner is in.
//
// A banner that "starts 01 Jul 06:00" starts at 06:00 where the COOPERATIVE is. The console types a date and a time; this
// file validates their SHAPE only — the conversion to an instant is done in SQL `AT TIME ZONE` the tenant's zone
// (`tenants.country_code → countries.timezone`, 6c-1's resolution, 7c's `resolveStart`), never in the Node process's
// zone. The repository hands back the instant AND the wall-clock it reads as in that zone; `clockIssue` compares the two,
// so a wall-clock that does not exist in the zone (a DST gap — not Asia/Kolkata's, but a cooperative elsewhere) is
// refused by name rather than silently shifted an hour.
//
// THE PHASE (W173's *"live now · scheduled · ended — derived from the window + is_active"*) is computed at read time:
// an ACTIVE banner before its start is scheduled, inside `[starts, ends)` live, at or after its end ended. F-21: the
// expiry job that was "registered nowhere" is deleted, not registered — a job would only write a copy of this, late.
import type { BannerState } from './banner.state';

export const BANNER_PHASES = ['live', 'scheduled', 'ended', 'draft', 'paused', 'archived'] as const;
export type BannerPhase = (typeof BANNER_PHASES)[number];

/** `YYYY-MM-DD` as a real calendar day (no 31 Feb), 2000–2100. Null otherwise. */
export function parseDateOnly(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return s;
}

/** `HH:MM` / `H:MM` (24-hour) → `HH:MM`. Null otherwise. */
export function parseWallTime(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** The wall-clock the form carries: both halves valid, else null. */
export function wallClock(date: string | null | undefined, time: string | null | undefined): { date: string; time: string } | null {
  const d = parseDateOnly(date); const t = parseWallTime(time);
  return d !== null && t !== null ? { date: d, time: t } : null;
}

/** What SQL resolved: the instant, and how that instant reads back in the tenant's zone. */
export interface ResolvedInstant { at: Date; localDate: string; localTime: string }

/** A typed wall-clock that does not read back as itself does not exist in the zone (a DST gap). */
export function clockIssue(typed: { date: string; time: string }, resolved: ResolvedInstant): boolean {
  return typed.date !== resolved.localDate || typed.time !== resolved.localTime;
}

export const WINDOW_REFUSALS = ['STARTS_INVALID', 'ENDS_INVALID', 'STARTS_NOT_ON_CLOCK', 'ENDS_NOT_ON_CLOCK', 'WINDOW_ORDER', 'WINDOW_ENDED'] as const;
export type WindowRefusal = (typeof WINDOW_REFUSALS)[number];

/**
 * Every reason the window is refused, each against the half it is about. `WINDOW_ENDED` — a window that is over before
 * it is saved would put nothing anywhere; it is refused only when `requireOpen` (a create, or an edit that moves the
 * window): an ended banner whose OTHER fields are being corrected is not refused for having run its course.
 */
export function windowRefusals(i: {
  starts: { date: string; time: string } | null; ends: { date: string; time: string } | null;
  startsAt: ResolvedInstant | null; endsAt: ResolvedInstant | null; now: Date; requireOpen: boolean;
}): Array<{ field: 'startsAt' | 'endsAt'; code: WindowRefusal }> {
  const out: Array<{ field: 'startsAt' | 'endsAt'; code: WindowRefusal }> = [];
  if (i.starts === null || i.startsAt === null) out.push({ field: 'startsAt', code: 'STARTS_INVALID' });
  else if (clockIssue(i.starts, i.startsAt)) out.push({ field: 'startsAt', code: 'STARTS_NOT_ON_CLOCK' });
  if (i.ends === null || i.endsAt === null) out.push({ field: 'endsAt', code: 'ENDS_INVALID' });
  else if (clockIssue(i.ends, i.endsAt)) out.push({ field: 'endsAt', code: 'ENDS_NOT_ON_CLOCK' });
  if (i.startsAt !== null && i.endsAt !== null) {
    if (i.endsAt.at.getTime() <= i.startsAt.at.getTime()) out.push({ field: 'endsAt', code: 'WINDOW_ORDER' });
    else if (i.requireOpen && i.endsAt.at.getTime() <= i.now.getTime()) out.push({ field: 'endsAt', code: 'WINDOW_ENDED' });
  }
  return out;
}

/** W173's phase: the state, except an ACTIVE banner is scheduled · live · ended by its window at `now`. */
export function bannerPhase(state: BannerState, startsAt: Date, endsAt: Date, now: Date): BannerPhase {
  if (state !== 'active') return state;
  const t = now.getTime();
  if (t < startsAt.getTime()) return 'scheduled';
  if (t >= endsAt.getTime()) return 'ended';
  return 'live';
}

/** The phase filter W173 offers, as the states it reads. `live / scheduled / ended` are `active` + a window predicate. */
export function phaseIsWindowed(p: BannerPhase): boolean { return p === 'live' || p === 'scheduled' || p === 'ended'; }

/** Whole minutes from `now` until the banner next changes phase by itself (its start, else its end); null if never. */
export function minutesToNextPhase(state: BannerState, startsAt: Date, endsAt: Date, now: Date): number | null {
  if (state !== 'active') return null;
  const t = now.getTime();
  const next = t < startsAt.getTime() ? startsAt.getTime() : t < endsAt.getTime() ? endsAt.getTime() : null;
  return next === null ? null : Math.ceil((next - t) / 60_000);
}
