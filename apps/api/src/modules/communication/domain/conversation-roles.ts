// modules/communication/domain/conversation-roles.ts · PC-56 HOTFIX-6 · B1 + B2 (survey STORE-4 F-1 / F-2; HOTFIX-4 D3 "the organisation only,
// everywhere") — WHO IS ON THE OTHER SIDE, SAID AS A ROLE; WHO A CALL RINGS, DECIDED BY THE SERVER. PURE.
//
// `GET /v1/conversations` served `counterpartyName = users.full_name` and the other person's user uuid to every participant, and every message
// served `senderUserId` — so a buyer's inbox carried the farmer's name and id, and the storefront thread derived the farmer's uuid from a
// message and posted it to `POST /v1/masked-calls`, which rang whoever it was given. ONE read model, two shapes (the HOTFIX-5
// `orders/domain/order-event-roles.ts` precedent), decided by the VIEWER:
//   • staff — a moderator, or a person holding an organisation role in this tenant (any active role but `customer`) — keep the full row they
//     had (the name and the ids), plus the role labels;
//   • a buyer (everyone else) reads the ORGANISATION: the counterparty is the tenant's display name when the other party belongs to the
//     organisation (else no name), never `users.full_name`, never a user uuid; each message says `from: you | organisation | platform | system`.
// `platform` is anyone in the thread who holds no organisation role here (platform support — or, reachable only through `open`'s arbitrary
// participant list until STORE-4b's B3, another buyer: still never a name or an id).
export type ConversationViewer = 'buyer' | 'staff';
export type MessageFrom = 'you' | 'organisation' | 'platform' | 'system';
export const MESSAGE_FROM: readonly MessageFrom[] = Object.freeze(['you', 'organisation', 'platform', 'system'] as MessageFrom[]);
export type CounterpartyParty = 'organisation' | 'platform';

/** Staff when a moderator, or when the viewer holds an organisation role in this tenant (read from the database, never from the token). */
export function viewerOf(v: { isModerator: boolean; isOrgMember: boolean }): ConversationViewer {
  return v.isModerator || v.isOrgMember ? 'staff' : 'buyer';
}

/** Who wrote one message, as the buyer reads it. A NULL sender is the system (or an AI writer — `isAiGenerated` says which). */
export function fromOf(senderUserId: string | null, viewerUserId: string, orgMembers: ReadonlySet<string>): MessageFrom {
  if (!senderUserId) return 'system';
  if (senderUserId === viewerUserId) return 'you';
  if (orgMembers.has(senderUserId)) return 'organisation';
  return 'platform';
}

/** The repository's raw summary row (staff fields included) — `otherIsOrg` / `orgName` / `contextLabel` are the HOTFIX-6 additions. */
export interface RawConversationSummary {
  id: string; contextType: string; contextId: string | null; isLocked: boolean; createdAt: Date;
  isArchived: boolean; unreadCount: number;
  lastMessageAt: Date | null; lastMessageBody: string | null; lastMessageHasAttachment: boolean; lastMessageHasVoice: boolean;
  counterpartyName: string | null; counterpartyRole: string | null; counterpartyUserId: string | null;
  otherIsOrg: boolean; orgName: string | null; contextLabel: string | null;
  /** PC-56 STORE-4b · B2: the lock's kind; did the CALLER write the last message ("You: "); was the last message reported (its preview is
   *  blanked in the read — `lastMessageBody` is null — and the page says "hidden pending review"); `created_at` as the database printed it
   *  (the µs keyset cursor — internal, never served). Optional so a pre-4b fixture still type-checks. */
  lockKind?: string | null; lastMessageFromYou?: boolean; lastMessageHidden?: boolean; createdAtUs?: string | null;
}

/** The buyer's summary: the organisation's name (only when the other party belongs to it), a party label, the context label — no person. */
export function buyerSummary(r: RawConversationSummary) {
  const party: CounterpartyParty | null = r.counterpartyUserId === null ? null : r.otherIsOrg ? 'organisation' : 'platform';
  return {
    id: r.id, contextType: r.contextType, contextId: r.contextId, isLocked: r.isLocked, createdAt: r.createdAt,
    isArchived: r.isArchived, unreadCount: r.unreadCount,
    lastMessageAt: r.lastMessageAt, lastMessageBody: r.lastMessageBody, lastMessageHasAttachment: r.lastMessageHasAttachment, lastMessageHasVoice: r.lastMessageHasVoice,
    counterpartyName: party === 'organisation' ? r.orgName : null,
    counterpartyRole: party,
    contextLabel: r.contextLabel,
    lockKind: r.lockKind ?? null, lastMessageFromYou: r.lastMessageFromYou === true, lastMessageHidden: r.lastMessageHidden === true,
  };
}

/** The staff summary: unchanged (the name, the role in the thread and the id they had), plus the context label. */
export function staffSummary(r: RawConversationSummary) {
  const { otherIsOrg, orgName, createdAtUs, ...rest } = r;
  void otherIsOrg; void orgName; void createdAtUs;
  return { ...rest, lockKind: r.lockKind ?? null, lastMessageFromYou: r.lastMessageFromYou === true, lastMessageHidden: r.lastMessageHidden === true };
}

export interface RawMessage {
  id: string; conversationId: string; senderUserId: string | null; body: string | null; voiceMediaId: string | null; attachmentMediaId: string | null;
  isAiGenerated: boolean; isFlagged: boolean; createdAt?: Date;
  /** PC-56 STORE-4b · D2b: the report (moderator-only fields — `hideFlagged` strips them for everyone else). */
  flagReason?: string | null; flaggedBy?: string | null; flaggedAt?: Date | null;
}
/** The buyer's message: `from`, never `senderUserId`. */
export function buyerMessage(m: RawMessage, viewerUserId: string, orgMembers: ReadonlySet<string>) {
  return { id: m.id, conversationId: m.conversationId, from: fromOf(m.senderUserId, viewerUserId, orgMembers), body: m.body, voiceMediaId: m.voiceMediaId,
    attachmentMediaId: m.attachmentMediaId, isAiGenerated: m.isAiGenerated, isFlagged: m.isFlagged, createdAt: m.createdAt,
    flagReason: m.flagReason ?? null, flaggedBy: m.flaggedBy ?? null, flaggedAt: m.flaggedAt ?? null };   // STORE-4b: hideFlagged decides who keeps these
}
/** The staff message: the row they had (the sender id) — `from` is the BUYER's vocabulary and is not added (a buyer would read as
 *  `platform` from the organisation's side, which is not what they are). */
export function staffMessage(m: RawMessage) {
  return { ...m };
}

/** WHOM A MASKED CALL RINGS (B1 / founder D2): never a client-supplied id. The caller must be a participant; the callee is the ONE other
 *  participant. A thread with more than two people is the organisation's-contact rule, which does not exist yet (STORE-4b's B3) — refused by
 *  name, never guessed. */
export type CalleeResolution = { ok: true; calleeUserId: string } | { ok: false; refusal: 'MASKED_CALL_NOT_PARTICIPANT' | 'MASKED_CALL_NO_CALLEE' };
export function resolveCallee(participantIds: readonly string[], callerUserId: string): CalleeResolution {
  const ids = [...new Set(participantIds)];
  if (!ids.includes(callerUserId)) return { ok: false, refusal: 'MASKED_CALL_NOT_PARTICIPANT' };
  const others = ids.filter((u) => u !== callerUserId);
  if (others.length !== 1) return { ok: false, refusal: 'MASKED_CALL_NO_CALLEE' };
  return { ok: true, calleeUserId: others[0] };
}
