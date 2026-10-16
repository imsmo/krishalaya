// modules/traceability/repositories/trace-lot.repository.ts · trace_lots. tenant_id in every (authenticated)
// query (Law 1) + RLS. No version → mutations lock FOR UPDATE. Keyset lists. The PUBLIC scan does NOT go through
// here — it calls the SECURITY DEFINER trace_scan() function (db/migrations/0028), the only RLS-bypass path.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { TraceLot } from '../domain/trace-lot.entity';
import { US_SQL } from '../../../shared/pagination/us-keyset';

const COLS = `id, tenant_id, listing_id, qr_token, farmer_user_id, parcel_id, crop_season_id, declared_inputs, certificate_ids, blockchain_anchor, created_at, ${US_SQL('created_at')} AS created_us`;
function toDomain(r: any): TraceLot {
  return TraceLot.rehydrate({ id: r.id, tenantId: r.tenant_id, listingId: r.listing_id, qrToken: r.qr_token, farmerUserId: r.farmer_user_id, parcelId: r.parcel_id,
    cropSeasonId: r.crop_season_id, declaredInputs: (r.declared_inputs ?? []) as unknown[], certificateIds: (r.certificate_ids ?? []) as unknown[], blockchainAnchor: r.blockchain_anchor, createdAt: r.created_at, createdAtUs: r.created_us ?? null });
}
export interface LotListQuery { box: 'mine' | 'all'; farmerUserId?: string; listingId?: string; cursor?: { c: string; id: string }; limit: number; }

@Injectable()
export class TraceLotRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, l: TraceLot): Promise<void> {
    const p = l.toProps();
    await tx.query(`INSERT INTO trace_lots (id, tenant_id, listing_id, qr_token, farmer_user_id, parcel_id, crop_season_id, declared_inputs, certificate_ids, blockchain_anchor, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$5)`,
      [p.id, p.tenantId, p.listingId, p.qrToken, p.farmerUserId, p.parcelId, p.cropSeasonId, JSON.stringify(p.declaredInputs), JSON.stringify(p.certificateIds), p.blockchainAnchor]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<TraceLot | null> {
    const r = await tx.query(`SELECT ${COLS} FROM trace_lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string): Promise<TraceLot | null> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM trace_lots WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /** Find the lot for a listing (used by the order/shipment fanout to attach journey events). In-tx. */
  async findByListing(tx: TxContext, tenantId: string, listingId: string): Promise<TraceLot | null> {
    const r = await tx.query(`SELECT ${COLS} FROM trace_lots WHERE tenant_id=$1 AND listing_id=$2 AND deleted_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE`, [tenantId, listingId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, l: TraceLot): Promise<void> {
    const p = l.toProps();
    await tx.query(`UPDATE trace_lots SET declared_inputs=$3::jsonb, certificate_ids=$4::jsonb, blockchain_anchor=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, JSON.stringify(p.declaredInputs), JSON.stringify(p.certificateIds), p.blockchainAnchor]);
  }
  async listFor(tenantId: string, q: LotListQuery): Promise<TraceLot[]> {
    const params: unknown[] = [tenantId]; let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.box === 'mine' && q.farmerUserId) where += ` AND farmer_user_id=${p(q.farmerUserId)}`;
    if (q.listingId) where += ` AND listing_id=${p(q.listingId)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }   // PC-56 HOTFIX-7 · B24: the µs keyset
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM trace_lots WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }
  /** PUBLIC scan — PC-56 HOTFIX-7 · B10 / B25: the SECURITY DEFINER `trace_scan_v2` (migration 0217): NULL unless the lot's organisation is
   *  publicly live; meta keys allow-listed per step; the organisation's display name; `tenantId` for the per-tenant flag (the service strips it).
   *  0028's `trace_scan` is no longer called. qr_token is the capability. */
  async scan(tx: TxContext, qrToken: string): Promise<Record<string, unknown> | null> {
    const r = await tx.query(`SELECT trace_scan_v2($1) AS provenance`, [qrToken]);
    return r.rows[0]?.provenance ?? null;
  }
}
