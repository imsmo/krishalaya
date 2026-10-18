// apps/web-partner/src/features/partner1/dashboard.ts · PC-56 PARTNER-1a · founder D1 — THE DASHBOARD'S PRESENTATIONAL MATHS. PURE.
//
// The server computes every figure (`GET /v1/partner/dashboard`: counts, bigint minor-unit sums, rates in integer basis points, latencies in
// whole seconds, `computedAt`). This file only TURNS them into text, with integer arithmetic so a float never appears: a rate of 7 123 bps
// prints "71.2", a latency of 5 400 s prints "1.5". The page never adds or divides a number itself. Money sums (where the page shows one)
// are BigInt over minor-unit strings.
import { formatDate } from '@krishalaya/i18n';

/** Integer basis points → one-decimal percent text ("71.2"), rounded half-up in integer arithmetic; null → null. */
export function bpsPercentText(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined) return null;
  if (!Number.isInteger(bps) || bps < 0) throw new Error(`bpsPercentText: ${bps} is not a whole number of basis points`);
  const tenths = Math.floor((bps + 5) / 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** Whole seconds → one-decimal hours text ("1.5"), rounded half-up in integer arithmetic; null → null. */
export function hoursText(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isInteger(seconds) || seconds < 0) throw new Error(`hoursText: ${seconds} is not a whole number of seconds`);
  const tenths = Math.floor((seconds * 10 + 1800) / 3600);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

/** Whole hours an application has waited, measured against the SERVER's computedAt (never the browser's clock). */
export function ageHours(createdAt: string, computedAt: string): number {
  const ms = Date.parse(computedAt) - Date.parse(createdAt);
  return ms > 0 ? Math.floor(ms / 3_600_000) : 0;
}

/** Σ of bigint minor-unit strings → a bigint minor-unit string (never Number). */
export function sumMinor(parts: ReadonlyArray<string | null | undefined>): string {
  let s = 0n;
  for (const p of parts) if (p) s += BigInt(p);
  return s.toString();
}

/** The "as of" time, printed in India time whatever the server's or the browser's zone. */
export function asOfText(computedAt: string, lang: string): string {
  return formatDate(computedAt, lang, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
}

/** An FPO's PUBLIC display name, or the neutral word when the organisation is not live (the API answered null). */
export function fpoLabel(name: string | null | undefined, neutral: string): string {
  return name && name.trim() ? name : neutral;
}

/** Which state the dashboard is in. `off` = partner_console OFF (404 + the flag map says off); `error` = anything else that failed. */
export type DashboardState = 'ok' | 'empty' | 'error' | 'off';
export function dashboardState(d: { applicationsTotal: number; portfolio: { activeLoans: number } } | null, failure: 'off' | 'error' | null): DashboardState {
  if (failure) return failure;
  if (!d) return 'error';
  return d.applicationsTotal === 0 && d.portfolio.activeLoans === 0 ? 'empty' : 'ok';
}

/** The short reference of an application (its uuid's head) — there is no `LA-…` number; the link carries the full id. */
export const appRef = (id: string) => `${id.slice(0, 8)}…`;

/** F-7: a failed read → which state. A 404 while the platform's flag map says `partner_console` is OFF is the SWITCHED-OFF state ("nothing is
 *  broken"); every other failure (or an unreadable flag map) is the error state — never an outage sentence for a switch. */
export function failureOf(status: number | undefined, consoleSwitch: 'on' | 'off' | 'unknown'): 'off' | 'error' {
  return status === 404 && consoleSwitch === 'off' ? 'off' : 'error';
}
