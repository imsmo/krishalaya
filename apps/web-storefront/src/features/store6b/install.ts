// apps/web-storefront/src/features/store6b/install.ts · PC-56 STORE-6b · D3 (founder Q8) — THE INSTALL INVITATION, PURE. A device act: no server
// round-trip, no API, no audit row (the STORE-5a W3074 device-preference precedent). Unit-tested (test/store6b-install.spec.ts).
//
//   • `kvs_visits` — a JavaScript-readable device cookie written by the CLIENT: `<count>:<YYYY-MM-DD>`, bumped once per calendar day (a page
//     load on a day already counted changes nothing). It is written only where the invitation is switched ON (the platform host passes OFF, so
//     nothing is written there).
//   • `kvs_install` — `notnow:<ISO>` (the person said "Not now": honoured 30 days on this device) or `added:<ISO>` (the browser said it was added).
//   • The sheet shows ONLY when: this organisation's `storefront_install_prompt` is ON, the browser offered its own install prompt
//     (`beforeinstallprompt` — iOS and Firefox never do: no sheet; the `/app` page says the Share → Add to Home Screen way), the app is not
//     already added, this is at least the SECOND visit of this device, and no "Not now" from the last 30 days stands.
import { DAY_MS } from './drafts';

export const VISITS_COOKIE = 'kvs_visits';
export const INSTALL_COOKIE = 'kvs_install';
/** "Not now" is honoured this many days on this device (founder Q8) — the copy interpolates it. */
export const NOT_NOW_DAYS = 30;
/** The sheet is offered from this visit of the device on (founder Q8: the second successful visit). */
export const SECOND_VISIT = 2;
/** The device cookies live a year. */
export const DEVICE_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 365;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day of an instant, as the device sees it (local date parts). */
export function dayOf(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Read `kvs_visits`: the count and the last counted day (anything malformed reads as no visit yet). */
export function readVisits(raw: string | null | undefined): { visits: number; day: string | null } {
  const m = /^(\d{1,6}):(\d{4}-\d{2}-\d{2})$/.exec(String(raw ?? ''));
  if (!m) return { visits: 0, day: null };
  return { visits: Number(m[1]), day: m[2] };
}

/** Count this load: once per calendar day. `changed` false = the cookie need not be written again today. */
export function bumpVisits(raw: string | null | undefined, today: string): { value: string; visits: number; changed: boolean } {
  const cur = readVisits(raw);
  const day = DAY_RE.test(today) ? today : '1970-01-01';
  if (cur.day === day) return { value: `${cur.visits}:${day}`, visits: cur.visits, changed: false };
  const visits = Math.min(cur.visits + 1, 999999);
  return { value: `${visits}:${day}`, visits, changed: true };
}

export type InstallMark = { kind: 'notnow' | 'added'; at: number };

/** Read `kvs_install` (`notnow:<ISO>` / `added:<ISO>`); anything else → null. */
export function readInstall(raw: string | null | undefined): InstallMark | null {
  const m = /^(notnow|added):(.+)$/.exec(decodeURIComponentSafe(String(raw ?? '')));
  if (!m) return null;
  const at = Date.parse(m[2]);
  return Number.isFinite(at) ? { kind: m[1] as InstallMark['kind'], at } : null;
}
export function installValue(kind: InstallMark['kind'], now: Date): string { return `${kind}:${now.toISOString()}`; }

function decodeURIComponentSafe(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

/** When a "Not now" stops being honoured (ms) — the `/app` page prints the date. */
export function notNowUntil(at: number): number { return at + NOT_NOW_DAYS * DAY_MS; }

export interface InviteFacts {
  /** the device's visit count (`kvs_visits`, this load counted) */
  visits: number;
  /** the "Not now" instant (ms), or null */
  notNowAt: number | null;
  /** already on the home screen (`added` mark, or the page runs standalone) */
  installed: boolean;
  /** the browser offered its own install prompt (`beforeinstallprompt`) */
  supported: boolean;
  /** this organisation's `storefront_install_prompt` (the platform host: false) */
  flagOn: boolean;
}

/** THE rule: offer the sheet? Every condition must hold — fail closed. */
export function shouldInvite(f: InviteFacts, now: number): boolean {
  if (!f.flagOn || !f.supported || f.installed) return false;
  if (!(f.visits >= SECOND_VISIT)) return false;
  if (f.notNowAt !== null && now - f.notNowAt < NOT_NOW_DAYS * DAY_MS) return false;
  return true;
}

/** The `/app?install=` states (the sheet's outcomes, also printed on the page): W3139 success, W3140 failure, W3137 error. */
export type InstallPageState = 'success' | 'failure' | 'error';
export const INSTALL_PAGE_STATES: readonly InstallPageState[] = Object.freeze(['success', 'failure', 'error'] as InstallPageState[]);
export function readInstallState(raw: string | string[] | undefined): InstallPageState | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (INSTALL_PAGE_STATES as readonly string[]).includes(String(v ?? '')) ? (v as InstallPageState) : null;
}

/** The `/app` page's status line from the device's mark: "Not now — until <date>", "added", or nothing. */
export function installStatus(mark: InstallMark | null, now: number): { kind: 'notnow'; until: number } | { kind: 'added' } | null {
  if (!mark) return null;
  if (mark.kind === 'added') return { kind: 'added' };
  const until = notNowUntil(mark.at);
  return now < until ? { kind: 'notnow', until } : null;
}

/** A cookie line the client writes (JS-readable on purpose: the device's own preference; Secure on https). */
export function deviceCookie(name: string, value: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${DEVICE_COOKIE_MAX_AGE_SEC}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** One cookie's value from `document.cookie`. */
export function cookieValue(all: string | null | undefined, name: string): string | null {
  for (const part of String(all ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { const v = part.slice(i + 1).trim(); try { return decodeURIComponent(v); } catch { return v; } }
  }
  return null;
}
