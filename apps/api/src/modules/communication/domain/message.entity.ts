// modules/communication/domain/message.entity.ts · the messages aggregate (append-only, partitioned by created_at).
// A message must carry SOMETHING (body | voice | attachment). senderUserId NULL = system/AI; is_ai_generated
// drives the transparency badge; is_flagged is the abuse-moderation flag (the only mutable state).
//
// PC-56 STORE-4b · D2a/b — A REPORT HAS A REASON, A REPORTER AND AN INSTANT (0216). `flag({ by, reasonId, reasonCode, at })`:
//   • the sender cannot report their own message (MESSAGE_REPORT_OWN, 422);
//   • an already-flagged message answers the same — no second event, the first report stands;
//   • the event carries the reason CODE, never the body and never the reporter (the outbox is not a moderator).
// `createdAtUs` is `created_at` as the database printed it (microseconds — shared/pagination/us-keyset.ts): the keyset cursor and the
// partition-pruned point UPDATE bind it, never a JS Date (milliseconds — the F-21 class: a Date-bound UPDATE matched no row).
import { DomainEvent, MessagingEventType } from './messaging.events';
import { EmptyMessageError, MessageReportOwnError } from './messaging.errors';

export interface MessageProps {
  id: string; conversationId: string; tenantId: string; senderUserId: string | null; body: string | null;
  voiceMediaId: string | null; attachmentMediaId: string | null; isAiGenerated: boolean; isFlagged: boolean; createdAt?: Date;
  createdAtUs?: string | null;
  flagReasonId?: string | null; flagReason?: string | null; flaggedBy?: string | null; flaggedAt?: Date | null;
}
export interface MessageReport { by: string; reasonId: string; reasonCode: string; at?: Date }

export class Message {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MessageProps) {}

  static post(input: Omit<MessageProps, 'isFlagged'>): Message {
    if (!input.body && !input.voiceMediaId && !input.attachmentMediaId) throw new EmptyMessageError();
    const m = new Message({ ...input, isFlagged: false });
    m.events.push({ type: MessagingEventType.MessagePosted, payload: { messageId: m.props.id, conversationId: m.props.conversationId, senderUserId: m.props.senderUserId, isAiGenerated: m.props.isAiGenerated } });
    return m;
  }
  static rehydrate(p: MessageProps): Message { return new Message(p); }
  get id() { return this.props.id; }
  get conversationId() { return this.props.conversationId; }
  get senderUserId() { return this.props.senderUserId; }
  get isFlagged() { return this.props.isFlagged; }
  toProps(): Readonly<MessageProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Report the message. Returns true when THIS call flagged it (false: it already was — the first report stands, no event). */
  flag(r: MessageReport): boolean {
    if (this.props.senderUserId !== null && this.props.senderUserId === r.by) throw new MessageReportOwnError();
    if (this.props.isFlagged) return false;
    this.props.isFlagged = true;
    this.props.flagReasonId = r.reasonId; this.props.flagReason = r.reasonCode; this.props.flaggedBy = r.by; this.props.flaggedAt = r.at ?? new Date();
    this.events.push({ type: MessagingEventType.MessageFlagged, payload: { messageId: this.props.id, conversationId: this.props.conversationId, reason: r.reasonCode } });
    return true;
  }
  /** Moderator review cleared it: the body is served again (the report's record — reason, reporter, instant — is kept). */
  unflag(): void { this.props.isFlagged = false; }
  toJSON() {
    const v = this.props;
    return { id: v.id, conversationId: v.conversationId, senderUserId: v.senderUserId, body: v.body, voiceMediaId: v.voiceMediaId, attachmentMediaId: v.attachmentMediaId,
      isAiGenerated: v.isAiGenerated, isFlagged: v.isFlagged, createdAt: v.createdAt,
      flagReason: v.flagReason ?? null, flaggedBy: v.flaggedBy ?? null, flaggedAt: v.flaggedAt ?? null };
  }
}
