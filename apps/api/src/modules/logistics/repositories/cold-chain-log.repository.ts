// modules/logistics/repositories/cold-chain-log.repository.ts · SQL for cold_chain_logs (0007). APPEND-ONLY
// (DB REVOKEs UPDATE/DELETE), PARTITIONED by recorded_at (bigserial id assigned by the DB). tenant_id in every
// tenant read + RLS. Reads on the replica; keyset on (recorded_at, id) with a recorded_at lower bound so PG prunes
// partitions. The breach-alert worker job scans across tenants via its own (system-pool) tx — see findBreachesAfter.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext, SqlExecutor } from '../../../core/database/unit-of-work';
import { ColdChainLog } from '../domain/cold-chain-log.entity';

const COLS = `id, tenant_id, subject_type, subject_id, temp_c, humidity_pct, device_ref, recorded_at, is_breach`;
const num = (v: any) => (v == null ? null : Number(v));

function toDomain(r: any): ColdChainLog {
  return ColdChainLog.rehydrate({
    id: r.id == null ? null : String(r.id), tenantId: r.tenant_id, subjectType: r.subject_type, subjectId: r.subject_id,
    tempC: Number(r.temp_c), humidityPct: num(r.humidity_pct), deviceRef: r.device_ref, recordedAt: r.recorded_at, isBreach: r.is_breach,
  });
}

export interface ColdChainListQuery { subjectType: string; subjectId: string; breachOnly: boolean; since?: Date; cursor?: { c: string; id: string }; limit: number; }
export interface BreachRow { id: string; tenantId: string | null; subjectType: string; subjectId: string; tempC: number; recordedAt: Date; }

@Injectable()
export class ColdChainLogRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** Append a reading; the DB assigns the bigserial id. */
  async insert(tx: TxContext, log: ColdChainLog): Promise<string> {
    const p = log.toProps();
    const r = await tx.query(
      `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, humidity_pct, device_ref, recorded_at, is_breach)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [p.tenantId, p.subjectType, p.subjectId, p.tempC, p.humidityPct, p.deviceRef, p.recordedAt, p.isBreach]);
    return String((r.rows[0] as any).id);
  }

  /** Tenant-scoped trail read for a subject; keyset on (recorded_at, id), recorded_at lower bound prunes partitions. */
  async listForSubject(tenantId: string, q: ColdChainListQuery): Promise<ColdChainLog[]> {
    const params: unknown[] = [tenantId, q.subjectType, q.subjectId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id=$1 AND subject_type=$2 AND subject_id=$3`;
    if (q.breachOnly) where += ` AND is_breach = true`;
    if (q.since) where += ` AND recorded_at >= ${p(q.since)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (recorded_at < ${cc} OR (recorded_at=${cc} AND id < ${ci}::bigint))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM cold_chain_logs WHERE ${where} ORDER BY recorded_at DESC, id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /**
   * Cross-tenant breach scan for the worker job, over the caller's (system-pool) tx. Keyset forward on
   * (recorded_at, id) from the last processed watermark so each breach is alerted exactly once. Bounded.
   */
  async findBreachesAfter(tx: SqlExecutor, after: { recordedAt: Date; id: string } | null, limit: number): Promise<BreachRow[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `is_breach = true`;
    if (after) { const cc = p(after.recordedAt), ci = p(after.id); where += ` AND (recorded_at > ${cc} OR (recorded_at=${cc} AND id > ${ci}::bigint))`; }
    const lp = p(limit);
    const r = await tx.query(
      `SELECT id, tenant_id, subject_type, subject_id, temp_c, recorded_at FROM cold_chain_logs
        WHERE ${where} ORDER BY recorded_at ASC, id ASC LIMIT ${lp}`, params);
    return r.rows.map((x: any) => ({ id: String(x.id), tenantId: x.tenant_id, subjectType: x.subject_type, subjectId: x.subject_id, tempC: Number(x.temp_c), recordedAt: x.recorded_at }));
  }

  /** PC-54 W54-12 `iot-device-fleet` v1: the fleet IS what the ledgered readings prove — per device_ref
   *  last-seen / 24h reading + breach counts / last temp. No phantom registry. */
  async deviceFleet(tenantId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT device_ref, MAX(recorded_at) AS last_seen, COUNT(*) FILTER (WHERE recorded_at >= now() - interval '24 hours')::int AS readings_24h,
              COUNT(*) FILTER (WHERE is_breach AND recorded_at >= now() - interval '24 hours')::int AS breaches_24h,
              (ARRAY_AGG(temp_c ORDER BY recorded_at DESC))[1]::text AS last_temp_c
         FROM cold_chain_logs WHERE tenant_id=$1 AND device_ref IS NOT NULL AND recorded_at >= now() - interval '30 days'
        GROUP BY device_ref ORDER BY last_seen DESC LIMIT 200`, [tenantId]);
    return r.rows.map((x: any) => ({ deviceRef: x.device_ref, lastSeen: new Date(x.last_seen).toISOString(), readings24h: x.readings_24h, breaches24h: x.breaches_24h, lastTempC: x.last_temp_c }));
  }
  /** PC-54 W54-12 `ops-alerting` v1: the breach FEED (alert rules/fan-out = gated `ops-alert-rules`). */
  async breaches(tenantId: string, hours: number, limit: number): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT subject_type, subject_id, device_ref, temp_c::text, humidity_pct::text, recorded_at
         FROM cold_chain_logs WHERE tenant_id=$1 AND is_breach AND recorded_at >= now() - ($2 || ' hours')::interval
        ORDER BY recorded_at DESC LIMIT $3`, [tenantId, String(Math.min(hours, 168)), Math.min(limit, 200)]);
    return r.rows.map((x: any) => ({ subjectType: x.subject_type, subjectId: x.subject_id, deviceRef: x.device_ref, tempC: x.temp_c, humidityPct: x.humidity_pct, recordedAt: new Date(x.recorded_at).toISOString() }));
  }
}
