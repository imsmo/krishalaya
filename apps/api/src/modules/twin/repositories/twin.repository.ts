// modules/twin/repositories/twin.repository.ts · PC-56 TENANT-12 · all SQL for the twin's OWN tables (0190) and the platform
// vocabulary it reads (lookup_values, ai_models, setting_definitions). tenant_id in every tenant query (Law 1) + RLS (0190's
// split). Reads on the replica; writes in the caller's unit of work. Cursors are µs (`shared/pagination/us-keyset`).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { SqlExecutor, TxContext } from '../../../core/database/unit-of-work';
import { KeysetCursor, US_SQL } from '../../../shared/pagination/us-keyset';
import { AssumptionUnit, AssumptionValue, KeyDef, ServingModel, StoredRun, TWIN_MODEL_CODE, TemplateDef } from '../domain/twin-rules';
import { ScenarioStatus } from '../domain/twin-scenario.state';

export interface TwinClock { zone: string; today: string; now: string }
export interface ScenarioRow {
  id: string; name: string; templateCode: string | null; productId: string | null; productName: string | null; status: ScenarioStatus;
  createdBy: string; createdAt: string; updatedAt: string; archivedAt: string | null; archivedBy: string | null; archiveReason: string | null;
  createdUs: string;
}
export interface AssumptionRow extends AssumptionValue { id: string; setBy: string; setAt: string; setByName: string | null }
export interface HistoryRow {
  id: string; key: string; oldValue: string | null; oldCitation: string | null; oldAsOf: string | null;
  newValue: string; newUnit: string; newCitation: string; newAsOf: string; setBy: string; setByName: string | null; setAt: string;
}
export interface RunRow extends StoredRun { id: string; scenarioId: string; refusalCode: string | null; requestedBy: string; createdAt: string; idempotencyKey: string }
export interface DeviceRow {
  id: string; kindCode: string; serial: string; label: string | null; parcelId: string | null; status: 'registered' | 'retired';
  registeredBy: string; registeredAt: string; retiredAt: string | null; retireReason: string | null; lastReadingAt: string | null; createdUs: string;
}

/** "Hetal Ben Admin" → "Hetal A." — the console's short form (first name + last initial); never a phone, never the full name. */
export function shortName(full: string | null | undefined): string | null {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const num = (v: unknown): string | null => (v == null ? null : String(v));

const SCEN_COLS = `s.id, s.name, s.template_code, s.product_id, p.default_name AS product_name, s.status, s.created_by, s.created_at, s.updated_at,
  s.archived_at, s.archived_by, s.archive_reason, ${US_SQL('s.created_at')} AS created_us`;
const toScenario = (r: any): ScenarioRow => ({
  id: r.id, name: r.name, templateCode: r.template_code, productId: r.product_id, productName: r.product_name ?? null, status: r.status,
  createdBy: r.created_by, createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!, archivedAt: iso(r.archived_at), archivedBy: r.archived_by,
  archiveReason: r.archive_reason, createdUs: r.created_us,
});
const DEV_COLS = `id, kind_code, serial, label, parcel_id, status, registered_by, registered_at, retired_at, retire_reason, last_reading_at, ${US_SQL('registered_at')} AS created_us`;
const toDevice = (r: any): DeviceRow => ({
  id: r.id, kindCode: r.kind_code, serial: r.serial, label: r.label, parcelId: r.parcel_id, status: r.status, registeredBy: r.registered_by,
  registeredAt: iso(r.registered_at)!, retiredAt: iso(r.retired_at), retireReason: r.retire_reason, lastReadingAt: iso(r.last_reading_at), createdUs: r.created_us,
});
const RUN_COLS = `id, scenario_id, status, model_code, model_version, input_snapshot_hash, seed::text AS seed, outputs, ai_inference_id::text AS ai_inference_id,
  refusal_code, requested_by, created_at, idempotency_key`;
const toRun = (r: any): RunRow => ({
  id: r.id, scenarioId: r.scenario_id, status: r.status, modelCode: r.model_code, modelVersion: r.model_version, inputSnapshotHash: r.input_snapshot_hash,
  seed: r.seed ?? null, outputs: r.outputs ?? null, aiInferenceId: r.ai_inference_id ?? null, refusalCode: r.refusal_code, requestedBy: r.requested_by,
  createdAt: iso(r.created_at)!, idempotencyKey: r.idempotency_key,
});

@Injectable()
export class TwinRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}
  private on(tenantId: string, tx?: SqlExecutor): SqlExecutor { return tx ?? this.replica.forTenant(tenantId); }

  /* ---------------------------------------------------------------- platform vocabulary + clock + setting + model */

  async catalogue(tenantId: string): Promise<{ keys: KeyDef[]; templates: TemplateDef[]; deviceKinds: string[] }> {
    const r = await this.on(tenantId).query<{ type_code: string; code: string; meta: any }>(
      `SELECT type_code, code, meta FROM lookup_values
        WHERE tenant_id IS NULL AND is_active AND deleted_at IS NULL
          AND type_code IN ('twin_assumption_key', 'twin_scenario_template', 'twin_device_kind')
        ORDER BY type_code, sort_order, code`);
    const keys: KeyDef[] = []; const templates: TemplateDef[] = []; const deviceKinds: string[] = [];
    for (const x of r.rows) {
      if (x.type_code === 'twin_assumption_key') keys.push({ code: x.code, unit: (x.meta?.unit === 'hectare' ? 'hectare' : 'pct') as AssumptionUnit, min: String(x.meta?.min ?? '0'), max: String(x.meta?.max ?? '0') });
      else if (x.type_code === 'twin_scenario_template') templates.push({ code: x.code, keys: Array.isArray(x.meta?.keys) ? x.meta.keys.map(String) : [] });
      else deviceKinds.push(x.code);
    }
    return { keys, templates, deviceKinds };
  }

  async clockOf(tenantId: string): Promise<TwinClock> {
    const r = await this.on(tenantId).query<TwinClock>(
      `SELECT c.timezone AS zone, to_char((now() AT TIME ZONE c.timezone)::date, 'YYYY-MM-DD') AS today,
              to_char(now() AT TIME ZONE c.timezone, 'YYYY-MM-DD"T"HH24:MI') AS now
         FROM tenants t JOIN countries c ON c.code = t.country_code WHERE t.id = $1`, [tenantId]);
    if (r.rows[0]) return r.rows[0];
    const u = await this.on(tenantId).query<{ today: string; now: string }>(
      `SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS now`);
    return { zone: 'UTC', ...u.rows[0] };
  }

  /** `twin.min_group_size` — the platform value, else the shipped default (0190); never below 2 (a "group" of one is a person). */
  async minGroupSize(tenantId: string): Promise<number> {
    const r = await this.on(tenantId).query<{ value: unknown }>(
      `SELECT COALESCE(v.value, d.default_value) AS value FROM setting_definitions d
         LEFT JOIN platform_setting_values v ON v.key = d.key AND v.deleted_at IS NULL WHERE d.key = 'twin.min_group_size'`);
    const n = Number(r.rows[0]?.value);
    return Number.isInteger(n) && n >= 2 ? n : 5;
  }

  /** The model a run would pin: registered under TWIN_MODEL_CODE at production / canary. NONE exists today. */
  async servingModel(tenantId: string, tx?: SqlExecutor): Promise<ServingModel | null> {
    const r = await this.on(tenantId, tx).query<{ id: string; code: string; version: string; status: string }>(
      `SELECT id, code, version, status FROM ai_models WHERE code = $1 AND status IN ('production','canary') AND deleted_at IS NULL
        ORDER BY (status = 'production') DESC, created_at DESC LIMIT 1`, [TWIN_MODEL_CODE]);
    return r.rows[0] ?? null;
  }

  async productKnown(tenantId: string, productId: string, tx?: SqlExecutor): Promise<boolean> {
    const r = await this.on(tenantId, tx).query(`SELECT 1 FROM products WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2) AND is_active AND deleted_at IS NULL`, [productId, tenantId]);
    return r.rows.length > 0;
  }

  async shortNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
    const uniq = Array.from(new Set(ids.filter(Boolean)));
    if (uniq.length === 0) return new Map();
    const r = await this.on(tenantId).query<{ id: string; full_name: string | null }>(`SELECT id, full_name FROM users WHERE id = ANY($1::uuid[])`, [uniq]);
    const out = new Map<string, string>();
    for (const x of r.rows) { const n = shortName(x.full_name); if (n) out.set(x.id, n); }
    return out;
  }

  /* ---------------------------------------------------------------- scenarios */

  async listScenarios(tenantId: string, q: { status?: ScenarioStatus; cursor?: KeysetCursor; limit: number }): Promise<ScenarioRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `s.tenant_id = $1`;
    if (q.status) where += ` AND s.status = ${p(q.status)}`;
    if (q.cursor) { const c = p(q.cursor.ts), i = p(q.cursor.id); where += ` AND (s.created_at, s.id) < (${c}::timestamptz, ${i}::uuid)`; }
    const lim = p(q.limit);
    const r = await this.on(tenantId).query(`SELECT ${SCEN_COLS} FROM twin_scenarios s LEFT JOIN products p ON p.id = s.product_id WHERE ${where} ORDER BY s.created_at DESC, s.id DESC LIMIT ${lim}`, params);
    return r.rows.map(toScenario);
  }
  async countScenarios(tenantId: string): Promise<Record<ScenarioStatus, number>> {
    const r = await this.on(tenantId).query<{ status: ScenarioStatus; n: number }>(`SELECT status, count(*)::int AS n FROM twin_scenarios WHERE tenant_id = $1 GROUP BY status`, [tenantId]);
    const out: Record<ScenarioStatus, number> = { draft: 0, ready: 0, archived: 0 };
    for (const x of r.rows) out[x.status] = x.n;
    return out;
  }
  async getScenario(tenantId: string, id: string, tx?: SqlExecutor, lock = false): Promise<ScenarioRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${SCEN_COLS} FROM twin_scenarios s LEFT JOIN products p ON p.id = s.product_id WHERE s.id = $1 AND s.tenant_id = $2${lock ? ' FOR UPDATE OF s' : ''}`, [id, tenantId]);
    return r.rows[0] ? toScenario(r.rows[0]) : null;
  }
  async insertScenario(tx: TxContext, s: { id: string; tenantId: string; name: string; templateCode: string | null; productId: string | null; userId: string }): Promise<void> {
    await tx.query(`INSERT INTO twin_scenarios (id, tenant_id, name, template_code, product_id, status, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,'draft',$6,$6)`,
      [s.id, s.tenantId, s.name, s.templateCode, s.productId, s.userId]);
  }
  async setStatus(tx: TxContext, tenantId: string, id: string, status: ScenarioStatus, userId: string): Promise<void> {
    await tx.query(`UPDATE twin_scenarios SET status = $3, updated_at = now(), updated_by = $4 WHERE id = $1 AND tenant_id = $2`, [id, tenantId, status, userId]);
  }
  async archive(tx: TxContext, tenantId: string, id: string, userId: string, reason: string): Promise<void> {
    await tx.query(`UPDATE twin_scenarios SET status = 'archived', archived_at = now(), archived_by = $3, archive_reason = $4, updated_at = now(), updated_by = $3
                     WHERE id = $1 AND tenant_id = $2 AND status <> 'archived'`, [id, tenantId, userId, reason]);
  }

  /* ---------------------------------------------------------------- assumptions */

  async assumptions(tenantId: string, scenarioId: string, tx?: SqlExecutor): Promise<AssumptionRow[]> {
    const r = await this.on(tenantId, tx).query(
      `SELECT a.id, a.key_code, a.value::text AS value, a.unit_code, a.source_citation, to_char(a.source_asof, 'YYYY-MM-DD') AS asof, a.set_by, a.set_at, u.full_name
         FROM twin_assumptions a LEFT JOIN users u ON u.id = a.set_by
        WHERE a.tenant_id = $1 AND a.scenario_id = $2 ORDER BY a.key_code`, [tenantId, scenarioId]);
    return r.rows.map((x: any) => ({ id: x.id, key: x.key_code, value: x.value, unit: x.unit_code, citation: x.source_citation, asOf: x.asof,
      setBy: x.set_by, setAt: iso(x.set_at)!, setByName: shortName(x.full_name) }));
  }
  async upsertAssumption(tx: TxContext, a: { tenantId: string; scenarioId: string; key: string; value: string; unit: string; citation: string; asOf: string; userId: string }): Promise<void> {
    await tx.query(
      `INSERT INTO twin_assumptions (tenant_id, scenario_id, key_code, value, unit_code, source_citation, source_asof, set_by, set_at)
       VALUES ($1,$2,$3,$4::numeric,$5,$6,$7::date,$8, now())
       ON CONFLICT (scenario_id, key_code) DO UPDATE SET value = EXCLUDED.value, unit_code = EXCLUDED.unit_code, source_citation = EXCLUDED.source_citation,
              source_asof = EXCLUDED.source_asof, set_by = EXCLUDED.set_by, set_at = now()`,
      [a.tenantId, a.scenarioId, a.key, a.value, a.unit, a.citation, a.asOf, a.userId]);
  }
  async history(tenantId: string, scenarioId: string, limit = 100): Promise<HistoryRow[]> {
    const r = await this.on(tenantId).query(
      `SELECT h.id, h.key_code, h.old_value::text AS old_value, h.old_citation, to_char(h.old_asof, 'YYYY-MM-DD') AS old_asof, h.new_value::text AS new_value,
              h.new_unit_code, h.new_citation, to_char(h.new_asof, 'YYYY-MM-DD') AS new_asof, h.set_by, h.set_at, u.full_name
         FROM twin_assumption_history h LEFT JOIN users u ON u.id = h.set_by
        WHERE h.tenant_id = $1 AND h.scenario_id = $2 ORDER BY h.set_at DESC, h.id DESC LIMIT $3`, [tenantId, scenarioId, limit]);
    return r.rows.map((x: any) => ({ id: x.id, key: x.key_code, oldValue: num(x.old_value), oldCitation: x.old_citation, oldAsOf: x.old_asof, newValue: x.new_value,
      newUnit: x.new_unit_code, newCitation: x.new_citation, newAsOf: x.new_asof, setBy: x.set_by, setByName: shortName(x.full_name), setAt: iso(x.set_at)! }));
  }

  /* ---------------------------------------------------------------- runs (the gate's record) */

  async runs(tenantId: string, scenarioIds: string[], tx?: SqlExecutor): Promise<RunRow[]> {
    if (scenarioIds.length === 0) return [];
    const r = await this.on(tenantId, tx).query(`SELECT ${RUN_COLS} FROM twin_runs WHERE tenant_id = $1 AND scenario_id = ANY($2::uuid[]) ORDER BY created_at DESC, id DESC LIMIT 500`, [tenantId, scenarioIds]);
    return r.rows.map(toRun);
  }
  async runByKey(tx: TxContext, tenantId: string, userId: string, key: string): Promise<RunRow | null> {
    const r = await tx.query(`SELECT ${RUN_COLS} FROM twin_runs WHERE tenant_id = $1 AND requested_by = $2 AND idempotency_key = $3`, [tenantId, userId, key]);
    return r.rows[0] ? toRun(r.rows[0]) : null;
  }
  /** The ONLY run row this wave writes: a refusal. 0190's CHECKs refuse outputs / an inference / a seed on it. */
  async insertRefusedRun(tx: TxContext, r: { id: string; tenantId: string; scenarioId: string; hash: string; snapshot: unknown; userId: string; code: string; key: string;
    modelCode: string | null; modelVersion: string | null; modelId: string | null }): Promise<void> {
    await tx.query(
      `INSERT INTO twin_runs (id, tenant_id, scenario_id, status, model_code, model_version, model_id, input_snapshot_hash, assumption_snapshot, requested_by, refusal_code, idempotency_key)
       VALUES ($1,$2,$3,'refused',$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [r.id, r.tenantId, r.scenarioId, r.modelCode, r.modelVersion, r.modelId, r.hash, JSON.stringify(r.snapshot), r.userId, r.code, r.key]);
  }

  /* ---------------------------------------------------------------- devices (registry only) */

  async listDevices(tenantId: string, q: { kind?: string; cursor?: KeysetCursor; limit: number }): Promise<DeviceRow[]> {
    const params: unknown[] = [tenantId];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = `tenant_id = $1`;
    if (q.kind) where += ` AND kind_code = ${p(q.kind)}`;
    if (q.cursor) { const c = p(q.cursor.ts), i = p(q.cursor.id); where += ` AND (registered_at, id) < (${c}::timestamptz, ${i}::uuid)`; }
    const lim = p(q.limit);
    const r = await this.on(tenantId).query(`SELECT ${DEV_COLS} FROM twin_devices WHERE ${where} ORDER BY registered_at DESC, id DESC LIMIT ${lim}`, params);
    return r.rows.map(toDevice);
  }
  async getDevice(tenantId: string, id: string, tx?: SqlExecutor, lock = false): Promise<DeviceRow | null> {
    const r = await this.on(tenantId, tx).query(`SELECT ${DEV_COLS} FROM twin_devices WHERE id = $1 AND tenant_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, tenantId]);
    return r.rows[0] ? toDevice(r.rows[0]) : null;
  }
  async parcelOfTenant(tx: TxContext, tenantId: string, parcelId: string): Promise<boolean> {
    const r = await tx.query(`SELECT 1 FROM land_parcels WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`, [parcelId, tenantId]);
    return r.rows.length > 0;
  }
  async insertDevice(tx: TxContext, d: { id: string; tenantId: string; kind: string; serial: string; label: string | null; parcelId: string | null; userId: string }): Promise<void> {
    await tx.query(`INSERT INTO twin_devices (id, tenant_id, kind_code, serial, label, parcel_id, registered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [d.id, d.tenantId, d.kind, d.serial, d.label, d.parcelId, d.userId]);
  }
  async retireDevice(tx: TxContext, tenantId: string, id: string, userId: string, reason: string): Promise<void> {
    await tx.query(`UPDATE twin_devices SET status = 'retired', retired_by = $3, retired_at = now(), retire_reason = $4, updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'registered'`,
      [id, tenantId, userId, reason]);
  }

  /* ---------------------------------------------------------------- the one access request */

  async accessRequest(tenantId: string, tx?: SqlExecutor): Promise<{ id: string; requestedBy: string; requestedAt: string } | null> {
    const r = await this.on(tenantId, tx).query(`SELECT id, requested_by, requested_at FROM twin_access_requests WHERE tenant_id = $1`, [tenantId]);
    return r.rows[0] ? { id: r.rows[0].id, requestedBy: r.rows[0].requested_by, requestedAt: iso(r.rows[0].requested_at)! } : null;
  }
  /** ON CONFLICT (tenant) DO NOTHING — asking twice is one row (F-15). Returns whether THIS call wrote it. */
  async insertAccessRequest(tx: TxContext, tenantId: string, id: string, userId: string): Promise<boolean> {
    const r = await tx.query(`INSERT INTO twin_access_requests (id, tenant_id, requested_by) VALUES ($1,$2,$3) ON CONFLICT (tenant_id) DO NOTHING RETURNING id`, [id, tenantId, userId]);
    return (r.rowCount ?? r.rows.length) > 0;
  }
}
