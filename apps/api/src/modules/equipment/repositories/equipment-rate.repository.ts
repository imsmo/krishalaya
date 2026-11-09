// modules/equipment/repositories/equipment-rate.repository.ts · all SQL for equipment_rates. Asset-scoped
// (asset belongs to a tenant; access gated in the service). Resolves the ACTIVE effective-dated rate.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { EquipmentRate } from '../domain/equipment-rate.entity';
import { RateBasis } from '../domain/equipment.events';

// [PC-56 OPS-4a — FOUND ON THE WAY] the two `date` columns are read as TEXT: node-pg parses oid 1082 at LOCAL midnight, so under
// TZ=Asia/Kolkata `toISOString().slice(0, 10)` printed every line's day one day EARLY (the TENANT-6c-1 mapper trap). Pinned live by
// ops4a-hire (run in IST and in UTC).
const COLS = `id, asset_id, rate_basis, rate_minor, includes_operator, includes_fuel, effective_from::text AS effective_from, effective_to::text AS effective_to, created_at`;
const d = (v: any): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
function toDomain(r: any): EquipmentRate {
  return EquipmentRate.rehydrate({ id: r.id, assetId: r.asset_id, rateBasis: r.rate_basis as RateBasis, rateMinor: BigInt(r.rate_minor),
    includesOperator: r.includes_operator, includesFuel: r.includes_fuel, effectiveFrom: d(r.effective_from)!, effectiveTo: d(r.effective_to), createdAt: r.created_at });
}

@Injectable()
export class EquipmentRateRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  /** Idempotent upsert per (asset, basis, effective_from). */
  async upsert(tx: TxContext, r: EquipmentRate): Promise<void> {
    const p = r.toProps();
    await tx.query(
      `INSERT INTO equipment_rates (id, asset_id, rate_basis, rate_minor, includes_operator, includes_fuel, effective_from, effective_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (asset_id, rate_basis, effective_from) DO UPDATE SET rate_minor=EXCLUDED.rate_minor, includes_operator=EXCLUDED.includes_operator, includes_fuel=EXCLUDED.includes_fuel, effective_to=EXCLUDED.effective_to, updated_at=now()`,
      [p.id, p.assetId, p.rateBasis, p.rateMinor.toString(), p.includesOperator, p.includesFuel, p.effectiveFrom, p.effectiveTo]);
  }
  /**
   * [PC-56 OPS-4a · E14] The ORGANISATION's calendar day of an instant (`tenants.country_code → countries.timezone`, both NOT NULL —
   * the 6c-1 rule), as `YYYY-MM-DD` text. Resolved in SQL so neither the Node process's zone nor the UTC slice can move a hire's day.
   */
  async tenantDay(tx: TxContext, tenantId: string, at: string): Promise<string> {
    const r = await tx.query(
      `SELECT (($1::timestamptz) AT TIME ZONE co.timezone)::date::text AS day FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $2`, [at, tenantId]);
    if (!r.rows[0]) throw new Error('tenant has no country timezone');
    return r.rows[0].day as string;
  }
  /** [PC-56 OPS-4a · E10] The rate line at (asset, basis, effective_from), locked — the "before" of a rate change. */
  async findAtForUpdate(tx: TxContext, assetId: string, basis: string, effectiveFrom: string): Promise<(EquipmentRate & { createdAt?: Date }) | null> {
    const r = await tx.query(`SELECT ${COLS} FROM equipment_rates WHERE asset_id=$1 AND rate_basis=$2 AND effective_from=$3::date AND deleted_at IS NULL FOR UPDATE`, [assetId, basis, effectiveFrom]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  /**
   * [PC-56 OPS-4a · E10] Has this rate line already priced a hire? True when a hire on this machine and basis, created after the line, is
   * scheduled on an organisation-day the line covers, and no other line (existing when the hire was made) took that day instead — i.e. the
   * line `resolveActive` gave that hire. Every hire counts, cancelled ones too: a snapshot is a snapshot.
   */
  async hasPricedAHire(tx: TxContext, tenantId: string, rateId: string): Promise<boolean> {
    const r = await tx.query(
      `WITH z AS (SELECT co.timezone AS tz FROM tenants t JOIN countries co ON co.code = t.country_code WHERE t.id = $1),
            rl AS (SELECT * FROM equipment_rates WHERE id = $2)
       SELECT EXISTS (
         SELECT 1 FROM equipment_bookings b, z, rl
          WHERE b.tenant_id = $1 AND b.asset_id = rl.asset_id AND b.rate_basis::text = rl.rate_basis::text AND b.created_at >= rl.created_at
            AND (b.scheduled_at AT TIME ZONE z.tz)::date >= rl.effective_from
            AND (rl.effective_to IS NULL OR (b.scheduled_at AT TIME ZONE z.tz)::date <= rl.effective_to)
            AND NOT EXISTS (SELECT 1 FROM equipment_rates r2
                             WHERE r2.asset_id = rl.asset_id AND r2.rate_basis = rl.rate_basis AND r2.deleted_at IS NULL AND r2.id <> rl.id
                               AND r2.created_at <= b.created_at AND r2.effective_from > rl.effective_from
                               AND r2.effective_from <= (b.scheduled_at AT TIME ZONE z.tz)::date
                               AND (r2.effective_to IS NULL OR r2.effective_to >= (b.scheduled_at AT TIME ZONE z.tz)::date))
       ) AS priced`, [tenantId, rateId]);
    return r.rows[0]?.priced === true;
  }
  /** Active rate for an asset+basis on a date (latest effective_from ≤ date, window open). */
  async resolveActive(tx: TxContext, assetId: string, basis: string, onDate: string): Promise<EquipmentRate | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM equipment_rates WHERE asset_id=$1 AND rate_basis=$2 AND deleted_at IS NULL
        AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $3::date)
        ORDER BY effective_from DESC LIMIT 1`, [assetId, basis, onDate]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }
  async listByAsset(tenantId: string, assetId: string, activeOnly: boolean): Promise<EquipmentRate[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM equipment_rates WHERE asset_id=$1 AND deleted_at IS NULL ${activeOnly ? "AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)" : ''} ORDER BY rate_basis, effective_from DESC LIMIT 100`, [assetId]);
    return r.rows.map(toDomain);
  }
}
