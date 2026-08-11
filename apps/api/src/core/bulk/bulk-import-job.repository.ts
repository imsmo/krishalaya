// core/bulk/bulk-import-job.repository.ts · ALL SQL for bulk_import_jobs. tenant_id in every query (Law 1) + RLS.
// No version column → the processor locks the row FOR UPDATE while running. Reads on the replica; writes in the
// caller's tx. Keyset list (never OFFSET).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../database/read-replica.provider';
import { TxContext } from '../database/unit-of-work';
import { BulkImportJob } from './domain/bulk-import-job.entity';
import { BulkStatus } from './domain/bulk-import.events';

const COLS = `id, tenant_id, import_type, storage_key, original_filename, status, total_rows, processed_rows, succeeded_rows, failed_rows, column_mapping, requested_by, error_summary, started_at, finished_at, created_at, file_sha256, validated_at, validation`;
function toDomain(r: any): BulkImportJob {
  return BulkImportJob.rehydrate({ id: r.id, tenantId: r.tenant_id, importType: r.import_type, storageKey: r.storage_key, originalFilename: r.original_filename,
    status: r.status as BulkStatus, totalRows: r.total_rows, processedRows: r.processed_rows, succeededRows: r.succeeded_rows, failedRows: r.failed_rows,
    columnMapping: r.column_mapping ?? {}, requestedBy: r.requested_by, errorSummary: r.error_summary, startedAt: r.started_at, finishedAt: r.finished_at, createdAt: r.created_at,
    // PC-56 TENANT-1b-4 (0129): the file hash and the validate-first triage. Selected in COLS so a rehydrated job carries
    // the report — without it `completeValidation` would be followed by an update that wrote NULL back over it.
    fileSha256: r.file_sha256 ?? null, validatedAt: r.validated_at ?? null, validation: r.validation ?? null });
}
export interface JobListQuery { status?: BulkStatus; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class BulkImportJobRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, j: BulkImportJob): Promise<void> {
    const p = j.toProps();
    await tx.query(
      `INSERT INTO bulk_import_jobs (id, tenant_id, import_type, storage_key, original_filename, status, column_mapping, requested_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)`,
      [p.id, p.tenantId, p.importType, p.storageKey, p.originalFilename, p.status, JSON.stringify(p.columnMapping), p.requestedBy]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<BulkImportJob | null> {
    const r = await tx.query(`SELECT ${COLS} FROM bulk_import_jobs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<BulkImportJob | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM bulk_import_jobs WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, j: BulkImportJob): Promise<void> {
    const p = j.toProps();
    await tx.query(
      `UPDATE bulk_import_jobs SET status=$3, total_rows=$4, processed_rows=$5, succeeded_rows=$6, failed_rows=$7, error_summary=$8, started_at=$9, finished_at=$10,
              file_sha256=$11, validated_at=$12, validation=$13::jsonb, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, p.status, p.totalRows, p.processedRows, p.succeededRows, p.failedRows, p.errorSummary, p.startedAt, p.finishedAt,
       p.fileSha256 ?? null, p.validatedAt ?? null, p.validation ? JSON.stringify(p.validation) : null]);
  }
  /** How many jobs are still pending/processing for this tenant (abuse cap). */
  async countActive(tenantId: string): Promise<number> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT count(*)::int AS n FROM bulk_import_jobs WHERE tenant_id=$1 AND status IN ('pending','validating','validated','processing') AND deleted_at IS NULL`, [tenantId]);
    return r.rows[0]?.n ?? 0;
  }
  async listFor(tenantId: string, q: JobListQuery): Promise<BulkImportJob[]> {
    const params: unknown[] = [tenantId]; let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM bulk_import_jobs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
}
