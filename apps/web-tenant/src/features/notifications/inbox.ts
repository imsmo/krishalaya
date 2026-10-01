// apps/web-tenant/src/features/notifications/inbox.ts · PC-56 TENANT-8b · THE INBOX — the console's pure helpers for
// W204 (`/notifications`), W431 (`/notifications/center`), W432 (the topbar bell — the canon's pattern page itself is not
// a route), W433 (`/notifications/preferences`), W434 (`/notifications/[id]?at=`), the notification FORM chain W2683–W2686
// (`/notifications/preferences/edit?form=window|preferences|language`), the notification MUTATE chain W2687–W2689
// (`/notifications/act` — mark read, one or several, and mark all read from the center) and the notifications MUTATE chain
// W2690–W2692 (`/notifications/read-all` — W204's *Mark all read*).
//
// No React, no SDK runtime (type-only imports), so every rule a page draws is reachable by a spec.
import type { LadderStep, NotificationAlsoOn, NotificationItem, NotificationMatrix, MatrixCell, NotificationForm, InboxAct } from '@krishalaya/sdk-js';

export const INBOX_HREF = '/notifications';
export const CENTER_HREF = '/notifications/center';
export const PREFS_HREF = '/notifications/preferences';
export const PREFS_EDIT_HREF = '/notifications/preferences/edit';
export const ACT_HREF = '/notifications/act';
export const READ_ALL_HREF = '/notifications/read-all';
export const FORMS: readonly NotificationForm[] = ['window', 'preferences', 'language'];
export const ACTS: readonly InboxAct[] = ['read', 'readAll'];
export const STATE_VALUES = ['unread', 'read'] as const;

/** The canon's clickables this platform has no backend for — each printed by name with its reason, never a dead button. */
export const REFUSED_BY_NAME = [
  'digest', 'collapse', 'archive', 'masterSwitch', 'suspendTonight', 'centerDisabled', 'autoRetry', 'smsCostRupees',
  'approvalRoleLock', 'teamReachability', 'retryPageLoad', 'popoverKeys', 'tierChipAct', 'digestFrequency',
] as const;
export type RefusedByName = (typeof REFUSED_BY_NAME)[number];
export function refusedKey(r: RefusedByName): string { return `notif.refused.${r}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* ROUTES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export interface CenterFilters { state?: string | null; tier?: string | null; module?: string | null; channel?: string | null }

/** W431 with its GET-form filters; a filter change resets the cursor (a cursor belongs to one filter set). */
export function centerHref(f: CenterFilters = {}, cursor?: string | null, base: string = CENTER_HREF): string {
  const q = new URLSearchParams();
  if (f.state === 'unread' || f.state === 'read') q.set('state', f.state);
  if (f.tier) q.set('tier', f.tier);
  if (f.module) q.set('module', f.module);
  if (f.channel) q.set('channel', f.channel);
  if (cursor) q.set('cursor', cursor);
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
export function hasFilters(f: CenterFilters): boolean { return Boolean(f.state || f.tier || f.module || f.channel); }

/** W434 — the ladder carries the row's EXACT instant, so the lookup touches one partition and never misses. */
export function ladderHref(n: Pick<NotificationItem, 'id' | 'at'>): string | null {
  if (!n.at) return null;
  return `${INBOX_HREF}/${encodeURIComponent(n.id)}?${new URLSearchParams({ at: n.at }).toString()}`;
}
/** W2687 · the mutate chain's confirm, for one item or several (the center's checkboxes), or all. */
export function actHref(act: InboxAct, items: ReadonlyArray<Pick<NotificationItem, 'id' | 'at'>> = []): string {
  const q = new URLSearchParams({ step: 'confirm', act });
  for (const i of items) { q.append('id', i.id); if (i.at) q.append('at', i.at); }
  return `${ACT_HREF}?${q.toString()}`;
}
export function prefsEditHref(form: NotificationForm, values: Record<string, string | undefined | null> = {}): string {
  const q = new URLSearchParams({ form });
  for (const [k, v] of Object.entries(values)) if (v) q.set(k, v);
  return `${PREFS_EDIT_HREF}?${q.toString()}`;
}
export function isForm(s: string | null | undefined): s is NotificationForm { return (FORMS as readonly string[]).includes(s ?? ''); }
export function isAct(s: string | null | undefined): s is InboxAct { return (ACTS as readonly string[]).includes(s ?? ''); }

/** The center's checkboxes carry `id|at` in one value (a checkbox has one value); the confirm page splits them back. */
export function pickValue(n: Pick<NotificationItem, 'id' | 'at'>): string { return n.at ? `${n.id}|${n.at}` : n.id; }
export function parsePicks(picks: readonly string[]): Array<{ id: string; at: string | undefined }> {
  const out: Array<{ id: string; at: string | undefined }> = [];
  const seen = new Set<string>();
  for (const p of picks) {
    const [id, at] = p.split('|');
    const i = (id ?? '').trim();
    if (!i || seen.has(i)) continue;
    seen.add(i);
    out.push({ id: i, at: at?.trim() || undefined });
  }
  return out;
}
/** At most this many items in one bulk act (the confirm page lists every one). */
export const MAX_PICKS = 50;
/** The ids and instants a confirm page carries, paired; an id without its instant is still carried (older links). */
export function pairIdsAt(ids: readonly string[], ats: readonly string[]): Array<{ id: string; at: string | undefined }> {
  return ids.filter((id) => id.trim().length > 0).map((id, i) => ({ id: id.trim(), at: ats[i]?.trim() || undefined }));
}

/* ---------------------------------------------------------------------------------------------------------- */
/* STATES                                                                                                     */
/* ---------------------------------------------------------------------------------------------------------- */

export type InboxPageState = 'notEnabled' | 'restricted' | 'notFound' | 'error';

/**
 * A transport failure → the canon's own states. The module guard answers a bare 404 when `communication` is OFF — the
 * canon's *"Flagged off"*, not *"Couldn't load"* (6e-1's lesson; before this wave `/notifications` printed its load
 * error whenever the flag was off). `NOTIFICATION_NOT_FOUND` is W434's *"Notification not found"* (another member's,
 * past retention, or a broken link) — a different sentence.
 */
export function inboxTransportState(code: string | null | undefined, status?: number): InboxPageState {
  if (code === 'COMM_FORBIDDEN' || code === 'FORBIDDEN' || status === 403) return 'restricted';
  if (code === 'NOTIFICATION_NOT_FOUND') return 'notFound';
  if (code === 'NOT_FOUND' || code === 'FEATURE_DISABLED' || status === 404) return 'notEnabled';
  return 'error';
}
export function pageStateKey(s: InboxPageState): string { return `notif.state.${s}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* WHAT AN ITEM SAYS                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v : null);
export function itemTitle(n: Pick<NotificationItem, 'payload'>): string | null { return str(n.payload.title); }
export function itemBody(n: Pick<NotificationItem, 'payload'>): string | null { return str(n.payload.body); }
/** Deep links are honoured only same-origin (open-redirect guard). */
export function sameOriginPath(v: unknown): string | null {
  const s = str(v);
  return s && s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : null;
}
export function isUnread(n: Pick<NotificationItem, 'status' | 'readAt'>): boolean { return n.status !== 'read' && !n.readAt; }

/**
 * The status an IN-APP item may print: what its row says. An in-app row is written `sent` (it IS the item) and becomes
 * `read`; it is never `delivered` — W431 drew "delivered" for in-app items and the log never said so.
 */
export function inappStatusKey(n: Pick<NotificationItem, 'status' | 'readAt'>): string { return isUnread(n) ? 'notif.inapp.unread' : 'notif.inapp.read'; }
export function outcomeKey(o: string): string { return `notif.outcome.${o}`; }
export function channelKey(c: string): string { return `notif.channel.${c}`; }
export function tierKey(t: string | null | undefined): string { return `notif.tier.${t ?? 'unknown'}`; }
export function moduleKey(m: string): string { return `notif.module.${m}`; }
export function suppressedKey(r: string | null | undefined): string { return `notif.suppressed.${r ?? 'unknown'}`; }
export function failureKey(r: string | null | undefined): string { return `notif.failure.${r ?? 'unrecorded'}`; }
export function stepKey(s: Pick<LadderStep, 'kind'>): string { return `notif.step.${s.kind}`; }

/** "Also by SMS · sent" — the other channels, never invented: only what the delivery instance holds. */
export function alsoOnLine(also: readonly NotificationAlsoOn[]): Array<{ channel: string; outcome: string }> {
  return also.map((a) => ({ channel: a.channel, outcome: a.outcome }));
}
/** W204's *"critical items also SMS you — the bell is never the only wire"*, as a per-item FACT: true only when this
 *  item's own delivery instance has an SMS row. */
export function alsoReachedBySms(also: readonly NotificationAlsoOn[]): boolean { return also.some((a) => a.channel === 'sms'); }

/* ---------------------------------------------------------------------------------------------------------- */
/* W431 · DAY GROUPS (the COOPERATIVE's day — the server computes `localDay` in its zone)                    */
/* ---------------------------------------------------------------------------------------------------------- */

export type DayLabel = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'date'; date: string } | { kind: 'unknown' };

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export function dayLabel(localDay: string | null | undefined, today: string | null | undefined): DayLabel {
  if (!localDay) return { kind: 'unknown' };
  if (today && localDay === today) return { kind: 'today' };
  if (today && localDay === dayBefore(today)) return { kind: 'yesterday' };
  return { kind: 'date', date: localDay };
}
/** Items grouped by day, in the order they came (newest first), one group per local day. */
export function groupByDay<T extends Pick<NotificationItem, 'localDay'>>(items: readonly T[]): Array<{ day: string | null; items: T[] }> {
  const out: Array<{ day: string | null; items: T[] }> = [];
  for (const i of items) {
    const d = i.localDay ?? null;
    const last = out[out.length - 1];
    if (last && last.day === d) last.items.push(i); else out.push({ day: d, items: [i] });
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------- */
/* W432 · THE BELL                                                                                            */
/* ---------------------------------------------------------------------------------------------------------- */

/** W432: zero unread = NO badge (not a "0"); the badge caps at 99+. */
export const BADGE_CAP = 99;
export function bellBadge(unread: number): string | null {
  if (!Number.isFinite(unread) || unread <= 0) return null;
  return unread > BADGE_CAP ? `${BADGE_CAP}+` : String(Math.floor(unread));
}
/** The popover is a glance (W432's honesty line): the latest eight, and always "See all" — it never paginates. */
export const BELL_LATEST = 8;

/* ---------------------------------------------------------------------------------------------------------- */
/* W433 · THE MATRIX                                                                                          */
/* ---------------------------------------------------------------------------------------------------------- */

export type CellState = 'notSent' | 'locked' | 'on' | 'off';
export function cellState(cell: Pick<MatrixCell, 'sentOn' | 'enabled'>, locked: boolean): CellState {
  if (!cell.sentOn) return 'notSent';
  if (locked) return 'locked';
  return cell.enabled === false ? 'off' : 'on';
}
export function cellStateKey(s: CellState): string { return `notif.cell.${s}`; }
export const cellName = (eventCode: string, channel: string) => `${eventCode}::${channel}`;

/**
 * The matrix form posts EVERY editable cell (a hidden `cell` per cell, a checkbox `on` when ticked); the review must be
 * asked about the CHANGES only — a 200-cell review is noise and would not fit a link. Locked and not-sent cells are
 * never editable, so they never appear.
 */
export function matrixChanges(m: Pick<NotificationMatrix, 'tiers'>, posted: readonly string[], ticked: ReadonlySet<string>): Array<{ eventCode: string; channel: string; isEnabled: boolean }> {
  const editable = new Map<string, boolean>();
  for (const t of m.tiers) for (const e of t.events) for (const c of e.cells) {
    const s = cellState(c, e.locked);
    if (s === 'on' || s === 'off') editable.set(cellName(e.code, c.channel), s === 'on');
  }
  const out: Array<{ eventCode: string; channel: string; isEnabled: boolean }> = [];
  for (const name of posted) {
    const now = editable.get(name);
    if (now === undefined) continue;
    const want = ticked.has(name);
    if (want === now) continue;
    const i = name.lastIndexOf('::');
    out.push({ eventCode: name.slice(0, i), channel: name.slice(i + 2), isEnabled: want });
  }
  return out;
}
/** Changes travel the review link as `set=event::channel::1|0`, one per change. */
export function encodeChanges(changes: ReadonlyArray<{ eventCode: string; channel: string; isEnabled: boolean }>): string[] {
  return changes.map((c) => `${c.eventCode}::${c.channel}::${c.isEnabled ? '1' : '0'}`);
}
export function decodeChanges(raw: readonly string[]): Array<{ eventCode: string; channel: string; isEnabled: boolean }> {
  const out: Array<{ eventCode: string; channel: string; isEnabled: boolean }> = [];
  for (const r of raw) {
    const parts = r.split('::');
    if (parts.length !== 3 || !parts[0] || !parts[1] || (parts[2] !== '1' && parts[2] !== '0')) continue;
    out.push({ eventCode: parts[0], channel: parts[1], isEnabled: parts[2] === '1' });
  }
  return out;
}
/** A review link carries at most this many changes; beyond it the screen says so (W2683's "values preserved" promise). */
export const MAX_CHANGES = 60;

/** F-18 · "One channel is enough" is DECIDED (G0-4) — the sentence is the flag's live state, never "pending". */
export function routineRuleKey(on: boolean): string { return on ? 'notif.routine.decidedOn' : 'notif.routine.decidedOff'; }

/* ---------------------------------------------------------------------------------------------------------- */
/* THE WINDOW                                                                                                 */
/* ---------------------------------------------------------------------------------------------------------- */

/** 450 → { h: 7, m: 30 } — the review's "lasts 7 h 30 min". */
export function durationParts(minutes: number): { h: number; m: number } {
  const n = Math.max(0, Math.floor(minutes));
  return { h: Math.floor(n / 60), m: n % 60 };
}
export function windowSourceKey(s: 'own' | 'tenant_default' | null | undefined): string { return `notif.window.source.${s ?? 'none'}`; }

/* ---------------------------------------------------------------------------------------------------------- */
/* THE ACTS                                                                                                   */
/* ---------------------------------------------------------------------------------------------------------- */

/**
 * Marking YOUR OWN inbox read asks no reason: the canon's own receipt is *"notifications_marked_read: 2 · actor"* — a
 * count and a person — and a reason box on a read flag would fill the audit trail with "ok". The act is still a confirm
 * step, keyed by the form, audited with actor, time and count.
 */
export function canConfirmAct(count: number): boolean { return Number.isFinite(count) && count > 0; }
export function actLabelKey(act: InboxAct): string { return `notif.act.${act}`; }
export function actDoneKey(act: InboxAct): string { return `notif.actDone.${act}`; }
/** The idempotency key of one item inside a bulk act: the form's key + the item, so a double-submit is one act per item. */
export function itemKey(formKey: string, id: string): string { return `${formKey}:${id}`; }
