// modules/education/repositories/live-session.repository.ts · PC-56 TENANT-7c · live_sessions + live_session_registrations
// + live_class_reminders, as 0172 holds them. tenant_id in every query (Law 1) + RLS (registrations under it since 0172).
// No version → lifecycle locks FOR UPDATE. Keyset lists on (scheduled_at, id).
//
// THE WALL-CLOCK IS THE DATABASE'S. A class scheduled "Thu 16 Jul, 20:30" is 20:30 where the cooperative is:
// `resolveStart` turns the typed date and time into an instant `AT TIME ZONE co.timezone` through
// `tenants.country_code → countries.timezone` (6c-1's resolution), and every read hands the instant back as a wall-clock
// in the same zone (`local_date`, `local_time`). Nothing in this module calls `new Date(y, m, d, h, mi)`.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { LiveSession } from '../domain/live-session.entity';
import { LiveStatus } from '../domain/creator.events';
import { OtherClass, ReminderKind } from '../domain/live-clock';
import { ResolvedStart } from '../domain/live-class-review';

const COLS = `s.id, s.tenant_id, s.host_user_id, s.channel_id, s.course_id, s.title, s.topic_id, s.scheduled_at, s.duration_mins, s.capacity, s.join_url, s.clash_accepted, s.remind,
  s.status, s.provider_stream_ref, s.playback_url, s.recording_media_id, s.recording_attached_at, s.recording_lesson_id, s.started_at, s.ended_at, s.cancelled_at,
  s.attendance_count, s.attendance_recorded_at, s.attendance_recorded_by, s.created_at,
  to_char(s.scheduled_at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS local_date, to_char(s.scheduled_at AT TIME ZONE co.timezone, 'HH24:MI') AS local_time, co.timezone,
  (SELECT count(*)::int FROM live_session_registrations r WHERE r.session_id = s.id) AS registered`;
const FROM = `FROM live_sessions s JOIN tenants t ON t.id = s.tenant_id JOIN countries co ON co.code = t.country_code`;

/** A class as read: the row, its wall-clock in the cooperative's zone, and who has registered. */
export interface LiveClassRow { session: LiveSession; localDate: string; localTime: string; timezone: string; registered: number }

function toDomain(r: any): LiveClassRow {
  const session = LiveSession.rehydrate({
    id: r.id, tenantId: r.tenant_id, hostUserId: r.host_user_id, channelId: r.channel_id, courseId: r.course_id, title: r.title, topicId: r.topic_id,
    scheduledAt: r.scheduled_at, durationMins: r.duration_mins, capacity: r.capacity, joinUrl: r.join_url, clashAccepted: r.clash_accepted, remind: r.remind,
    status: r.status as LiveStatus, providerStreamRef: r.provider_stream_ref, playbackUrl: r.playback_url,
    recordingMediaId: r.recording_media_id, recordingAttachedAt: r.recording_attached_at, recordingLessonId: r.recording_lesson_id,
    startedAt: r.started_at, endedAt: r.ended_at, cancelledAt: r.cancelled_at,
    attendanceCount: r.attendance_count, attendanceRecordedAt: r.attendance_recorded_at, attendanceRecordedBy: r.attendance_recorded_by, createdAt: r.created_at,
  });
  return { session, localDate: r.local_date, localTime: r.local_time, timezone: r.timezone, registered: r.registered };
}

export const LIVE_BOXES = ['upcoming', 'past', 'mine', 'all'] as const;
export type LiveBox = (typeof LIVE_BOXES)[number];
export interface LiveListQuery { box: LiveBox; hostUserId?: string; courseId?: string; status?: LiveStatus; cursor?: { at: string; id: string }; limit: number }

@Injectable()
export class LiveSessionRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private run(tenantId: string, tx: TxContext | undefined, sql: string, params: unknown[]) { return tx ? tx.query(sql, params) : this.replica.forTenant(tenantId).query(sql, params); }

  async insert(tx: TxContext, s: LiveSession): Promise<void> {
    const p = s.toProps();
    await tx.query(
      `INSERT INTO live_sessions (id, tenant_id, host_user_id, channel_id, course_id, title, topic_id, scheduled_at, duration_mins, capacity, join_url, clash_accepted, remind, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [p.id, p.tenantId, p.hostUserId, p.channelId, p.courseId, p.title, p.topicId, p.scheduledAt, p.durationMins, p.capacity, p.joinUrl, p.clashAccepted, p.remind, p.status, tx.userId ?? p.hostUserId]);
  }
  async update(tx: TxContext, s: LiveSession): Promise<void> {
    const p = s.toProps();
    await tx.query(
      `UPDATE live_sessions SET title=$3, scheduled_at=$4, duration_mins=$5, capacity=$6, join_url=$7, clash_accepted=$8, remind=$9, status=$10, provider_stream_ref=$11, playback_url=$12,
         recording_media_id=$13, recording_attached_at=$14, recording_lesson_id=$15, started_at=$16, ended_at=$17, cancelled_at=$18,
         attendance_count=$19, attendance_recorded_at=$20, attendance_recorded_by=$21, updated_at=now(), updated_by=$22
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.title, p.scheduledAt, p.durationMins, p.capacity, p.joinUrl, p.clashAccepted, p.remind, p.status, p.providerStreamRef, p.playbackUrl,
        p.recordingMediaId, p.recordingAttachedAt, p.recordingLessonId, p.startedAt, p.endedAt, p.cancelledAt, p.attendanceCount, p.attendanceRecordedAt, p.attendanceRecordedBy, tx.userId ?? null]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<LiveClassRow | null> {
    // lock the row itself first (a join in a FOR UPDATE would lock tenants/countries too)
    const lock = await tx.query(`SELECT id FROM live_sessions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    if (!lock.rows[0]) return null;
    const r = await tx.query(`SELECT ${COLS} ${FROM} WHERE s.id=$1 AND s.tenant_id=$2 AND s.deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<LiveClassRow | null> {
    const r = await this.run(tenantId, tx, `SELECT ${COLS} ${FROM} WHERE s.id=$1 AND s.tenant_id=$2 AND s.deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** The typed wall-clock as an instant in the COOPERATIVE's zone. Null when the tenant has no country (and so no zone). */
  async resolveStart(tenantId: string, date: string, time: string, tx?: TxContext): Promise<ResolvedStart | null> {
    const r = await this.run(tenantId, tx,
      `SELECT (($1 || ' ' || $2)::timestamp AT TIME ZONE co.timezone) AS starts_at, co.timezone
         FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $3`, [date, time, tenantId]);
    const x = r.rows[0];
    return x ? { startsAt: x.starts_at, timezone: x.timezone } : null;
  }

  /** The host's classes still on the calendar — the clash read (idx_live_sessions_host_calendar). */
  async hostCalendar(tenantId: string, hostUserId: string, tx?: TxContext): Promise<OtherClass[]> {
    const r = await this.run(tenantId, tx,
      `SELECT id, title, scheduled_at, duration_mins FROM live_sessions WHERE tenant_id=$1 AND host_user_id=$2 AND status IN ('scheduled','live') AND deleted_at IS NULL ORDER BY scheduled_at`, [tenantId, hostUserId]);
    return r.rows.map((x: any) => ({ id: x.id, title: x.title, startsAt: x.scheduled_at, durationMins: x.duration_mins }));
  }

  /* ---- registrations ---- */
  /** Registers; false when already registered (ON CONFLICT on the two NOT NULL key columns). tenant_id is the trigger's. */
  async register(tx: TxContext, tenantId: string, sessionId: string, userId: string): Promise<boolean> {
    const r = await tx.query(`INSERT INTO live_session_registrations (tenant_id, session_id, user_id) VALUES ($1,$2,$3) ON CONFLICT (session_id, user_id) DO NOTHING`, [tenantId, sessionId, userId]);
    return (r.rowCount ?? 0) > 0;
  }
  async isRegistered(tenantId: string, sessionId: string, userId: string, tx?: TxContext): Promise<boolean> {
    const r = await this.run(tenantId, tx, `SELECT 1 FROM live_session_registrations WHERE tenant_id=$1 AND session_id=$2 AND user_id=$3`, [tenantId, sessionId, userId]);
    return r.rows.length > 0;
  }
  async registrationCount(tx: TxContext, tenantId: string, sessionId: string): Promise<number> {
    const r = await tx.query(`SELECT count(*)::int n FROM live_session_registrations WHERE tenant_id=$1 AND session_id=$2`, [tenantId, sessionId]);
    return r.rows[0].n;
  }

  /* ---- reminders sent ---- */
  async remindersFor(tenantId: string, sessionId: string, tx?: TxContext): Promise<Array<{ kind: ReminderKind; sentAt: Date; recipients: number }>> {
    const r = await this.run(tenantId, tx, `SELECT kind, sent_at, recipients FROM live_class_reminders WHERE tenant_id=$1 AND session_id=$2 ORDER BY sent_at`, [tenantId, sessionId]);
    return r.rows.map((x: any) => ({ kind: x.kind, sentAt: x.sent_at, recipients: x.recipients }));
  }

  /* ---- W414's table ---- */
  async listFor(tenantId: string, q: LiveListQuery): Promise<LiveClassRow[]> {
    const params: unknown[] = [tenantId]; let where = `s.tenant_id=$1 AND s.deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.box === 'upcoming') where += ` AND s.status IN ('scheduled','live')`;
    if (q.box === 'past') where += ` AND s.status IN ('ended','cancelled')`;
    if (q.box === 'mine' && q.hostUserId) where += ` AND s.host_user_id=${p(q.hostUserId)}`;
    if (q.courseId) where += ` AND s.course_id=${p(q.courseId)}`;
    if (q.status) where += ` AND s.status=${p(q.status)}`;
    const asc = q.box === 'upcoming';
    if (q.cursor) { const ca = p(q.cursor.at), ci = p(q.cursor.id); where += asc ? ` AND (s.scheduled_at > ${ca} OR (s.scheduled_at=${ca} AND s.id > ${ci}))` : ` AND (s.scheduled_at < ${ca} OR (s.scheduled_at=${ca} AND s.id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} ${FROM} WHERE ${where} ORDER BY s.scheduled_at ${asc ? 'ASC' : 'DESC'}, s.id ${asc ? 'ASC' : 'DESC'} LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /* ---- the reminder cadence (kv_relay pool, across tenants) ---- */
  /**
   * Classes that may owe a reminder: scheduled, wanting reminders, not yet begun, and within the largest offset any
   * tenant could have set (30 days — `reminderOffsets` caps there). The tenant's offsets ride along from
   * `setting_definitions` / `tenant_settings`, the kinds already sent as an array, and the wall-clock in the zone.
   */
  async reminderCandidates(pool: Pool, now: Date): Promise<Array<{ id: string; tenantId: string; title: string; scheduledAt: Date; localDate: string; localTime: string; offsets: unknown; sent: string[] }>> {
    const r = await pool.query(
      `SELECT s.id, s.tenant_id, s.title, s.scheduled_at,
              to_char(s.scheduled_at AT TIME ZONE co.timezone, 'YYYY-MM-DD') AS local_date, to_char(s.scheduled_at AT TIME ZONE co.timezone, 'HH24:MI') AS local_time,
              COALESCE(ts.value, d.default_value) AS offsets,
              COALESCE((SELECT array_agg(k.kind) FROM live_class_reminders k WHERE k.session_id = s.id), '{}') AS sent
         FROM live_sessions s
         JOIN tenants t ON t.id = s.tenant_id
         JOIN countries co ON co.code = t.country_code
         CROSS JOIN setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = s.tenant_id
        WHERE d.key = 'education.live_reminder_offsets_mins'
          AND s.status = 'scheduled' AND s.remind AND s.deleted_at IS NULL
          AND s.scheduled_at > $1 AND s.scheduled_at <= $1::timestamptz + interval '30 days'
        ORDER BY s.scheduled_at
        LIMIT 500`, [now]);
    return r.rows.map((x: any) => ({ id: x.id, tenantId: x.tenant_id, title: x.title, scheduledAt: x.scheduled_at, localDate: x.local_date, localTime: x.local_time, offsets: x.offsets, sent: x.sent ?? [] }));
  }
}
