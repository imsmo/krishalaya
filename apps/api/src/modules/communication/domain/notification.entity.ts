// modules/communication/domain/notification.entity.ts · the notifications delivery-log aggregate (partitioned
// by created_at). One row per (recipient × channel) actually dispatched. Money-free, but cost_minor tracks the
// SMS cost-bomb monitor. Status via the notif.state machine (Law 5). Emits domain events for the outbox.
import { NotifChannel, DomainEvent, CommEventType } from './communication.events';
import { NotifStatus, assertTransition } from './notification.state';

export interface NotificationProps {
  id: string; tenantId: string | null; userId: string; eventCode: string; channel: NotifChannel; templateId: string | null;
  /** The IMMUTABLE template version whose words were rendered into this notification (0122). `templateId` alone pointed
   *  at a row whose body could be replaced afterwards, so the log recorded which template was used and could not say
   *  what was sent. NULL for a send with no template (the recorded 'no_template' failure) — never a guess. */
  templateVersionId?: string | null;
  languageCode: string | null; payload: Record<string, unknown>; status: NotifStatus; providerMsgRef: string | null;
  costMinor: number | null; batchedInto: string | null; createdAt?: Date; sentAt: Date | null; readAt: Date | null;
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
  /** Gateway rejected / unavailable — the dispatch job will requeue 'queued' rows. */
  markFailed(reason: string): void {
    assertTransition(this.props.status, 'failed');
    this.props.status = 'failed';
    this.events.push({ type: CommEventType.NotificationFailed, payload: { notificationId: this.props.id, channel: this.props.channel, reason } });
  }
  /** Delivery-status webhook from the external notifier. */
  markDelivered(): void { assertTransition(this.props.status, 'delivered'); this.props.status = 'delivered'; }
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
      costMinor: v.costMinor, createdAt: v.createdAt, sentAt: v.sentAt, readAt: v.readAt };
  }
}
