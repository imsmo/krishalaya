// modules/communication/domain/delivery-log.ts · PC-56 TENANT-8b · what the delivery log WRITES and what it can SAY.
//
// Pure (no I/O), and the home of five rules that used to be nowhere:
//   • `suppressionRows` — F-4: which channels the fan-out did NOT send, and why. They are written as `suppressed` rows
//     now (before this wave they were a metric increment); a quiet-hours suppression is a HOLD with `held_until`.
//   • `normaliseFailureReason` — F-10 / Law 6: a failure reason is a CODE from `notification_failure_reason` (0176),
//     never a provider's free text; anything unknown is `provider_rejected` (the provider's words ride the outbox
//     event, where an operator can read them, and never the column a chart counts).
//   • `releaseDecision` — what the release job does with a held row whose window has ended: send it, re-hold it (the
//     member's window moved), or record that the member has since switched the channel off.
//   • `ladderFor` — W434: one channel's history, from the row's own timestamps, never invented.
//   • `fanoutKeyOf` / `groupByFanout` — the first-class "delivery instance" W434 says is missing.
import { createHash } from 'node:crypto';
import { NotifChannel, NotifPriority } from './communication.events';
import { isIntrusive } from './channel-resolution';
import { EffectiveWindow, windowEndAfter, isWithinWindow } from './quiet-window';

/* ---------------------------------------------------------------------------------------------------------- */
/* THE VOCABULARIES                                                                                           */
/* ---------------------------------------------------------------------------------------------------------- */

/** 0176's `ck_notif_suppressed_reason`. `channel_off` is reserved for W433's master switch (refused by name). */
export const SUPPRESSED_REASONS = ['quiet_hours', 'channel_off', 'routine_collapsed', 'opted_out'] as const;
export type SuppressedReason = (typeof SUPPRESSED_REASONS)[number];

/** 0176's `notification_failure_reason` platform rows, mirrored so a write can be normalised before the trigger sees it. */
export const FAILURE_REASONS = [
  'no_template', 'no_address', 'no_device', 'no_tokens', 'push_failed', 'push_unavailable', 'notifier_not_configured',
  'notifier_unavailable', 'dispatch_failed', 'provider_rejected', 'dnd_registered', 'invalid_number', 'unreachable', 'expired', 'unrecorded',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

/** A provider's or sender's reason, as a code the column may hold. Unknown text → `provider_rejected`; nothing → the given default. */
export function normaliseFailureReason(raw: string | null | undefined, whenMissing: FailureReason = 'dispatch_failed'): FailureReason {
  const s = (raw ?? '').trim().toLowerCase();
  if (s.length === 0) return whenMissing;
  return (FAILURE_REASONS as readonly string[]).includes(s) && s !== 'unrecorded' ? (s as FailureReason) : 'provider_rejected';
}

/* ---------------------------------------------------------------------------------------------------------- */
/* F-4 · WHAT THE FAN-OUT DID NOT SEND                                                                        */
/* ---------------------------------------------------------------------------------------------------------- */

export interface SuppressionRow { channel: NotifChannel; reason: SuppressedReason; heldUntil: Date | null }

/**
 * Every channel of the event that will NOT be sent now, each with its reason — one row each, so the log can say
 * "respected, not lost" (W204) and "not sent — channel off at send time" (W434).
 *
 *   • `resolved.suppressed` — the member's opt-outs (`opted_out`) and quiet hours (`quiet_hours`, HELD until the window
 *     ends: `held_until` is computed here from the very window that suppressed it);
 *   • the routine rule's collapse (G0-4): channels resolved for sending that the one-primary rule did not send now —
 *     `routine_collapsed` — EXCEPT the SMS fallback when it was actually used (that channel has a real row).
 *
 * A quiet-hours suppression with no computable end (it cannot happen for a window that contains `now`) is held until
 * `now`, so the next release tick re-asks it: a hold must always end.
 */
export function suppressionRows(a: {
  resolved: { channels: readonly NotifChannel[]; suppressed: ReadonlyArray<{ channel: NotifChannel; reason: 'opted_out' | 'quiet_hours' }> };
  sentNow: readonly NotifChannel[];
  fallbackUsed: NotifChannel | null;
  window: EffectiveWindow | null;
  now: Date;
}): SuppressionRow[] {
  const out: SuppressionRow[] = [];
  for (const s of a.resolved.suppressed) {
    if (s.reason === 'quiet_hours') {
      const end = a.window ? windowEndAfter(a.now, a.window) : null;
      out.push({ channel: s.channel, reason: 'quiet_hours', heldUntil: end ?? a.now });
    } else {
      out.push({ channel: s.channel, reason: 'opted_out', heldUntil: null });
    }
  }
  for (const ch of a.resolved.channels) {
    if (a.sentNow.includes(ch) || ch === a.fallbackUsed) continue;
    out.push({ channel: ch, reason: 'routine_collapsed', heldUntil: null });
  }
  return out;
}

/**
 * THE ROUTINE RULE'S SMS FALLBACK, under the same rules as any SMS (G0-4's "auto-fallback to SMS on non-delivery").
 *   • `skip` — the event's own SMS row already exists as a suppression (held for quiet hours, or opted out): one row per
 *     channel per send, and the member's choice stands;
 *   • `hold` — quiet hours, a non-critical event, and SMS is not otherwise in play: the fallback waits for the morning
 *     like every intrusive channel (before 8b it fired at 03:00);
 *   • `send` — otherwise.
 */
export function fallbackAction(a: {
  fallback: NotifChannel; priority: NotifPriority; inQuiet: boolean;
  resolved: { suppressed: ReadonlyArray<{ channel: NotifChannel }> };
}): 'send' | 'hold' | 'skip' {
  if (a.resolved.suppressed.some((s) => s.channel === a.fallback)) return 'skip';
  if (a.inQuiet && a.priority !== 'critical' && isIntrusive(a.fallback)) return 'hold';
  return 'send';
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE RELEASE                                                                                                */
/* ---------------------------------------------------------------------------------------------------------- */

export type ReleaseDecision = { kind: 'send' } | { kind: 'rehold'; until: Date } | { kind: 'opted_out' };

/**
 * A held row whose `held_until` has passed. Re-asked at release, because a night is long:
 *   • the member switched this event × channel OFF since (an opt-out-able event) → it is never sent: `opted_out`;
 *   • the member's window, as it stands NOW, still contains `now` (they widened it) → hold again until it ends;
 *   • a critical event is never held (it never was — quiet hours never applied to it), and anything else → send.
 */
export function releaseDecision(a: {
  priority: NotifPriority; userCanOptOut: boolean; channel: NotifChannel;
  prefEnabled: boolean | undefined; window: EffectiveWindow | null; now: Date;
}): ReleaseDecision {
  if (a.userCanOptOut && a.prefEnabled === false) return { kind: 'opted_out' };
  if (a.priority !== 'critical' && isIntrusive(a.channel) && a.window && isWithinWindow(a.now, a.window)) {
    const until = windowEndAfter(a.now, a.window);
    if (until && until.getTime() > a.now.getTime()) return { kind: 'rehold', until };
  }
  return { kind: 'send' };
}

/* ---------------------------------------------------------------------------------------------------------- */
/* W434 · THE LADDER                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export interface LadderRow {
  id: string; channel: string; status: string;
  suppressedReason: string | null; failureReason: string | null;
  createdAt: Date; sentAt: Date | null; deliveredAt: Date | null; failedAt: Date | null; readAt: Date | null;
  heldUntil: Date | null; releasedAt: Date | null;
}
export type LadderStepKind = 'queued' | 'held' | 'released' | 'suppressed' | 'sent' | 'delivered' | 'failed' | 'read';
export interface LadderStep { kind: LadderStepKind; at: Date | null; reason: string | null; until?: Date | null }

/**
 * One channel's history from the row's OWN columns — the canon's "queued → sent → delivered | failed (reason, time) |
 * suppressed (reason)". A step with no recorded time (a row delivered before 0176 kept `delivered_at`) is printed with
 * `at: null` — "time not recorded" — never with a guessed time.
 */
export function ladderFor(r: LadderRow): LadderStep[] {
  const steps: LadderStep[] = [{ kind: 'queued', at: r.createdAt, reason: null }];
  if (r.suppressedReason === 'quiet_hours') {
    steps.push({ kind: 'held', at: r.createdAt, reason: 'quiet_hours', until: r.heldUntil });
    if (r.releasedAt) steps.push({ kind: 'released', at: r.releasedAt, reason: null });
  } else if (r.status === 'suppressed') {
    steps.push({ kind: 'suppressed', at: r.createdAt, reason: r.suppressedReason });
  }
  if (r.status === 'suppressed') return steps;
  if (r.sentAt) steps.push({ kind: 'sent', at: r.sentAt, reason: null });
  if (r.status === 'delivered' || r.deliveredAt) steps.push({ kind: 'delivered', at: r.deliveredAt, reason: null });
  if (r.status === 'failed') steps.push({ kind: 'failed', at: r.failedAt, reason: r.failureReason });
  if (r.status === 'read' || r.readAt) steps.push({ kind: 'read', at: r.readAt, reason: null });
  return steps;
}

/** The ladder's last word — what the channel's row says NOW. */
export function ladderOutcome(r: Pick<LadderRow, 'status' | 'suppressedReason' | 'releasedAt'>): LadderStepKind {
  if (r.status === 'suppressed') return r.suppressedReason === 'quiet_hours' && !r.releasedAt ? 'held' : 'suppressed';
  return (['queued', 'sent', 'delivered', 'failed', 'read'] as const).find((k) => k === r.status) ?? 'queued';
}

/** The order channels are drawn in: the in-app item first (it is the one the member opened), then the wires. */
export const CHANNEL_ORDER: readonly string[] = ['inapp', 'push', 'sms', 'whatsapp', 'ivr', 'email'];
export function byChannelOrder<T extends { channel: string }>(rows: readonly T[]): T[] {
  const rank = (c: string) => { const i = CHANNEL_ORDER.indexOf(c); return i < 0 ? CHANNEL_ORDER.length : i; };
  return [...rows].sort((a, b) => rank(a.channel) - rank(b.channel) || a.channel.localeCompare(b.channel));
}

/* ---------------------------------------------------------------------------------------------------------- */
/* THE DELIVERY INSTANCE                                                                                      */
/* ---------------------------------------------------------------------------------------------------------- */

/** One value per (event delivery × recipient), shared by every channel row of that send — 0176's `fanout_key`. */
export function fanoutKeyOf(dedupeKey: string, userId: string): string {
  return createHash('sha256').update(`${dedupeKey}|${userId}`).digest('hex');
}

/**
 * Rows grouped into delivery instances. A row written before 0176 has no key and stands alone (its own id), never
 * merged by time proximity — W434's flagged guess is exactly what the key replaces.
 */
export function groupByFanout<T extends { id: string; fanoutKey: string | null }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const k = r.fanoutKey ?? `row:${r.id}`;
    const g = out.get(k);
    if (g) g.push(r); else out.set(k, [r]);
  }
  return out;
}

/** The module an event belongs to — its catalogue namespace (`dispute.resolved` → `dispute`). No invented map. */
export function moduleOf(eventCode: string): string {
  const i = eventCode.indexOf('.');
  return i > 0 ? eventCode.slice(0, i) : eventCode;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* W204 · MEMBER DELIVERY HEALTH                                                                              */
/* ---------------------------------------------------------------------------------------------------------- */

export interface HealthFigures {
  /** Rows on a channel that LEAVES the platform (not in-app) that were actually attempted: sent, delivered, read, failed. */
  leftPlatform: number;
  /** Of those, the provider's receipt said delivered (or the member read it after delivery). */
  delivered: number;
  /** Of those, still `sent` — accepted, no receipt (yet, or ever: some routes never return one). */
  awaitingReceipt: number;
  failed: number;
  /** Not sent, with the reason (quiet_hours holds are counted here until released). */
  suppressed: number;
  /** In-app items written (they are the inbox; never "delivered"). */
  inapp: number;
  /** Rows that carry a `cost_minor`. There is no currency column, so this is a count — never a ₹ sum. */
  costedSends: number;
  suppressedByReason: Record<string, number>;
  failedByReason: Record<string, number>;
}

/** The tiles, from the grouped rows — every figure a sum of what the log says. */
export function healthFigures(rows: ReadonlyArray<{ channel: string; status: string; suppressedReason: string | null; failureReason: string | null; n: number; withCost: number }>): HealthFigures {
  const f: HealthFigures = { leftPlatform: 0, delivered: 0, awaitingReceipt: 0, failed: 0, suppressed: 0, inapp: 0, costedSends: 0, suppressedByReason: {}, failedByReason: {} };
  const bump = (m: Record<string, number>, k: string, n: number) => { m[k] = (m[k] ?? 0) + n; };
  for (const r of rows) {
    f.costedSends += r.withCost;
    if (r.status === 'suppressed') { f.suppressed += r.n; bump(f.suppressedByReason, r.suppressedReason ?? 'unknown', r.n); continue; }
    if (r.channel === 'inapp') { f.inapp += r.n; continue; }
    if (r.status === 'queued') continue;
    f.leftPlatform += r.n;
    if (r.status === 'delivered' || r.status === 'read') f.delivered += r.n;
    else if (r.status === 'sent') f.awaitingReceipt += r.n;
    else if (r.status === 'failed') { f.failed += r.n; bump(f.failedByReason, r.failureReason ?? 'unrecorded', r.n); }
  }
  return f;
}
