// apps/web-storefront/src/features/store4b/refusals.ts · PC-56 STORE-4b · brief §E — what the messages list (W297), the thread (W298) and the
// report chain (W3109–W3111) do NOT claim, BY NAME. PURE. (The shape of features/store4/refusals.ts, store4a's and store4c's.) Each refused canon
// claim is listed ONCE with where the canon makes it and the surfaces it is PRINTED on (a refusal sentence — never an offer); the render tests
// read this map, so a refusal that disappears from its page — or the refused copy coming back into a catalogue (test/claims-guard.spec.ts) —
// turns a test red. "Call" stays HOTFIX-6's (`features/store4/refusals.ts`, surface `thread` — founder D3 carried).
import type { Store4Refusal, Store4Surface } from '../store4/refusals';

export type Store4bSurface = Extract<Store4Surface, 'messages' | 'thread' | 'report'>;

export const STORE4B_REFUSALS: readonly Store4Refusal[] = Object.freeze([
  { id: 'block', canon: 'W297 state "Blocked contact — You blocked this buyer on Fri 03 Jul…" · W298 ⋮ "Report or block" · state "Block confirm — Block Ramesh Patel?"', surfaces: ['messages', 'thread', 'report'],
    key: 'store4b.refusal.block', why: 'founder D2e (Q9): blocking is refused — `user_blocks` stays person→person, read only by HOTFIX-6\'s call check; "You blocked this buyer" is also a seller sentence on a buyer screen (survey F-26)' },
  { id: 'translation', canon: 'W298 "Translated: \\"Thanks for the order!…\\""', surfaces: ['thread'],
    key: 'store4b.refusal.translation', why: 'founder D4 (Q15): no translation exists anywhere in the platform' },
  { id: 'transcript', canon: 'W298 voice note "auto-transcript below"', surfaces: ['thread'],
    key: 'store4b.refusal.transcript', why: 'founder D4 (Q15): no transcription exists' },
  { id: 'voice_playback', canon: 'W298 voice note ▶ 0:19', surfaces: ['thread'],
    key: 'store4b.refusal.voicePlayback', why: 'founder D4: `media.downloadUrl` answers the uploader (or a moderator) only — a buyer cannot be given a playable link to the organisation\'s note in one call; the label is printed instead' },
  { id: 'waveform', canon: 'W298 "▂▄▆▄▂▃▅▇▅▃▂▄" waveform', surfaces: ['thread'],
    key: 'store4b.refusal.waveform', why: 'founder D4: DECOR — no waveform is computed or stored' },
  { id: 'mic', canon: 'W298 composer mic icon (voice note)', surfaces: ['thread'],
    key: 'store4b.refusal.mic', why: 'founder D4: recording a voice note needs a media upload from the storefront — not built' },
  { id: 'ai', canon: 'W298 "AI · system message — always labelled · Dispatch re-grade…"', surfaces: ['thread'],
    key: 'store4b.refusal.ai', why: 'founder D4: there is no AI or system-message writer (`is_ai_generated` exists; nothing sets it)' },
  { id: 'kyc', canon: 'W298 H1 "Ramesh Patel KYC ✓"', surfaces: ['thread'],
    key: 'store4b.refusal.kyc', why: 'founder D4: no person is named and no person\'s KYC is a buyer fact — the header is the organisation' },
  { id: 'read_receipts', canon: 'W297 "✓✓" · W298 "You 18:10 · ✓✓ read"', surfaces: ['messages', 'thread'],
    key: 'store4b.refusal.readReceipts', why: 'founder D4: `last_read_at` is per participant, not served per message — no "read" tick is claimed' },
  { id: 'offline_queue', canon: 'W297 "Offline — messages written offline queue… \\"sending…\\"" · W298 "Sending… (offline queue) — it will never send twice"', surfaces: ['messages', 'thread'],
    key: 'store4b.refusal.offlineQueue', why: 'PC-56 STORE-6b (founder D1 / D4) reworded: the canon\'s "saved on this phone" half is TRUE now — the composer keeps the words on this phone as they are typed — and the "sends when signal returns" half stays REFUSED: nothing is queued or sent by itself; the person presses Send, under the key this page minted at its render (a retry after a timeout posts once)' },
  { id: 'safety_desk', canon: 'W298 "harassment cases jump straight to the safety desk"', surfaces: ['thread', 'report'],
    key: 'store4b.refusal.safetyDesk', why: 'a report hides the message for review; nothing routes it to a desk' },
  { id: 'counts', canon: 'W297 "Showing 4 of 31 conversations"', surfaces: ['messages'],
    key: 'store4b.refusal.counts', why: 'keyset Next only (Law 11); no total is served' },
  { id: 'platform_support', canon: 'W297 row "Krishalaya support · support_ticket · TKT-77145"', surfaces: ['messages'],
    key: 'store4b.refusal.platformSupport', why: 'founder D1 (Q13): a white-label store lists the threads with THIS organisation (order · listing); platform support is not listed here' },
  { id: 'flagged_off', canon: 'W297 / W298 "Flagged off — Messages / Chat disabled … See store settings"', surfaces: ['messages', 'thread'],
    key: 'store4b.refusal.flaggedOff', why: 'reworded: when this store\'s messages are switched off the page says so honestly (`store4b.messages.off`) — there are no "store settings" for a buyer' },
  { id: 'unread_badge', canon: 'W297 header "1 unread" beside Messages (survey B15)', surfaces: ['messages'],
    key: 'store4b.refusal.unreadBadge', why: 'no bounded unread-count endpoint exists (a list of one is not a count) — none is added; each row carries its own unread count' },
  { id: 'oncall', canon: 'W3111 "repeated failures page the on-call"', surfaces: ['report'],
    key: 'store4b.refusal.oncall', why: 'nothing pages anyone; the failure is said by name, with a Retry' },
]);

/** The canon shapes STORE-4b builds differently — recorded DELTAs, not refusals. */
export const STORE4B_DELTAS: readonly { id: string; canon: string; built: string }[] = Object.freeze([
  { id: 'messages_route', canon: '`(marketplace)/messages` · `messages/[id]`', built: '/<slug>/messages and /<slug>/messages/[id] under the organisation\'s chrome (founder Q13); the platform /messages and /messages/[id] are doors' },
  { id: 'send_no_confirm', canon: 'W3109 "Confirm this action" before Send', built: 'a chat send has no confirm (it is a message, not a state change worth a confirm); its key is minted at render so a retry posts once' },
  { id: 'retry_reload', canon: 'W3112 "Confirm this action" before the list\'s Retry', built: 'Retry is a reload (a read): no confirm, no audit — W3112–W3114 are DECOR' },
  { id: 'organisation_name', canon: 'rows and the header name a person ("Ramesh Patel", "RP")', built: 'the organisation\'s name (founder D1 — HOTFIX-6\'s buyer shape); staff keep the names on their own pages' },
  { id: 'negotiation_context', canon: 'W297 "direct · wheat negotiation"', built: 'an offer has no thread of its own: "Message the organisation" on an offer opens the thread about its LISTING' },
  { id: 'keyset', canon: '"Showing 4 of 31"', built: 'keyset Next (Law 11)' },
]);

/** The 8 STORE-4b canon files and their verdicts. */
export const STORE4B_CHAIN_PAGES: readonly { file: string; flowmap: string; verdict: string }[] = Object.freeze([
  { file: 'W297-store-messages.html', flowmap: 'route `messages`', verdict: 'BUILT at /<slug>/messages (the platform /messages a door) — the organisation\'s name, the context chip, "You: " previews, hidden previews, unread per row, the lock with its kind, keyset, the honest OFF state' },
  { file: 'W298-store-message-thread.html', flowmap: 'route `messages/[id]`', verdict: 'BUILT at /<slug>/messages/[id] (the platform /messages/[id] a door) — the organisation, the context strip with its link, `from` labels, hidden messages, the keyed composer, the locked state with its kind, ⋮ Report' },
  { file: 'W3109-store-message-mutate-confirm.html', flowmap: 'W298 ⋮ Report', verdict: 'BUILT — REAL: the report confirm (a reason from the vocabulary, the sentence, the key minted at render). Send has no confirm (DELTA); Call and Block are refused' },
  { file: 'W3110-store-message-mutate-success.html', flowmap: 'W3109 Proceed', verdict: 'BUILT — REAL: "Reported — hidden from you pending review" on the thread, the message now hidden' },
  { file: 'W3111-store-message-mutate-failure.html', flowmap: 'W3109 Proceed (failure)', verdict: 'BUILT — REAL: named (not found / not yours to report / not a reason / switched off / server) with Retry carrying the same key' },
  { file: 'W3112-store-messages-mutate-confirm.html', flowmap: 'W297 Retry', verdict: 'PARITY-DECOR — Retry is a reload' },
  { file: 'W3113-store-messages-mutate-success.html', flowmap: 'W3112 Proceed', verdict: 'PARITY-DECOR — the re-rendered list' },
  { file: 'W3114-store-messages-mutate-failure.html', flowmap: 'W3112 Proceed (failure)', verdict: 'PARITY-DECOR — the load error again with Retry' },
]);

/** The keys a surface prints (in registry order). */
export function store4bRefusalKeys(surface: Store4bSurface): string[] {
  return STORE4B_REFUSALS.filter((r) => (r.surfaces as readonly string[]).includes(surface)).map((r) => r.key);
}
