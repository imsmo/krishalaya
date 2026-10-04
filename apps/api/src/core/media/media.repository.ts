// core/media/media.repository.ts · all SQL for media_assets. tenant_id in EVERY query (Law 1) + RLS
// (NULL = platform asset, visible to all; set = tenant-private). Parameterized only.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../database/read-replica.provider';
import { TxContext } from '../database/unit-of-work';
import { MediaKind } from './media.domain';

export interface MediaRow {
  id: string; tenantId: string | null; uploaderUserId: string | null; kind: MediaKind; s3Key: string;
  mimeType: string; bytes: string; sha256: string; scanStatus: string; createdAt: Date;
}
const COLS = `id, tenant_id, uploader_user_id, kind, s3_key, mime_type, bytes, sha256, scan_status, created_at`;
function toRow(r: any): MediaRow {
  return { id: r.id, tenantId: r.tenant_id, uploaderUserId: r.uploader_user_id, kind: r.kind, s3Key: r.s3_key, mimeType: r.mime_type, bytes: String(r.bytes), sha256: r.sha256, scanStatus: r.scan_status, createdAt: r.created_at };
}

@Injectable()
export class MediaRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Create the asset row in 'pending' (bytes/sha filled on confirm; scan_status set by the AV webhook). */
  async insertPending(tx: TxContext, m: { id: string; tenantId: string | null; uploaderUserId: string | null; kind: MediaKind; s3Key: string; mimeType: string }): Promise<void> {
    await tx.query(
      `INSERT INTO media_assets (id, tenant_id, uploader_user_id, kind, s3_key, mime_type, bytes, sha256, scan_status)
       VALUES ($1,$2,$3,$4,$5,$6,0,'','pending')`,
      [m.id, m.tenantId, m.uploaderUserId, m.kind, m.s3Key, m.mimeType]);
  }

  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<MediaRow | null> {
    const r = await tx.query(`SELECT ${COLS} FROM media_assets WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  async markUploaded(tx: TxContext, tenantId: string, id: string, v: { bytes: bigint; sha256: string; width: number | null; height: number | null }): Promise<number> {
    const r = await tx.query(
      `UPDATE media_assets SET bytes=$3, sha256=$4, width=$5, height=$6, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND scan_status='pending'`,
      [id, tenantId, v.bytes.toString(), v.sha256, v.width, v.height]);
    return r.rowCount ?? 0;
  }

  /** AV result. tenantId may be NULL for a platform asset (use IS NOT DISTINCT FROM). */
  async setScanStatus(tx: TxContext, tenantId: string | null, id: string, status: 'clean' | 'infected' | 'failed'): Promise<number> {
    const r = await tx.query(
      `UPDATE media_assets SET scan_status=$3, updated_at=now() WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2`,
      [id, tenantId, status]);
    return r.rowCount ?? 0;
  }

  /** Claim clean, not-yet-stripped images across tenants for the EXIF-strip job (system/relay conn). */
  async claimUnstrippedImages(systemTx: TxContext, limit: number): Promise<Array<{ id: string; tenantId: string | null; s3Key: string; mimeType: string }>> {
    const r = await systemTx.query<any>(
      `SELECT id, tenant_id, s3_key, mime_type FROM media_assets
        WHERE kind='image' AND scan_status='clean' AND exif_stripped=false
        ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    return r.rows.map((x) => ({ id: x.id, tenantId: x.tenant_id, s3Key: x.s3_key, mimeType: x.mime_type }));
  }

  async markExifStripped(tx: TxContext, tenantId: string | null, id: string): Promise<void> {
    await tx.query(`UPDATE media_assets SET exif_stripped=true, updated_at=now() WHERE id=$1 AND tenant_id IS NOT DISTINCT FROM $2`, [id, tenantId]);
  }

  /** Download authz: the uploader, a moderator, OR any platform (tenant NULL) asset. */
  async getVisible(tenantId: string, id: string, viewerUserId: string, canModerate: boolean): Promise<MediaRow | null> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM media_assets WHERE id=$1 AND (tenant_id=$2 OR tenant_id IS NULL) AND ($3=true OR uploader_user_id=$4 OR tenant_id IS NULL)`,
      [id, tenantId, canModerate, viewerUserId]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }
}
