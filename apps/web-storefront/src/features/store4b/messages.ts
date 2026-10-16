// apps/web-storefront/src/features/store4b/messages.ts · PC-56 STORE-4b · C1 / C4 / C6 — the MESSAGES list's pure half (canon W297 "Messages";
// W3112–W3114 are DECOR reloads) and the entry points' rules. No React, no Next, no I/O; unit-tested in test/store4b-messages.spec.ts.
//
// • THE THREADS ARE THE ORGANISATION'S (founder Q13): a buyer's thread is WITH THE ORGANISATION (founder D1) about an order or a listing, so the
//   list lives at /<slug>/messages and reads `conversations.list({ scope: 'organisation' })` — never platform support ("Krishalaya support ·
//   TKT-…" is refused by name). The platform's /messages is a door (lib/store-door.ts).
// • A ROW: the organisation's name (`counterpartyName` — never a person), the context chip (the order number or the listing's title from
//   `contextLabel`), the preview ("You: …" when the caller wrote it; a reported message → "hidden pending review"; none → "No messages yet"),
//   the unread count, the last-message time, the lock with its kind.
// • Keyset Next (never "Showing 4 of 31"); a load error is NOT empty (Retry = a reload); flag OFF → the honest sentence and NO API call.
import type { Conversation } from '@krishalaya/sdk-js';

const one = (v: unknown): string | undefined => { const x = Array.isArray(v) ? v[0] : v; return typeof x === 'string' ? x : undefined; };
const enc = encodeURIComponent;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function messagesHref(slug: string, q: { cursor?: string; failure?: string; code?: string } = {}): string {
  const p = new URLSearchParams();
  if (q.cursor) p.set('cursor', q.cursor);
  if (q.failure) p.set('failure', q.failure);
  if (q.code) p.set('code', q.code);
  const s = p.toString();
  return `/${enc(slug)}/messages${s ? `?${s}` : ''}`;
}
/** The list's query: a keyset cursor (opaque, bounded) and an entry-point failure carried back by name. */
export function readMessagesQuery(sp: Record<string, string | string[] | undefined>): { cursor?: string; openFailure: OpenFailure | null } {
  const c = one(sp.cursor);
  const f = one(sp.failure) === 'open' ? one(sp.code) : undefined;
  return { cursor: c && /^[A-Za-z0-9+/=_-]{1,512}$/.test(c) ? c : undefined, openFailure: f && (OPEN_FAILURES as readonly string[]).includes(f) ? (f as OpenFailure) : null };
}

/** The context chip: an order's number or a listing's title (the API's `contextLabel`), else the context's kind. */
export type ContextChip = { kind: 'order' | 'listing'; label: string } | { kind: 'other'; type: string };
export function contextChip(c: Pick<Conversation, 'contextType' | 'contextLabel'>): ContextChip {
  if ((c.contextType === 'order' || c.contextType === 'listing') && c.contextLabel) return { kind: c.contextType, label: c.contextLabel };
  return { kind: 'other', type: c.contextType };
}

/** The preview: hidden (reported) · yours ("You: …") · theirs · a voice note / an attachment (labels) · none. Never a body that was reported. */
export type Preview = { kind: 'hidden' } | { kind: 'none' } | { kind: 'text'; text: string; fromYou: boolean } | { kind: 'voice' | 'attachment'; fromYou: boolean };
export function previewOf(c: Pick<Conversation, 'lastMessageAt' | 'lastMessageBody' | 'lastMessageHasVoice' | 'lastMessageHasAttachment' | 'lastMessageFromYou' | 'lastMessageHidden'>): Preview {
  if (c.lastMessageHidden) return { kind: 'hidden' };
  const fromYou = c.lastMessageFromYou === true;
  if (c.lastMessageBody) return { kind: 'text', text: c.lastMessageBody.length > 140 ? `${c.lastMessageBody.slice(0, 139)}…` : c.lastMessageBody, fromYou };
  if (c.lastMessageHasVoice) return { kind: 'voice', fromYou };
  if (c.lastMessageHasAttachment) return { kind: 'attachment', fromYou };
  return { kind: 'none' };
}

export const LOCK_KINDS = ['owner', 'moderator', 'dispute'] as const;
export type LockKind = (typeof LOCK_KINDS)[number];
/** The lock's marker key by kind (`store4b.lock.<kind>`); a kind the page does not know reads as the plain lock. */
export function lockKey(kind: string | null | undefined): string {
  return (LOCK_KINDS as readonly string[]).includes(String(kind)) ? `store4b.lock.${kind}` : 'messages.locked';
}

// ── the entry points (C4): "Message the organisation" on an order, an offer's listing and a listing ──────────────────────────────────────
export const OPEN_KEY_RE = /^openorg:[0-9a-f-]{36}$/;
export const OPEN_CONTEXTS = ['order', 'listing'] as const;
export type OpenContext = (typeof OPEN_CONTEXTS)[number];
/** The entry point is drawn ONLY for a signed-in buyer in a store whose `communication` flag is ON (never on a read failure). */
export function showsMessageOrg(signedIn: boolean, flags: { communication?: boolean } | null): boolean {
  return signedIn && flags?.communication === true;
}
/** The open's failures, by name (the API's code → the page's sentence). */
export const OPEN_FAILURES = ['context', 'no_responder', 'forbidden', 'off', 'server'] as const;
export type OpenFailure = (typeof OPEN_FAILURES)[number];
export function openFailureOf(code: string | undefined, status?: number): OpenFailure {
  if (code === 'CONVERSATION_CONTEXT_NOT_FOUND') return 'context';
  if (code === 'CONVERSATION_NO_RESPONDER') return 'no_responder';
  if (code === 'MESSAGING_FORBIDDEN') return 'forbidden';
  if (code === 'NOT_FOUND' || status === 404) return 'off';   // the `communication` guard answers a plain 404 (invisible when OFF)
  return 'server';
}
