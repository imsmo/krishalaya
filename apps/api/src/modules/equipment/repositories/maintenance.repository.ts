// modules/equipment/repositories/maintenance.repository.ts · PC-54 W54-12 `equipment-maintenance-alerts`
// (canon 312): SQL over equipment_maintenance_logs (0010). The ALERT read is computed from ledgered logs:
// needs_attention = latest log is a breakdown; service_due = no service/inspection in 365 days.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

@Injectable()
export class MaintenanceRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertLog(tx: TxContext, l: { id: string; tenantId: string; assetId: string; logType: string; costMinor?: string; notes?: string; engineHoursAt?: string; performedOn: string }): Promise<void> {
    await tx.query(
      `INSERT INTO equipment_maintenance_logs (id, tenant_id, asset_id, log_type, cost_minor, notes, engine_hours_at, performed_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [l.id, l.tenantId, l.assetId, l.logType, l.costMinor ?? null, l.notes ?? null, l.engineHoursAt ?? null, l.performedOn]);
  }
  async listLogs(tenantId: string, assetId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT id, log_type, cost_minor::text, notes, engine_hours_at::text, performed_on FROM equipment_maintenance_logs
        WHERE tenant_id=$1 AND asset_id=$2 AND deleted_at IS NULL ORDER BY performed_on DESC, created_at DESC LIMIT 100`, [tenantId, assetId]);
    return r.rows.map((x: any) => ({ id: x.id, logType: x.log_type, costMinor: x.cost_minor, notes: x.notes, engineHoursAt: x.engine_hours_at, performedOn: pgDate(x.performed_on) }));
  }
  async alerts(tenantId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH latest AS (
         SELECT DISTINCT ON (asset_id) asset_id, log_type, performed_on FROM equipment_maintenance_logs
          WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY asset_id, performed_on DESC, created_at DESC),
       last_service AS (
         SELECT asset_id, MAX(performed_on) AS on_date FROM equipment_maintenance_logs
          WHERE tenant_id=$1 AND log_type IN ('service','inspection') AND deleted_at IS NULL GROUP BY asset_id)
       SELECT a.id AS asset_id, a.status, l.log_type AS latest_log, l.performed_on AS latest_on, s.on_date AS last_service_on,
              CASE WHEN l.log_type = 'breakdown' THEN 'needs_attention'
                   WHEN s.on_date IS NULL OR s.on_date < CURRENT_DATE - 365 THEN 'service_due' END AS alert
         FROM equipment_assets a
         LEFT JOIN latest l ON l.asset_id = a.id
         LEFT JOIN last_service s ON s.asset_id = a.id
        WHERE a.tenant_id=$1 AND a.status != 'retired' AND a.deleted_at IS NULL
          AND (l.log_type = 'breakdown' OR s.on_date IS NULL OR s.on_date < CURRENT_DATE - 365)
        ORDER BY alert, latest_on DESC NULLS LAST LIMIT 200`, [tenantId]);
    return r.rows.map((x: any) => ({ assetId: x.asset_id, status: x.status, latestLog: x.latest_log, latestOn: x.latest_on ? pgDate(x.latest_on) : null, lastServiceOn: x.last_service_on ? pgDate(x.last_service_on) : null, alert: x.alert }));
  }
}
