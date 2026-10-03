// modules/land-soil-weather/repositories/land-parcel.repository.ts · all SQL for land_parcels. tenant_id in
// EVERY query (Law 1) + RLS. No version column → mutations lock FOR UPDATE. Resolves the irrigation lookup.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { LandParcel } from '../domain/land-parcel.entity';
import { InvalidParcelError } from '../domain/land-soil-weather.errors';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';

const COLS = `id, tenant_id, owner_user_id, region_id, survey_no, bhulekh_ref, area_value, area_unit, irrigation_type_id, boundary_geojson, verification_status, is_tenant_farmed, created_at`;
const toTenThou = (v: any): bigint => BigInt(Math.round(Number(v) * 10000));
const tenThouToNum = (m: bigint) => (Number(m) / 10000).toFixed(4);
function toDomain(r: any): LandParcel {
  return LandParcel.rehydrate({ id: r.id, tenantId: r.tenant_id, ownerUserId: r.owner_user_id, regionId: r.region_id, surveyNo: r.survey_no, bhulekhRef: r.bhulekh_ref,
    areaTenThousandth: toTenThou(r.area_value), areaUnit: r.area_unit, irrigationTypeId: r.irrigation_type_id, boundaryGeojson: r.boundary_geojson,
    verificationStatus: r.verification_status, isTenantFarmed: r.is_tenant_farmed, createdAt: r.created_at });
}
@Injectable()
export class LandParcelRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  /** Resolve an 'irrigation' lookup CODE → platform lookup_values id (never trust a client-supplied id). */
  async resolveIrrigationTypeId(tx: TxContext, code: string): Promise<string> {
    // 0190 deduplicated the platform vocabulary and gave it a partial unique index — one active row per code (F-16).
    const r = await tx.query(`SELECT id FROM lookup_values WHERE type_code='irrigation' AND code=$1 AND tenant_id IS NULL AND is_active=true AND deleted_at IS NULL ORDER BY id LIMIT 1`, [code]);
    if (!r.rows[0]) throw new InvalidParcelError(`unknown irrigation type '${code}'`);
    return r.rows[0].id;
  }
  async insert(tx: TxContext, p: LandParcel): Promise<void> {
    const v = p.toProps();
    await tx.query(`INSERT INTO land_parcels (id, tenant_id, owner_user_id, region_id, survey_no, bhulekh_ref, area_value, area_unit, irrigation_type_id, boundary_geojson, verification_status, is_tenant_farmed, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$3)`,
      [v.id, v.tenantId, v.ownerUserId, v.regionId, v.surveyNo, v.bhulekhRef, tenThouToNum(v.areaTenThousandth), v.areaUnit, v.irrigationTypeId, v.boundaryGeojson ? JSON.stringify(v.boundaryGeojson) : null, v.verificationStatus, v.isTenantFarmed]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<LandParcel | null> {
    const r = await tx.query(`SELECT ${COLS} FROM land_parcels WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async getById(tenantId: string, id: string, tx?: TxContext): Promise<LandParcel | null> {
    const sql = `SELECT ${COLS} FROM land_parcels WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`;
    const r = tx ? await tx.query(sql, [id, tenantId]) : await this.replica.forTenant(tenantId).query(sql, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, p: LandParcel): Promise<void> {
    const v = p.toProps();
    await tx.query(`UPDATE land_parcels SET region_id=$3, survey_no=$4, bhulekh_ref=$5, irrigation_type_id=$6, boundary_geojson=$7::jsonb, is_tenant_farmed=$8, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [v.id, v.tenantId, v.regionId, v.surveyNo, v.bhulekhRef, v.irrigationTypeId, v.boundaryGeojson ? JSON.stringify(v.boundaryGeojson) : null, v.isTenantFarmed]);
  }
  /** PC-56 TENANT-12 (F-10a): µs keyset — the cursor carries `created_at` as the database printed it (six fractional digits)
   *  and is compared as `timestamptz`, never through a JS Date (rows in one millisecond used to be skipped at a page break). */
  async listFor(tenantId: string, q: { ownerUserId?: string; regionId?: string; cursor?: KeysetCursor; limit: number }): Promise<Array<{ parcel: LandParcel; createdUs: string }>> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (q.ownerUserId) where += ` AND owner_user_id=${p(q.ownerUserId)}`;
    if (q.regionId) where += ` AND region_id=${p(q.regionId)}`;
    if (q.cursor) { const cc = p(q.cursor.ts), ci = p(q.cursor.id); where += ` AND (created_at, id) < (${cc}::timestamptz, ${ci}::uuid)`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS}, ${US_SQL('created_at')} AS created_us FROM land_parcels WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map((row: any) => ({ parcel: toDomain(row), createdUs: row.created_us as string }));
  }
}
