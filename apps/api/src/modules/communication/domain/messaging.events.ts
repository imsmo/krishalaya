// modules/communication/domain/messaging.events.ts · messaging integration events (via outbox) + vocab.
// MessagePosted is the bridge into the notification spine: the notification-event-map turns it into a
// 'chat.message_posted' catalog event → push/in-app alert to the OTHER participants.
export const MessagingEventType = {
  ConversationOpened:  'comm.conversation_opened',
  ConversationLocked:  'comm.conversation_locked',
  MessagePosted:       'comm.message_posted',
  MessageFlagged:      'comm.message_flagged',
  MaskedCallInitiated: 'comm.masked_call_initiated',
  MaskedCallCompleted: 'comm.masked_call_completed',
} as const;
export type MessagingEventType = (typeof MessagingEventType)[keyof typeof MessagingEventType];

export type DomainEvent = { type: string; payload: Record<string, unknown> };

// Where a conversation hangs (PRD §9). 'direct' = peer DM; the rest are linked to another aggregate.
// 'listing' (KV-BL-031, 03_API_CONTRACT_DELTA.md) = a buyer inquiry thread about a specific listing — added so
// GET /v1/listings/:id/inquiries can filter conversations by (contextType='listing', contextId=<listingId>)
// instead of buyer inquiries hiding under the generic 'direct' bucket with no queryable context. context_type is a
// code-side vocab, NOT a DB enum/CHECK (ADR-0006 — see conversations.context_type varchar(40), no CHECK) so this
// is a pure code addition, zero migration.
// PC-56 TENANT-6d-5 · `bmc_unit` — a call or a thread ABOUT A BULK MILK COOLER.
//
// W170's *"Call MCC-AND-03 operator"* is a call about a tank that is warming, and until this entry the platform had no
// way to say so: `masked_calls.context_type` would have been NULL, and a privacy-proxy call log with no context cannot
// answer *"who was called about this cooler, and when"* — which is most of what a call log is for. Added HERE, in the
// module that owns the vocabulary, rather than written as a literal from a dairy service: the column has no CHECK
// (ADR-0006), so a string invented elsewhere would have been accepted and unrecognised forever.
//
// Deliberately NOT in `MULTI_THREAD_CONTEXT_TYPES` below: a tank is one subject with one thread, not one thread per
// caller the way a listing has one per buyer.
export const CONTEXT_TYPES = ['order', 'requirement', 'dispute', 'booking', 'direct', 'support_ticket', 'listing', 'bmc_unit'] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

// Context types where MANY simultaneous threads legitimately share the same (contextType, contextId): a 'direct'
// DM pair may reopen repeatedly, and a 'listing' has ONE thread PER BUYER (many buyers inquire about the same
// listing). ConversationService.open() must NOT auto-reuse "the" existing thread for these types the way it does
// for genuinely 1:1 contexts (order/requirement/dispute/booking/support_ticket) — doing so would hand buyer B
// someone else's conversation with the seller (a real cross-buyer IDOR/mixup), 403-ing them via the participant
// check. GET-side filtering by contextId is unaffected — it lists ALL threads for that context, which is exactly
// what the listing owner's inquiry inbox needs.
// Typed as ReadonlySet<string> (not ContextType) because the DTO's contextType arrives as a plain string (zod
// .enum(CONTEXT_TYPES as unknown as [string, ...string[]]) infers `string`, same as everywhere else it's consumed
// in this service before being cast to ContextType for the entity).
export const MULTI_THREAD_CONTEXT_TYPES: ReadonlySet<string> = new Set<ContextType>(['direct', 'listing']);

export const PARTICIPANT_ROLES = ['member', 'owner', 'agent', 'moderator'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];
