// modules/esg/repositories/esg.repository.ts · PC-56 TENANT-9d · SQL over 0183's method registry (platform rows — read only)
// and the cooperative's disclosures (tenant rows). Every `esg_disclosures` read and write binds its alias to the tenant in
// its own SQL (Law 1: RLS is the net, not the plan — 9b's alias-bound rule, pinned by the unit spec that reads this file).
import { Inject, Injectable } from '@nestjs/common';
import { READ_REPLICA, ReadReplicaProvider } from '../../../core/database/read-replica.provider';
import { TxContext } from '../../../core/database/unit-of-work';
import type { MethodRow, Pillar } from '../domain/esg-rules';

export interface Disclosure {
  id: string; metricCode: string; texts: Record<string, string>; status: 'draft' | 'published' | 'withdrawn';
  createdAt: string; createdBy: string; updatedAt: string; publishedAt: string | null; publishedBy: string | null;
  withdrawnAt: string | null; withdrawnBy: string | null; withdrawReason: string | null;
}
export interface EsgClock { zone: string; today: string; now: string }

const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);
const toMethod = (r: any): MethodRow => ({
  metricCode: r.metric_code, pillar: String(r.pillar).trim() as Pillar, sortOrder: Number(r.sort_order),
  methodStatus: r.method_status, refusalKind: r.refusal_kind ?? null, methodRef: r.method_ref ?? null,
  methodVersion: r.method_version === null || r.method_version === undefined ? null : Number(r.method_version),
  publishedAt: iso(r.published_at), factKind: r.fact_kind, sourceTables: Array.isArray(r.source_tables) ? r.source_tables.map(String) : [],
  freshnessRule: r.freshness_rule, staleAfterDays: r.stale_after_days === null ? null : Number(r.stale_after_days),
  windowDays: r.window_days === null ? null : Number(r.window_days),
});
const toDisclosure = (r: any): Disclosure => ({
  id: r.id, metricCode: r.metric_code, texts: r.texts ?? {}, status: r.status, createdAt: iso(r.created_at) as string, createdBy: r.created_by,
  updatedAt: iso(r.updated_at) as string, publishedAt: iso(r.published_at), publishedBy: r.published_by ?? null,
  withdrawnAt: iso(r.withdrawn_at), withdrawnBy: r.withdrawn_by ?? null, withdrawReason: r.withdraw_reason ?? null,
});
const PILLAR_ORDER = `CASE m.pillar WHEN 'E' THEN 1 WHEN 'S' THEN 2 ELSE 3 END`;
const D_COLS = `d.id, d.metric_code, d.texts, d.status, d.created_at, d.created_by, d.updated_at, d.published_at, d.published_by, d.withdrawn_at, d.withdrawn_by, d.withdraw_reason`;

@Injectable()
export class EsgRepository {
  constructor(@Inject(READ_REPLICA) private readonly replica: ReadReplicaProvider) {}

  /** The registry, in the canon's order (E · S · G). Platform rows: no tenant column, SELECT-only for kv_app (0183). */
  async methods(tenantId: string): Promise<MethodRow[]> {
    const r = await this.replica.forTenant(tenantId).query(`SELECT m.* FROM esg_metric_methods m ORDER BY ${PILLAR_ORDER}, m.sort_order`);
    return r.rows.map(toMethod);
  }

  /** The cooperative's zone and today, as the DATABASE computes them (F-17 — never the process zone). */
  async clockOf(tenantId: string): Promise<EsgClock> {
    const r = await this.replica.forTenant(tenantId).query<{ zone: string; today: string; now: string }>(
      `SELECT c.timezone AS zone, to_char((now() AT TIME ZONE c.timezone)::date, 'YYYY-MM-DD') AS today,
              to_char(now() AT TIME ZONE c.timezone, 'YYYY-MM-DD"T"HH24:MI') AS now
         FROM tenants t JOIN countries c ON c.code = t.country_code WHERE t.id = $1`, [tenantId]);
    if (r.rows[0]) return r.rows[0];
    // A tenant with no country is a corrupt row; UTC is the technical floor (8b's LAST_RESORT_ZONE), said by the zone itself.
    const u = await this.replica.forTenant(tenantId).query<{ today: string; now: string }>(
      `SELECT to_char((now() AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS today, to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI') AS now`);
    return { zone: 'UTC', ...u.rows[0] };
  }

  /** The platform's ACTIVE languages — a disclosure is written in these (data, rule zero). */
  async activeLanguages(tenantId: string): Promise<string[]> {
    const r = await this.replica.forTenant(tenantId).query<{ code: string }>(
      `SELECT code FROM languages WHERE is_active AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x) => x.code);
  }

  async withdrawReasons(tenantId: string): Promise<string[]> {
    const r = await this.replica.forTenant(tenantId).query<{ code: string }>(
      `SELECT code FROM lookup_values WHERE type_code = 'esg_disclosure_withdraw_reason' AND tenant_id IS NULL AND deleted_at IS NULL ORDER BY sort_order, code`);
    return r.rows.map((x) => x.code);
  }

  /** Every disclosure of this cooperative that is not withdrawn, newest first (the dashboard groups them by metric). */
  async liveDisclosures(tenantId: string): Promise<Disclosure[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${D_COLS} FROM esg_disclosures d WHERE d.tenant_id = $1 AND d.status <> 'withdrawn' ORDER BY d.metric_code, d.created_at DESC, d.id DESC`, [tenantId]);
    return r.rows.map(toDisclosure);
  }

  async publishedDisclosures(tenantId: string): Promise<Disclosure[]> {
    const r = await this.replica.forTenant(tenantId).query(
      `SELECT ${D_COLS} FROM esg_disclosures d WHERE d.tenant_id = $1 AND d.status = 'published' ORDER BY d.metric_code`, [tenantId]);
    return r.rows.map(toDisclosure);
  }

  async get(tenantId: string, id: string, tx?: TxContext): Promise<Disclosure | null> {
    const sql = `SELECT ${D_COLS} FROM esg_disclosures d WHERE d.tenant_id = $1 AND d.id = $2${tx ? ' FOR UPDATE' : ''}`;
    const r = tx ? await tx.query(sql, [tenantId, id]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, id]);
    return r.rows[0] ? toDisclosure(r.rows[0]) : null;
  }

  async otherPublished(tenantId: string, metricCode: string, exceptId: string, tx?: TxContext): Promise<boolean> {
    const sql = `SELECT 1 FROM esg_disclosures d WHERE d.tenant_id = $1 AND d.metric_code = $2 AND d.status = 'published' AND d.id <> $3 LIMIT 1`;
    const r = tx ? await tx.query(sql, [tenantId, metricCode, exceptId]) : await this.replica.forTenant(tenantId).query(sql, [tenantId, metricCode, exceptId]);
    return r.rows.length > 0;
  }

  async insert(tx: TxContext, d: { id: string; tenantId: string; metricCode: string; texts: Record<string, string>; userId: string }): Promise<void> {
    await tx.query(`INSERT INTO esg_disclosures (id, tenant_id, metric_code, texts, status, created_by, updated_by) VALUES ($1, $2, $3, $4, 'draft', $5, $5)`,
      [d.id, d.tenantId, d.metricCode, JSON.stringify(d.texts), d.userId]);
  }

  /** Edit a DRAFT's words — the WHERE is the state machine's half here; 0183's guard is the other half (23514). */
  async updateDraft(tx: TxContext, tenantId: string, id: string, texts: Record<string, string>, userId: string): Promise<Disclosure | null> {
    const r = await tx.query(
      `UPDATE esg_disclosures d SET texts = $3, updated_by = $4 WHERE d.tenant_id = $1 AND d.id = $2 AND d.status = 'draft' RETURNING ${D_COLS}`,
      [tenantId, id, JSON.stringify(texts), userId]);
    return r.rows[0] ? toDisclosure(r.rows[0]) : null;
  }

  async publish(tx: TxContext, tenantId: string, id: string, userId: string): Promise<Disclosure | null> {
    const r = await tx.query(
      `UPDATE esg_disclosures d SET status = 'published', published_at = now(), published_by = $3, updated_by = $3
        WHERE d.tenant_id = $1 AND d.id = $2 AND d.status = 'draft' RETURNING ${D_COLS}`, [tenantId, id, userId]);
    return r.rows[0] ? toDisclosure(r.rows[0]) : null;
  }

  async withdraw(tx: TxContext, tenantId: string, id: string, userId: string, reason: string): Promise<Disclosure | null> {
    const r = await tx.query(
      `UPDATE esg_disclosures d SET status = 'withdrawn', withdrawn_at = now(), withdrawn_by = $3, withdraw_reason = $4, updated_by = $3
        WHERE d.tenant_id = $1 AND d.id = $2 AND d.status IN ('draft', 'published') RETURNING ${D_COLS}`, [tenantId, id, userId, reason]);
    return r.rows[0] ? toDisclosure(r.rows[0]) : null;
  }
}
