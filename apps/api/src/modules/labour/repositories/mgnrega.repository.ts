// modules/labour/repositories/mgnrega.repository.ts · PC-54 W54-3 `mgnrega-program` (first slice): service
// layer over mgnrega_job_cards (0008, PRD §31.10 convergence). The job card is the worker's 100-day
// guarantee record: job_card_no is UNIQUE nationally; days_used_fy is the convergence counter the
// platform mirrors (synced from the state ledger — we RECORD, the state ledger is the authority).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface JobCard { id: string; userId: string; jobCardNo: string; regionId: string | null; daysUsedFy: number; lastSyncedAt: string | null }
const COLS = `id, user_id, job_card_no, region_id, days_used_fy, last_synced_at`;
const toCard = (r: any): JobCard => ({ id: r.id, userId: r.user_id, jobCardNo: r.job_card_no, regionId: r.region_id, daysUsedFy: r.days_used_fy, lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at).toISOString() : null });

@Injectable()
export class MgnregaRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async register(tx: TxContext, c: { id: string; userId: string; jobCardNo: string; regionId?: string }): Promise<void> {
    await tx.query(`INSERT INTO mgnrega_job_cards (id, user_id, job_card_no, region_id) VALUES ($1,$2,$3,$4)`, [c.id, c.userId, c.jobCardNo, c.regionId ?? null]);
  }
  async mine(tenantId: string, userId: string): Promise<JobCard[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mgnrega_job_cards WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 10`, [userId]);
    return r.rows.map(toCard);
  }
  async list(tenantId: string, q: { regionId?: string; limit: number }): Promise<JobCard[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM mgnrega_job_cards WHERE ($1::uuid IS NULL OR region_id=$1) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT $2`, [q.regionId ?? null, q.limit]);
    return r.rows.map(toCard);
  }
}
