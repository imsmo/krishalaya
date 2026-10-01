// modules/communication/repositories/notification.repository.ts · the notifications delivery log (PARTITIONED by
// created_at; ensure_partitions manages partitions). tenant_id in every tenant read; the user inbox is filtered
// by user_id (no IDOR). Lists are KEYSET on (created_at,id) — never OFFSET. Point updates bind (id, created_at) so PG
// prunes to one partition (Law 8). kv_app may only UPDATE the delivery columns (status/sent_at/read_at/provider_msg_ref/
// cost_minor/delivered_at/failed_at/failure_reason) — migration 0176 (0014's grant, re-narrowed).
//
// [PC-56 TENANT-8b] EVERY READ THIS WAVE ADDS IS BOUNDED ON created_at, because notification ids are DERIVED (sha256,
// `deriveId`) and `uuid_v7_time(id)` cannot prune them: the inbox and the bell by the delivery log's own retention window
// (`data_retention_policies`, 6 months — `inboxSince`), the ladder by the clicked row's own `created_at`, the held-row
// release and the webhook lookup by a seven-day look-back, the tenant health tiles by 24 hours.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { Notification } from '../domain/notification.entity';
import { NotifChannel } from '../domain/communication.events';
import { NotifStatus } from '../domain/notification.state';
import { NotificationUpdateLostError } from '../domain/communication.errors';

const COLS = `id, tenant_id, user_id, event_code, channel, template_id, template_version_id, language_code, payload, status, provider_msg_ref, cost_minor, batched_into, created_at, sent_at, read_at,
  delivered_at, failed_at, failure_reason, suppressed_reason, held_until, released_at, fanout_key`;
/**
 * **A POINT LOOKUP ON `created_at` IS A ONE-MILLISECOND RANGE.** Postgres keeps microseconds; a JavaScript `Date` keeps
 * milliseconds, so a row read into the domain and written back with `created_at = $2` matched NOTHING whenever its
 * timestamp had a sub-millisecond part — which is almost always. `update()` (mark-read, the delivery webhook) has had
 * this shape since 0012 and silently updated zero rows; found by this wave's live suite (the read flag and the receipt
 * returned in the response and never reached the table). `[t, t + 1 ms)` contains the row's real instant for a
 * truncated `t` and for an exact one, and it is still a range on the partition key, so it still prunes (Law 8).
 */
const AT = (param: string, alias = '') => `${alias}created_at >= ${param}::timestamptz AND ${alias}created_at < ${param}::timestamptz + interval '1 millisecond'`;
/** The row's instant, EXACT (microseconds) — what a cursor or a ladder link carries, so nothing is lost in a round trip. */
const AT_EXACT = (alias: string) => `to_char(${alias}created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/** The upper bound every inbox read carries so the planner prunes the empty FUTURE monthly partitions too (ensure_partitions
 *  keeps 15 months ahead): a row is never written with a `created_at` past its own transaction's start. A day of slack
 *  keeps a row committed after this statement's snapshot began from ever being excluded. */
const NOT_FUTURE = `now() + interval '1 day'`;
const qualified = (alias: string) => COLS.split(',').map((c) => `${alias}.${c.trim()}`).join(', ');
function toDomain(r: any): Notification {
  return Notification.rehydrate({ id: r.id, tenantId: r.tenant_id, userId: r.user_id, eventCode: r.event_code, channel: r.channel as NotifChannel,
    templateId: r.template_id, templateVersionId: r.template_version_id ?? null, languageCode: r.language_code, payload: r.payload ?? {}, status: r.status as NotifStatus, providerMsgRef: r.provider_msg_ref,
    costMinor: r.cost_minor, batchedInto: r.batched_into, createdAt: r.created_at, sentAt: r.sent_at, readAt: r.read_at,
    deliveredAt: r.delivered_at ?? null, failedAt: r.failed_at ?? null, failureReason: r.failure_reason ?? null, suppressedReason: r.suppressed_reason ?? null,
    heldUntil: r.held_until ?? null, releasedAt: r.released_at ?? null, fanoutKey: r.fanout_key ?? null });
}

/** W204 / W431 · the inbox's filters — every one optional, every one a GET-form field. */
export interface InboxQuery {
  /** `unread` | `read` | undefined (all). */
  state?: 'unread' | 'read';
  /** Legacy filter kept for the storefront/partner/mobile inboxes (status of the IN-APP row). */
  status?: string;
  unreadOnly?: boolean;
  tier?: string;
  /** The event's catalogue namespace (`dispute`, `payout`, …) — `moduleOf`. */
  module?: string;
  /** Items that ALSO reached the member on this channel (a sibling row of the same delivery instance). */
  channel?: string;
  cursor?: { c: string; id: string };
  limit: number;
}
/** One inbox item: the IN-APP row (F-9), its catalogue tier, and its day in the cooperative's zone. */
export interface InboxRow { n: Notification; tier: string | null; localDay: string | null; localTime: string | null; /** exact created_at (µs), ISO */ at: string }
export interface SiblingRow {
  id: string; fanoutKey: string; channel: string; status: string; suppressedReason: string | null; failureReason: string | null;
  createdAt: Date; sentAt: Date | null; deliveredAt: Date | null; failedAt: Date | null; readAt: Date | null; heldUntil: Date | null; releasedAt: Date | null;
}
export interface HealthRow { channel: string; status: string; suppressedReason: string | null; failureReason: string | null; n: number; withCost: number }

/** The held-row release scans this far back — a quiet window is at most 24 hours, so seven days is slack for a job
 *  that was stopped (the kill-switch) or down, and it keeps the scan inside two monthly partitions. */
export const HOLD_LOOKBACK_DAYS = 7;
/** A delivery receipt arrives within minutes; seven days bounds the lookup to at most two partitions (Law 8). */
export const RECEIPT_LOOKBACK_DAYS = 7;
/** The bell's badge caps at 99+ (W432), so the count stops at 100 — counting past the cap is work nobody reads. */
export const BELL_COUNT_CAP = 100;
export const BELL_LATEST = 8;
function siblingOf(r: any): SiblingRow {
  return { id: r.id, fanoutKey: r.fanout_key, channel: r.channel, status: r.status, suppressedReason: r.suppressed_reason ?? null, failureReason: r.failure_reason ?? null,
    createdAt: r.created_at, sentAt: r.sent_at, deliveredAt: r.delivered_at, failedAt: r.failed_at, readAt: r.read_at, heldUntil: r.held_until, releasedAt: r.released_at };
}

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
  /** [PC-56 TENANT-8b] Channels the fan-out decided NOT to send (F-4: written as rows now), by reason. NOT counted in
   *  `rows` / `byStatus` / `byChannel`: those are delivery ATTEMPTS, and a held SMS is not an attempt until it is
   *  released — at which point it is counted under its real status. */
  suppressed: number;
  bySuppressedReason: Record<string, number>;
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
    const r = await run.query<{ event_code: string; channel: string; language_code: string | null; status: string; suppressed_reason: string | null; n: number }>(
      `SELECT event_code, channel, language_code, status, suppressed_reason, count(*)::int AS n
         FROM notifications
        WHERE tenant_id = $1 AND event_code = ANY($2::text[])
          AND created_at >= $3 AND created_at < $4
          AND payload->>$5 = $6
        GROUP BY event_code, channel, language_code, status, suppressed_reason`,
      [tenantId, [...i.eventCodes], i.from, i.to, i.payloadKey, i.payloadValue]);

    const report: DeliveryReport = { rows: 0, people: 0, byStatus: {}, byChannel: {}, byLanguage: {}, byEvent: {}, suppressed: 0, bySuppressedReason: {} };
    const bump = (m: Record<string, number>, k: string, n: number) => { m[k] = (m[k] ?? 0) + n; };
    for (const row of r.rows) {
      const n = Number(row.n);
      if (row.status === 'suppressed') { report.suppressed += n; bump(report.bySuppressedReason, row.suppressed_reason ?? 'unknown', n); continue; }
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

  /** Insert a delivery row in its FINAL resolved state (sent/failed/suppressed) — one write per channel decision. */
  async insert(tx: TxContext, n: Notification): Promise<void> {
    const p = n.toProps();
    await tx.query(
      `INSERT INTO notifications (id, tenant_id, user_id, event_code, channel, template_id, template_version_id, language_code, payload, status, provider_msg_ref, cost_minor, sent_at,
                                  failed_at, failure_reason, suppressed_reason, held_until, fanout_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [p.id, p.tenantId, p.userId, p.eventCode, p.channel, p.templateId, p.templateVersionId ?? null, p.languageCode, JSON.stringify(p.payload), p.status, p.providerMsgRef, p.costMinor, p.sentAt,
        p.failedAt ?? null, p.failureReason ?? null, p.suppressedReason ?? null, p.heldUntil ?? null, p.fanoutKey ?? null]);
  }

  /**
   * The start of the inbox's window: the delivery log's OWN retention (`data_retention_policies`, 6 months, delete —
   * 0107/0150, ensured by 0176). The center shows what the log keeps; W431's "90-day history" was copy, this is the rule.
   */
  async inboxSince(x: SqlExecutor): Promise<Date> {
    const r = await x.query<{ since: Date }>(
      `SELECT now() - make_interval(months => active_months) AS since
         FROM data_retention_policies WHERE table_name = 'notifications' AND is_active AND deleted_at IS NULL`);
    if (!r.rows[0]) throw new Error('data_retention_policies has no active row for notifications (0176 ensures one)');
    return r.rows[0].since;
  }

  /**
   * **THE INBOX IS THE IN-APP ITEM (F-9).** One row per delivery instance — `channel = 'inapp'` — not one per channel:
   * the push, SMS and WhatsApp rows of the same send are W434's ladder, not three more lines in the bell. Bounded on
   * `created_at` (the retention window, `idx_notif_inbox`), keyset on `(created_at, id)`, each item with its catalogue
   * tier and its day in the COOPERATIVE's zone (7c's `countries.timezone`), so "Today" means the cooperative's today.
   */
  async inbox(userId: string, tenantId: string, q: InboxQuery): Promise<{ rows: InboxRow[]; zone: string | null; today: string | null }> {
    const run = this.replica.forTenant(tenantId);
    const since = await this.inboxSince(run);
    const params: unknown[] = [userId, since, tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `n.user_id = $1 AND n.channel = 'inapp' AND n.created_at >= $2 AND n.created_at < ${NOT_FUTURE}`;
    if (q.state === 'unread' || q.unreadOnly) where += ` AND n.read_at IS NULL`;
    if (q.state === 'read') where += ` AND n.read_at IS NOT NULL`;
    if (q.status) where += ` AND n.status = ${p(q.status)}::notif_status`;
    if (q.tier) where += ` AND e.priority = ${p(q.tier)}`;
    if (q.module) where += ` AND n.event_code LIKE ${p(`${q.module.replace(/[%_\\]/g, '')}.%`)}`;
    if (q.channel) {
      where += ` AND EXISTS (SELECT 1 FROM notifications s WHERE s.user_id = n.user_id AND s.fanout_key = n.fanout_key
                                AND s.created_at = n.created_at AND s.channel = ${p(q.channel)})`;
    }
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (n.created_at < ${cc}::timestamptz OR (n.created_at = ${cc}::timestamptz AND n.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await run.query(
      `WITH zone AS (SELECT co.timezone FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $3)
       SELECT ${qualified('n')}, e.priority AS tier, ${AT_EXACT('n.')} AS at_exact,
              to_char(n.created_at AT TIME ZONE (SELECT timezone FROM zone), 'YYYY-MM-DD') AS local_day,
              to_char(n.created_at AT TIME ZONE (SELECT timezone FROM zone), 'HH24:MI') AS local_time
         FROM notifications n LEFT JOIN notification_events e ON e.code = n.event_code
        WHERE ${where}
        ORDER BY n.created_at DESC, n.id DESC LIMIT ${lp}`, params);
    const z = await run.query<{ timezone: string; today: string }>(
      `SELECT co.timezone, to_char(now() AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS today
         FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $1`, [tenantId]);
    return {
      rows: r.rows.map((x: any) => ({ n: toDomain(x), tier: x.tier ?? null, localDay: x.local_day ?? null, localTime: x.local_time ?? null, at: x.at_exact })),
      zone: z.rows[0]?.timezone ?? null, today: z.rows[0]?.today ?? null,
    };
  }

  /** The other channel rows of these delivery instances — for the inbox's "also sent by" line and W434. Pruned to the
   *  page's own created_at range. */
  async siblings(tenantId: string, userId: string, keys: readonly string[], from: Date | string, to: Date | string, x?: SqlExecutor): Promise<SiblingRow[]> {
    if (keys.length === 0) return [];
    const run = x ?? this.replica.forTenant(tenantId);
    const r = await run.query(
      `SELECT id, fanout_key, channel, status, suppressed_reason, failure_reason, created_at, sent_at, delivered_at, failed_at, read_at, held_until, released_at
         FROM notifications
        WHERE user_id = $1 AND fanout_key = ANY($2::text[]) AND created_at >= $3 AND created_at < $4::timestamptz + interval '1 millisecond'`,
      [userId, [...keys], from, to]);
    return r.rows.map(siblingOf);
  }

  /**
   * W432 · THE BELL: unread count (capped at 100 — the badge reads 99+), the latest eight in-app items, and what is HELD
   * for this member on the intrusive channels right now (quiet hours) with the earliest release.
   */
  async bell(tenantId: string, userId: string): Promise<{ unread: number; latest: InboxRow[]; held: number; nextRelease: Date | null; zone: string | null; today: string | null }> {
    const run = this.replica.forTenant(tenantId);
    const since = await this.inboxSince(run);
    const c = await run.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM (SELECT 1 FROM notifications
          WHERE user_id = $1 AND channel = 'inapp' AND read_at IS NULL AND created_at >= $2 AND created_at < ${NOT_FUTURE} LIMIT ${BELL_COUNT_CAP}) u`, [userId, since]);
    const h = await run.query<{ n: number; next: Date | null }>(
      `SELECT count(*)::int AS n, min(held_until) AS next FROM notifications
        WHERE user_id = $1 AND status = 'suppressed' AND suppressed_reason = 'quiet_hours'
          AND created_at >= now() - make_interval(days => ${HOLD_LOOKBACK_DAYS}) AND created_at < ${NOT_FUTURE}`, [userId]);
    const latest = await this.inbox(userId, tenantId, { limit: BELL_LATEST });
    return { unread: Number(c.rows[0]?.n ?? 0), latest: latest.rows, held: Number(h.rows[0]?.n ?? 0), nextRelease: h.rows[0]?.next ?? null, zone: latest.zone, today: latest.today };
  }

  /** How many of this member's in-app items are unread right now — the mark-all-read confirm step's object. */
  async unreadCount(tenantId: string, userId: string): Promise<number> {
    const run = this.replica.forTenant(tenantId);
    const since = await this.inboxSince(run);
    const r = await run.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND channel = 'inapp' AND read_at IS NULL AND created_at >= $2 AND created_at < ${NOT_FUTURE}`, [userId, since]);
    return Number(r.rows[0]?.n ?? 0);
  }

  /**
   * Point read-modify-write of one of the caller's own notifications (404-IDOR guarded by user_id). With `at` (the
   * row's own created_at, which the page carries) the read touches one partition; without it (older SDK callers) it is
   * bounded by the retention window.
   */
  async getForUserUpdate(tx: TxContext, userId: string, id: string, at?: Date | string | null): Promise<Notification | null> {
    const r = at
      ? await tx.query(`SELECT ${COLS} FROM notifications WHERE id=$1 AND user_id=$2 AND ${AT('$3')} FOR UPDATE`, [id, userId, at])
      : await tx.query(`SELECT ${COLS} FROM notifications WHERE id=$1 AND user_id=$2 AND created_at >= $3 AND created_at < ${NOT_FUTURE} FOR UPDATE`, [id, userId, await this.inboxSince(tx)]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * Mark every unread IN-APP item of this member read, in one statement, from the statuses the state machine allows to
   * become `read` (`statusesThatCanBecome('read')` — never a list written here). Returns the ids it moved, so the
   * service can write ONE audit row with the count (W431's *"notifications_marked_read: 2 · actor"*).
   */
  async markAllRead(tx: TxContext, userId: string, from: readonly string[]): Promise<string[]> {
    const since = await this.inboxSince(tx);
    const r = await tx.query<{ id: string }>(
      `UPDATE notifications SET status = 'read', read_at = now()
        WHERE user_id = $1 AND channel = 'inapp' AND read_at IS NULL AND status = ANY($2::notif_status[]) AND created_at >= $3 AND created_at < ${NOT_FUTURE}
        RETURNING id`, [userId, [...from], since]);
    return r.rows.map((x) => x.id);
  }

  /** W434 · the clicked row (the member's own — user_id bound) and every channel row of its delivery instance. */
  async ladder(tenantId: string, userId: string, id: string, at: Date | string): Promise<{ row: Notification; tier: string | null; channels: SiblingRow[] } | null> {
    const run = this.replica.forTenant(tenantId);
    const r = await run.query(
      `SELECT ${qualified('n')}, e.priority AS tier FROM notifications n LEFT JOIN notification_events e ON e.code = n.event_code
        WHERE n.id = $1 AND n.user_id = $2 AND ${AT('$3', 'n.')}`, [id, userId, at]);
    if (!r.rows[0]) return null;
    const row = toDomain(r.rows[0]);
    const key = row.toProps().fanoutKey ?? null;
    const channels = key
      ? await this.siblings(tenantId, userId, [key], at, at, run)
      : [siblingOf({ ...r.rows[0], fanout_key: null })];
    return { row, tier: r.rows[0].tier ?? null, channels };
  }

  /** Persist a status/read/receipt change. created_at is bound so PG prunes to the row's partition. */
  async update(tx: TxContext, n: Notification): Promise<void> {
    const p = n.toProps();
    const res = await tx.query(
      `UPDATE notifications SET status=$3, sent_at=$4, read_at=$5, provider_msg_ref=$6, cost_minor=$7, delivered_at=$8, failed_at=$9, failure_reason=$10
        WHERE id=$1 AND ${AT('$2')}`,
      [p.id, p.createdAt, p.status, p.sentAt, p.readAt, p.providerMsgRef, p.costMinor, p.deliveredAt ?? null, p.failedAt ?? null, p.failureReason ?? null]);
    // The row was read FOR UPDATE in this transaction, so a definite zero is a lost write — fail closed (5d's rule), never
    // answer "read" / "applied" for a row that did not change.
    if (res.rowCount === 0) throw new NotificationUpdateLostError(p.id);
  }

  /**
   * The release job's write: the held row's whole outcome in one statement (the template it resolved at release, the
   * hold's end, the release time). Runs on the job's kv_relay connection — kv_app holds no grant on these columns and
   * never needs one.
   */
  async updateReleased(x: SqlExecutor, n: Notification): Promise<void> {
    const p = n.toProps();
    await x.query(
      `UPDATE notifications SET status=$3, sent_at=$4, provider_msg_ref=$5, cost_minor=$6, failed_at=$7, failure_reason=$8,
              suppressed_reason=$9, held_until=$10, released_at=$11, template_id=$12, template_version_id=$13, language_code=$14
        WHERE id=$1 AND ${AT('$2')}`,
      [p.id, p.createdAt, p.status, p.sentAt, p.providerMsgRef, p.costMinor, p.failedAt ?? null, p.failureReason ?? null,
        p.suppressedReason ?? null, p.heldUntil ?? null, p.releasedAt ?? null, p.templateId, p.templateVersionId ?? null, p.languageCode]);
  }

  /** Resolve a delivery row by the gateway's provider_msg_ref (the delivery-status webhook) — bounded (Law 8). */
  async getByProviderRef(tx: TxContext, providerMsgRef: string): Promise<Notification | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM notifications
        WHERE provider_msg_ref=$1 AND created_at >= now() - make_interval(days => ${RECEIPT_LOOKBACK_DAYS}) AND created_at < ${NOT_FUTURE}
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [providerMsgRef]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** The release job's scan (cross-tenant, kv_relay pool): held rows whose window has ended, oldest hold first. */
  async heldDue(x: SqlExecutor, now: Date, limit: number): Promise<Array<{ id: string; createdAt: Date; tenantId: string | null }>> {
    const r = await x.query<{ id: string; created_at: Date; tenant_id: string | null }>(
      `SELECT id, created_at, tenant_id FROM notifications
        WHERE status = 'suppressed' AND suppressed_reason = 'quiet_hours' AND held_until <= $1
          AND created_at >= $1::timestamptz - make_interval(days => ${HOLD_LOOKBACK_DAYS}) AND created_at < ${NOT_FUTURE}
        ORDER BY held_until, created_at LIMIT $2`, [now, limit]);
    return r.rows.map((x) => ({ id: x.id, createdAt: x.created_at, tenantId: x.tenant_id }));
  }

  /** Claim one held row (SKIP LOCKED — a second pod moves on); re-checks it is still a due hold inside the lock. */
  async claimHeld(x: SqlExecutor, id: string, createdAt: Date, now: Date): Promise<Notification | null> {
    const r = await x.query(
      `SELECT ${COLS} FROM notifications
        WHERE id = $1 AND ${AT('$2')} AND status = 'suppressed' AND suppressed_reason = 'quiet_hours' AND held_until <= $3
        FOR UPDATE SKIP LOCKED`, [id, createdAt, now]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * W204 · MEMBER DELIVERY HEALTH (24h), tenant-wide — the read `notification.manage` was described as granting and no
   * route served. Grouped by channel × status × reason; `withCost` counts rows that carry a `cost_minor` (there is no
   * currency column, so the figure is a count of costed sends, never a ₹ sum).
   */
  async tenantHealth(tenantId: string, hours: number): Promise<HealthRow[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT channel, status::text AS status, suppressed_reason, failure_reason, count(*)::int AS n, count(cost_minor)::int AS with_cost
         FROM notifications
        WHERE tenant_id = $1 AND created_at >= now() - make_interval(hours => $2::int) AND created_at < ${NOT_FUTURE}
        GROUP BY channel, status, suppressed_reason, failure_reason`, [tenantId, hours]);
    return r.rows.map((x: any) => ({ channel: x.channel, status: x.status, suppressedReason: x.suppressed_reason ?? null, failureReason: x.failure_reason ?? null, n: Number(x.n), withCost: Number(x.with_cost) }));
  }
}
