// modules/land-soil-weather/repositories/crop-season.repository.ts · all SQL for crop_seasons. tenant_id in
// EVERY query (Law 1) + RLS. No version column → mutations lock FOR UPDATE. Reads on replica.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { CropSeason } from '../domain/crop-season.entity';
import { CropSeasonName } from '../domain/land-soil-weather.events';
import { CropStatus } from '../domain/crop-season.state';
import { pgDateOrNull } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date — node-pg hands back LOCAL midnight and
// `toISOString()` is a DAY EARLY anywhere ahead of UTC (see that file's header; the dairy double-payment proved it).

const COLS = `id, tenant_id, parcel_id, product_id, season, year, sown_on, expected_harvest, expected_yield, actual_yield, status, created_at`;
const d = pgDateOrNull;
const toMilli = (v: any): bigint | null => (v == null ? null : BigInt(Math.round(Number(v) * 1000)));
const milliToNum = (m: bigint | null) => (m == null ? null : (Number(m) / 1000).toFixed(3));
function toDomain(r: any): CropSeason {
  return CropSeason.rehydrate({ id: r.id, tenantId: r.tenant_id, parcelId: r.parcel_id, productId: r.product_id, season: r.season as CropSeasonName, year: r.year, sownOn: d(r.sown_on),
    expectedHarvest: d(r.expected_harvest), expectedYieldMilli: toMilli(r.expected_yield), actualYieldMilli: toMilli(r.actual_yield), status: r.status as CropStatus, createdAt: r.created_at });
}
@Injectable()
export class CropSeasonRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  async insert(tx: TxContext, c: CropSeason): Promise<void> {
    const v = c.toProps();
    await tx.query(`INSERT INTO crop_seasons (id, tenant_id, parcel_id, product_id, season, year, sown_on, expected_harvest, expected_yield, actual_yield, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)`,
      [v.id, v.tenantId, v.parcelId, v.productId, v.season, v.year, v.sownOn, v.expectedHarvest, milliToNum(v.expectedYieldMilli), milliToNum(v.actualYieldMilli), v.status]);
  }
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<CropSeason | null> {
    const r = await tx.query(`SELECT ${COLS} FROM crop_seasons WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async update(tx: TxContext, c: CropSeason): Promise<void> {
    const v = c.toProps();
    await tx.query(`UPDATE crop_seasons SET sown_on=$3, actual_yield=$4, status=$5, updated_at=now() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [v.id, v.tenantId, v.sownOn, milliToNum(v.actualYieldMilli), v.status]);
  }
  async listForParcel(tenantId: string, parcelId: string, status?: string): Promise<CropSeason[]> {
    const params: unknown[] = [tenantId, parcelId];
    let where = `tenant_id=$1 AND parcel_id=$2 AND deleted_at IS NULL`;
    if (status) { params.push(status); where += ` AND status=$3`; }
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM crop_seasons WHERE ${where} ORDER BY year DESC, created_at DESC, id DESC LIMIT 200`, params);
    return r.rows.map(toDomain);
  }
}
