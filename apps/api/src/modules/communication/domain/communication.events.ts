// modules/communication/domain/communication.events.ts · integration events this module EMITS (via outbox).
export const CommEventType = {
  NotificationQueued:    'comm.notification_queued',
  NotificationSent:      'comm.notification_sent',
  NotificationFailed:    'comm.notification_failed',
  NotificationRead:      'comm.notification_read',
  PreferenceUpdated:     'comm.preference_updated',
  // PC-56 TENANT-8b — the delivery log's new facts, each an outbox event in the transaction that writes it.
  NotificationDelivered: 'comm.notification_delivered',
  NotificationSuppressed:'comm.notification_suppressed',
  NotificationReleased:  'comm.notification_released',
  NotificationsMarkedRead: 'comm.notifications_marked_read',
  QuietHoursUpdated:     'comm.quiet_hours_updated',
} as const;
export type CommEventType = (typeof CommEventType)[keyof typeof CommEventType];

export type DomainEvent = { type: string; payload: Record<string, unknown> };

export const NOTIF_CHANNELS = ['push', 'sms', 'whatsapp', 'email', 'inapp', 'ivr'] as const;
export type NotifChannel = (typeof NOTIF_CHANNELS)[number];

export const NOTIF_PRIORITIES = ['critical', 'important', 'informational', 'promotional'] as const;
export type NotifPriority = (typeof NOTIF_PRIORITIES)[number];
