// apps/admin-api/src/modules/tenant-ops/repositories/tenant.repository.ts · ALL SQL for god-mode tenant ops.
// The god-mode plane operates platform-wide (no tenant_id scoping on reads — that's the POINT of admin-api,
// Law 11), but EVERY query is parameterised, bounded, and every WRITE runs in the caller's tx (PoolClient) and
// is audited. Tenant rows have no version column → mutations lock FOR UPDATE. Keyset pagination (never OFFSET).
import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { AdminPool } from '../../../core/database/admin-pool';
import { Tenant } from '../domain/tenant.entity';
import { TenantStatus } from '../domain/tenant.state';

function toDomain(r: any): Tenant {
  return Tenant.rehydrate({ id: r.id, slug: r.slug, status: r.status as TenantStatus, riskScore: Number(r.risk_score ?? 0), approvedAt: r.approved_at ?? null, createdAt: r.created_at ?? null });
}

export interface TenantSearchQuery { q?: string; status?: TenantStatus; riskMin?: number; cursor?: { c: string; id: string }; limit: number; }
export interface TenantScorecard {
  tenant: ReturnType<Tenant['toJSON']>;
  subscription: { planId: string; status: string; priceMinor: string; currency: string; periodEnd: string } | null;
  liveListings: number;
  openDisputes: number;
  limitOverrides: { limitCode: string; limitValue: string; expiresAt: string | null }[];
}

@Injectable()
export class TenantRepository {
  constructor(private readonly pool: AdminPool) {}

  async getForUpdate(client: PoolClient, id: string): Promise<Tenant | null> {
    const r = await client.query(`SELECT id, slug, status, risk_score, approved_at FROM tenants WHERE id=$1 FOR UPDATE`, [id]);
    return r.rows[0] ? toDomain(r.rows[0]) : null;
  }

  async updateStatus(client: PoolClient, id: string, status: TenantStatus, actorUserId: string, approvedAt: Date | null): Promise<void> {
    await client.query(
      `UPDATE tenants SET status=$2, approved_at=COALESCE($3, approved_at), updated_by=$4, updated_at=now() WHERE id=$1`,
      [id, status, approvedAt, actorUserId],
    );
  }

  /** Append the lifecycle audit row (PRD §5.5 tenant_status_events) IN THE SAME TX as the status change. */
  async insertStatusEvent(client: PoolClient, id: string, from: TenantStatus, to: TenantStatus, reason: string, actorUserId: string): Promise<void> {
    await client.query(
      `INSERT INTO tenant_status_events (tenant_id, from_status, to_status, reason, actor_user_id) VALUES ($1,$2,$3,$4,$5)`,
      [id, from, to, reason, actorUserId],
    );
  }

  /** Upsert a per-tenant numeric limit override (idempotent on (tenant_id, limit_code)). Runs in the caller tx. */
  async upsertLimitOverride(client: PoolClient, tenantId: string, limitCode: string, limitValue: string, reason: string, expiresAt: string | null, actorUserId: string): Promise<{ previous: string | null }> {
    const prev = await client.query(`SELECT limit_value FROM tenant_limit_overrides WHERE tenant_id=$1 AND limit_code=$2`, [tenantId, limitCode]);
    await client.query(
      `INSERT INTO tenant_limit_overrides (tenant_id, limit_code, limit_value, reason, expires_at, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (tenant_id, limit_code) DO UPDATE
         SET limit_value=EXCLUDED.limit_value, reason=EXCLUDED.reason, expires_at=EXCLUDED.expires_at,
             updated_by=EXCLUDED.updated_by, updated_at=now(), deleted_at=NULL`,
      [tenantId, limitCode, limitValue, reason, expiresAt, actorUserId],
    );
    return { previous: prev.rows[0]?.limit_value != null ? String(prev.rows[0].limit_value) : null };
  }

  async exists(id: string): Promise<boolean> {
    const r = await this.pool.query(`SELECT 1 FROM tenants WHERE id=$1`, [id]);
    return (r.rowCount ?? 0) > 0;
  }

  /** Keyset search over tenants (read on the admin pool). Bounded LIMIT; never OFFSET. */
  async search(q: TenantSearchQuery): Promise<Tenant[]> {
    const params: unknown[] = [];
    const p = (v: unknown) => { params.push(v); return `$${params.length}`; };
    let where = '1=1';
    if (q.q) where += ` AND (slug ILIKE ${p(q.q + '%')} OR display_name ILIKE ${p(q.q + '%')})`;
    if (q.status) where += ` AND status=${p(q.status)}`;
    if (typeof q.riskMin === 'number') where += ` AND risk_score >= ${p(q.riskMin)}`;
    if (q.cursor) { const cc = p(q.cursor.c), ci = p(q.cursor.id); where += ` AND (created_at < ${cc} OR (created_at=${cc} AND id < ${ci}))`; }
    const lp = p(q.limit);
    const r = await this.pool.query(
      `SELECT id, slug, status, risk_score, approved_at, created_at FROM tenants WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${lp}`,
      params,
    );
    return r.rows.map(toDomain);
  }

  /** Read-only scorecard rollup for one tenant (admin pool). Batched single-row aggregates — no N+1. */
  async scorecard(id: string): Promise<TenantScorecard | null> {
    const t = await this.pool.query(`SELECT id, slug, status, risk_score, approved_at FROM tenants WHERE id=$1`, [id]);
    if (!t.rows[0]) return null;
    const sub = await this.pool.query(
      `SELECT plan_id::text AS plan_id, status, price_minor::text AS price_minor, currency_code, current_period_end::text AS period_end
         FROM subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]);
    const listings = await this.pool.query(`SELECT count(*)::int AS n FROM listings WHERE tenant_id=$1 AND status='active'`, [id]).catch(() => ({ rows: [{ n: 0 }] }));
    const disputes = await this.pool.query(`SELECT count(*)::int AS n FROM disputes WHERE tenant_id=$1 AND status NOT IN ('resolved','closed','rejected','withdrawn')`, [id]).catch(() => ({ rows: [{ n: 0 }] }));
    const overrides = await this.pool.query(`SELECT limit_code, limit_value::text AS limit_value, expires_at FROM tenant_limit_overrides WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY limit_code`, [id]).catch(() => ({ rows: [] as any[] }));
    return {
      tenant: toDomain(t.rows[0]).toJSON(),
      subscription: sub.rows[0] ? { planId: sub.rows[0].plan_id, status: sub.rows[0].status, priceMinor: sub.rows[0].price_minor, currency: sub.rows[0].currency_code, periodEnd: sub.rows[0].period_end } : null,
      liveListings: listings.rows[0]?.n ?? 0,
      openDisputes: disputes.rows[0]?.n ?? 0,
      limitOverrides: overrides.rows.map((o: any) => ({ limitCode: o.limit_code, limitValue: String(o.limit_value), expiresAt: o.expires_at ?? null })),
    };
  }
}
