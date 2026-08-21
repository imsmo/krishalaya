// modules/communication/repositories/quiet-hours.repository.ts · a user's quiet-hours window (user_quiet_hours,
// user-scoped — no tenant_id). Always filtered by user_id. Reads accept an optional tx (fanout handler).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface QuietHoursRow { starts: string; ends: string; timezone: string; }

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
}
