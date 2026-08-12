// modules/payments/repositories/payout-batch.repository.ts
// SQL for the payout BATCH bookkeeping table + the cross-tenant claim of queued payouts into a batch.
// payout_batches is an operational table OUTSIDE tenant RLS (like reconciliation_runs / ops_job_runs):
// a run can span tenants, so it is written on the PRIVILEGED worker connection (kv_relay/kv_wallet),
// never from a tenant request. Reads (list/get) go to the replica (CQRS). All amounts are bigint
// minor units. Claiming uses FOR UPDATE SKIP LOCKED so concurrent workers never grab the same payout.
import { Injectable } from '@nestjs/common';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { PayoutBatch } from '../domain/payout-batch.entity';
import { PayoutBatchStatus } from '../domain/payout-batch.state';

const COLS = `id, tenant_id, batch_type, total_minor, count, status, executed_at, created_at`;

function toDomain(r: any): PayoutBatch {
  return PayoutBatch.rehydrate({
    id: r.id, tenantId: r.tenant_id, batchType: r.batch_type, totalMinor: BigInt(r.total_minor),
    count: r.count, status: r.status as PayoutBatchStatus, executedAt: r.executed_at, createdAt: r.created_at,
  });
}

@Injectable()
export class PayoutBatchRepository {
  constructor(private readonly pools: PgPoolProvider) {}

  /** Insert an OPEN batch (privileged worker tx). */
  async insert(tx: TxContext, b: PayoutBatch): Promise<void> {
    const v = b.toProps();
    await tx.query(
      `INSERT INTO payout_batches (id, tenant_id, batch_type, total_minor, count, status, executed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [v.id, v.tenantId, v.batchType, v.totalMinor.toString(), v.count, v.status, v.executedAt]);
  }

  async getForUpdate(tx: TxContext, id: string): Promise<PayoutBatch | null> {
    const r = await tx.query(`SELECT ${COLS} FROM payout_batches WHERE id=$1 FOR UPDATE`, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Persist the running total + status after a transition (privileged worker tx). */
  async update(tx: TxContext, b: PayoutBatch): Promise<void> {
    const v = b.toProps();
    await tx.query(
      `UPDATE payout_batches SET total_minor=$2, count=$3, status=$4, executed_at=$5, updated_at=now() WHERE id=$1`,
      [v.id, v.totalMinor.toString(), v.count, v.status, v.executedAt]);
  }

  /** Atomically claim up to `limit` QUEUED payouts into a batch (set batch_id; keep status 'queued').
   *  Lower priority number = more urgent (wage lane first). `maxPriority` (when set) restricts the lane.
   *  FOR UPDATE SKIP LOCKED so two concurrent runs never claim the same payout. Returns (id, tenantId). */
  async claimQueuedIntoBatch(tx: TxContext, batchId: string, opts: { limit: number; maxPriority: number | null }): Promise<Array<{ id: string; tenantId: string; amountMinor: bigint }>> {
    const r = await tx.query<{ id: string; tenant_id: string; amount_minor: string }>(
      `UPDATE payouts SET batch_id=$1, updated_at=now()
        WHERE id IN (
          SELECT id FROM payouts
           WHERE status='queued' AND batch_id IS NULL AND ($3::int IS NULL OR priority <= $3)
           ORDER BY priority ASC, created_at ASC
           FOR UPDATE SKIP LOCKED LIMIT $2)
        RETURNING id, tenant_id, amount_minor`,
      [batchId, opts.limit, opts.maxPriority]);
    return r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id, amountMinor: BigInt(x.amount_minor) }));
  }

  // --- reads (replica, CQRS) ---
  async getById(id: string): Promise<PayoutBatch | null> {
    const r = await this.pools.replica(0).query(`SELECT ${COLS} FROM payout_batches WHERE id=$1`, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async list(opts: { status?: PayoutBatchStatus; batchType?: string; cursor?: { c: string; id: string }; limit: number }): Promise<PayoutBatch[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `1=1`;
    if (opts.status) where += ` AND status=${p(opts.status)}`;
    if (opts.batchType) where += ` AND batch_type=${p(opts.batchType)}`;
    if (opts.cursor) { const cc = p(opts.cursor.c), ci = p(opts.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(opts.limit);
    const r = await this.pools.replica(0).query(`SELECT ${COLS} FROM payout_batches WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
