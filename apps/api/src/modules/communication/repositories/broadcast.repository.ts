// modules/communication/repositories/broadcast.repository.ts · all SQL for tenant broadcasts — PC-56 TENANT-8e.
// tenant_id in EVERY query (Law 1) + RLS (0179: `tb_tenant` / `tbr_tenant`, USING + WITH CHECK). Lists are KEYSET.
// The audience is resolved in keyset PAGES over `user_tenant_roles` (Law 8); its size is a COUNT.
//
// THE COUNTS ARE THE LOG'S (F-2). `logGroups` reads `notifications` through `tenant_broadcast_recipients.fanout_key`,
// pruned on BOTH partitioned tables by the fan-out's own instant: every recipients row and every notifications row of one
// broadcast carries `created_at = tenant_broadcasts.fanned_out_at` (the fan-out transaction's `now()`, written by SQL —
// never a JS Date, which would lose the microseconds and match nothing — 8b's mark-read lesson).
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { Broadcast, BroadcastChannel } from '../domain/broadcast.entity';
import { BroadcastFailureReason, BroadcastStatus } from '../domain/broadcast.state';
import { LogGroup } from '../domain/broadcast-counts';
import { ImpactMember } from '../domain/broadcast-audience';
import { NotifChannel } from '../domain/communication.events';

export const BROADCAST_EVENT = 'tenant.broadcast';

const COLS = `id, tenant_id, created_by_user_id, audience_role_code, title, body, status, channel, scheduled_at, eligible_count,
  send_requested_by, send_requested_at, queued_at, fanned_out_at, failed_at, failure_reason, cancelled_by, cancelled_at, cancel_reason,
  created_at, updated_at`;

function toDomain(r: any): Broadcast {
  return Broadcast.rehydrate({
    id: r.id, tenantId: r.tenant_id, createdByUserId: r.created_by_user_id, audienceRoleCode: r.audience_role_code,
    title: r.title, body: r.body, status: r.status as BroadcastStatus, channel: r.channel as BroadcastChannel,
    scheduledAt: r.scheduled_at, eligibleCount: Number(r.eligible_count), sendRequestedBy: r.send_requested_by, sendRequestedAt: r.send_requested_at,
    queuedAt: r.queued_at, fannedOutAt: r.fanned_out_at, failedAt: r.failed_at, failureReason: r.failure_reason as BroadcastFailureReason | null,
    cancelledBy: r.cancelled_by, cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, createdAt: r.created_at, updatedAt: r.updated_at,
  });
}

/** Keyset on the id alone: ids are uuid v7 (time-ordered, minted at creation), so `id DESC` IS newest first — and a cursor
 *  that is an id cannot lose the microseconds a timestamp cursor round-tripped through a JS Date would. */
export interface BroadcastListQuery { status?: BroadcastStatus; cursor?: string; limit: number }
export interface TenantRole { code: string; name: string; members: number }

@Injectable()
export class BroadcastRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private x(tenantId: string, tx?: SqlExecutor): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  async insert(tx: TxContext, b: Broadcast, actor: string): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `INSERT INTO tenant_broadcasts (id, tenant_id, created_by_user_id, audience_role_code, title, body, status, channel, scheduled_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
      [p.id, p.tenantId, p.createdByUserId, p.audienceRoleCode, p.title, p.body, p.status, p.channel, p.scheduledAt, actor]);
  }
  async updateDraft(tx: TxContext, b: Broadcast, actor: string): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `UPDATE tenant_broadcasts SET title=$3, body=$4, audience_role_code=$5, scheduled_at=$6, updated_by=$7
        WHERE id=$1 AND tenant_id=$2 AND status='draft' AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.title, p.body, p.audienceRoleCode, p.scheduledAt, actor]);
  }
  /** Persist a move the entity decided (Law 5). `fanOut` stamps `fanned_out_at = now()` in SQL — the instant every log row
   *  of this fan-out carries. */
  async updateState(tx: TxContext, b: Broadcast, actor: string | null, fanOut = false): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `UPDATE tenant_broadcasts SET status=$3, eligible_count=$4, send_requested_by=$5, send_requested_at=$6, queued_at=$7,
              fanned_out_at = CASE WHEN $8::boolean THEN now() ELSE fanned_out_at END,
              failed_at=$9, failure_reason=$10, cancelled_by=$11, cancelled_at=$12, cancel_reason=$13, updated_by=COALESCE($14, updated_by)
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.eligibleCount, p.sendRequestedBy, p.sendRequestedAt, p.queuedAt, fanOut,
        p.failedAt, p.failureReason, p.cancelledBy, p.cancelledAt, p.cancelReason, actor]);
  }
  /** PC-56 HOTFIX-2 · the RELAY's state write (BroadcastRequestedHandler, on the relay transaction as kv_relay). 0179 granted kv_relay
   *  UPDATE on exactly (status, queued_at, fanned_out_at, failed_at, failure_reason, updated_at, updated_by) — and `updateState` above
   *  SETs every lifecycle column (eligible_count, send_requested_*, cancelled_*), so Postgres refused the whole statement 42501 and no
   *  broadcast ever left `queued`. The fan-out changes only status / failed_at / failure_reason / fanned_out_at, so this writes only
   *  those, inside 0179's column grant — no grant was widened. */
  async updateRelayState(tx: TxContext, b: Broadcast, fanOut = false): Promise<void> {
    const p = b.toProps();
    await tx.query(
      `UPDATE tenant_broadcasts SET status=$3,
              fanned_out_at = CASE WHEN $4::boolean THEN now() ELSE fanned_out_at END,
              failed_at=$5, failure_reason=$6, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, fanOut, p.failedAt, p.failureReason]);
  }
  async get(tenantId: string, id: string, tx?: SqlExecutor): Promise<Broadcast | null> {
    const r = await this.x(tenantId, tx).query(`SELECT ${COLS} FROM tenant_broadcasts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Broadcast | null> {
    const r = await tx.query(`SELECT ${COLS} FROM tenant_broadcasts WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async list(tenantId: string, q: BroadcastListQuery): Promise<Broadcast[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) where += ` AND id < ${p(q.cursor)}`;
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM tenant_broadcasts WHERE ${where} ORDER BY id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** History counts by status (the W429 status chips). */
  async statusCounts(tenantId: string): Promise<Record<string, number>> {
    const r = await this.replica.forTenant(tenantId).query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM tenant_broadcasts WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status`, [tenantId]);
    const out: Record<string, number> = {};
    for (const row of r.rows) out[row.status] = Number(row.n);
    return out;
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE REGISTRIES                                                                                              */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** 0179's `broadcast_role_known` — the trigger's own question, so a "ready" review is never refused underneath. */
  async roleKnown(tenantId: string, code: string, tx?: SqlExecutor): Promise<boolean> {
    const r = await this.x(tenantId, tx).query<{ ok: boolean }>(`SELECT broadcast_role_known($1) AS ok`, [code]);
    return Boolean(r.rows[0]?.ok);
  }
  /** The form's audience choices: every active tenant role, with how many of this cooperative's active members hold it. */
  async tenantRoles(tenantId: string): Promise<TenantRole[]> {
    const r = await this.replica.forTenant(tenantId).query<{ code: string; default_name: string; members: number }>(
      `SELECT ro.code, ro.default_name,
              (SELECT count(DISTINCT utr.user_id)::int FROM user_tenant_roles utr
                WHERE utr.tenant_id=$1 AND utr.role_id = ro.id AND utr.is_active AND utr.deleted_at IS NULL) AS members
         FROM roles ro WHERE ro.scope='tenant' AND ro.is_active AND ro.deleted_at IS NULL ORDER BY ro.code`, [tenantId]);
    return r.rows.map((x) => ({ code: x.code, name: x.default_name, members: Number(x.members) }));
  }
  /** 0179's `broadcast_template_gaps(tenant)` — `channel:language` pairs the frame does not serve in. */
  async templateGaps(tenantId: string, tx?: SqlExecutor): Promise<string[]> {
    const r = await this.x(tenantId, tx).query<{ gaps: string[] }>(`SELECT broadcast_template_gaps($1::uuid) AS gaps`, [tenantId]);
    return r.rows[0]?.gaps ?? ['EVENT_MISSING'];
  }
  /** 0179's `broadcast_required_languages()` — the one list (en · hi · gu); never a literal in the service (Law 6). */
  async requiredLanguages(tenantId: string): Promise<string[]> {
    const r = await this.x(tenantId).query<{ l: string[] }>(`SELECT broadcast_required_languages() AS l`);
    return r.rows[0]?.l ?? [];
  }
  async whatsappConnected(tenantId: string, tx?: SqlExecutor): Promise<boolean> {
    const r = await this.x(tenantId, tx).query<{ ok: boolean }>(`SELECT whatsapp_provider_connected() AS ok`);
    return Boolean(r.rows[0]?.ok);
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE AUDIENCE                                                                                                */
  /* ---------------------------------------------------------------------------------------------------------- */

  private audienceWhere(role: string | null, params: unknown[]): { join: string; where: string } {
    let join = ''; let where = `utr.tenant_id=$1 AND utr.is_active AND utr.deleted_at IS NULL`;
    if (role) { params.push(role); join = `JOIN roles ro ON ro.id = utr.role_id`; where += ` AND ro.code=$${params.length}`; }
    return { join, where };
  }
  /** Distinct active members in the audience — the honest-math count (W429), and `eligible_count` at send. */
  async audienceSize(tenantId: string, role: string | null, tx?: SqlExecutor): Promise<number> {
    const params: unknown[] = [tenantId];
    const { join, where } = this.audienceWhere(role, params);
    const r = await this.x(tenantId, tx).query<{ n: number }>(`SELECT count(DISTINCT utr.user_id)::int AS n FROM user_tenant_roles utr ${join} WHERE ${where}`, params);
    return Number(r.rows[0]?.n ?? 0);
  }
  /** One KEYSET page of the audience's user ids (`afterUserId` drives it). */
  async audiencePage(tx: TxContext, tenantId: string, role: string | null, afterUserId: string | null, limit: number): Promise<string[]> {
    const params: unknown[] = [tenantId];
    const { join, where: w } = this.audienceWhere(role, params);
    let where = w;
    if (afterUserId) { params.push(afterUserId); where += ` AND utr.user_id > $${params.length}`; }
    params.push(limit);
    const r = await tx.query<{ user_id: string }>(
      `SELECT DISTINCT utr.user_id FROM user_tenant_roles utr ${join} WHERE ${where} ORDER BY utr.user_id LIMIT $${params.length}`, params);
    return r.rows.map((x) => x.user_id);
  }
  /** The members the quiet-hours estimate examines (≤ limit): their own window, their tenant.broadcast preferences, and
   *  whether they have a push device — the three facts the fan-out reads. */
  async impactMembers(tenantId: string, role: string | null, limit: number): Promise<ImpactMember[]> {
    const params: unknown[] = [tenantId];
    const { join, where } = this.audienceWhere(role, params);
    params.push(BROADCAST_EVENT); const ev = `$${params.length}`;
    params.push(limit); const lim = `$${params.length}`;
    const r = await this.replica.forTenant(tenantId).query<{ user_id: string; starts: string | null; ends: string | null; timezone: string | null; prefs: Record<string, boolean> | null; has_device: boolean }>(
      `WITH a AS (SELECT DISTINCT utr.user_id FROM user_tenant_roles utr ${join} WHERE ${where} ORDER BY utr.user_id LIMIT ${lim})
       SELECT a.user_id, q.starts::text AS starts, q.ends::text AS ends, q.timezone,
              (SELECT jsonb_object_agg(np.channel, np.is_enabled) FROM notification_preferences np WHERE np.user_id = a.user_id AND np.event_code = ${ev}) AS prefs,
              EXISTS (SELECT 1 FROM push_devices pd WHERE pd.user_id = a.user_id AND pd.is_active) AS has_device
         FROM a LEFT JOIN user_quiet_hours q ON q.user_id = a.user_id ORDER BY a.user_id`, params);
    return r.rows.map((x) => ({
      userId: x.user_id,
      own: x.starts && x.ends ? { starts: x.starts, ends: x.ends, timezone: x.timezone ?? '' } : null,
      prefs: new Map(Object.entries(x.prefs ?? {}).map(([k, v]) => [k as NotifChannel, Boolean(v)])),
      hasPushDevice: Boolean(x.has_device),
    }));
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE RECIPIENTS AND THE LOG                                                                                  */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** One row per member reached, at the fan-out transaction's instant (`created_at` = now(), = `fanned_out_at`). */
  async insertRecipients(tx: TxContext, tenantId: string, broadcastId: string, rows: ReadonlyArray<{ userId: string; fanoutKey: string }>): Promise<void> {
    if (rows.length === 0) return;
    await tx.query(
      `INSERT INTO tenant_broadcast_recipients (tenant_id, broadcast_id, user_id, fanout_key, created_at)
       SELECT $1, $2, u, k, now() FROM unnest($3::uuid[], $4::text[]) AS x(u, k)
       ON CONFLICT DO NOTHING`,
      [tenantId, broadcastId, rows.map((r) => r.userId), rows.map((r) => r.fanoutKey)]);
  }
  /** The recipients and the log's groups for these broadcasts (sent ones), pruned to their fan-out instants. */
  async logGroups(tenantId: string, broadcastIds: readonly string[], tx?: SqlExecutor): Promise<Map<string, { recipients: number; groups: LogGroup[] }>> {
    const out = new Map<string, { recipients: number; groups: LogGroup[] }>();
    if (broadcastIds.length === 0) return out;
    const x = this.x(tenantId, tx);
    const rc = await x.query<{ broadcast_id: string; n: number }>(
      `SELECT r.broadcast_id, count(*)::int AS n
         FROM tenant_broadcasts b JOIN tenant_broadcast_recipients r
           ON r.tenant_id = b.tenant_id AND r.broadcast_id = b.id AND r.created_at = b.fanned_out_at
        WHERE b.tenant_id = $1 AND b.id = ANY($2::uuid[]) AND b.fanned_out_at IS NOT NULL
        GROUP BY r.broadcast_id`, [tenantId, [...broadcastIds]]);
    for (const id of broadcastIds) out.set(id, { recipients: 0, groups: [] });
    for (const row of rc.rows) out.get(row.broadcast_id)!.recipients = Number(row.n);
    const g = await x.query<{ broadcast_id: string; channel: string; status: string; suppressed_reason: string | null; failure_reason: string | null; released: boolean; n: number }>(
      `SELECT r.broadcast_id, n.channel, n.status::text AS status, n.suppressed_reason, n.failure_reason, (n.released_at IS NOT NULL) AS released, count(*)::int AS n
         FROM tenant_broadcasts b
         JOIN tenant_broadcast_recipients r ON r.tenant_id = b.tenant_id AND r.broadcast_id = b.id AND r.created_at = b.fanned_out_at
         JOIN notifications n ON n.user_id = r.user_id AND n.fanout_key = r.fanout_key AND n.created_at = b.fanned_out_at
                             AND n.event_code = '${BROADCAST_EVENT}' AND n.tenant_id = b.tenant_id
        WHERE b.tenant_id = $1 AND b.id = ANY($2::uuid[]) AND b.fanned_out_at IS NOT NULL
        GROUP BY 1, 2, 3, 4, 5, 6`, [tenantId, [...broadcastIds]]);
    for (const row of g.rows) {
      out.get(row.broadcast_id)!.groups.push({ channel: row.channel, status: row.status, suppressedReason: row.suppressed_reason, failureReason: row.failure_reason, released: Boolean(row.released), n: Number(row.n) });
    }
    return out;
  }
  /** Broadcasts that fanned out since `from` (the hub's window), newest first, bounded. */
  async fannedOutSince(tenantId: string, from: Date, limit: number): Promise<string[]> {
    const r = await this.replica.forTenant(tenantId).query<{ id: string }>(
      `SELECT id FROM tenant_broadcasts WHERE tenant_id=$1 AND status='sent' AND fanned_out_at >= $2 AND deleted_at IS NULL
        ORDER BY fanned_out_at DESC LIMIT $3`, [tenantId, from, limit]);
    return r.rows.map((x) => x.id);
  }

  /* ---------------------------------------------------------------------------------------------------------- */
  /* THE SCHEDULE JOB                                                                                            */
  /* ---------------------------------------------------------------------------------------------------------- */

  /** Due scheduled broadcasts across tenants (the runner's kv_relay pool — a cross-tenant scan by nature). Oldest first. */
  async due(pool: Pool, now: Date, limit: number): Promise<Array<{ id: string; tenantId: string }>> {
    const r = await pool.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM tenant_broadcasts WHERE status='scheduled' AND scheduled_at <= $1 AND deleted_at IS NULL
        ORDER BY scheduled_at, id LIMIT $2`, [now, limit]);
    return r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id }));
  }
  /** Claim one due broadcast inside the queuing transaction — a second pod moves on (`SKIP LOCKED`). */
  async claimDue(tx: TxContext, tenantId: string, id: string, now: Date): Promise<Broadcast | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM tenant_broadcasts WHERE id=$1 AND tenant_id=$2 AND status='scheduled' AND scheduled_at <= $3 AND deleted_at IS NULL
        FOR UPDATE SKIP LOCKED`, [id, tenantId, now]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
}
