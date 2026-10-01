// modules/communication/domain/broadcast-counts.ts · PC-56 TENANT-8e · WHAT A BROADCAST DID, COUNTED FROM THE LOG. PURE.
//
// F-2: the handler wrote `markSent(total, total)` — `sent_count` = the recipient count — while every push leg had
// recorded `failed · no_template`. The receipt now has ONE source: the `notifications` rows of the broadcast's members
// (joined through `tenant_broadcast_recipients.fanout_key`), grouped by channel × status × reason. This file turns those
// groups into the figures W429's receipt prints ("1,384 delivered · 3 failed"), and refuses to invent any:
//   • SENT is a row the log says left (`sent`), was delivered (`delivered`) or was read (`read`) — an in-app row is
//     written `sent` (the row IS the item) and becomes `read`; it is never "delivered" (8b's ruling);
//   • HELD is a quiet-hours row not yet released (8b's `held_until`; the release job sends it when the window ends) —
//     "respected, not lost", and NOT counted as sent or failed until the log says which;
//   • SUPPRESSED is a row the member's choice or the decided routine rule kept back (opted_out · routine_collapsed ·
//     channel_off) — counted apart from failed, never folded into it;
//   • FAILED carries its reason code (no_device, no_template, …) — the log's, Law 6;
//   • a row released after a hold is counted by its FINAL status and also as `released`.
// A status this file does not know (a future enum value) is counted as `other` — printed, never dropped.

export interface LogGroup {
  channel: string; status: string; suppressedReason: string | null; failureReason: string | null; released: boolean; n: number;
}
export interface ChannelCounts {
  channel: string; total: number; sent: number; delivered: number; read: number; failed: number; held: number; suppressed: number;
  queued: number; released: number; other: number; failedBy: Record<string, number>; suppressedBy: Record<string, number>;
}
export interface BroadcastCounts {
  /** Members the fan-out reached (one recipients row each). */
  recipients: number;
  /** Rows the log says left / were delivered / were read — every channel. */
  sent: number; delivered: number; read: number; failed: number; held: number; suppressed: number; queued: number; other: number;
  /** Members holding the in-app item (its row sent or read) — the announcement itself. */
  inapp: number;
  channels: ChannelCounts[];
}

/** The order the receipt prints channels in: the announcement first, then the interrupting ones. */
const CHANNEL_ORDER = ['inapp', 'push', 'sms', 'whatsapp', 'email', 'ivr'];
const rank = (c: string) => { const i = CHANNEL_ORDER.indexOf(c); return i < 0 ? CHANNEL_ORDER.length : i; };

function emptyChannel(channel: string): ChannelCounts {
  return { channel, total: 0, sent: 0, delivered: 0, read: 0, failed: 0, held: 0, suppressed: 0, queued: 0, released: 0, other: 0, failedBy: {}, suppressedBy: {} };
}

/** Is this group a HOLD still waiting for its window to end? */
export function isHeld(g: Pick<LogGroup, 'status' | 'suppressedReason' | 'released'>): boolean {
  return g.status === 'suppressed' && g.suppressedReason === 'quiet_hours' && !g.released;
}

export function countBroadcast(recipients: number, groups: readonly LogGroup[]): BroadcastCounts {
  const by = new Map<string, ChannelCounts>();
  for (const g of groups) {
    const n = Number.isFinite(g.n) && g.n > 0 ? Math.floor(g.n) : 0;
    if (n === 0) continue;
    const c = by.get(g.channel) ?? emptyChannel(g.channel);
    by.set(g.channel, c);
    c.total += n;
    if (g.released) c.released += n;
    switch (g.status) {
      case 'sent': c.sent += n; break;
      case 'delivered': c.delivered += n; break;
      case 'read': c.read += n; break;
      case 'failed': {
        c.failed += n;
        const r = g.failureReason ?? 'unrecorded';
        c.failedBy[r] = (c.failedBy[r] ?? 0) + n;
        break;
      }
      case 'queued': c.queued += n; break;
      case 'suppressed':
        if (isHeld(g)) c.held += n;
        else {
          c.suppressed += n;
          const r = g.suppressedReason ?? 'unrecorded';
          c.suppressedBy[r] = (c.suppressedBy[r] ?? 0) + n;
        }
        break;
      default: c.other += n;
    }
  }
  const channels = [...by.values()].sort((a, b) => rank(a.channel) - rank(b.channel) || a.channel.localeCompare(b.channel));
  const sum = (k: keyof Pick<ChannelCounts, 'sent' | 'delivered' | 'read' | 'failed' | 'held' | 'suppressed' | 'queued' | 'other'>) => channels.reduce((s, c) => s + c[k], 0);
  const inappRow = by.get('inapp');
  return {
    recipients: Math.max(0, Math.floor(recipients)),
    sent: sum('sent') + sum('delivered') + sum('read'),
    delivered: sum('delivered'), read: sum('read'), failed: sum('failed'), held: sum('held'), suppressed: sum('suppressed'),
    queued: sum('queued'), other: sum('other'),
    inapp: inappRow ? inappRow.sent + inappRow.read + inappRow.delivered : 0,
    channels,
  };
}

/** Sum several broadcasts' counts (the hub's tiles over a window). */
export function addCounts(all: readonly BroadcastCounts[]): Omit<BroadcastCounts, 'channels'> {
  const z = { recipients: 0, sent: 0, delivered: 0, read: 0, failed: 0, held: 0, suppressed: 0, queued: 0, other: 0, inapp: 0 };
  for (const c of all) for (const k of Object.keys(z) as (keyof typeof z)[]) z[k] += c[k];
  return z;
}
