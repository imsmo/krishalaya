// core/exports-plane/export-job.repository.ts · ALL SQL for tenant_export_jobs (PC-56 TENANT-6e-2). tenant_id in every
// tenant query (Law 1) + RLS; writes in the caller's tx with the `version` optimistic lock; reads on the replica.
//
// TWO KINDS OF QUERY LIVE HERE AND THEY ARE KEPT APART BY NAME. `…ForTenant`/`getById`/`insert`/`update` are tenant-scoped
// and run as `kv_app`. The `peek…` methods take the RUNNER's pool (`kv_relay`, BYPASSRLS, SELECT-only on this table by
// 0169's grants) and return only `(id, tenant_id)` pairs for the worker to then open under that tenant's own unit of
// work — the same shape `runPendingImports` uses. Nothing here ever writes through the relay pool.
import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { READ_REPLICA, ReadReplicaProvider } from '../database/read-replica.provider';
import { TxContext } from '../database/unit-of-work';
import { ExportJob, ExportFailureCode } from './domain/export-job.entity';
import { ExportStatus } from './domain/export-job.state';
import { ETA_SAMPLE_SIZE, QueueObservation } from './domain/export-eta';

const COLS = `id, tenant_id, dataset_code, params, params_sha256, requested_by, status, attempts, queued_at, started_at, generated_at,
  failed_at, expired_at, expires_at, row_count, content_sha256, file_name, byte_size, content_type, storage_key, notes,
  failure_code, failure_detail, version`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg row
function toDomain(r: any): ExportJob {
  return ExportJob.rehydrate({
    id: r.id, tenantId: r.tenant_id, datasetCode: r.dataset_code, params: r.params ?? {}, paramsSha256: r.params_sha256,
    requestedBy: r.requested_by, status: r.status as ExportStatus, attempts: Number(r.attempts),
    queuedAt: r.queued_at, startedAt: r.started_at, generatedAt: r.generated_at, failedAt: r.failed_at, expiredAt: r.expired_at,
    expiresAt: r.expires_at,
    rowCount: r.row_count === null ? null : Number(r.row_count), contentSha256: r.content_sha256, fileName: r.file_name,
    byteSize: r.byte_size === null ? null : Number(r.byte_size), contentType: r.content_type, storageKey: r.storage_key,
    notes: Array.isArray(r.notes) ? r.notes.map(String) : [],
    failureCode: (r.failure_code as ExportFailureCode | null) ?? null, failureDetail: r.failure_detail, version: Number(r.version),
  });
}

/** A write that matched no row at the expected version. Fail closed (Law 12 as TENANT-5d applied it): a lost update on
 *  a job's state must not vanish — it would leave a `running` claim that is really finished, or a receipt never written. */
export class ExportJobUpdateLostError extends Error {
  constructor(id: string, version: number) { super(`EXPORT_JOB_UPDATE_LOST: ${id} at version ${version}`); this.name = 'ExportJobUpdateLostError'; }
}

export interface QueuedRef { id: string; tenantId: string }

@Injectable()
export class ExportJobRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, j: ExportJob): Promise<void> {
    const p = j.toProps();
    await tx.query(
      `INSERT INTO tenant_export_jobs (id, tenant_id, dataset_code, params, params_sha256, requested_by, status, attempts, queued_at, version, created_by)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$6)`,
      [p.id, p.tenantId, p.datasetCode, JSON.stringify(p.params), p.paramsSha256, p.requestedBy, p.status, p.attempts, p.queuedAt, p.version]);
  }

  /** The SAME request already waiting or running (0169's `uq_texp_open_request`). Locked, so two concurrent enqueues of one
   *  request serialise on it rather than both inserting and one dying on the unique index. */
  async findOpenTwin(tx: TxContext, tenantId: string, datasetCode: string, paramsSha256: string, requestedBy: string): Promise<ExportJob | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM tenant_export_jobs
        WHERE tenant_id=$1 AND dataset_code=$2 AND params_sha256=$3 AND requested_by=$4
          AND status IN ('queued','running') AND deleted_at IS NULL
        ORDER BY queued_at ASC, id ASC LIMIT 1 FOR UPDATE`,
      [tenantId, datasetCode, paramsSha256, requestedBy]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async getById(tenantId: string, id: string): Promise<ExportJob | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM tenant_export_jobs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Locked read in the writer's tx. `SKIP LOCKED` when claiming, so two workers racing the same head of queue do not
   *  wait on each other — the loser sees no row and moves on. */
  async getForUpdate(tx: TxContext, tenantId: string, id: string, opts: { skipLocked?: boolean } = {}): Promise<ExportJob | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM tenant_export_jobs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE${opts.skipLocked ? ' SKIP LOCKED' : ''}`,
      [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Optimistic: the row must still be at `version - 1`. Only the columns 0169 grants `kv_app` UPDATE on. */
  async update(tx: TxContext, j: ExportJob): Promise<void> {
    const p = j.toProps();
    const r = await tx.query(
      `UPDATE tenant_export_jobs
          SET status=$3, attempts=$4, started_at=$5, generated_at=$6, failed_at=$7, expired_at=$8, expires_at=$9,
              row_count=$10, content_sha256=$11, file_name=$12, byte_size=$13, content_type=$14, storage_key=$15,
              notes=$16::jsonb, failure_code=$17, failure_detail=$18, version=$19, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND version=$20 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.attempts, p.startedAt, p.generatedAt, p.failedAt, p.expiredAt, p.expiresAt,
       p.rowCount, p.contentSha256, p.fileName, p.byteSize, p.contentType, p.storageKey,
       JSON.stringify(p.notes), p.failureCode, p.failureDetail, p.version, p.version - 1]);
    if (r.rowCount !== 1) throw new ExportJobUpdateLostError(p.id, p.version - 1);
  }

  /** Open jobs this requester has in this tenant (the enqueue cap — a bound on write amplification). */
  async countOpenFor(tenantId: string, requestedBy: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS n FROM tenant_export_jobs WHERE tenant_id=$1 AND requested_by=$2 AND status IN ('queued','running') AND deleted_at IS NULL`,
      [tenantId, requestedBy]);
    return r.rows[0]?.n ?? 0;
  }

  /**
   * W2553's position and the ETA's inputs — THREE NUMBERS from `export_queue_standing` (0169.1b), a SECURITY DEFINER
   * function owned by kv_relay, because the queue is one queue across every tenant and the caller's RLS view of it is
   * (correctly) only their own rows. Called on the tenant's own executor AFTER the caller's own row was read under RLS.
   */
  async queueStanding(tenantId: string, jobId: string): Promise<QueueObservation> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ahead, sample, median_ms FROM export_queue_standing($1, $2)`, [jobId, ETA_SAMPLE_SIZE]);
    const row = r.rows[0] ?? { ahead: 0, sample: 0, median_ms: null };
    return { ahead: Number(row.ahead ?? 0), sample: Number(row.sample ?? 0), medianRunMs: row.median_ms === null || row.median_ms === undefined ? null : Number(row.median_ms) };
  }

  /* ---- the runner's cross-tenant peeks (kv_relay pool, SELECT only) ---- */

  /** The head of the one FIFO. `LIMIT 1`: one job per tick, as the brief says — a worker that drains the whole queue in
   *  one tick holds the advisory lock for as long as the largest export takes. */
  async peekNextQueued(relay: Pool): Promise<QueuedRef | null> {
    const r = await relay.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM tenant_export_jobs WHERE status='queued' AND deleted_at IS NULL ORDER BY queued_at ASC, id ASC LIMIT 1`);
    return r.rows[0] ? { id: r.rows[0].id, tenantId: r.rows[0].tenant_id } : null;
  }

  /** Claims older than `staleMs` whose pod is presumed dead. Bounded. */
  async peekStaleRunning(relay: Pool, staleMs: number, limit = 20): Promise<QueuedRef[]> {
    const r = await relay.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM tenant_export_jobs
        WHERE status='running' AND deleted_at IS NULL AND started_at < now() - ($1::int * interval '1 millisecond')
        ORDER BY started_at ASC LIMIT $2`, [staleMs, limit]);
    return r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id }));
  }

  /** Ready files past their retention. Bounded; the sweep runs every tick so a backlog drains over a few. */
  async peekExpired(relay: Pool, limit = 100): Promise<QueuedRef[]> {
    const r = await relay.query<{ id: string; tenant_id: string }>(
      `SELECT id, tenant_id FROM tenant_export_jobs WHERE status='ready' AND deleted_at IS NULL AND expires_at <= now()
        ORDER BY expires_at ASC LIMIT $1`, [limit]);
    return r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id }));
  }
}
