// modules/communication/domain/timezone.ts · PC-56 TENANT-8b (F-6) · which zone a quiet window is read in, and the
// guarantee that a bad one can never throw inside a fan-out.
//
// `user_quiet_hours.timezone` was free text (≤40 characters, `Asia/Kolkata` by literal default), and
// `new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkatta' })` throws `RangeError: Invalid time zone specified`.
// `resolveChannels` ran per recipient INSIDE the relay's per-event transaction, so one member's typo failed the whole
// fan-out — every other member of the village went unnotified — and the relay retried it for ever.
//
// Two guards, because there are two moments:
//   • AT WRITE: the database refuses a zone it does not know (`trg_uqh_timezone_known`, `pg_timezone_names`, 0176) and
//     the review refuses it first, with a sentence;
//   • AT READ: a row already on disk is SANITISED here — an unknown zone degrades to the cooperative's own zone (and, if
//     even that were unusable, to UTC), the substitution is reported, and nothing throws.
//
// Pure: no I/O. The cache is per process; `Intl` support for a zone does not change while a process runs.
const known = new Map<string, boolean>();

/** The zone of last resort: only when neither the member's nor the cooperative's zone is usable. A technical floor, not
 *  a business default — `countries.timezone` is NOT NULL for every country, so reaching it means a corrupt row. */
export const LAST_RESORT_ZONE = 'UTC';

/** Can this process format a time in this zone? Never throws. */
export function isUsableTimezone(zone: unknown): zone is string {
  if (typeof zone !== 'string') return false;
  const z = zone.trim();
  if (z.length === 0 || z.length > 64) return false;
  const hit = known.get(z);
  if (hit !== undefined) return hit;
  let ok: boolean;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: z }).format(0);
    ok = true;
  } catch {
    ok = false;
  }
  known.set(z, ok);
  return ok;
}

export interface SanitisedZone {
  /** The zone the window will be read in — always usable. */
  zone: string;
  /** True when `requested` could not be used and `zone` is a substitute. The fan-out logs it. */
  sanitised: boolean;
  /** What the row asked for (trimmed), for the notice. Null when nothing was asked. */
  requested: string | null;
}

/**
 * The zone to read a window in: the requested one when usable, else the fallback (the cooperative's zone), else
 * `LAST_RESORT_ZONE`. NEVER throws — this is the line that keeps a typo out of every village's notice.
 */
export function sanitiseTimezone(requested: string | null | undefined, fallback: string | null | undefined): SanitisedZone {
  const r = typeof requested === 'string' && requested.trim().length > 0 ? requested.trim() : null;
  if (r !== null && isUsableTimezone(r)) return { zone: r, sanitised: false, requested: r };
  const f = typeof fallback === 'string' ? fallback.trim() : '';
  const zone = isUsableTimezone(f) ? f : LAST_RESORT_ZONE;
  // Asking for nothing is not a substitution: a member with no row is read in the tenant's zone by design.
  return { zone, sanitised: r !== null, requested: r };
}
