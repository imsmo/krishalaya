// modules/communication/domain/conversation.entity.ts · the conversations aggregate (order/dispute/direct chat).
// A thin context holder + lock state; participants live in conversation_participants (managed by the service).
// No version column → the repo locks FOR UPDATE when changing the lock. Soft-deletable (deleted_at).
//
// PC-56 STORE-4b · D2c (Law 5) — THE LOCK IS MONOTONIC and its rule lives HERE (with the pure ranking in organisation-thread.ts):
//   • `lock(kind)` — `owner` (the opener) · `moderator` · `dispute` (a dispute decision). A lock on an open thread, or a STRONGER kind on a
//     locked one (owner < moderator < dispute), changes it and emits `comm.conversation_locked` with the kind; the same or a weaker kind is a
//     no-op (no event — the dispute handler's idempotency);
//   • `unlock(by)` — the owner lifts only an `owner` lock; a moderator lifts any; anything else → CONVERSATION_LOCK_HELD (403) by name.
import { ContextType, DomainEvent, MessagingEventType } from './messaging.events';
import { InvalidConversationError, ConversationLockHeldError } from './messaging.errors';
import { LockKind, LockLifter, lockLift, lockWins } from './organisation-thread';

export interface ConversationProps {
  id: string; tenantId: string; contextType: ContextType; contextId: string | null; isLocked: boolean; createdAt?: Date;
  /** PC-56 STORE-4b (0216): the current lock's kind and instant (null while open). A locked row read without a kind is `owner` (0216's backfill). */
  lockKind?: LockKind | null; lockedAt?: Date | null;
}
export class Conversation {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: ConversationProps) {}

  static open(input: Omit<ConversationProps, 'isLocked' | 'lockKind' | 'lockedAt'>): Conversation {
    if (input.contextType !== 'direct' && !input.contextId) throw new InvalidConversationError('contextId required for a context-linked conversation');
    const c = new Conversation({ ...input, isLocked: false, lockKind: null, lockedAt: null });
    c.events.push({ type: MessagingEventType.ConversationOpened, payload: { conversationId: c.props.id, contextType: c.props.contextType, contextId: c.props.contextId } });
    return c;
  }
  static rehydrate(p: ConversationProps): Conversation {
    return new Conversation({ ...p, lockKind: p.isLocked ? (p.lockKind ?? 'owner') : null, lockedAt: p.isLocked ? (p.lockedAt ?? null) : null });
  }
  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get isLocked() { return this.props.isLocked; }
  get lockKind(): LockKind | null { return this.props.lockKind ?? null; }
  get contextType() { return this.props.contextType; }
  toProps(): Readonly<ConversationProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Lock with a kind. Changes the thread only when it is open or the kind is stronger; otherwise a no-op with no event. */
  lock(kind: LockKind, now: Date = new Date()): boolean {
    if (this.props.isLocked && !lockWins(this.lockKind, kind)) return false;
    this.props.isLocked = true; this.props.lockKind = kind; this.props.lockedAt = now;
    this.events.push({ type: MessagingEventType.ConversationLocked, payload: { conversationId: this.props.id, locked: true, lockKind: kind } });
    return true;
  }
  /** Lift the lock as `by`. The owner lifts only an owner lock (else CONVERSATION_LOCK_HELD); a moderator lifts any. Open → no-op. */
  unlock(by: LockLifter): boolean {
    if (!this.props.isLocked) return false;
    const was = this.lockKind;
    const r = lockLift(was, by);
    if (!r.ok) throw new ConversationLockHeldError(was);
    this.props.isLocked = false; this.props.lockKind = null; this.props.lockedAt = null;
    this.events.push({ type: MessagingEventType.ConversationLocked, payload: { conversationId: this.props.id, locked: false, lockKind: was, liftedBy: by } });
    return true;
  }
  toJSON() { const v = this.props; return { id: v.id, contextType: v.contextType, contextId: v.contextId, isLocked: v.isLocked, lockKind: v.lockKind ?? null, createdAt: v.createdAt }; }
}
