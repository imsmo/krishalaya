// modules/communication/services/inbox.service.ts · PC-56 TENANT-8b · THE INBOX — the member's own side of the delivery
// log: W204 (notifications), W431 (the center), W432 (the bell), W434 (one notification's per-channel ladder), and the
// two mutate chains' acts (mark read · mark all read).
//
// WHAT CHANGED, AND WHY (TENANT-8's survey):
//   • F-9 · THE INBOX IS THE IN-APP ITEM. `listForUser` filtered on `user_id` only, so one event sent on in-app + push +
//     SMS was three lines in the bell. The inbox now lists `channel = 'inapp'` rows — one per delivery instance — and
//     each item names the other channels that carried it ("also by SMS · sent"), which are W434's ladder.
//   • THE STATUS PRINTED IS THE LOG'S. An in-app row is written `sent` (the row IS the item) and becomes `read`; it is
//     never `delivered`, and the center does not say it was (W431 drew "delivered").
//   • MARK READ / MARK ALL READ ARE ACTS: an Idempotency-Key (the form's — the confirm page mints it), an audit row in the
//     same transaction (W431's receipt: *"notifications_marked_read: 2 · actor"*), an outbox event. Mark-all moves only
//     the statuses the state machine lets become `read` (`statusesThatCanBecome`), in one statement.
//   • THE TENANT-WIDE HEALTH TILES (W204 "Member delivery health (24h)") need `notification.manage` — the permission whose
//     own description is "read tenant delivery log" and which no route honoured. Refused with a sentence, never a bare 403.
//   • EVERY READ IS PRUNED on `created_at` (Law 8; notification ids are derived, so `uuid_v7_time` cannot prune).
import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, UnitOfWork } from '../../../core/database/unit-of-work';
import { OUTBOX_WRITER, OutboxWriter } from '../../../core/outbox/outbox.writer';
import { AUDIT_WRITER, AuditWriter } from '../../../core/audit/audit.writer';
import { IDEMPOTENCY_SERVICE, IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { METRICS, Metrics } from '../../../core/observability/metrics';
import { looksLikeId } from '../../../shared/form-review';
import { InboxQuery, InboxRow, NotificationRepository, SiblingRow } from '../repositories/notification.repository';
import { NotificationEventRepository } from '../repositories/notification-event.repository';
import { NotificationService } from './notification.service';
import { CommEventType, NOTIF_PRIORITIES } from '../domain/communication.events';
import { statusesThatCanBecome } from '../domain/notification.state';
import { CommForbiddenError, NotificationNotFoundError } from '../domain/communication.errors';
import { HealthFigures, LadderStep, byChannelOrder, healthFigures, ladderFor, ladderOutcome, moduleOf } from '../domain/delivery-log';

export interface InboxActor { userId: string; canManage: boolean }

export interface AlsoOn { channel: string; status: string; outcome: string; suppressedReason: string | null; failureReason: string | null }
export interface InboxItem {
  id: string; eventCode: string; channel: string; status: string; languageCode: string | null; payload: Record<string, unknown>;
  createdAt: Date | undefined; sentAt: Date | null; readAt: Date | null;
  /** The row's instant to the microsecond (ISO) — what the ladder link and mark-read carry, so the lookup is exact. */
  at: string;
  tier: string | null; module: string; localDay: string | null; localTime: string | null; fanoutKey: string | null;
  /** The OTHER channels of this delivery instance (push / SMS / WhatsApp / email / IVR), each with what its row says. */
  alsoOn: AlsoOn[];
}
export interface InboxPage { items: InboxItem[]; nextCursor: string | null; zone: string | null; today: string | null }
export interface BellView { unread: number; latest: InboxItem[]; held: number; nextRelease: Date | null; releaseStopped: boolean; zone: string | null; today: string | null }
export interface LadderChannel { channel: string; status: string; outcome: string; suppressedReason: string | null; failureReason: string | null; steps: LadderStep[] }
export interface LadderView {
  id: string; eventCode: string; tier: string | null; module: string; payload: Record<string, unknown>; createdAt: Date | undefined;
  /** False for a row written before 0176: it has no delivery-instance key, so only its own channel can be shown. */
  grouped: boolean; releaseStopped: boolean; channels: LadderChannel[];
}

export const encodeInboxCursor = (createdAt: Date | string | undefined, id: string) =>
  Buffer.from(`${createdAt instanceof Date ? createdAt.toISOString() : String(createdAt)}|${id}`).toString('base64');
export const decodeInboxCursor = (c?: string) => {
  if (!c) return undefined;
  const [cc, id] = Buffer.from(c, 'base64').toString().split('|');
  return cc && id && !Number.isNaN(Date.parse(cc)) && looksLikeId(id) ? { c: cc, id } : undefined;
};

/** The health tiles' window — W204 says "(24h)". */
export const HEALTH_HOURS = 24;

@Injectable()
export class InboxService {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(OUTBOX_WRITER) private readonly outbox: OutboxWriter,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(IDEMPOTENCY_SERVICE) private readonly idem: IdempotencyService,
    @Inject(METRICS) private readonly metrics: Metrics,
    private readonly notifications: NotificationRepository,
    private readonly events: NotificationEventRepository,
    private readonly spine: NotificationService,
  ) {}

  private item(r: InboxRow, siblings: readonly SiblingRow[]): InboxItem {
    const j = r.n.toJSON();
    const others = byChannelOrder(siblings.filter((s) => s.fanoutKey === j.fanoutKey && s.id !== j.id && s.channel !== 'inapp'));
    return {
      id: j.id, eventCode: j.eventCode, channel: j.channel, status: j.status, languageCode: j.languageCode, payload: j.payload,
      createdAt: j.createdAt, sentAt: j.sentAt, readAt: j.readAt, at: r.at, tier: r.tier, module: moduleOf(j.eventCode),
      localDay: r.localDay, localTime: r.localTime, fanoutKey: j.fanoutKey,
      alsoOn: others.map((s) => ({ channel: s.channel, status: s.status, outcome: ladderOutcome(s), suppressedReason: s.suppressedReason, failureReason: s.failureReason })),
    };
  }

  private async withSiblings(tenantId: string, userId: string, rows: readonly InboxRow[]): Promise<InboxItem[]> {
    const keyed = rows.filter((r) => r.n.toProps().fanoutKey && r.n.toProps().createdAt);
    let sibs: SiblingRow[] = [];
    if (keyed.length > 0) {
      // exact instants, sorted as text (ISO, UTC, fixed width) — never via a millisecond Date
      const times = keyed.map((r) => r.at).sort();
      sibs = await this.notifications.siblings(tenantId, userId, keyed.map((r) => r.n.toProps().fanoutKey as string), times[0], times[times.length - 1]);
    }
    return rows.map((r) => this.item(r, sibs));
  }

  /** W204 / W431 · the member's own in-app items, keyset, with GET-form filters. */
  async list(tenantId: string, userId: string, q: InboxQuery): Promise<InboxPage> {
    const page = await this.notifications.inbox(userId, tenantId, q);
    const items = await this.withSiblings(tenantId, userId, page.rows);
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === q.limit && last ? encodeInboxCursor(last.at, last.id) : null, zone: page.zone, today: page.today };
  }

  /** The filter vocabularies, from the catalogue — never a list written in a page. */
  async filters(): Promise<{ tiers: readonly string[]; modules: string[] }> {
    const mods = [...new Set((await this.events.list()).map((e) => moduleOf(e.code)))].sort();
    return { tiers: NOTIF_PRIORITIES, modules: mods };
  }

  /** W432 · the bell: unread (capped), the latest eight, and what is held for you tonight. */
  async bell(tenantId: string, userId: string): Promise<BellView> {
    const b = await this.notifications.bell(tenantId, userId);
    const latest = await this.withSiblings(tenantId, userId, b.latest);
    return { unread: b.unread, latest, held: b.held, nextRelease: b.nextRelease, releaseStopped: await this.spine.releaseStopped(tenantId), zone: b.zone, today: b.today };
  }

  /** W434 · one of YOUR notifications, every channel of its delivery instance, each as a ladder from its own columns. */
  async ladder(tenantId: string, userId: string, id: string, at: string | undefined): Promise<LadderView> {
    const when = at && !Number.isNaN(Date.parse(at)) ? at : null;
    if (!looksLikeId(id) || !when) throw new NotificationNotFoundError(id);
    const l = await this.notifications.ladder(tenantId, userId, id, when);
    if (!l) throw new NotificationNotFoundError(id);   // another member's row, a wrong time, or past retention: 404, no IDOR
    const j = l.row.toJSON();
    return {
      id: j.id, eventCode: j.eventCode, tier: l.tier, module: moduleOf(j.eventCode), payload: j.payload, createdAt: j.createdAt,
      grouped: j.fanoutKey !== null, releaseStopped: await this.spine.releaseStopped(tenantId),
      channels: byChannelOrder(l.channels).map((c) => ({ channel: c.channel, status: c.status, outcome: ladderOutcome(c), suppressedReason: c.suppressedReason, failureReason: c.failureReason, steps: ladderFor(c) })),
    };
  }

  /** W204 · the tenant's delivery health, 24 hours — `notification.manage` only, refused with a sentence. */
  async health(tenantId: string, actor: InboxActor): Promise<HealthFigures & { hours: number }> {
    if (!actor.canManage) throw new CommForbiddenError('tenant-wide delivery health requires notification.manage');
    return { ...healthFigures(await this.notifications.tenantHealth(tenantId, HEALTH_HOURS)), hours: HEALTH_HOURS };
  }

  /** The mark-all-read confirm step's object: how many it would clear (W431 "This clears 2 unread"). */
  async readAllPreview(tenantId: string, userId: string): Promise<{ unread: number }> {
    return { unread: await this.notifications.unreadCount(tenantId, userId) };
  }

  /** Mark ONE of your items read — keyed when the form sent a key, audited either way. Idempotent by nature too. */
  async markRead(tenantId: string, actor: InboxActor, id: string, opts: { at?: string | null; idemKey?: string | null; ip?: string | null } = {}) {
    const at = opts.at && !Number.isNaN(Date.parse(opts.at)) ? opts.at : null;
    const act = () => this.uow.run(tenantId, async (tx) => {
      const n = looksLikeId(id) ? await this.notifications.getForUserUpdate(tx, actor.userId, id, at) : null;
      if (!n) throw new NotificationNotFoundError(id);   // 404 for a non-owner (no cross-user IDOR)
      const before = n.status;
      n.markRead();
      if (before !== n.status) {
        await this.notifications.update(tx, n);
        for (const e of n.pullEvents()) await this.outbox.write(tx, { tenantId, aggregateType: 'notification', aggregateId: n.id, eventType: e.type, payload: { v: 1, ...e.payload } });
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'communication.notification.read', entityType: 'notification', entityId: n.id,
          oldValue: { status: before }, newValue: { status: n.status }, ip: opts.ip ?? null });
      }
      return n.toJSON();
    }, { userId: actor.userId });
    return opts.idemKey ? this.idem.remember(opts.idemKey, actor.userId, 'communication.notification.read', act) : act();
  }

  /** W2690–W2692 / W2687–W2689 · MARK ALL READ — one statement, one audit row with the count, one outbox event. */
  async markAllRead(tenantId: string, actor: InboxActor, idemKey: string, ip: string | null): Promise<{ marked: number }> {
    return this.idem.remember(idemKey, actor.userId, 'communication.notifications.read_all', () =>
      this.uow.run(tenantId, async (tx) => {
        const ids = await this.notifications.markAllRead(tx, actor.userId, statusesThatCanBecome('read'));
        await this.audit.write(tx, { tenantId, actorUserId: actor.userId, action: 'communication.notifications.read_all', entityType: 'notification_inbox', entityId: actor.userId,
          oldValue: { unread: ids.length }, newValue: { notificationsMarkedRead: ids.length }, ip });
        await this.outbox.write(tx, { tenantId, aggregateType: 'notification_inbox', aggregateId: actor.userId, eventType: CommEventType.NotificationsMarkedRead, payload: { v: 1, userId: actor.userId, count: ids.length } });
        this.metrics.inc('comm.inbox.read_all', {});
        return { marked: ids.length };
      }, { userId: actor.userId }));
  }
}
