// modules/communication/domain/notification.entity.ts · the notifications delivery-log aggregate (partitioned
// by created_at). One row per (recipient × channel) the fan-out DECIDED about — sent, failed, or (PC-56 TENANT-8b, F-4)
// suppressed with its reason. Money-free, but cost_minor tracks the SMS cost-bomb monitor. Status via the notif.state
// machine (Law 5). Emits domain events for the outbox.
//
// [PC-56 TENANT-8b] What the row now records that it did not:
//   • `suppressedReason` / `heldUntil` / `releasedAt` — a channel NOT sent says why; a quiet-hours suppression is a HOLD
//     that the release job lets go when the window ends (`release()`), F-4;
//   • `failureReason` (a vocabulary CODE, normalised — Law 6) and `failedAt` — F-10; a provider's receipt can now move
//     `sent → failed` (`markFailedByProvider`);
//   • `deliveredAt` — the receipt's time, F-10;
//   • `fanoutKey` — the delivery instance every channel row of one send shares (W434).
import { NotifChannel, DomainEvent, CommEventType } from './communication.events';
import { NotifStatus, assertTransition } from './notification.state';
import { FailureReason, SuppressedReason, normaliseFailureReason } from './delivery-log';
import { IllegalNotificationTransitionError } from './communication.errors';

export interface NotificationProps {
  id: string; tenantId: string | null; userId: string; eventCode: string; channel: NotifChannel; templateId: string | null;
  /** The IMMUTABLE template version whose words were rendered into this notification (0122). `templateId` alone pointed
   *  at a row whose body could be replaced afterwards, so the log recorded which template was used and could not say
   *  what was sent. NULL for a send with no template (the recorded 'no_template' failure) — never a guess. */
  templateVersionId?: string | null;
  languageCode: string | null; payload: Record<string, unknown>; status: NotifStatus; providerMsgRef: string | null;
  costMinor: number | null; batchedInto: string | null; createdAt?: Date; sentAt: Date | null; readAt: Date | null;
  deliveredAt?: Date | null; failedAt?: Date | null; failureReason?: FailureReason | string | null;
  suppressedReason?: SuppressedReason | string | null; heldUntil?: Date | null; releasedAt?: Date | null;
  fanoutKey?: string | null;
}

export class Notification {
  private readonly events: DomainEvent[] = [];
  private constructor(private props: NotificationProps) {}

  /** Queue a notification for one channel (the initial 'queued' delivery row). */
  static queue(input: Omit<NotificationProps, 'status' | 'providerMsgRef' | 'costMinor' | 'batchedInto' | 'sentAt' | 'readAt'>): Notification {
    const n = new Notification({ ...input, status: 'queued', providerMsgRef: null, costMinor: null, batchedInto: null, sentAt: null, readAt: null });
    n.events.push({ type: CommEventType.NotificationQueued, payload: { notificationId: n.props.id, userId: n.props.userId, eventCode: n.props.eventCode, channel: n.props.channel } });
    return n;
  }
  static rehydrate(p: NotificationProps): Notification { return new Notification(p); }

  get id() { return this.props.id; }
  get tenantId() { return this.props.tenantId; }
  get userId() { return this.props.userId; }
  get channel() { return this.props.channel; }
  get eventCode() { return this.props.eventCode; }
  get status() { return this.props.status; }
  toProps(): Readonly<NotificationProps> { return Object.freeze({ ...this.props }); }
  pullEvents(): DomainEvent[] { const e = [...this.events]; this.events.length = 0; return e; }

  /** Gateway accepted it (async delivery to follow). */
  markSent(providerMsgRef: string | null, costMinor: number | null): void {
    assertTransition(this.props.status, 'sent');
    this.props.status = 'sent'; this.props.sentAt = new Date(); this.props.providerMsgRef = providerMsgRef; this.props.costMinor = costMinor;
    this.events.push({ type: CommEventType.NotificationSent, payload: { notificationId: this.props.id, channel: this.props.channel, costMinor } });
  }
  /** Not sent at the fan-out (or at release): no template, no address, the notifier refused. The REASON is a code
   *  (Law 6); the raw text, if it was a provider's, rides the outbox event only. */
  markFailed(reason: string): void {
    assertTransition(this.props.status, 'failed');
    this.props.status = 'failed'; this.props.failedAt = new Date();
    this.props.failureReason = normaliseFailureReason(reason);
    this.events.push({ type: CommEventType.NotificationFailed, payload: { notificationId: this.props.id, channel: this.props.channel, reason: this.props.failureReason, detail: reason } });
  }
  /** F-10 · the provider's receipt said FAILED. `sent → failed`, with the reason and the time. */
  markFailedByProvider(reason: string | null | undefined): void {
    assertTransition(this.props.status, 'failed');
    this.props.status = 'failed'; this.props.failedAt = new Date();
    this.props.failureReason = normaliseFailureReason(reason, 'provider_rejected');
    this.events.push({ type: CommEventType.NotificationFailed, payload: { notificationId: this.props.id, channel: this.props.channel, reason: this.props.failureReason, detail: reason ?? null, source: 'provider' } });
  }
  /** F-10 · the provider's receipt said DELIVERED — with its time. */
  markDelivered(at: Date = new Date()): void {
    assertTransition(this.props.status, 'delivered');
    this.props.status = 'delivered'; this.props.deliveredAt = at;
    this.events.push({ type: CommEventType.NotificationDelivered, payload: { notificationId: this.props.id, channel: this.props.channel } });
  }
  /**
   * F-4 · NOT SENT, AND WHY. A quiet-hours suppression is a HOLD (`heldUntil` required — a hold must end); any other
   * reason is final and carries no hold.
   */
  markSuppressed(reason: SuppressedReason, heldUntil: Date | null): void {
    assertTransition(this.props.status, 'suppressed');
    if (reason === 'quiet_hours' && !heldUntil) throw new IllegalNotificationTransitionError('queued', 'suppressed(quiet_hours without an end)');
    this.props.status = 'suppressed'; this.props.suppressedReason = reason;
    this.props.heldUntil = reason === 'quiet_hours' ? heldUntil : null;
    this.events.push({ type: CommEventType.NotificationSuppressed, payload: { notificationId: this.props.id, channel: this.props.channel, reason, heldUntil: this.props.heldUntil?.toISOString() ?? null } });
  }
  /** The quiet window ended: `suppressed → queued`, ONLY for a quiet-hours hold. The caller then sends or fails it. */
  release(at: Date = new Date()): void {
    if (this.props.status !== 'suppressed' || this.props.suppressedReason !== 'quiet_hours' || this.props.releasedAt) {
      throw new IllegalNotificationTransitionError(`${this.props.status}(${this.props.suppressedReason ?? 'none'})`, 'queued(release)');
    }
    assertTransition(this.props.status, 'queued');
    this.props.status = 'queued'; this.props.releasedAt = at;
    this.events.push({ type: CommEventType.NotificationReleased, payload: { notificationId: this.props.id, channel: this.props.channel } });
  }
  /** Still quiet when the job looked (the member widened their window): the hold moves, the row stays suppressed. */
  rehold(until: Date): void {
    if (this.props.status !== 'suppressed' || this.props.suppressedReason !== 'quiet_hours') throw new IllegalNotificationTransitionError(this.props.status, 'suppressed(rehold)');
    this.props.heldUntil = until;
  }
  /** The member switched this event × channel off during the night: the hold becomes an opt-out and is never sent. */
  dropHoldAsOptedOut(): void {
    if (this.props.status !== 'suppressed' || this.props.suppressedReason !== 'quiet_hours') throw new IllegalNotificationTransitionError(this.props.status, 'suppressed(opted_out)');
    this.props.suppressedReason = 'opted_out'; this.props.heldUntil = null;
  }
  /** The template a RELEASED row resolved at release (the reader's language, as it stands in the morning). Queued only. */
  attachTemplate(templateId: string | null, templateVersionId: string | null, languageCode: string | null): void {
    if (this.props.status !== 'queued') throw new IllegalNotificationTransitionError(this.props.status, 'queued(attachTemplate)');
    this.props.templateId = templateId; this.props.templateVersionId = templateVersionId; this.props.languageCode = languageCode;
  }
  /** Requeue a failed row for another dispatch attempt. */
  requeue(): void { assertTransition(this.props.status, 'queued'); this.props.status = 'queued'; }
  /** User opened the in-app item (or the notifier reported a read receipt). */
  markRead(): void {
    if (this.props.status === 'read') return;                  // idempotent
    assertTransition(this.props.status, 'read');
    this.props.status = 'read'; this.props.readAt = new Date();
    this.events.push({ type: CommEventType.NotificationRead, payload: { notificationId: this.props.id, userId: this.props.userId } });
  }
  toJSON() {
    const v = this.props;
    return { id: v.id, eventCode: v.eventCode, channel: v.channel, languageCode: v.languageCode, payload: v.payload, status: v.status,
      costMinor: v.costMinor, createdAt: v.createdAt, sentAt: v.sentAt, readAt: v.readAt,
      deliveredAt: v.deliveredAt ?? null, failedAt: v.failedAt ?? null, failureReason: v.failureReason ?? null,
      suppressedReason: v.suppressedReason ?? null, heldUntil: v.heldUntil ?? null, releasedAt: v.releasedAt ?? null, fanoutKey: v.fanoutKey ?? null };
  }
}
