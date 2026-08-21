// modules/communication/repositories/notification.repository.ts · the notifications delivery log (PARTITIONED by
// created_at; ensure_partitions manages partitions). tenant_id in every tenant read; the user inbox is filtered
// by user_id (no IDOR). Lists are KEYSET on (created_at,id) — never OFFSET — and the index idx_notif_user backs
// it. Point updates bind (id, created_at) so PG prunes to one partition (Law 8). kv_app may only UPDATE the
// delivery columns (status/sent_at/read_at/provider_msg_ref/cost_minor/batched_into) — migration 0014.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
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

/**
 * [PC-56 TENANT-6d-8] What the delivery log can say about one announced thing.
 *
 * `rows` counts delivery attempts (one per person per channel); `people` counts the humans at least one channel
 * reached. A screen that showed `rows` where a cooperative asked *"how many were told?"* would report 87 families as
 * 261 — the same class of overstatement this programme keeps finding.
 */
export interface DeliveryReport {
  rows: number;
  people: number;
  byStatus: Record<string, number>;
  byChannel: Record<string, number>;
  byLanguage: Record<string, number>;
  byEvent: Record<string, number>;
}

/**
 * What the platform knows about ONE recipient before it tries to reach them: the language they chose and whether
 * they have an address at all.
 *
 * `languageCode` is `users.language_code` — NOT NULL with a default since migration 0003, and **read for the first
 * time by TENANT-6d-7**. See `NotificationService.fanout` for what that cost.
 */
export interface RecipientProfile { languageCode: string; hasEmail: boolean; hasPhone: boolean; }

/**
 * THE ADDRESS RULE, ONCE. `contactableOn` (one recipient) and `profilesFor` (a whole village) must not disagree
 * about what "reachable on this channel" means, and this programme has now found the same defect four times: a rule
 * written twice drifts, and the copy that drifts is the one no test covers. Both callers decide here.
 */
export function addressableOn(channel: NotifChannel, row: { hasEmail: boolean; hasPhone: boolean } | null): boolean {
  if (channel === 'inapp' || channel === 'push') return true;   // inapp needs no address; push has its own device check
  if (!row) return false;                                       // no live user row → fail closed, never dispatch to an id we cannot see
  // sms / whatsapp / ivr all ride the phone number.
  return channel === 'email' ? row.hasEmail : row.hasPhone;
}

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
    // sms / whatsapp / ivr all ride the phone number. `users.phone` is NOT NULL UNIQUE on this platform, so this
    // is true for every live user and the check is a no-op for them — deliberately: it is here so that a future
    // channel cannot be added without answering the question, not to change today's SMS behaviour.
    return addressableOn(channel, row ? { hasEmail: row.has_email, hasPhone: row.has_phone } : null);
  }

  /**
   * **THE SAME TWO QUESTIONS FOR A WHOLE VILLAGE, IN ONE QUERY (PC-56 TENANT-6d-7).**
   *
   * W170 sends a notice to *"87 pourers"*. `fanout` used to ask the database five separate questions PER RECIPIENT —
   * preferences, quiet hours, language (it did not ask at all, see below), an address per channel, a template per
   * channel — inside the relay's single per-event transaction. At 87 that is some 350 round trips on one connection;
   * at a district union's 2,000-member centre it is 8,000, and the notice does not go out at all because the
   * transaction dies first. A cooperative's size is not a thing this platform gets to have an opinion about
   * (rule zero), so the reads that CAN be set-based are.
   *
   * Returns a row per LIVE user only: a deleted or missing id is absent from the map, and `addressableOn(null)`
   * refuses it — the same fail-closed answer `contactableOn` gives, from the same function.
   */
  async profilesFor(tx: TxContext, userIds: readonly string[]): Promise<Map<string, RecipientProfile>> {
    const out = new Map<string, RecipientProfile>();
    if (userIds.length === 0) return out;
    const r = await tx.query<{ id: string; language_code: string; has_email: boolean; has_phone: boolean }>(
      `SELECT id, language_code,
              (email IS NOT NULL AND btrim(email) <> '') AS has_email,
              (phone IS NOT NULL AND btrim(phone) <> '') AS has_phone
         FROM users WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [[...userIds]]);
    for (const row of r.rows) {
      out.set(row.id, { languageCode: row.language_code, hasEmail: row.has_email, hasPhone: row.has_phone });
    }
    return out;
  }

  /**
   * **DID THE MESSAGE ARRIVE? (PC-56 TENANT-6d-8.)**
   *
   * The delivery log's own answer for ONE thing that was announced: how many rows were written, on which channels, in
   * which languages, and in what state. W170's *"route notice to 87 pourers"* is the first screen on this platform
   * that has to say *"87 told, 3 unreachable"* rather than *"queued"* — and this is the read behind it.
   *
   * **BOUNDED THREE WAYS, because `notifications` is the platform's highest-volume table (RANGE partitioned by
   * `created_at`, 0012):** the event codes, a `created_at` window taken from the notice's OWN receipt
   * (`dairy_shift_diversions.notice_queued_at`), and the payload key that identifies the thing announced. With
   * `idx_notif_event_created` (0167) that is an index range inside ONE partition over a handful of rows. Without the
   * window it would be a filtered scan of every notification the platform has ever sent, which is what Law 8 exists to
   * forbid — so the window is a REQUIRED argument rather than an optional filter.
   *
   * The payload match is `->>` on a jsonb key, evaluated over those few rows only. It is not indexed and deliberately
   * so: an index per announced-thing-id would be an index per module.
   */
  async deliveryReport(tenantId: string, i: {
    eventCodes: readonly string[]; from: Date; to: Date; payloadKey: string; payloadValue: string;
  }, x?: SqlExecutor): Promise<DeliveryReport> {
    // The REPLICA by default (a report is a screen and tolerates lag, Law 12), the caller's executor when it has one —
    // a live spec asserting what a fan-out just wrote must read it on the same connection that wrote it.
    const run = x ?? this.replica.forTenant(tenantId);
    const r = await run.query<{ event_code: string; channel: string; language_code: string | null; status: string; n: number }>(
      `SELECT event_code, channel, language_code, status, count(*)::int AS n
         FROM notifications
        WHERE tenant_id = $1 AND event_code = ANY($2::text[])
          AND created_at >= $3 AND created_at < $4
          AND payload->>$5 = $6
        GROUP BY event_code, channel, language_code, status`,
      [tenantId, [...i.eventCodes], i.from, i.to, i.payloadKey, i.payloadValue]);

    const report: DeliveryReport = { rows: 0, people: 0, byStatus: {}, byChannel: {}, byLanguage: {}, byEvent: {} };
    const bump = (m: Record<string, number>, k: string, n: number) => { m[k] = (m[k] ?? 0) + n; };
    for (const row of r.rows) {
      const n = Number(row.n);
      report.rows += n;
      bump(report.byStatus, row.status, n);
      bump(report.byChannel, row.channel, n);
      bump(report.byLanguage, row.language_code ?? 'unknown', n);
      bump(report.byEvent, row.event_code, n);
    }
    // PEOPLE, not rows — the number a cooperative means by *"how many were told"*. One member reached on push and in
    // the app is ONE person told, and counting rows would have reported 87 families as 261.
    //
    // **AND NOT COUNTING THE IN-APP INBOX.** An `inapp` row is marked `sent` the moment it is written (it IS the inbox
    // item, there is nothing to dispatch), so counting it would make every live user "reached" and the number would
    // answer nothing: a member without a smartphone never sees it. `people` is therefore who was reached on a channel
    // that LEFT this platform — a call, a text, a push — which is the number that decides whether somebody walks round
    // to three houses. The in-app rows are still reported, by channel, beside it.
    const p = await run.query<{ n: number }>(
      `SELECT count(DISTINCT user_id)::int AS n
         FROM notifications
        WHERE tenant_id = $1 AND event_code = ANY($2::text[])
          AND created_at >= $3 AND created_at < $4
          AND payload->>$5 = $6
          AND channel <> 'inapp'
          AND status IN ('sent', 'delivered', 'read')`,
      [tenantId, [...i.eventCodes], i.from, i.to, i.payloadKey, i.payloadValue]);
    report.people = Number(p.rows[0]?.n ?? 0);
    return report;
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
