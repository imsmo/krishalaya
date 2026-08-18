// modules/communication/repositories/notification.repository.ts · the notifications delivery log (PARTITIONED by
// created_at; ensure_partitions manages partitions). tenant_id in every tenant read; the user inbox is filtered
// by user_id (no IDOR). Lists are KEYSET on (created_at,id) — never OFFSET — and the index idx_notif_user backs
// it. Point updates bind (id, created_at) so PG prunes to one partition (Law 8). kv_app may only UPDATE the
// delivery columns (status/sent_at/read_at/provider_msg_ref/cost_minor/batched_into) — migration 0014.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Notification } from '../domain/notification.entity';
import { NotifChannel } from '../domain/communication.events';
import { NotifStatus } from '../domain/notification.state';

const COLS = `id, tenant_id, user_id, event_code, channel, template_id, language_code, payload, status, provider_msg_ref, cost_minor, batched_into, created_at, sent_at, read_at`;
function toDomain(r: any): Notification {
  return Notification.rehydrate({ id: r.id, tenantId: r.tenant_id, userId: r.user_id, eventCode: r.event_code, channel: r.channel as NotifChannel,
    templateId: r.template_id, templateVersionId: r.template_version_id ?? null, languageCode: r.language_code, payload: r.payload ?? {}, status: r.status as NotifStatus, providerMsgRef: r.provider_msg_ref,
    costMinor: r.cost_minor, batchedInto: r.batched_into, createdAt: r.created_at, sentAt: r.sent_at, readAt: r.read_at });
}
export interface InboxQuery { status?: string; unreadOnly?: boolean; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class NotificationRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * **DOES THIS RECIPIENT HAVE AN ADDRESS ON THIS CHANNEL AT ALL? (PC-56 TENANT-4d-5.)**
   *
   * `NotificationService.deliverPush` has asked the equivalent question since P0-10 — it resolves the user's own
   * device tokens and records `no_device` when there are none — and NO OTHER external channel asked it. The
   * gateway port's contract is "the external product resolves device tokens / contact" from a bare `userId`, so
   * an email to a user whose `users.email` is NULL was dispatched to a notifier that had nothing to send it to,
   * came back `accepted` (the notifier took the request), and was written into the delivery log as **`sent`**.
   *
   * That was harmless while nothing seeded an email template. TENANT-4d-1's W118 promises a tenant "a console +
   * email notice" at 90% of a quota and 0149 seeds exactly that, on a phone-first platform where `users.email`
   * is nullable and usually null — so without this check the platform would have recorded a clean email delivery
   * to a farmer-cooperative admin who has no email address, and the delivery log (the thing a support agent and
   * a regulator both read) would have said the notice went out. `no_address` is the same shape of truth as
   * `no_device` and `no_template`: recorded, counted, not sent, and not a lie.
   *
   * Runs inside the delivery tx on the same connection as the insert (never the replica): a contact detail added
   * seconds ago must not be invisible to the send that depends on it.
   */
  async contactableOn(tx: TxContext, userId: string, channel: NotifChannel): Promise<boolean> {
    if (channel === 'inapp' || channel === 'push') return true;   // inapp needs no address; push has its own device check
    const r = await tx.query<{ has_email: boolean; has_phone: boolean }>(
      `SELECT (email IS NOT NULL AND btrim(email) <> '') AS has_email,
              (phone IS NOT NULL AND btrim(phone) <> '') AS has_phone
         FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId]);
    const row = r.rows[0];
    if (!row) return false;   // no live user row → no address (fail closed; never dispatch to an id we cannot see)
    // sms / whatsapp / ivr all ride the phone number. `users.phone` is NOT NULL UNIQUE on this platform, so this
    // is true for every live user and the check is a no-op for them — deliberately: it is here so that a future
    // channel cannot be added without answering the question, not to change today's SMS behaviour.
    return channel === 'email' ? row.has_email : row.has_phone;
  }

  /** Insert a delivery row in its FINAL resolved state (sent/failed/suppressed) — one write, no later update. */
  async insert(tx: TxContext, n: Notification): Promise<void> {
    const p = n.toProps();
    await tx.query(
      `INSERT INTO notifications (id, tenant_id, user_id, event_code, channel, template_id, template_version_id, language_code, payload, status, provider_msg_ref, cost_minor, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13)`,
      [p.id, p.tenantId, p.userId, p.eventCode, p.channel, p.templateId, p.templateVersionId ?? null, p.languageCode, JSON.stringify(p.payload), p.status, p.providerMsgRef, p.costMinor, p.sentAt]);
  }

  /** A user's own inbox (keyset, bounded). */
  async listForUser(userId: string, tenantId: string, q: InboxQuery): Promise<Notification[]> {
    const params: unknown[] = [userId]; let where = `user_id=$1`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.unreadOnly) where += ` AND read_at IS NULL`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** Point read-modify-write of one of the caller's own notifications (404-IDOR guarded by user_id). */
  async getForUserUpdate(tx: TxContext, userId: string, id: string): Promise<Notification | null> {
    const r = await tx.query(`SELECT ${COLS} FROM notifications WHERE id=$1 AND user_id=$2 FOR UPDATE`, [id, userId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Persist a status/read change. created_at is bound so PG prunes to the row's partition. */
  async update(tx: TxContext, n: Notification): Promise<void> {
    const p = n.toProps();
    await tx.query(
      `UPDATE notifications SET status=$3, sent_at=$4, read_at=$5, provider_msg_ref=$6, cost_minor=$7 WHERE id=$1 AND created_at=$2`,
      [p.id, p.createdAt, p.status, p.sentAt, p.readAt, p.providerMsgRef, p.costMinor]);
  }

  /** Resolve a delivery row by the gateway's provider_msg_ref (the delivery-status webhook). */
  async getByProviderRef(tx: TxContext, providerMsgRef: string): Promise<Notification | null> {
    const r = await tx.query(`SELECT ${COLS} FROM notifications WHERE provider_msg_ref=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [providerMsgRef]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
}
