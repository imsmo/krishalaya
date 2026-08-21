// modules/logistics/repositories/ops-alert.repository.ts · PC-55 A6 (0086). tenant_id in EVERY query (Law 1).
// Evidence comes from the W54-12 read-models (cold_chain_logs, equipment_maintenance_logs) — this repo adds no
// new source of truth, it only reads what was already ledgered and records what fired.
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import { pgDate } from '../../../core/database/pg-date';
// [PC-56 TENANT-6b-1] `date` columns are read through core/database/pg-date. The shape this file used —
// `String(row.some_date).slice(0, 10)` — yields "Mon Jul 13" for the JS Date node-pg hands back for a `date`
// (oid 1082), in EVERY timezone. Verified against the live schema: every column it was applied to here is a
// `date`. `pgDate` returns the calendar day PostgreSQL holds and passes an already-formatted string through.

export interface AlertRule {
  id: string; kind: string; ruleName: string; threshold: Record<string, unknown>; recipientUserIds: string[];
  channelHint: string | null; cooldownMinutes: number; isActive: boolean; lastEvaluatedAt: string | null;
}
const toRule = (x: any): AlertRule => ({
  id: x.id, kind: x.kind, ruleName: x.rule_name, threshold: x.threshold ?? {},
  recipientUserIds: x.recipient_user_ids ?? [], channelHint: x.channel_hint,
  cooldownMinutes: x.cooldown_minutes, isActive: x.is_active,
  lastEvaluatedAt: x.last_evaluated_at ? new Date(x.last_evaluated_at).toISOString() : null,
});

@Injectable()
export class OpsAlertRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  async insertRule(tx: TxContext, r: { id: string; tenantId: string; kind: string; ruleName: string; threshold: Record<string, unknown>; recipientUserIds: string[]; channelHint?: string; cooldownMinutes: number }): Promise<{ ok: true } | { ok: false; conflict: 'duplicate_name' }> {
    try {
      await tx.query(
        `INSERT INTO ops_alert_rules (id, tenant_id, kind, rule_name, threshold, recipient_user_ids, channel_hint, cooldown_minutes)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)`,
        [r.id, r.tenantId, r.kind, r.ruleName, JSON.stringify(r.threshold), JSON.stringify(r.recipientUserIds), r.channelHint ?? null, r.cooldownMinutes]);
      return { ok: true };
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return { ok: false, conflict: 'duplicate_name' };
      throw e;
    }
  }
  async updateRule(tx: TxContext, tenantId: string, id: string, patch: { ruleName?: string; threshold?: Record<string, unknown>; recipientUserIds?: string[]; channelHint?: string | null; cooldownMinutes?: number; isActive?: boolean }): Promise<boolean> {
    const r = await tx.query(
      `UPDATE ops_alert_rules SET rule_name=COALESCE($3,rule_name), threshold=COALESCE($4::jsonb,threshold),
              recipient_user_ids=COALESCE($5::jsonb,recipient_user_ids), channel_hint=COALESCE($6,channel_hint),
              cooldown_minutes=COALESCE($7,cooldown_minutes), is_active=COALESCE($8,is_active), version=version+1
        WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [id, tenantId, patch.ruleName ?? null, patch.threshold ? JSON.stringify(patch.threshold) : null,
       patch.recipientUserIds ? JSON.stringify(patch.recipientUserIds) : null, patch.channelHint ?? null,
       patch.cooldownMinutes ?? null, patch.isActive ?? null]);
    return (r.rowCount ?? 0) > 0;
  }
  async listRules(tenantId: string, q: { kind?: string; activeOnly?: boolean } = {}): Promise<AlertRule[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT * FROM ops_alert_rules WHERE tenant_id=$1 AND deleted_at IS NULL
          AND ($2::text IS NULL OR kind=$2) AND ($3 = false OR is_active = true)
        ORDER BY created_at DESC LIMIT 200`, [tenantId, q.kind ?? null, q.activeOnly ?? false]);
    return r.rows.map(toRule);
  }
  /** Cross-tenant read for the evaluator job (it holds the runner's pool and iterates tenants itself). */
  async activeRulesForTenant(tenantId: string): Promise<AlertRule[]> { return this.listRules(tenantId, { activeOnly: true }); }
  async touchEvaluated(tx: TxContext, tenantId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.query(`UPDATE ops_alert_rules SET last_evaluated_at = now() WHERE tenant_id=$1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
  }

  // ===== evidence (from the W54-12 ledgered read-models; no new source of truth) =====
  async coldChainBreachCounts(tenantId: string, windowHours: number, subjectType?: string): Promise<Array<{ deviceRef: string | null; subjectType: string; subjectId: string; breaches: number; lastTempC: string | null; lastAt: string }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT device_ref, subject_type, subject_id, COUNT(*)::int AS breaches,
              (ARRAY_AGG(temp_c ORDER BY recorded_at DESC))[1]::text AS last_temp_c, MAX(recorded_at) AS last_at
         FROM cold_chain_logs
        WHERE tenant_id=$1 AND is_breach AND recorded_at >= now() - ($2 || ' hours')::interval
          AND ($3::text IS NULL OR subject_type=$3)
        GROUP BY device_ref, subject_type, subject_id ORDER BY breaches DESC LIMIT 200`,
      [tenantId, String(windowHours), subjectType ?? null]);
    return r.rows.map((x: any) => ({ deviceRef: x.device_ref, subjectType: x.subject_type, subjectId: x.subject_id, breaches: x.breaches, lastTempC: x.last_temp_c, lastAt: new Date(x.last_at).toISOString() }));
  }
  /**
   * Sensors that have gone quiet, measured in MINUTES.
   *
   * PC-56 TENANT-6d-5. This query used to floor the gap to whole hours, which is why W170's *"operator called
   * automatically after 15 min silence"* could never fire: a fifteen-minute gap was `silent_hours = 0`, below every
   * legal threshold, and the alert body would have read *"has not reported for ~0h"* even if it had.
   *
   * The 30-day window is unchanged — a sensor nobody has heard from in a month is a decommissioning question, not an
   * alert — and it is deliberately WIDER than the maximum threshold (43,200 minutes = 30 days) rather than derived
   * from it, so the two numbers cannot silently converge into a rule that can never match.
   */
  async silentDevices(tenantId: string, silentMinutes: number): Promise<Array<{ deviceRef: string; lastSeen: string; silentMinutes: number }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT device_ref, MAX(recorded_at) AS last_seen,
              FLOOR(EXTRACT(EPOCH FROM (now() - MAX(recorded_at))) / 60)::int AS silent_minutes
         FROM cold_chain_logs
        WHERE tenant_id=$1 AND device_ref IS NOT NULL AND recorded_at >= now() - interval '30 days'
        GROUP BY device_ref
       HAVING MAX(recorded_at) < now() - ($2 || ' minutes')::interval
        ORDER BY last_seen ASC LIMIT 200`, [tenantId, String(silentMinutes)]);
    return r.rows.map((x: any) => ({ deviceRef: x.device_ref, lastSeen: new Date(x.last_seen).toISOString(), silentMinutes: x.silent_minutes }));
  }
  async maintenanceAlerts(tenantId: string, which: string): Promise<Array<{ assetId: string; alert: string; lastServiceOn: string | null }>> {
    const r = await this.replica.forTenant(tenantId).query(
      `WITH latest AS (
         SELECT DISTINCT ON (asset_id) asset_id, log_type, performed_on FROM equipment_maintenance_logs
          WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY asset_id, performed_on DESC, created_at DESC),
       last_service AS (
         SELECT asset_id, MAX(performed_on) AS on_date FROM equipment_maintenance_logs
          WHERE tenant_id=$1 AND log_type IN ('service','inspection') AND deleted_at IS NULL GROUP BY asset_id)
       SELECT a.id AS asset_id, s.on_date AS last_service_on,
              CASE WHEN l.log_type='breakdown' THEN 'needs_attention'
                   WHEN s.on_date IS NULL OR s.on_date < CURRENT_DATE - 365 THEN 'service_due' END AS alert
         FROM equipment_assets a
         LEFT JOIN latest l ON l.asset_id = a.id
         LEFT JOIN last_service s ON s.asset_id = a.id
        WHERE a.tenant_id=$1 AND a.status != 'retired' AND a.deleted_at IS NULL
          AND (l.log_type='breakdown' OR s.on_date IS NULL OR s.on_date < CURRENT_DATE - 365)
        LIMIT 200`, [tenantId]);
    return r.rows
      .map((x: any) => ({ assetId: x.asset_id, alert: x.alert as string, lastServiceOn: x.last_service_on ? pgDate(x.last_service_on) : null }))
      .filter((x) => which === 'any' || x.alert === which);
  }

  // ===== fired log =====
  /** Returns false when the dedupe key already exists — the DB, not app code, settles the multi-pod race. */
  async recordFired(tx: TxContext, f: { id: string; tenantId: string; ruleId: string; kind: string; severity: string; subjectType: string | null; subjectRef: string | null; detail: Record<string, unknown>; recipients: string[]; dedupeKey: string; notified: boolean }): Promise<boolean> {
    try {
      await tx.query(
        `INSERT INTO ops_fired_alerts (id, tenant_id, rule_id, kind, severity, subject_type, subject_ref, detail, recipients, dedupe_key, notified)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)`,
        [f.id, f.tenantId, f.ruleId, f.kind, f.severity, f.subjectType, f.subjectRef, JSON.stringify(f.detail), JSON.stringify(f.recipients), f.dedupeKey, f.notified]);
      return true;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === '23505') return false;   // cooldown bucket already fired
      throw e;
    }
  }
  async feed(tenantId: string, q: { kind?: string; severity?: string; unacknowledgedOnly?: boolean; limit: number }): Promise<Array<Record<string, unknown>>> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT f.id, f.rule_id, r.rule_name, f.kind, f.severity, f.subject_type, f.subject_ref, f.detail,
              f.recipients, f.notified, f.fired_at, f.acknowledged_at, f.acknowledged_by
         FROM ops_fired_alerts f LEFT JOIN ops_alert_rules r ON r.id = f.rule_id
        WHERE f.tenant_id=$1 AND f.deleted_at IS NULL
          AND ($2::text IS NULL OR f.kind=$2) AND ($3::text IS NULL OR f.severity=$3)
          AND ($4 = false OR f.acknowledged_at IS NULL)
        ORDER BY f.fired_at DESC LIMIT $5`,
      [tenantId, q.kind ?? null, q.severity ?? null, q.unacknowledgedOnly ?? false, Math.min(q.limit, 200)]);
    return r.rows.map((x: any) => ({
      id: x.id, ruleId: x.rule_id, ruleName: x.rule_name, kind: x.kind, severity: x.severity,
      subjectType: x.subject_type, subjectRef: x.subject_ref, detail: x.detail, recipients: x.recipients,
      notified: x.notified, firedAt: new Date(x.fired_at).toISOString(),
      acknowledgedAt: x.acknowledged_at ? new Date(x.acknowledged_at).toISOString() : null, acknowledgedBy: x.acknowledged_by,
    }));
  }
  async acknowledge(tx: TxContext, tenantId: string, id: string, by: string): Promise<boolean> {
    const r = await tx.query(
      `UPDATE ops_fired_alerts SET acknowledged_at=now(), acknowledged_by=$3
        WHERE id=$1 AND tenant_id=$2 AND acknowledged_at IS NULL AND deleted_at IS NULL`, [id, tenantId, by]);
    return (r.rowCount ?? 0) > 0;
  }
}
