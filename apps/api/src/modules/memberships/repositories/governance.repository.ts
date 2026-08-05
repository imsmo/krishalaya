// modules/memberships/repositories/governance.repository.ts · PC-54 W54-7 `governance-agm`: SQL over
// coop_resolutions + coop_votes (0009 — AGM votes, dividends, patronage bonus, board elections).
// ONE VOTE PER MEMBER is the composite PK — the DB is the ballot box's integrity, not app code.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';

export interface Resolution { id: string; title: string; body: string | null; resolutionType: string; votingOpens: string | null; votingCloses: string | null; payload: Record<string, unknown>; status: string }
const toRes = (r: any): Resolution => ({ id: r.id, title: r.title, body: r.body, resolutionType: r.resolution_type, votingOpens: r.voting_opens ? new Date(r.voting_opens).toISOString() : null, votingCloses: r.voting_closes ? new Date(r.voting_closes).toISOString() : null, payload: r.payload ?? {}, status: r.status });

@Injectable()
export class GovernanceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, r: { id: string; tenantId: string; title: string; body?: string; resolutionType: string; votingOpens?: string; votingCloses?: string; payload?: Record<string, unknown> }): Promise<void> {
    await tx.query(`INSERT INTO coop_resolutions (id, tenant_id, title, body, resolution_type, voting_opens, voting_closes, payload) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [r.id, r.tenantId, r.title, r.body ?? null, r.resolutionType, r.votingOpens ?? null, r.votingCloses ?? null, JSON.stringify(r.payload ?? {})]);
  }
  async list(tenantId: string, status?: string): Promise<Resolution[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM coop_resolutions WHERE tenant_id=$1 AND ($2::text IS NULL OR status=$2) AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100`, [tenantId, status ?? null]);
    return r.rows.map(toRes);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<Resolution | null> {
    const r = await tx.query(`SELECT * FROM coop_resolutions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRes(r.rows[0]) : null;
  }
  async get(tenantId: string, id: string): Promise<Resolution | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT * FROM coop_resolutions WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toRes(r.rows[0]) : null;
  }
  async setStatus(tx: TxContext, tenantId: string, id: string, from: string[], to: string): Promise<boolean> {
    const r = await tx.query(`UPDATE coop_resolutions SET status=$4 WHERE id=$1 AND tenant_id=$2 AND status = ANY($3::text[]) AND deleted_at IS NULL`, [id, tenantId, from, to]);
    return (r.rowCount ?? 0) > 0;
  }
  /** Returns false on a duplicate ballot (the PK) — the caller turns that into a 409, never a double vote. */
  async castVote(tx: TxContext, resolutionId: string, memberUserId: string, choice: string): Promise<boolean> {
    try { await tx.query(`INSERT INTO coop_votes (resolution_id, member_user_id, choice) VALUES ($1,$2,$3)`, [resolutionId, memberUserId, choice]); return true; }
    catch (e: any) { if (e?.code === '23505') return false; throw e; }
  }
  async tally(tenantId: string, resolutionId: string): Promise<Array<{ choice: string; votes: number }>> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT choice, COUNT(*)::int AS votes FROM coop_votes WHERE resolution_id=$1 GROUP BY choice ORDER BY votes DESC`, [resolutionId]);
    return r.rows.map((x: any) => ({ choice: x.choice, votes: x.votes }));
  }
}
