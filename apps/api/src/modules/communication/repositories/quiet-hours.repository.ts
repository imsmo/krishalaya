// modules/communication/repositories/quiet-hours.repository.ts · a user's quiet-hours window (user_quiet_hours,
// user-scoped — no tenant_id). Always filtered by user_id. Reads accept an optional tx (fanout handler).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';

export interface QuietHoursRow { starts: string; ends: string; timezone: string; }

/** [PC-56 TENANT-8b · F-5] What a member with no row inherits: the cooperative's zone and its default window setting. */
export interface TenantQuietContext { zone: string | null; defaultWindow: unknown }

@Injectable()
export class QuietHoursRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  /**
   * **EVERY RECIPIENT'S WINDOW IN ONE QUERY (PC-56 TENANT-6d-7)** — the same reason as the preference map: a notice to
   * a village must not cost one round trip per family. Absent from the map = no window set, which is what
   * `resolveChannels` receives as `null` today.
   */
  async mapForUsers(userIds: readonly string[], tx: TxContext): Promise<Map<string, QuietHoursRow>> {
    const out = new Map<string, QuietHoursRow>();
    if (userIds.length === 0) return out;
    const r = await tx.query<{ user_id: string; starts: string; ends: string; timezone: string }>(
      `SELECT user_id, starts::text AS starts, ends::text AS ends, timezone
         FROM user_quiet_hours WHERE user_id = ANY($1::uuid[])`, [[...userIds]]);
    for (const row of r.rows) out.set(row.user_id, { starts: row.starts, ends: row.ends, timezone: row.timezone });
    return out;
  }

  async getForUser(userId: string, tx?: TxContext): Promise<QuietHoursRow | null> {
    const sql = `SELECT starts::text AS starts, ends::text AS ends, timezone FROM user_quiet_hours WHERE user_id=$1`;
    const r = tx ? await tx.query(sql, [userId]) : await this.replica.forTenant('').query(sql, [userId]);
    return r.rows[0] ? { starts: r.rows[0].starts, ends: r.rows[0].ends, timezone: r.rows[0].timezone } : null;
  }
  async upsert(tx: TxContext, userId: string, q: QuietHoursRow): Promise<void> {
    await tx.query(
      `INSERT INTO user_quiet_hours (user_id, starts, ends, timezone) VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id) DO UPDATE SET starts=EXCLUDED.starts, ends=EXCLUDED.ends, timezone=EXCLUDED.timezone`,
      [userId, q.starts, q.ends, q.timezone]);
  }

  /**
   * [PC-56 TENANT-8b · F-5 / F-22] The cooperative's zone (`tenants.country_code → countries.timezone`, 7c's resolution —
   * never an `'Asia/Kolkata'` literal) and its `notification.quiet_hours_default` (the tenant's own value, else the
   * definition's 21:00–06:00). Read ONCE per fan-out. A null tenant (a platform notice) has neither.
   */
  async tenantContext(tenantId: string | null, x?: SqlExecutor): Promise<TenantQuietContext> {
    if (!tenantId) return { zone: null, defaultWindow: null };
    const run = x ?? this.replica.forTenant(tenantId);
    const r = await run.query<{ timezone: string | null; win: unknown }>(
      `SELECT co.timezone, COALESCE(ts.value, d.default_value) AS win
         FROM tenants t
         JOIN countries co ON co.code = t.country_code
         LEFT JOIN setting_definitions d ON d.key = 'notification.quiet_hours_default'
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = t.id AND ts.deleted_at IS NULL
        WHERE t.id = $1`, [tenantId]);
    return { zone: r.rows[0]?.timezone ?? null, defaultWindow: r.rows[0]?.win ?? null };
  }

  /** Does the DATABASE know this zone — the same registry `trg_uqh_timezone_known` checks at write (the review asks
   *  the writer's question, so a "ready" review is never followed by a refusal). */
  async knownTimezone(name: string): Promise<boolean> {
    const r = await this.replica.forTenant('').query<{ ok: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1) AS ok`, [name]);
    return Boolean(r.rows[0]?.ok);
  }
}
