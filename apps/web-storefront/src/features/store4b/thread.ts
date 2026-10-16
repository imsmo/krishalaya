// apps/web-storefront/src/features/store4b/thread.ts · PC-56 STORE-4b · C2 / C3 — the THREAD's and the REPORT chain's pure half (canon W298
// "Conversation", W3109–W3111 the message chain — REAL for report; send has no confirm, a DELTA). No React, no Next, no I/O.
//
// • THE HEADER IS THE ORGANISATION (founder D1, HOTFIX-6's buyer shape): its name, never a person's, never "KYC ✓".
// • THE CONTEXT STRIP: the order number + "Open order" (→ /<slug>/orders/[id]) or the listing's title + its link (→ /<slug>/listings/[id]).
// • EACH MESSAGE by `from` (you · the organisation · platform · system) with its time; a REPORTED message prints "hidden pending review" (the API
//   served no body — founder D2b); a voice note prints its label (playback refused by name — D4: the media download link is the uploader's
//   only, so a buyer cannot be given a playable URL in one call); an attachment its label.
// • THE COMPOSER: the key minted AT RENDER (`send:<uuid>` in a hidden input — the 3a/4c precedent): a retry after a timeout posts ONCE. A
//   locked thread: "Readable forever, writable never" + the kind's sentence, and no composer.
// • REPORT (⋮ → W3109 confirm → W3110 success / W3111 failure): a reason from the platform's `report_reason` vocabulary (labels from the
//   vocabulary), the key minted at render (`report:<uuid>`), the failure named by code with Retry carrying the SAME key.
import type { Message, MessageFrom } from '@krishalaya/sdk-js';

const one = (v: unknown): string | undefined => { const x = Array.isArray(v) ? v[0] : v; return typeof x === 'string' ? x : undefined; };
const enc = encodeURIComponent;

export function threadHref(slug: string, id: string, q: { status?: ThreadStatus; code?: string } = {}): string {
  const p = new URLSearchParams();
  if (q.status) p.set('status', q.status);
  if (q.code) p.set('code', q.code);
  const s = p.toString();
  return `/${enc(slug)}/messages/${enc(id)}${s ? `?${s}` : ''}`;
}
export function reportHref(slug: string, id: string, messageId: string, q: { failure?: ReportFailure; key?: string; reason?: string } = {}): string {
  const p = new URLSearchParams();
  if (q.failure) p.set('failure', q.failure);
  if (q.key) p.set('key', q.key);
  if (q.reason) p.set('reason', q.reason);
  const s = p.toString();
  return `/${enc(slug)}/messages/${enc(id)}/report/${enc(messageId)}${s ? `?${s}` : ''}`;
}
/** The context strip's link: the order page or the listing page under THIS store; none for any other context. */
export function contextLink(slug: string, c: { contextType: string; contextId: string | null }): { kind: 'order' | 'listing'; href: string } | null {
  if (!c.contextId) return null;
  if (c.contextType === 'order') return { kind: 'order', href: `/${enc(slug)}/orders/${enc(c.contextId)}` };
  if (c.contextType === 'listing') return { kind: 'listing', href: `/${enc(slug)}/listings/${enc(c.contextId)}` };
  return null;
}

/** Who wrote it, as a catalogue key (the organisation's NAME is printed by the page when it has one). */
export function whoKey(from: MessageFrom | undefined): string {
  return from === 'you' ? 'messages.you' : from === 'organisation' ? 'store4.from.organisation' : from === 'platform' ? 'store4.from.platform' : 'store4.from.system';
}
/** What a message shows: hidden (reported — no body served) · its text · a voice-note label · an attachment label. */
export type BodyView = { kind: 'hidden' } | { kind: 'text'; text: string } | { kind: 'voice' } | { kind: 'attachment' } | { kind: 'empty' };
export function bodyView(m: Pick<Message, 'hidden' | 'isFlagged' | 'body' | 'voiceMediaId' | 'attachmentMediaId'>): BodyView {
  if (m.hidden === true || (m.isFlagged && !m.body && !m.voiceMediaId && !m.attachmentMediaId)) return { kind: 'hidden' };
  if (m.body) return { kind: 'text', text: m.body };
  if (m.voiceMediaId) return { kind: 'voice' };
  if (m.attachmentMediaId) return { kind: 'attachment' };
  return { kind: 'empty' };
}
/** D4: voice PLAYBACK is built only when the SDK gives a playable URL in one call — `media.downloadUrl` is the uploader's (or a moderator's)
 *  only, so a buyer would get 404 for the organisation's note: refused by name (`store4b.refusal.voicePlayback`). */
export const VOICE_PLAYBACK = false as const;
/** The ⋮ "Report" link: on another party's message that is not already hidden (you cannot report your own — the API says so too). */
export function canReport(m: Pick<Message, 'from' | 'hidden' | 'isFlagged'>): boolean {
  return m.from !== 'you' && m.hidden !== true && m.isFlagged !== true;
}

// ── statuses and failures, by name ──────────────────────────────────────────────────────────────────────────────────────────────────────
export const THREAD_STATUSES = ['sent', 'senderr', 'reported'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export const SEND_FAILURES = ['locked', 'not_found', 'off', 'empty', 'server'] as const;
export type SendFailure = (typeof SEND_FAILURES)[number];
export function sendFailureOf(code: string | undefined, status?: number): SendFailure {
  if (code === 'CONVERSATION_LOCKED') return 'locked';
  if (code === 'CONVERSATION_NOT_FOUND') return 'not_found';
  if (code === 'NOT_FOUND' || status === 404) return 'off';
  if (code === 'MESSAGE_EMPTY' || code === 'VALIDATION_FAILED') return 'empty';
  return 'server';
}
export const REPORT_FAILURES = ['not_found', 'own', 'reason', 'off', 'server'] as const;
export type ReportFailure = (typeof REPORT_FAILURES)[number];
/** The report's failure by the API's code: the message (or the caller's place in its thread) is gone · your own · not a reason · switched off. */
export function reportFailureOf(code: string | undefined, status?: number): ReportFailure {
  if (code === 'MESSAGE_NOT_FOUND') return 'not_found';            // also "not a participant" — the API answers both as 404 (no IDOR)
  if (code === 'MESSAGE_REPORT_OWN') return 'own';
  if (code === 'MESSAGE_REPORT_REASON_UNKNOWN' || code === 'VALIDATION_FAILED') return 'reason';
  if (code === 'NOT_FOUND' || status === 404) return 'off';
  return 'server';
}
export function readThreadQuery(sp: Record<string, string | string[] | undefined>): { status: ThreadStatus | null; code: string | null } {
  const s = one(sp.status);
  const status = s && (THREAD_STATUSES as readonly string[]).includes(s) ? (s as ThreadStatus) : null;
  const c = one(sp.code);
  const code = status === 'senderr' && c && ((SEND_FAILURES as readonly string[]).includes(c) || /^lock_(owner|moderator|dispute)$/.test(c)) ? c : null;
  return { status, code };
}
export function readReportQuery(sp: Record<string, string | string[] | undefined>): { failure: ReportFailure | null; key: string | null; reason: string | null } {
  const f = one(sp.failure);
  const k = one(sp.key);
  const r = one(sp.reason);
  return {
    failure: f && (REPORT_FAILURES as readonly string[]).includes(f) ? (f as ReportFailure) : null,
    key: k && REPORT_KEY_RE.test(k) ? k : null,
    reason: r && REASON_RE.test(r) ? r : null,
  };
}

// ── keys minted at render (re-validated on the way in) ───────────────────────────────────────────────────────────────────────────────────
export const SEND_KEY_RE = /^send:[0-9a-f-]{36}$/;
export const REPORT_KEY_RE = /^report:[0-9a-f-]{36}$/;
export const REASON_RE = /^[a-z][a-z0-9_]{0,79}$/;
export function actKeyOf(raw: unknown, re: RegExp): string | null { const v = one(raw); return v && re.test(v) ? v : null; }
