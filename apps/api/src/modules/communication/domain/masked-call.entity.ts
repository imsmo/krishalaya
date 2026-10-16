// modules/communication/domain/masked-call.entity.ts · the masked_calls privacy-proxy log (append-only, partitioned).
// PRD §9.13: buyer↔seller talk without exposing phone numbers. We persist ONLY user ids + the provider's call
// ref + duration — NEVER raw phone numbers (the external masking provider owns the directory). No status column:
// provider_call_ref set = initiated; duration_secs set = completed (lifecycle is implicit, not a stored enum).
import { ContextType, DomainEvent, MessagingEventType } from './messaging.events';

export interface MaskedCallProps {
  id: string; tenantId: string; callerUserId: string; calleeUserId: string; contextType: ContextType | null; contextId: string | null;
  providerCallRef: string | null; durationSecs: number | null; recordingMediaId: string | null; createdAt?: Date;
  /** PC-56 STORE-4b · B4: `created_at` as the database printed it (µs) — the cursor and the point update bind it. */
  createdAtUs?: string | null;
}
export class MaskedCall {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: MaskedCallProps) {}

  static initiate(input: Omit<MaskedCallProps, 'durationSecs' | 'recordingMediaId'>): MaskedCall {
    const c = new MaskedCall({ ...input, durationSecs: null, recordingMediaId: null });
    c.events.push({ type: MessagingEventType.MaskedCallInitiated, payload: { callId: c.props.id, callerUserId: c.props.callerUserId, calleeUserId: c.props.calleeUserId, contextType: c.props.contextType } });
    return c;
  }
  static rehydrate(p: MaskedCallProps): MaskedCall { return new MaskedCall(p); }
  get id() { return this.props.id; }
  get callerUserId() { return this.props.callerUserId; }
  get calleeUserId() { return this.props.calleeUserId; }
  get providerCallRef() { return this.props.providerCallRef; }
  toProps(): Readonly<MaskedCallProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Telephony provider reports the call ended (duration ≥ 0). Idempotent: a second report is ignored. */
  complete(durationSecs: number, recordingMediaId: string | null): void {
    if (this.props.durationSecs !== null) return;
    this.props.durationSecs = Math.max(0, Math.trunc(durationSecs));
    this.props.recordingMediaId = recordingMediaId;
    this.events.push({ type: MessagingEventType.MaskedCallCompleted, payload: { callId: this.props.id, durationSecs: this.props.durationSecs } });
  }
  toJSON() { const v = this.props; return { id: v.id, callerUserId: v.callerUserId, calleeUserId: v.calleeUserId, contextType: v.contextType, contextId: v.contextId, durationSecs: v.durationSecs, createdAt: v.createdAt }; }
}
