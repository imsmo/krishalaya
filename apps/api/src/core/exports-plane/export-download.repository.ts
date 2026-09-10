// core/exports-plane/export-download.repository.ts · the fetch log (tenant_export_downloads). Append-only by grant, so
// there is no update here; one insert per attempt and two counts for the receipt page (PC-56 TENANT-6e-2).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../database/read-replica.provider';
import { TxContext } from '../database/unit-of-work';

export const DOWNLOAD_OUTCOMES = [
  'served', 'aborted', 'storage_failed',
  'refused_no_token', 'refused_bad_signature', 'refused_expired', 'refused_wrong_job', 'refused_not_ready', 'refused_file_expired',
] as const;
export type DownloadOutcome = (typeof DOWNLOAD_OUTCOMES)[number];

export interface DownloadRow {
  tenantId: string; jobId: string; fetchedBy: string; tokenJti: string | null; outcome: DownloadOutcome;
  bytesServed?: number | null; servedSha256?: string | null; digestMatched?: boolean | null;
  ip?: string | null; userAgent?: string | null;
}

export interface FetchCounts { attempts: number; served: number; refused: number; mismatched: number; lastServedAt: Date | null }

@Injectable()
export class ExportDownloadRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, d: DownloadRow): Promise<void> {
    await tx.query(
      `INSERT INTO tenant_export_downloads (tenant_id, job_id, fetched_by, token_jti, outcome, bytes_served, served_sha256, digest_matched, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::inet,$10)`,
      [d.tenantId, d.jobId, d.fetchedBy, d.tokenJti, d.outcome, d.bytesServed ?? null, d.servedSha256 ?? null, d.digestMatched ?? null,
       d.ip ?? null, d.userAgent ? d.userAgent.slice(0, 300) : null]);
  }

  /** W2554's *"every fetch logged"*, as the receipt page counts it: attempts, served, refused, and any digest mismatch. */
  async countsFor(tenantId: string, jobId: string): Promise<FetchCounts> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS attempts,
              count(*) FILTER (WHERE outcome = 'served')::int AS served,
              count(*) FILTER (WHERE outcome LIKE 'refused_%')::int AS refused,
              count(*) FILTER (WHERE digest_matched = false)::int AS mismatched,
              max(fetched_at) FILTER (WHERE outcome = 'served') AS last_served_at
         FROM tenant_export_downloads WHERE tenant_id=$1 AND job_id=$2`, [tenantId, jobId]);
    const x = r.rows[0] ?? {};
    return { attempts: Number(x.attempts ?? 0), served: Number(x.served ?? 0), refused: Number(x.refused ?? 0), mismatched: Number(x.mismatched ?? 0), lastServedAt: x.last_served_at ?? null };
  }
}
