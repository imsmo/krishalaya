// modules/communication/domain/messaging.errors.ts · typed errors, stable codes → HTTP.
// Anti-enumeration: a non-participant gets 404 (NotFound), never 403 — they must not learn the row exists.
import { DomainError } from '../../../shared/errors/app-error';

export class ConversationNotFoundError extends DomainError {
  constructor(id: string) { super('CONVERSATION_NOT_FOUND', `Conversation ${id} not found`, 404, { id }); }
}
export class MessageNotFoundError extends DomainError {
  constructor(id: string) { super('MESSAGE_NOT_FOUND', `Message ${id} not found`, 404, { id }); }
}
export class MaskedCallNotFoundError extends DomainError {
  constructor(id: string) { super('MASKED_CALL_NOT_FOUND', `Masked call ${id} not found`, 404, { id }); }
}
/** PC-56 STORE-4b · B3: the lock's KIND travels in the details (`owner` · `moderator` · `dispute`) — the thread page says which, by name. */
export class ConversationLockedError extends DomainError {
  constructor(id: string, lockKind: string | null = null) { super('CONVERSATION_LOCKED', `Conversation ${id} is locked to new messages`, 409, { id, lockKind }); }
}
export class EmptyMessageError extends DomainError {
  constructor() { super('MESSAGE_EMPTY', 'A message needs body, voice, or an attachment', 422, {}); }
}
export class InvalidConversationError extends DomainError {
  constructor(detail: string) { super('CONVERSATION_INVALID', detail, 422, { detail }); }
}
export class MessagingForbiddenError extends DomainError {
  constructor(detail = 'forbidden') { super('MESSAGING_FORBIDDEN', detail, 403, {}); }
}
/** PC-56 HOTFIX-6 · B1 (founder D2) — a masked call refused BY NAME. The callee is resolved by the server from the conversation; nothing the
 *  client sends names a person. NOT_PARTICIPANT answers an unknown conversation too (403 either way — the route never says whether a thread
 *  it will not ring exists). */
export type MaskedCallRefusalCode = 'MASKED_CALL_NOT_PARTICIPANT' | 'MASKED_CALL_NO_CALLEE' | 'MASKED_CALL_NOT_MEMBER' | 'MASKED_CALL_BLOCKED';
const MASKED_CALL_REFUSAL_STATUS: Record<MaskedCallRefusalCode, number> = {
  MASKED_CALL_NOT_PARTICIPANT: 403, MASKED_CALL_NO_CALLEE: 422, MASKED_CALL_NOT_MEMBER: 403, MASKED_CALL_BLOCKED: 403,
};
const MASKED_CALL_REFUSAL_TEXT: Record<MaskedCallRefusalCode, string> = {
  MASKED_CALL_NOT_PARTICIPANT: 'You can only call from a conversation you are part of',
  MASKED_CALL_NO_CALLEE: 'This conversation has no single other party to call',
  MASKED_CALL_NOT_MEMBER: 'Both sides of a call must belong to this organisation',
  MASKED_CALL_BLOCKED: 'This call cannot be placed',
};
export class MaskedCallRefusedError extends DomainError {
  constructor(code: MaskedCallRefusalCode) { super(code, MASKED_CALL_REFUSAL_TEXT[code], MASKED_CALL_REFUSAL_STATUS[code], {}); }
}

// ── PC-56 STORE-4b · B5 (founder D1 / D2) — refused BY NAME ──────────────────────────────────────────────────────────────────────────────
/** The order is not the caller's, or the order / listing does not exist (or is not live) in this organisation — 404, never 403. */
export class ConversationContextNotFoundError extends DomainError {
  constructor() { super('CONVERSATION_CONTEXT_NOT_FOUND', 'Nothing to message the organisation about was found', 404, {}); }
}
/** The organisation has no active member who handles orders (`order.manage`) — nobody would read the thread. */
export class ConversationNoResponderError extends DomainError {
  constructor() { super('CONVERSATION_NO_RESPONDER', 'This organisation has nobody to answer messages yet', 422, {}); }
}
/** Staff opened a thread naming somebody with no active role in this organisation. */
export class ConversationParticipantNotMemberError extends DomainError {
  constructor(count: number) { super('CONVERSATION_PARTICIPANT_NOT_MEMBER', 'Every participant must belong to this organisation', 422, { count }); }
}
/** A sender cannot report their own message. */
export class MessageReportOwnError extends DomainError {
  constructor() { super('MESSAGE_REPORT_OWN', 'You cannot report your own message', 422, {}); }
}
/** The reason is not a `report_reason` value of the platform vocabulary. */
export class MessageReportReasonUnknownError extends DomainError {
  constructor(reason: string) { super('MESSAGE_REPORT_REASON_UNKNOWN', 'That is not a reason a message can be reported for', 422, { reason }); }
}
/** The owner tried to lift a lock that is not theirs to lift (a moderator's or a dispute's) — only a moderator can. */
export class ConversationLockHeldError extends DomainError {
  constructor(lockKind: string | null) { super('CONVERSATION_LOCK_HELD', 'Only a moderator can reopen this conversation', 403, { lockKind }); }
}
