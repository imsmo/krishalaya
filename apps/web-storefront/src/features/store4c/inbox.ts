// apps/web-storefront/src/features/store4c/inbox.ts · PC-56 STORE-4c · C2 / C5 — the INBOX's pure half (canon W299 "Notifications"; W3118–W3120
// are DECOR reloads). No React, no Next, no I/O; unit-tested in test/store4c-notifications.spec.ts.
//
// • THE INBOX IS THE ORGANISATION'S (founder Q13): notices carry the organisation (`tenant_id`), so the page lives at /<slug>/notifications and
//   the platform's /notifications is a door (lib/store-door.ts). A person's notices have NO kill-switch (founder Q12): no "Flagged off" state.
// • WHAT AN ITEM SAYS: the words it was SENT with — the API renders the row's own template version with the row's own payload (`rendered`,
//   STORE-4c C2) — else the payload's own `title`/`body` (an announcement carries its words), else the event's name. Never invented.
// • THE TIER CHIP (critical · important · informational · promotional), the module, the time, and the LADDER: every OTHER channel of the same
//   delivery ("also by SMS · delivered / not sent — quiet hours / failed"), each from its own row (`alsoOn`) — never "app + SMS" for a notice
//   that went one way (outbid is push + in-app: printed from the ladder, never claimed).
// • A deep link only when the payload carries a SAME-ORIGIN path ("Open"); none otherwise.
// • Keyset Next (never "Showing 5 of 187"); the window the API keeps is a retention policy it does not serve, so no "(90 days)" is printed.

export const INBOX_TIERS = ['critical', 'important', 'informational', 'promotional'] as const;
export type InboxTier = (typeof INBOX_TIERS)[number];
export function tierKey(t: string | null | undefined): string {
  return (INBOX_TIERS as readonly string[]).includes(String(t)) ? `store4c.tier.${t}` : 'store4c.tier.unknown';
}
/** The tier's tone — a class modifier only (logical properties live in the stylesheet). */
export function tierTone(t: string | null | undefined): 'danger' | 'warn' | 'info' | 'muted' {
  return t === 'critical' ? 'danger' : t === 'important' ? 'warn' : t === 'promotional' ? 'muted' : 'info';
}

export const INBOX_CHANNELS = ['inapp', 'push', 'sms', 'whatsapp', 'email', 'ivr'] as const;
export function channelKey(c: string): string {
  return (INBOX_CHANNELS as readonly string[]).includes(c) ? `store4c.channel.${c}` : 'store4c.channel.other';
}
/** The ladder's outcome vocabulary — the API's `NotificationOutcome`. */
export const INBOX_OUTCOMES = ['queued', 'held', 'released', 'suppressed', 'sent', 'delivered', 'failed', 'read'] as const;
export function outcomeKey(o: string): string {
  return (INBOX_OUTCOMES as readonly string[]).includes(o) ? `store4c.outcome.${o}` : 'store4c.outcome.unknown';
}
/** Why a channel was NOT sent — the delivery log's own reasons (0176 + 0215's `no_consent`). */
export const SUPPRESS_REASONS = ['opted_out', 'quiet_hours', 'no_consent', 'routine_collapsed', 'channel_off'] as const;
export function suppressKey(r: string | null | undefined): string {
  return (SUPPRESS_REASONS as readonly string[]).includes(String(r)) ? `store4c.suppressed.${r}` : 'store4c.suppressed.unknown';
}

export interface LadderRow { channel: string; channelKey: string; outcomeKey: string; reasonKey: string | null; failed: boolean }
/** "Also by SMS · delivered" — the OTHER channels of this delivery, each as its own row says (never invented; in-app is the item itself). */
export function ladderRows(alsoOn: ReadonlyArray<{ channel: string; outcome: string; suppressedReason?: string | null }> | undefined | null): LadderRow[] {
  return (alsoOn ?? []).filter((a) => a.channel !== 'inapp').map((a) => ({
    channel: a.channel, channelKey: channelKey(a.channel), outcomeKey: outcomeKey(a.outcome),
    reasonKey: a.outcome === 'suppressed' || a.outcome === 'held' ? suppressKey(a.suppressedReason ?? null) : null,
    failed: a.outcome === 'failed',
  }));
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
export interface ItemWords { title: string | null; body: string | null; source: 'rendered' | 'payload' | 'event' }
/** The words of an item: what was sent (`rendered`), else the payload's own, else nothing (the page prints the event's name). */
export function itemWords(n: { rendered?: { title: string | null; body: string } | null; payload?: Record<string, unknown> | null }): ItemWords {
  const r = n.rendered ?? null;
  if (r && (str(r.title) || str(r.body))) return { title: str(r.title), body: str(r.body), source: 'rendered' };
  const p = n.payload ?? {};
  if (str(p.title) || str(p.body)) return { title: str(p.title), body: str(p.body), source: 'payload' };
  return { title: null, body: null, source: 'event' };
}
/** The event's name as words (`store4c.event.<code>` where the catalogue has one), else the code itself. */
export function eventKey(code: string): string { return `store4c.event.${code}`; }
/** A deep link is honoured only as a SAME-ORIGIN path (open-redirect guard); none → no "Open". */
export function deepLink(payload: Record<string, unknown> | null | undefined): string | null {
  const s = str(payload?.deepLink);
  return s && s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : null;
}
export function isUnread(n: { status?: string | null; readAt?: string | null }): boolean { return String(n.status ?? '').toLowerCase() !== 'read' && !n.readAt; }

/* ---------------------------------------------------------------------------------------------------------------------------------- */
/* THE PAGE'S QUERY · HREFS · ACT OUTCOMES                                                                                             */
/* ---------------------------------------------------------------------------------------------------------------------------------- */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
export function inboxHref(slug: string, q: { unread?: boolean; cursor?: string | null; ok?: string | null; failure?: string | null } = {}): string {
  const base = SLUG.test(slug) ? `/${slug}/notifications` : '/notifications';
  const p = new URLSearchParams();
  if (q.unread) p.set('unread', '1');
  if (q.cursor) p.set('cursor', q.cursor.slice(0, 512));
  if (q.ok) p.set('ok', q.ok);
  if (q.failure) p.set('failure', q.failure);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
const one = (v: unknown): string | undefined => { const x = Array.isArray(v) ? v[0] : v; return typeof x === 'string' ? x : undefined; };
/** All (`unreadOnly: false` — the strict boolean, HOTFIX-6: read rows are listed) or Unread. */
export function readInboxQuery(sp: Record<string, string | string[] | undefined>): { unreadOnly: boolean; cursor: string | undefined } {
  const c = one(sp.cursor);
  return { unreadOnly: one(sp.unread) === '1', cursor: c && /^[A-Za-z0-9+/=_-]{1,512}$/.test(c) ? c : undefined };
}
export const INBOX_OK = ['read', 'all_read'] as const;
export const INBOX_FAILURES = ['read', 'all_read'] as const;
export function readOneOf<T extends string>(raw: unknown, allowed: readonly T[]): T | null {
  const v = one(raw);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
/** A key minted at render (`read:<uuid>` per row · `readall:<uuid>`) — re-validated on the way in. */
export const READ_KEY_RE = /^read:[0-9a-f-]{36}$/;
export const READ_ALL_KEY_RE = /^readall:[0-9a-f-]{36}$/;
export function readActKey(raw: unknown, re: RegExp): string | null { const v = one(raw); return v && re.test(v) ? v : null; }
/** The row's instant (`at`, microseconds, ISO) — carried to mark-read so the API prunes to one partition; anything else is dropped. */
export function readAt(raw: unknown): string | undefined {
  const v = one(raw);
  return v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(v) ? v : undefined;
}

/** The canon's rows that NO event the platform emits can produce — refused by name, never drawn (features/store4c/refusals.ts). */
export const INBOX_UNMAPPED_EVENTS = Object.freeze(['price.alert', 'shipment.in_transit', 'delivery.otp'] as const);
