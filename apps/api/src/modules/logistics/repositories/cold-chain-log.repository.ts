// modules/logistics/repositories/cold-chain-log.repository.ts · SQL for cold_chain_logs (0007, 0201). APPEND-ONLY
// (DB REVOKEs UPDATE/DELETE), PARTITIONED by recorded_at (bigserial id assigned by the DB). tenant_id in every
// tenant read + RLS. Reads on the replica; keyset on (recorded_at, id) — microsecond-exact (F-14) — with a recorded_at lower
// bound so PG prunes partitions.
//
// PC-56 TENANT-SW-e: kv_app INSERTS ONLY WHAT A MANUAL READING MAY CARRY (0201's column grant): subject, temperature, humidity, a
// device label, `recorded_at = now()` and `source = 'manual'`. The band, the time of record and the excursion flag are written by
// the database (trg_ccl_before) and read back here; a device reading arrives only on the kv_ingest route (ColdChainIngestService).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { US_SQL } from '../../../shared/pagination/us-keyset';
import { ColdChainLog, ReadingSource } from '../domain/cold-chain-log.entity';

const COLS = `l.id, l.tenant_id, l.subject_type, l.subject_id, l.temp_c, l.humidity_pct, l.device_ref, l.recorded_at, l.is_breach, l.source, l.device_id,
  l.server_recorded_at, l.band_min_c, l.band_max_c, l.sequence_no, ${US_SQL('l.recorded_at')} AS recorded_us`;
const num = (v: any) => (v == null ? null : Number(v));

function toDomain(r: any): ColdChainLog {
  return ColdChainLog.rehydrate({
    id: r.id == null ? null : String(r.id), tenantId: r.tenant_id, subjectType: r.subject_type, subjectId: r.subject_id,
    tempC: Number(r.temp_c), humidityPct: num(r.humidity_pct), deviceRef: r.device_ref, recordedAt: r.recorded_at, isBreach: r.is_breach,
    source: (r.source ?? 'manual') as ReadingSource, deviceId: r.device_id ?? null, serverRecordedAt: r.server_recorded_at ?? null,
    bandMinC: num(r.band_min_c), bandMaxC: num(r.band_max_c), sequenceNo: r.sequence_no == null ? null : String(r.sequence_no), recordedUs: r.recorded_us ?? null,
  });
}

export interface ColdChainListQuery { subjectType: string; subjectId: string; breachOnly: boolean; since?: Date; cursor?: { c: string; id: string }; limit: number; }
export interface WrittenReading { id: string; recordedAt: Date; serverRecordedAt: Date; bandMinC: number | null; bandMaxC: number | null; isBreach: boolean; source: ReadingSource }

@Injectable()
export class ColdChainLogRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** A MANUAL reading at the server's time. Returns what the database decided (band copied from the store, excursion flag). */
  async insertManual(tx: TxContext, log: ColdChainLog): Promise<WrittenReading> {
    const p = log.toProps();
    const r = await tx.query(
      `INSERT INTO cold_chain_logs (tenant_id, subject_type, subject_id, temp_c, humidity_pct, device_ref, recorded_at, source)
       VALUES ($1,$2,$3,$4,$5,$6, now(), 'manual')
       RETURNING id, recorded_at, server_recorded_at, band_min_c, band_max_c, is_breach, source`,
      [p.tenantId, p.subjectType, p.subjectId, p.tempC, p.humidityPct, p.deviceRef]);
    const x = r.rows[0] as any;
    return { id: String(x.id), recordedAt: x.recorded_at, serverRecordedAt: x.server_recorded_at, bandMinC: num(x.band_min_c), bandMaxC: num(x.band_max_c), isBreach: !!x.is_breach, source: x.source };
  }

  /** Tenant-scoped trail read for a subject; keyset on (recorded_at, id), recorded_at lower bound prunes partitions. */
  async listForSubject(tenantId: string, q: ColdChainListQuery): Promise<ColdChainLog[]> {
    const params: unknown[] = [tenantId, q.subjectType, q.subjectId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `l.tenant_id=$1 AND l.subject_type=$2 AND l.subject_id=$3`;
    if (q.breachOnly) where += ` AND l.is_breach = true`;
    if (q.since) where += ` AND l.recorded_at >= ${p(q.since)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (l.recorded_at < ${cc}::timestamptz OR (l.recorded_at=${cc}::timestamptz AND l.id < ${ci}::bigint))`; }
    const lp = p(q.limit);
    const r = await this.replica.forTenant(tenantId).query(`SELECT ${COLS} FROM cold_chain_logs l WHERE ${where} ORDER BY l.recorded_at DESC, l.id DESC LIMIT ${lp}`, params);
    return r.rows.map(toDomain);
  }

  /** PC-54 W54-12 `iot-device-fleet` v1: the fleet IS what the ledgered readings prove — per device_ref
   *  last-seen / 24h reading + excursion counts / last temp. No phantom registry. */
  async deviceFleet(tenantId: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT device_ref, MAX(recorded_at) AS last_seen, COUNT(*) FILTER (WHERE recorded_at >= now() - interval '24 hours')::int AS readings_24h,
              COUNT(*) FILTER (WHERE is_breach AND recorded_at >= now() - interval '24 hours')::int AS breaches_24h,
              (ARRAY_AGG(temp_c ORDER BY recorded_at DESC))[1]::text AS last_temp_c
         FROM cold_chain_logs WHERE tenant_id=$1 AND device_ref IS NOT NULL AND recorded_at >= now() - interval '30 days'
        GROUP BY device_ref ORDER BY last_seen DESC LIMIT 200`, [tenantId]);
    return r.rows.map((x: any) => ({ deviceRef: x.device_ref, lastSeen: new Date(x.last_seen).toISOString(), readings24h: x.readings_24h, breaches24h: x.breaches_24h, lastTempC: x.last_temp_c }));
  }
}
