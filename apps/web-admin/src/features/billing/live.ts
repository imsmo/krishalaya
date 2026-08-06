// apps/web-admin/src/features/billing/live.ts · PURE rules for the live money ticker and the schedules screen
// (PC-56 ADMIN-1e). No IO, no React → unit-provable.

// ---------------------------------------------------------------------------
// The live stream (ADMIN-1-Q8)
// ---------------------------------------------------------------------------
export interface MoneyEvent {
  id?: string; at?: string; kind?: string; tenantSlug?: string | null;
  invoiceNo?: string | null; amountMinor?: string; currency?: string;
}

/**
 * The connection state a live screen must be able to show.
 *
 * `stale` is the one that matters and the one most tickers get wrong: a screen that has silently stopped receiving is
 * worse than a screen that says "not connected", because an operator keeps reading it. The server sends a heartbeat
 * every poll interval, so ANY gap longer than a small multiple of that interval means the stream is not healthy —
 * whatever the browser thinks about its own EventSource.
 */
export type StreamState = 'connecting' | 'live' | 'stale' | 'closed';

/** How many missed heartbeats before a stream is called stale. Three is enough to survive one dropped frame and a
 *  slow GC pause without crying wolf, and short enough that nobody trusts a dead screen for a minute. */
export const STALE_AFTER_HEARTBEATS = 3;

export function streamState(
  opts: { open: boolean; closed: boolean; lastFrameAt: number | null; now: number; pollMs: number },
): StreamState {
  if (opts.closed) return 'closed';
  if (!opts.open || opts.lastFrameAt === null) return 'connecting';
  return opts.now - opts.lastFrameAt > opts.pollMs * STALE_AFTER_HEARTBEATS ? 'stale' : 'live';
}

/** Newest first, capped. A ticker is a window, not a log: keeping ten thousand rows in a browser tab to scroll through
 *  is what makes a "live" page unusable after an hour. The full history is the invoice list. */
export const FEED_WINDOW = 100;
export function mergeFeed(existing: readonly MoneyEvent[], incoming: readonly MoneyEvent[]): MoneyEvent[] {
  // de-duplicated by id: a reconnect can legitimately re-deliver the frame the client was mid-render on
  const seen = new Set(existing.map((e) => String(e.id)));
  const fresh = incoming.filter((e) => e.id && !seen.has(String(e.id)));
  return [...fresh.reverse(), ...existing].slice(0, FEED_WINDOW);
}

/** The cursor to reconnect with: the LAST event actually rendered. Null when nothing has been seen, which asks the
 *  server to start from the beginning of its window rather than guessing. */
export function feedCursor(feed: readonly MoneyEvent[]): { at: string; id: string } | null {
  // the feed is newest-first, so the oldest rendered event is last — but the cursor must be the NEWEST one, or a
  // reconnect would replay everything the operator has already seen
  const newest = feed[0];
  return newest?.at && newest?.id ? { at: newest.at, id: String(newest.id) } : null;
}

/** Running total of what arrived in this session, per currency. Session-scoped and LABELLED as such: it is not the
 *  day's takings (the hourly chart is), and presenting it as one would be a number nobody can reconcile. */
export function sessionTotals(feed: readonly MoneyEvent[]): Array<{ currency: string; receivedMinor: string; count: number }> {
  const map = new Map<string, { total: bigint; n: number }>();
  for (const e of feed) {
    if (e.kind !== 'payment') continue;                 // invoices issued are not money received
    const s = String(e.amountMinor ?? '').trim();
    if (!/^-?\d{1,20}$/.test(s)) continue;
    const cur = String(e.currency ?? 'INR');
    const acc = map.get(cur) ?? { total: 0n, n: 0 };
    acc.total += BigInt(s); acc.n += 1;
    map.set(cur, acc);
  }
  return [...map.entries()].map(([currency, v]) => ({ currency, receivedMinor: v.total.toString(), count: v.n }));
}

// ---------------------------------------------------------------------------
// Schedules (ADMIN-1-Q9)
// ---------------------------------------------------------------------------
export const CADENCES = ['daily', 'weekly', 'monthly'] as const;
export type Cadence = (typeof CADENCES)[number];
export function isCadence(v: string | null | undefined): v is Cadence {
  return !!v && (CADENCES as readonly string[]).includes(v);
}

export type ScheduleError = 'report' | 'cadence' | 'hour' | 'weekday' | 'recipients' | 'email' | 'tooMany';
export type ScheduleResult =
  | { ok: true; value: { report: string; cadence: Cadence; hourIst: number; weekdayIso?: number; recipients: string[]; notes?: string } }
  | { ok: false; error: ScheduleError };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const MAX_RECIPIENTS = 20;

/** Build the schedule. Recipients arrive as one comma/newline-separated field because that is how somebody pastes a
 *  distribution list; splitting server-side would mean the console could not tell them WHICH address was wrong. */
export function buildSchedule(raw: {
  report: string; cadence: string; hourIst: string; weekdayIso?: string; recipients: string; notes?: string;
}, knownReports: readonly string[]): ScheduleResult {
  if (!knownReports.includes(raw.report)) return { ok: false, error: 'report' };
  if (!isCadence(raw.cadence)) return { ok: false, error: 'cadence' };
  const cadence = raw.cadence;

  const h = raw.hourIst.trim();
  if (!/^\d{1,2}$/.test(h)) return { ok: false, error: 'hour' };
  const hourIst = Number.parseInt(h, 10);
  if (hourIst > 23) return { ok: false, error: 'hour' };

  let weekdayIso: number | undefined;
  if (cadence === 'weekly') {
    const w = (raw.weekdayIso ?? '').trim();
    if (!/^[1-7]$/.test(w)) return { ok: false, error: 'weekday' };
    weekdayIso = Number.parseInt(w, 10);
  }

  const list = [...new Set(raw.recipients.split(/[\s,;]+/).map((r) => r.trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0) return { ok: false, error: 'recipients' };
  if (list.length > MAX_RECIPIENTS) return { ok: false, error: 'tooMany' };
  if (list.some((r) => !EMAIL_RE.test(r))) return { ok: false, error: 'email' };

  const notes = (raw.notes ?? '').trim();
  return {
    ok: true,
    value: { report: raw.report, cadence, hourIst, ...(weekdayIso ? { weekdayIso } : {}), recipients: list, ...(notes ? { notes } : {}) },
  };
}

/** Human rule, mirroring the server's `describeSchedule` so the form preview and the audit row read the same. */
export function describeSchedule(cadence: Cadence, hourIst: number, weekdayIso: number | null): string {
  const hh = `${String(hourIst).padStart(2, '0')}:00 IST`;
  if (cadence === 'daily') return `every day at ${hh}`;
  if (cadence === 'monthly') return `on the 1st of each month at ${hh}`;
  const days = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  return `every ${days[weekdayIso ?? 1]} at ${hh}`;
}

export interface RunRow { status?: string; ranAt?: string; detail?: string | null; rowCount?: number }

/** Whether a run actually DELIVERED. `provider_pending` means computed and not sent, and the UI must never show a
 *  success tick for it — somebody would wait for an email that is not coming. */
export function wasDelivered(status: string | null | undefined): boolean { return status === 'sent'; }

/** The state a schedule is in, for the list: paused, never run, delivering, or computing-without-delivery. The last
 *  one is today's truth for every schedule, and naming it is the point. */
export type ScheduleHealth = 'paused' | 'never_run' | 'delivering' | 'computed_not_delivered' | 'failing';
export function scheduleHealth(isActive: boolean, runs: readonly RunRow[]): ScheduleHealth {
  if (!isActive) return 'paused';
  const last = runs[0];
  if (!last) return 'never_run';
  if (last.status === 'failed') return 'failing';
  return wasDelivered(last.status) ? 'delivering' : 'computed_not_delivered';
}
