// modules/communication/domain/notification.state.ts · STATE MACHINE for notifications.status (Law 5).
// notif_status ENUM = queued|sent|delivered|failed|read|suppressed (db/migrations/0012).
//   queued → sent → delivered → read   (a delivery-status webhook drives sent→delivered)
//   queued → suppressed   (quiet hours / opted-out / disabled channel — never dispatched)
//   queued → failed       (gateway rejected/unavailable; dispatch job retries queued only)
//   failed → queued       (requeue) ; sent/delivered → read (user opened the in-app item)
//   suppressed → queued   [PC-56 TENANT-8b] ONLY a quiet-hours HOLD, released by the cadence job when the window ends
//                         (the entity refuses any other suppression — an opt-out is never "released")
//   sent → failed         [PC-56 TENANT-8b, F-10] the provider's delivery receipt said failed — WRITTEN now
import { IllegalNotificationTransitionError } from './communication.errors';

export const NOTIF_STATUSES = ['queued', 'sent', 'delivered', 'failed', 'read', 'suppressed'] as const;
export type NotifStatus = (typeof NOTIF_STATUSES)[number];

const TRANSITIONS: Readonly<Record<NotifStatus, readonly NotifStatus[]>> = Object.freeze({
  queued:     ['sent', 'failed', 'suppressed'],
  sent:       ['delivered', 'read', 'failed'],
  delivered:  ['read'],
  failed:     ['queued', 'sent'],
  read:       [],
  suppressed: ['queued'],
});
export function canTransition(from: NotifStatus, to: NotifStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: NotifStatus, to: NotifStatus): void { if (!canTransition(from, to)) throw new IllegalNotificationTransitionError(from, to); }

/** The statuses a row may be marked READ from — read off the machine, so mark-all-read never states its own list. */
export function statusesThatCanBecome(to: NotifStatus): NotifStatus[] { return NOTIF_STATUSES.filter((s) => canTransition(s, to)); }
