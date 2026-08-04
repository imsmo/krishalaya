// apps/mobile/src/features/notifications/notif-prefs.ts · PURE grouping/labelling for the notification-settings
// screen (171). No React/native — unit-tested. The server contract is per event×channel booleans
// (NotificationPreference {eventCode, channel, isEnabled}); these helpers group those real rows by event, bucket
// events into display categories, and pick display glyphs — all derived from the server's codes (never fabricated).
import type { NotificationPreference } from '@krishalaya/sdk-js';

export interface EventGroup { eventCode: string; channels: NotificationPreference[] }
export type NotifCategory = 'money' | 'mandi' | 'other';

/** Group prefs by eventCode, preserving first-seen order (both of events and of channels within an event). Pure. */
export function groupByEvent(prefs: readonly NotificationPreference[] | null | undefined): EventGroup[] {
  const order: string[] = [];
  const map = new Map<string, NotificationPreference[]>();
  for (const p of prefs ?? []) {
    if (!p || typeof p.eventCode !== 'string') continue;
    if (!map.has(p.eventCode)) { map.set(p.eventCode, []); order.push(p.eventCode); }
    map.get(p.eventCode)!.push(p);
  }
  return order.map((eventCode) => ({ eventCode, channels: map.get(eventCode)! }));
}

/** Bucket an event code into a display category by keyword. Unknown → 'other'. Pure. */
export function eventCategory(code: string | null | undefined): NotifCategory {
  const k = (code ?? '').toLowerCase();
  if (/pay|order|delivery|wallet|payout|settle|refund|invoice/.test(k)) return 'money';
  if (/price|mandi|weather|crop|tip|market|advis/.test(k)) return 'mandi';
  return 'other';
}

/** A per-event glyph matched from the event code. Unknown → the generic bell. Pure. */
export function eventIcon(code: string | null | undefined): string {
  const k = (code ?? '').toLowerCase();
  if (/pay|wallet|payout|settle|refund/.test(k)) return '💰';
  if (/order/.test(k)) return '🛒';
  if (/delivery|ship|logistic/.test(k)) return '📦';
  if (/price|mandi|market/.test(k)) return '📊';
  if (/weather|rain|advis/.test(k)) return '🌧️';
  if (/crop|tip/.test(k)) return '💡';
  return '🔔';
}

/** A per-channel glyph. push 📱 / sms 💬 / email 📧, else generic. Pure. */
export function channelIcon(channel: string | null | undefined): string {
  const k = (channel ?? '').toLowerCase();
  if (/push|in[-_ ]?app/.test(k)) return '📱';
  if (/sms|text/.test(k)) return '💬';
  if (/email|mail/.test(k)) return '📧';
  return '🔔';
}

/** The enabled channel codes for an event (for the "Push + SMS" summary). Pure. */
export function enabledChannels(channels: readonly NotificationPreference[]): string[] {
  return channels.filter((c) => c.isEnabled).map((c) => c.channel);
}

/** Turn a server event/channel code into a readable label ("payment_received" → "Payment received"). This is a
 *  presentation transform of REAL server data — not a fabricated string. Pure. */
export function humanizeCode(code: string | null | undefined): string {
  const s = (code ?? '').replace(/[_.-]+/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}
