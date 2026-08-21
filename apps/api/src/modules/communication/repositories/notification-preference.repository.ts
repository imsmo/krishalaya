// modules/communication/repositories/notification-preference.repository.ts · a user's per event×channel opt-in/out
// (notification_preferences, user-scoped — no tenant_id). Always filtered by user_id (a user can only ever read
// or write THEIR OWN preferences — no IDOR). Reads accept an optional tx for the fanout handler's connection.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { NotificationPreference } from '../domain/notification-preference.entity';
import { NotifChannel } from '../domain/communication.events';

function toDomain(r: any): NotificationPreference {
  return NotificationPreference.rehydrate({ userId: r.user_id, eventCode: r.event_code, channel: r.channel as NotifChannel, isEnabled: r.is_enabled });
}

@Injectable()
export class NotificationPreferenceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /**
   * **EVERY RECIPIENT'S OVERRIDES FOR ONE EVENT, IN ONE QUERY (PC-56 TENANT-6d-7).**
   *
   * The fan-out of a village notice asked this per recipient inside the relay's transaction; W170's *"87 pourers"* is
   * one village and a union centre is twenty of them. Absent from the map = no explicit override, which
   * `resolveChannels` already treats as "the catalogue decides" — so a missing row and an empty map behave the same
   * and no recipient is silently dropped for having said nothing.
   */
  async mapForUsers(userIds: readonly string[], eventCode: string, tx: TxContext): Promise<Map<string, Map<NotifChannel, boolean>>> {
    const out = new Map<string, Map<NotifChannel, boolean>>();
    if (userIds.length === 0) return out;
    const r = await tx.query<{ user_id: string; channel: string; is_enabled: boolean }>(
      `SELECT user_id, channel, is_enabled FROM notification_preferences
        WHERE user_id = ANY($1::uuid[]) AND event_code = $2`, [[...userIds], eventCode]);
    for (const row of r.rows) {
      const m = out.get(row.user_id) ?? new Map<NotifChannel, boolean>();
      m.set(row.channel as NotifChannel, row.is_enabled);
      out.set(row.user_id, m);
    }
    return out;
  }

  /** All of a user's explicit overrides (optionally for one event). */
  async listForUser(userId: string, eventCode?: string, tx?: TxContext): Promise<NotificationPreference[]> {
    const params: unknown[] = [userId]; let where = `user_id=$1`;
    if (eventCode) { params.push(eventCode); where += ` AND event_code=$2`; }
    const sql = `SELECT user_id, event_code, channel, is_enabled FROM notification_preferences WHERE ${where}`;
    const r = tx ? await tx.query(sql, params) : await this.replica.forTenant('').query(sql, params);
    return r.rows.map(toDomain);
  }

  /** Idempotent bulk upsert of a user's preferences (PK = user_id,event_code,channel). */
  async upsertMany(tx: TxContext, userId: string, prefs: { eventCode: string; channel: string; isEnabled: boolean }[]): Promise<void> {
    for (const p of prefs) {
      await tx.query(
        `INSERT INTO notification_preferences (user_id, event_code, channel, is_enabled) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id, event_code, channel) DO UPDATE SET is_enabled=EXCLUDED.is_enabled`,
        [userId, p.eventCode, p.channel, p.isEnabled]);
    }
  }
}
