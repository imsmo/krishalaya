// modules/disputes/repositories/dispute-message.repository.ts
// Append-only threaded evidence on a dispute. tenant_id in EVERY query (Law 1) + RLS. Keyset reads.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { DisputeMessage } from '../domain/dispute-message.entity';
import { US_SQL } from '../../../shared/pagination/us-keyset';

@Injectable()
export class DisputeMessageRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, m: DisputeMessage): Promise<void> {
    const p = m.props;
    await tx.query(
      `INSERT INTO dispute_messages (id, dispute_id, tenant_id, author_user_id, body) VALUES ($1,$2,$3,$4,$5)`,
      [p.id, p.disputeId, p.tenantId, p.authorUserId, p.body]);
  }

  async listFor(tenantId: string, disputeId: string, q: { cursor?: { c: string; id: string }; limit: number }): Promise<Array<{ id: string; authorUserId: string; body: string; createdAt: Date; createdAtUs: string | null }>> {
    const params: unknown[] = [tenantId, disputeId];
    let where = `tenant_id=$1 AND dispute_id=$2`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }   // PC-56 HOTFIX-7 · B24: the µs keyset
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, author_user_id, body, created_at, ${US_SQL('created_at')} AS created_us FROM dispute_messages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((x) => ({ id: x.id, authorUserId: x.author_user_id, body: x.body, createdAt: x.created_at, createdAtUs: x.created_us ?? null }));
  }
}
