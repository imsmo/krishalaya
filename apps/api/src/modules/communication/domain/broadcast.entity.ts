// modules/communication/domain/broadcast.entity.ts · a tenant → members announcement (PRD §14) — PC-56 TENANT-8e. PURE.
//
// Born a DRAFT (the form chain's *Save draft*). The SEND act moves it to `queued` (now) or `scheduled` (at a time, which
// the registered schedule job queues when due); the fan-out moves it `sending → sent`, or `failed` with a code. A person
// may cancel a draft or a scheduled broadcast, with a reason.
//
// WHAT IT NO LONGER CARRIES: `recipientCount` and `sentCount`. The handler used to write `markSent(total, total)` — the
// recipient count AS the sent count, whatever the log said (F-2) — and 0179 drops both columns. The receipt counts the
// delivery log (`broadcast-counts.ts`); the entity carries only what a person or the fan-out decided.
import { assertTransition, BroadcastFailureReason, BroadcastStatus } from './broadcast.state';

export type BroadcastChannel = 'inapp' | 'whatsapp';

export interface BroadcastProps {
  id: string; tenantId: string; createdByUserId: string; audienceRoleCode: string | null;
  title: string; body: string; status: BroadcastStatus; channel: BroadcastChannel;
  scheduledAt: Date | null; eligibleCount: number;
  sendRequestedBy: string | null; sendRequestedAt: Date | null; queuedAt: Date | null; fannedOutAt: Date | null;
  failedAt: Date | null; failureReason: BroadcastFailureReason | null;
  cancelledBy: string | null; cancelledAt: Date | null; cancelReason: string | null;
  createdAt?: Date; updatedAt?: Date;
}

export class Broadcast {
  private constructor(private readonly props: BroadcastProps) {}

  static draft(input: { id: string; tenantId: string; createdByUserId: string; audienceRoleCode: string | null; title: string; body: string; scheduledAt: Date | null }): Broadcast {
    return new Broadcast({
      ...input, status: 'draft', channel: 'inapp', eligibleCount: 0,
      sendRequestedBy: null, sendRequestedAt: null, queuedAt: null, fannedOutAt: null, failedAt: null, failureReason: null,
      cancelledBy: null, cancelledAt: null, cancelReason: null,
    });
  }
  static rehydrate(props: BroadcastProps): Broadcast { return new Broadcast(props); }

  get id() { return this.props.id; }
  get status() { return this.props.status; }
  toProps(): Readonly<BroadcastProps> { return Object.freeze({ ...this.props }); }

  /** A draft's words, audience and time — the draft only (0179 freezes them after). */
  edit(v: { title: string; body: string; audienceRoleCode: string | null; scheduledAt: Date | null }): void {
    if (this.props.status !== 'draft') assertTransition(this.props.status, 'draft');
    Object.assign(this.props, v);
  }
  /** The SEND act: queued now, or scheduled for `scheduledAt` when it is set. `eligible` is the audience as it stands. */
  requestSend(by: string, at: Date, eligible: number): void {
    const to: BroadcastStatus = this.props.scheduledAt ? 'scheduled' : 'queued';
    assertTransition(this.props.status, to);
    this.props.status = to; this.props.sendRequestedBy = by; this.props.sendRequestedAt = at; this.props.eligibleCount = eligible;
    if (to === 'queued') this.props.queuedAt = at;
  }
  /** The schedule job: a due scheduled broadcast enters the queue. */
  queueScheduled(at: Date): void { assertTransition(this.props.status, 'queued'); this.props.status = 'queued'; this.props.queuedAt = at; }
  markSending(): void { assertTransition(this.props.status, 'sending'); this.props.status = 'sending'; }
  markSent(fannedOutAt: Date): void { assertTransition(this.props.status, 'sent'); this.props.status = 'sent'; this.props.fannedOutAt = fannedOutAt; }
  markFailed(reason: BroadcastFailureReason, at: Date): void {
    assertTransition(this.props.status, 'failed'); this.props.status = 'failed'; this.props.failureReason = reason; this.props.failedAt = at;
  }
  cancel(by: string, at: Date, reason: string): void {
    assertTransition(this.props.status, 'cancelled');
    this.props.status = 'cancelled'; this.props.cancelledBy = by; this.props.cancelledAt = at; this.props.cancelReason = reason;
  }

  toJSON() {
    const p = this.props;
    return {
      id: p.id, audienceRoleCode: p.audienceRoleCode, title: p.title, body: p.body, status: p.status, channel: p.channel,
      scheduledAt: p.scheduledAt, eligibleCount: p.eligibleCount, createdByUserId: p.createdByUserId,
      sendRequestedBy: p.sendRequestedBy, sendRequestedAt: p.sendRequestedAt, queuedAt: p.queuedAt, fannedOutAt: p.fannedOutAt,
      failedAt: p.failedAt, failureReason: p.failureReason, cancelledBy: p.cancelledBy, cancelledAt: p.cancelledAt, cancelReason: p.cancelReason,
      createdAt: p.createdAt, updatedAt: p.updatedAt,
    };
  }
}
