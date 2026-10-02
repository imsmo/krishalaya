// modules/ambassadors/read-models/referral-desk.read-model.ts · PC-56 TENANT-10a · W162 (`/people/referrals`).
//
// THERE WAS NO TENANT-WIDE REFERRAL READ (F-13): the only list was the caller's OWN referrals, and the admin activated a
// referral by pasting its UUID. This is the desk: every referral in the tenant, newest first (µs keyset), with the
// referrer's and referee's short name + MASKED phone (1b's mask; never the raw number), and the four KPI tiles.
//
// WHAT IT REFUSES TO PRINT, BY NAME
//   • "Rewards paid (30d)" — no reward rule exists and nothing has ever written a reward (F-11): `rewardsPaid30dMinor` is
//     `null` with `rewardsPaidReason: 'reward_rule_not_configured'`, never "₹0".
//   • An `invited` row's invitee contact — `referrals` has no invitee phone column; the referee is `null` and the screen
//     says "not yet joined".
//   • The KPIs are a COHORT over the last 30 days of invites (created_at), stated as such on the tile — not a guess at a
//     signup moment no column records. `activated30d` reads 0184's `activated_at` (the audited act's own time).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { decodeCursor, encodeCursor } from '../domain/cursor';
import { REFERRAL_STATUSES } from '../domain/ambassadors.events';
import { maskPhone, shortName } from '../domain/display';

export interface ReferralDeskRow {
  id: string; code: string; status: string; createdAt: string; activatedAt: string | null;
  referrer: { userId: string; displayName: string | null; phoneMasked: string; isAmbassador: boolean };
  referee: { userId: string; displayName: string | null; phoneMasked: string } | null;
  /** F-11: no reward rule exists on this platform — every row says so rather than "pending" or "₹0". */
  reward: { state: 'not_configured' };
}
export interface ReferralDeskSummary {
  invites30d: number; signedUp30d: number; awaitingActivation: number; activated30d: number;
  rewardsPaid30dMinor: null; rewardsPaidReason: 'reward_rule_not_configured';
  byStatus: Record<string, number>; total: number;
}

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

@Injectable()
export class ReferralDeskReadModel {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** One desk row (the activation chain's confirm step names both people exactly as the desk does). */
  async one(tenantId: string, id: string): Promise<ReferralDeskRow | null> {
    return (await this.list(tenantId, { id, limit: 1 })).items[0] ?? null;
  }

  async list(tenantId: string, q: { id?: string; status?: string; cursor?: string; limit: number }): Promise<{ items: ReferralDeskRow[]; nextCursor: string | null; total: number }> {
    const status = q.status && (REFERRAL_STATUSES as readonly string[]).includes(q.status) ? q.status : undefined;
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `r.tenant_id = $1 AND r.deleted_at IS NULL`;
    if (q.id) where += ` AND r.id = ${p(q.id)}::uuid`;
    if (status) where += ` AND r.status = ${p(status)}`;
    const countWhere = where; const countParams = [...params];
    const c = decodeCursor(q.cursor);
    if (c) { const cc = p(c.c), ci = p(c.id); where += ` AND (r.created_at < ${cc}::timestamptz OR (r.created_at = ${cc}::timestamptz AND r.id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const db = this.replica.forTenant(tenantId);
    const r = await db.query<any>(
      `SELECT r.id, r.code, r.status, r.created_at, r.created_at::text AS created_at_raw, r.activated_at,
              r.referrer_user_id, ru.full_name AS referrer_name, ru.phone AS referrer_phone,
              r.referee_user_id, eu.full_name AS referee_name, eu.phone AS referee_phone,
              EXISTS (SELECT 1 FROM ambassador_profiles a WHERE a.tenant_id = r.tenant_id AND a.user_id = r.referrer_user_id AND a.deleted_at IS NULL) AS referrer_is_ambassador
         FROM referrals r
         JOIN users ru ON ru.id = r.referrer_user_id
         LEFT JOIN users eu ON eu.id = r.referee_user_id
        WHERE ${where}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ${lp}`, params);
    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM referrals r WHERE ${countWhere}`, countParams);
    const items: ReferralDeskRow[] = r.rows.map((x: any) => ({
      id: x.id, code: x.code, status: x.status, createdAt: iso(x.created_at) as string, activatedAt: iso(x.activated_at),
      referrer: { userId: x.referrer_user_id, displayName: shortName(x.referrer_name), phoneMasked: maskPhone(x.referrer_phone ?? ''), isAmbassador: !!x.referrer_is_ambassador },
      referee: x.referee_user_id ? { userId: x.referee_user_id, displayName: shortName(x.referee_name), phoneMasked: maskPhone(x.referee_phone ?? '') } : null,
      reward: { state: 'not_configured' },
    }));
    const last = r.rows[r.rows.length - 1];
    const nextCursor = r.rows.length === q.limit && last ? encodeCursor(last.created_at_raw, last.id) : null;
    return { items, nextCursor, total: Number(n.rows[0]?.n ?? 0) };
  }

  async summary(tenantId: string): Promise<ReferralDeskSummary> {
    const db = this.replica.forTenant(tenantId);
    const r = await db.query<any>(
      `SELECT
         count(*) FILTER (WHERE created_at >= now() - interval '30 days')::int AS invites_30d,
         count(*) FILTER (WHERE created_at >= now() - interval '30 days' AND status IN ('signed_up','activated','rewarded'))::int AS signed_up_30d,
         count(*) FILTER (WHERE status = 'signed_up')::int AS awaiting,
         count(*) FILTER (WHERE activated_at >= now() - interval '30 days')::int AS activated_30d,
         count(*) FILTER (WHERE status = 'invited')::int AS s_invited,
         count(*) FILTER (WHERE status = 'signed_up')::int AS s_signed_up,
         count(*) FILTER (WHERE status = 'activated')::int AS s_activated,
         count(*) FILTER (WHERE status = 'rewarded')::int AS s_rewarded,
         count(*)::int AS total
         FROM referrals WHERE tenant_id = $1 AND deleted_at IS NULL`, [tenantId]);
    const x = r.rows[0] ?? {};
    return {
      invites30d: Number(x.invites_30d ?? 0), signedUp30d: Number(x.signed_up_30d ?? 0), awaitingActivation: Number(x.awaiting ?? 0),
      activated30d: Number(x.activated_30d ?? 0), rewardsPaid30dMinor: null, rewardsPaidReason: 'reward_rule_not_configured',
      byStatus: { invited: Number(x.s_invited ?? 0), signed_up: Number(x.s_signed_up ?? 0), activated: Number(x.s_activated ?? 0), rewarded: Number(x.s_rewarded ?? 0) },
      total: Number(x.total ?? 0),
    };
  }
}
