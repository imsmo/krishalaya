// modules/dairy/repositories/bmc-unit.repository.ts · PC-56 TENANT-6d-1 · the first code to own `bmc_units`.
//
// The table has existed since 0009 with **no repository, no service and no route**. The only reader on the platform is
// TENANT-6a's counter board, which joins it to print `no unit` for every centre — accurately, because nothing could
// ever create one.
//
// Temperatures are DECI-DEGREES and volumes are CENTI-LITRES, both integers, read through `core/database/pg-numeric.ts`
// at their column's own scale. `numeric(4,1)` read as a JS number is how 4.5 becomes 4.4999999 and a tank in range
// becomes a breach on somebody's phone at 2am.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { numericFromScaled, scaledFromNumeric, scaledFromNumericOrNull } from '../../../core/database/pg-numeric';
import { BmcUnit, BmcUnitProps, CompressorState } from '../domain/bmc-unit.entity';

const TEMP_SCALE = 1;    // numeric(4,1) — tenths of a degree
const LITRE_SCALE = 2;   // numeric(10,2) — hundredths of a litre

const COLS = `id, tenant_id, mcc_id, min_temp_c, target_temp_c, tolerance_c, capacity_litres, volume_litres,
              volume_at, volume_by, iot_device_ref, model, serial_no, compressor_state, compressor_state_at,
              compressor_state_by, is_active, retired_at, retired_by, created_at`;

/** The same columns, aliased for the monitor's join — written out rather than derived, so a rename breaks loudly. */
const B_COLS = `b.id, b.tenant_id, b.mcc_id, b.min_temp_c, b.target_temp_c, b.tolerance_c, b.capacity_litres,
                b.volume_litres, b.volume_at, b.volume_by, b.iot_device_ref, b.model, b.serial_no,
                b.compressor_state, b.compressor_state_at, b.compressor_state_by, b.is_active, b.retired_at,
                b.retired_by, b.created_at`;

function toDomain(r: any): BmcUnit {
  return BmcUnit.rehydrate({
    id: r.id, tenantId: r.tenant_id, mccId: r.mcc_id,
    minDeci: Number(scaledFromNumeric(r.min_temp_c, TEMP_SCALE)),
    targetDeci: Number(scaledFromNumeric(r.target_temp_c, TEMP_SCALE)),
    toleranceDeci: Number(scaledFromNumeric(r.tolerance_c, TEMP_SCALE)),
    capacityCenti: scaledFromNumeric(r.capacity_litres, LITRE_SCALE),
    volumeCenti: scaledFromNumericOrNull(r.volume_litres, LITRE_SCALE),
    volumeAt: r.volume_at ?? null, volumeBy: r.volume_by ?? null,
    iotDeviceRef: r.iot_device_ref ?? null, model: r.model ?? null, serialNo: r.serial_no ?? null,
    compressorState: String(r.compressor_state) as CompressorState,
    compressorStateAt: r.compressor_state_at ?? null, compressorStateBy: r.compressor_state_by ?? null,
    isActive: Boolean(r.is_active), retiredAt: r.retired_at ?? null, retiredBy: r.retired_by ?? null,
    createdAt: r.created_at ?? undefined,
  } as BmcUnitProps);
}

/** One cooler as the monitor needs it: the unit, its centre, and its latest reading — in ONE query per page. */
export interface BmcUnitWithReading {
  unit: BmcUnit;
  mccCode: string;
  mccName: string;
  operatorUserId: string | null;
  lastTempDeci: number | null;
  lastAt: Date | null;
  lastIsBreach: boolean | null;
  /** How many of this unit's readings in the window breached, and how many there were at all. */
  breaches24h: number;
  readings24h: number;
}

@Injectable()
export class BmcUnitRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insert(tx: TxContext, u: BmcUnit): Promise<void> {
    const p = u.toProps();
    await tx.query(
      `INSERT INTO bmc_units (id, tenant_id, mcc_id, min_temp_c, target_temp_c, tolerance_c, capacity_litres,
                              iot_device_ref, model, serial_no, compressor_state, is_active, created_by)
       VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7::numeric,$8,$9,$10,$11,true,$12)`,
      [p.id, p.tenantId, p.mccId, numericFromScaled(BigInt(p.minDeci), TEMP_SCALE),
       numericFromScaled(BigInt(p.targetDeci), TEMP_SCALE), numericFromScaled(BigInt(p.toleranceDeci), TEMP_SCALE),
       numericFromScaled(p.capacityCenti, LITRE_SCALE), p.iotDeviceRef, p.model, p.serialNo, p.compressorState,
       p.volumeBy ?? null]);
  }

  /** The writing read: a cooler is small and its acts are rare, so they take the row lock and keep the rules simple. */
  async getForUpdate(tx: TxContext, tenantId: string, id: string): Promise<BmcUnit | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM bmc_units WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL FOR UPDATE`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /**
   * The reading path's lookup: BY SENSOR, because that is all a device knows about itself.
   *
   * Tenant-scoped like everything else, and `is_active` is NOT filtered here — a reading from a retired cooler must be
   * REFUSED with that reason rather than silently ignored, which is how somebody finds out the sensor was never moved.
   */
  async byDeviceRef(tx: SqlExecutor, tenantId: string, deviceRef: string): Promise<BmcUnit | null> {
    const r = await tx.query(
      `SELECT ${COLS} FROM bmc_units WHERE tenant_id=$1 AND iot_device_ref=$2 AND deleted_at IS NULL LIMIT 1`,
      [tenantId, deviceRef]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async byId(x: SqlExecutor, tenantId: string, id: string): Promise<BmcUnit | null> {
    const r = await x.query(`SELECT ${COLS} FROM bmc_units WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`, [id, tenantId]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  /** Every act on a cooler writes the whole mutable set, so a partial update can never leave a stamp without its state. */
  async update(tx: TxContext, u: BmcUnit): Promise<void> {
    const p = u.toProps();
    const res = await tx.query(
      `UPDATE bmc_units SET min_temp_c=$3::numeric, target_temp_c=$4::numeric, tolerance_c=$5::numeric,
              volume_litres=$6::numeric, volume_at=$7, volume_by=$8,
              compressor_state=$9, compressor_state_at=$10, compressor_state_by=$11,
              is_active=$12, retired_at=$13, retired_by=$14, updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [p.id, p.tenantId, numericFromScaled(BigInt(p.minDeci), TEMP_SCALE),
       numericFromScaled(BigInt(p.targetDeci), TEMP_SCALE), numericFromScaled(BigInt(p.toleranceDeci), TEMP_SCALE),
       p.volumeCenti === null ? null : numericFromScaled(p.volumeCenti, LITRE_SCALE), p.volumeAt, p.volumeBy,
       p.compressorState, p.compressorStateAt, p.compressorStateBy,
       p.isActive, p.retiredAt, p.retiredBy]);
    // FAIL CLOSED, the ruling this programme has now made on six tables: a zero-row UPDATE means the row moved under
    // us (retired, soft-deleted, another tenant's) and returning success would publish a state nothing holds.
    if (res.rowCount === 0) throw new Error(`bmc unit ${p.id} was not updated — the row is gone, retired or another tenant's`);
  }

  /**
   * THE MONITOR'S READ: every live cooler with its latest reading and its 24-hour breach count.
   *
   * One query, one LATERAL per unit, ordered by the centre's code so the three tiles W170 draws are stable between
   * refreshes. The breach counts come from `cold_chain_logs` — logistics' table, READ ONLY (the dairy module never
   * writes it directly; that goes through `ColdChainService`, per CLAUDE.md's module rule).
   */
  async monitor(tenantId: string, windowHours: number): Promise<BmcUnitWithReading[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${B_COLS},
              m.code AS mcc_code, m.default_name AS mcc_name, m.operator_user_id,
              l.temp_c AS last_temp_c, l.recorded_at AS last_at, l.is_breach AS last_is_breach,
              coalesce(w.readings, 0)::int AS readings_24h, coalesce(w.breaches, 0)::int AS breaches_24h
         FROM bmc_units b
         JOIN mcc_centres m ON m.id = b.mcc_id AND m.tenant_id = b.tenant_id AND m.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT temp_c, recorded_at, is_breach FROM cold_chain_logs
            WHERE tenant_id = b.tenant_id AND subject_type = 'bmc_unit' AND subject_id = b.id
            ORDER BY recorded_at DESC, id DESC LIMIT 1) l ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS readings, count(*) FILTER (WHERE is_breach)::int AS breaches
             FROM cold_chain_logs
            WHERE tenant_id = b.tenant_id AND subject_type = 'bmc_unit' AND subject_id = b.id
              AND recorded_at >= now() - ($2 || ' hours')::interval) w ON true
        WHERE b.tenant_id = $1 AND b.is_active = true AND b.deleted_at IS NULL
        ORDER BY m.code, b.created_at`, [tenantId, String(windowHours)]);

    return (r.rows as any[]).map((x) => ({
      unit: toDomain(x),
      mccCode: String(x.mcc_code), mccName: String(x.mcc_name), operatorUserId: x.operator_user_id ?? null,
      lastTempDeci: x.last_temp_c == null ? null : Number(scaledFromNumeric(x.last_temp_c, TEMP_SCALE)),
      lastAt: x.last_at ?? null,
      lastIsBreach: x.last_is_breach == null ? null : Boolean(x.last_is_breach),
      readings24h: Number(x.readings_24h ?? 0), breaches24h: Number(x.breaches_24h ?? 0),
    }));
  }

  /**
   * One cooler's readings over a window, oldest first — W170's *"last 6 hours"* chart.
   *
   * Bounded by `limit` and by the window, and ORDERED so a chart cannot draw its own line backwards. Partition pruning
   * comes free: `recorded_at` is the partition key (Law 8).
   */
  /**
   * EVERYTHING THE CALL NEEDS, IN ONE QUERY — PC-56 TENANT-6d-5.
   *
   * The cooler, its centre, its latest reading, and WHO HOLDS CUSTODY of that centre right now, with the holder's name
   * resolved through the same tenancy-checked join TENANT-6d-2 put on the centres board: `users` is platform-wide
   * (0003), so a name is only printed for somebody who holds an active role in THIS cooperative. A holder this
   * platform cannot verify comes back with a null name and the call is still placeable — the provider bridges by id,
   * and a name nothing stands behind is not shown.
   *
   * NO `FOR UPDATE`. Reading who holds a centre must not block a handover being recorded at that centre; and a call is
   * not a state change on the custody row.
   */
  async callContext(x: SqlExecutor, tenantId: string, unitId: string): Promise<{
    unit: BmcUnit; mccCode: string; mccName: string;
    lastTempDeci: number | null; lastAt: Date | null;
    custody: { operatorUserId: string; operatorName: string | null; assignedAt: Date } | null;
  } | null> {
    const r = await x.query(
      `SELECT ${B_COLS},
              m.code AS mcc_code, m.default_name AS mcc_name,
              l.temp_c AS last_temp_c, l.recorded_at AS last_at,
              c.operator_user_id, c.assigned_at, c.operator_name
         FROM bmc_units b
         JOIN mcc_centres m ON m.id = b.mcc_id AND m.tenant_id = b.tenant_id AND m.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT cl.temp_c, cl.recorded_at FROM cold_chain_logs cl
            WHERE cl.tenant_id = b.tenant_id AND cl.subject_type = 'bmc_unit' AND cl.subject_id = b.id
            ORDER BY cl.recorded_at DESC LIMIT 1) l ON true
         LEFT JOIN LATERAL (
           SELECT a.operator_user_id, a.assigned_at,
                  (SELECT u.full_name FROM users u
                    WHERE u.id = a.operator_user_id AND u.deleted_at IS NULL
                      AND EXISTS (SELECT 1 FROM user_tenant_roles utr
                                   WHERE utr.user_id = u.id AND utr.tenant_id = b.tenant_id
                                     AND utr.is_active = true AND utr.deleted_at IS NULL)) AS operator_name
             FROM mcc_operator_assignments a
            WHERE a.tenant_id = b.tenant_id AND a.mcc_id = b.mcc_id
              AND a.ended_at IS NULL AND a.deleted_at IS NULL
            LIMIT 1) c ON true
        WHERE b.tenant_id = $1 AND b.id = $2 AND b.deleted_at IS NULL`, [tenantId, unitId]);
    const row: any = r.rows[0];
    if (!row) return null;
    return {
      unit: toDomain(row), mccCode: String(row.mcc_code), mccName: String(row.mcc_name),
      lastTempDeci: row.last_temp_c === null || row.last_temp_c === undefined
        ? null : Number(scaledFromNumeric(row.last_temp_c, TEMP_SCALE)),
      lastAt: row.last_at ?? null,
      custody: row.operator_user_id
        ? { operatorUserId: String(row.operator_user_id), operatorName: row.operator_name ?? null, assignedAt: row.assigned_at }
        : null,
    };
  }

  async series(tenantId: string, unitId: string, hours: number, limit: number): Promise<Array<{ tempDeci: number; at: Date; isBreach: boolean }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT temp_c, recorded_at, is_breach FROM cold_chain_logs
        WHERE tenant_id = $1 AND subject_type = 'bmc_unit' AND subject_id = $2
          AND recorded_at >= now() - ($3 || ' hours')::interval
        ORDER BY recorded_at, id LIMIT $4`, [tenantId, unitId, String(hours), limit]);
    return (r.rows as any[]).map((x) => ({
      tempDeci: Number(scaledFromNumeric(x.temp_c, TEMP_SCALE)),
      at: x.recorded_at, isBreach: Boolean(x.is_breach),
    }));
  }

  /**
   * The quarter tile: readings and breaches across every live cooler over N days.
   *
   * Counted rather than sampled, and the READING COUNT comes back with it — *"99.2% time in range"* from four readings
   * is not the sentence W170 is making, and only the denominator can say so.
   */
  async windowCounts(tenantId: string, days: number): Promise<{ readings: number; breaches: number; units: number }> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT count(*)::int AS readings,
              count(*) FILTER (WHERE l.is_breach)::int AS breaches,
              count(DISTINCT l.subject_id)::int AS units
         FROM cold_chain_logs l
         JOIN bmc_units b ON b.id = l.subject_id AND b.tenant_id = l.tenant_id AND b.deleted_at IS NULL
        WHERE l.tenant_id = $1 AND l.subject_type = 'bmc_unit'
          AND l.recorded_at >= now() - ($2 || ' days')::interval`, [tenantId, String(days)]);
    const x = (r.rows[0] ?? {}) as any;
    return { readings: Number(x.readings ?? 0), breaches: Number(x.breaches ?? 0), units: Number(x.units ?? 0) };
  }

  /** This tenant's coolers for a centre — used by the register and to refuse a second cooler on one sensor early. */
  async listForTenant(tenantId: string, opts: { mccId?: string; includeRetired?: boolean } = {}): Promise<BmcUnit[]> {
    const params: unknown[] = [tenantId];
    let where = `tenant_id = $1 AND deleted_at IS NULL`;
    if (opts.mccId) { params.push(opts.mccId); where += ` AND mcc_id = $${params.length}`; }
    if (!opts.includeRetired) where += ` AND is_active = true`;
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${COLS} FROM bmc_units WHERE ${where} ORDER BY created_at, id`, params);
    return (r.rows as any[]).map(toDomain);
  }

  /**
   * The two playbook thresholds and the silence window, from the tenant's settings (0162).
   *
   * Refuses rather than defaults, for the reason 6c-5's reader gives: a monitor that invents 7.5°C because a setting
   * is missing would divert 87 families' milk on a number nobody chose.
   */
  async thresholds(x: SqlExecutor, tenantId: string): Promise<{ divertDeci: number; condemnDeci: number; silenceMinutes: number }> {
    const keys = ['dairy.bmc_divert_temp_decic', 'dairy.bmc_condemn_temp_decic', 'dairy.bmc_silence_minutes'];
    const r = await x.query(
      `SELECT d.key, (COALESCE(ts.value, d.default_value) #>> '{}')::int AS v
         FROM setting_definitions d
         LEFT JOIN tenant_settings ts ON ts.key = d.key AND ts.tenant_id = $1
        WHERE d.key = ANY($2::text[])`, [tenantId, keys]);
    const byKey = new Map((r.rows as Array<{ key: string; v: number }>).map((row) => [row.key, Number(row.v)]));
    for (const k of keys) {
      const v = byKey.get(k);
      if (v == null || !Number.isFinite(v) || v < 0) {
        throw new Error(`${k} is missing or out of range for tenant ${tenantId} — refusing to guess the temperature at which a cooperative moves its members' milk`);
      }
    }
    return {
      divertDeci: byKey.get('dairy.bmc_divert_temp_decic') as number,
      condemnDeci: byKey.get('dairy.bmc_condemn_temp_decic') as number,
      silenceMinutes: byKey.get('dairy.bmc_silence_minutes') as number,
    };
  }
}
