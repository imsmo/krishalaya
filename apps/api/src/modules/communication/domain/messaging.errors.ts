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
export class ConversationLockedError extends DomainError {
  constructor(id: string) { super('CONVERSATION_LOCKED', `Conversation ${id} is locked to new messages`, 409, { id }); }
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
