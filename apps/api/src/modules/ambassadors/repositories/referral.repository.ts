// modules/ambassadors/repositories/referral.repository.ts · referrals. tenant_id in every query (Law 1) + RLS.
// No version → transitions lock FOR UPDATE. code unique per (tenant, code, referee). Keyset lists.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { Referral } from '../domain/referral.entity';
import { ReferralStatus } from '../domain/ambassadors.events';

const COLS = `id, tenant_id, referrer_user_id, referee_user_id, code, status, reward_rule, reward_txn_id, activated_at, created_at, created_at::text AS created_at_raw`;
function toDomain(r: any): Referral {
  return Referral.rehydrate({ id: r.id, tenantId: r.tenant_id, referrerUserId: r.referrer_user_id, refereeUserId: r.referee_user_id, code: r.code,
    status: r.status as ReferralStatus, rewardRule: r.reward_rule ?? {}, rewardTxnId: r.reward_txn_id, activatedAt: r.activated_at ?? null, createdAt: r.created_at, createdAtRaw: r.created_at_raw });
}
export interface ReferralListQuery { status?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class ReferralRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, r: Referral): Promise<void> {
    const p = r.toProps();
    await tx.query(`INSERT INTO referrals (id, tenant_id, referrer_user_id, referee_user_id, code, status, reward_rule, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$3)`,
      [p.id, p.tenantId, p.referrerUserId, p.refereeUserId, p.code, p.status, JSON.stringify(p.rewardRule)]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Referral | null> {
    const r = await tx.query(`SELECT ${COLS} FROM referrals WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async findByCode(tx: TxContext, tenantId: string, code: string): Promise<Referral | null> {
    const r = await tx.query(`SELECT ${COLS} FROM referrals WHERE tenant_id=$1 AND code=$2 AND referee_user_id IS NULL AND deleted_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE`, [tenantId, code]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** F-18 / A10: does this user already hold ANY referral as the referee (claimed, assisted, activated)? */
  async refereeHasAny(tx: TxContext, tenantId: string, refereeUserId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM referrals WHERE tenant_id=$1 AND referee_user_id=$2 AND deleted_at IS NULL LIMIT 1`, [tenantId, refereeUserId]);
    return (r.rowCount ?? 0) > 0;
  }
  async findByReferee(tenantId: string, refereeUserId: string, tx?: TxContext): Promise<Referral | null> {
    const sql = `SELECT ${COLS} FROM referrals WHERE tenant_id=$1 AND referee_user_id=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`;
    const r = tx ? await tx.query(sql, [tenantId, refereeUserId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, refereeUserId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, r: Referral): Promise<void> {
    const p = r.toProps();
    await tx.query(`UPDATE referrals SET referee_user_id=$3, status=$4, reward_txn_id=$5, activated_at=$6, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.refereeUserId, p.status, p.rewardTxnId, p.activatedAt ?? null]);
  }
  async listForReferrer(tenantId: string, referrerUserId: string, q: ReferralListQuery): Promise<Referral[]> {
    const params: unknown[] = [tenantId, referrerUserId]; let where = `tenant_id=$1 AND referrer_user_id=$2 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc}::timestamptz OR (created_at = ${cc}::timestamptz AND id < ${ci}::uuid))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM referrals WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
