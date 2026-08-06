// apps/admin-api/src/modules/cells-ops/__tests__/cells-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (schema apps/api builds + migration 0043). Proves the routing-
// directory write paths: register two cells in the SAME country + a shard each, place a tenant, MOVE it within the
// country (allowed), attempt a CROSS-RESIDENCY move to a different-country cell (blocked, DPDP), then remove —
// asserting placed_count bookkeeping on cells/shards, the cell_map_changes timeline, and the audit_log rows. All
// tables are GLOBAL/god-mode (no tenant_id ⇒ no RLS — kv_admin-only). Runs only when DATABASE_ADMIN_URL is set.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { CellsRepository } from '../repositories/cells.repository';
import { CellRegistryService } from '../services/cell-registry.service';
import { TenantCellAssignmentService } from '../services/tenant-cell-assignment.service';
import { ResidencyViolationError } from '../domain/cells-ops.errors';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('cells-ops (integration, real Postgres — cell/shard registry + placement + residency + audit)', () => {
  let pool: AdminPool; let inspect: Pool; let registry: CellRegistryService; let assign: TenantCellAssignmentService;
  const actor = { userId: randomUUID(), roles: ['platform_cells_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['cells.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  const tag = Date.now().toString(36).slice(-6);
  const tenantId = randomUUID();
  let countryA = 'IN'; let countryB: string | null = null;
  const ids: { cellA1?: string; cellA2?: string; cellB?: string; shardA1?: string; shardA2?: string; shardB?: string } = {};

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const repo = new CellsRepository(pool); const audit = new AdminAuditWriter(pool);
    registry = new CellRegistryService(pool, audit, repo);
    assign = new TenantCellAssignmentService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
    const cc = await inspect.query(`SELECT code FROM countries ORDER BY code LIMIT 5`);
    const codes: string[] = cc.rows.map((r: any) => r.code);
    if (codes.length) countryA = codes.includes('IN') ? 'IN' : codes[0];
    countryB = codes.find((c) => c !== countryA) ?? null;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      await inspect.query(`DELETE FROM cell_map_changes WHERE entity_id=$1`, [tenantId]).catch(() => undefined);
      for (const id of Object.values(ids)) if (id) await inspect.query(`DELETE FROM cell_map_changes WHERE entity_id=$1`, [id]).catch(() => undefined);
      await inspect.query(`DELETE FROM tenant_placements WHERE placed_tenant_id=$1`, [tenantId]).catch(() => undefined);
      for (const id of [ids.shardA1, ids.shardA2, ids.shardB]) if (id) await inspect.query(`DELETE FROM shards WHERE id=$1`, [id]).catch(() => undefined);
      for (const id of [ids.cellA1, ids.cellA2, ids.cellB]) if (id) await inspect.query(`DELETE FROM cells WHERE id=$1`, [id]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('register cells/shards → place → move (same country) → cross-residency blocked → remove', async () => {
    const a1: any = await registry.createCell(actor, { code: `c-${tag}-a1`, displayName: 'A1', countryCode: countryA, isDefault: false, residencyLocked: true, capacityTenants: null, notes: null, reason: 'cell' });
    const a2: any = await registry.createCell(actor, { code: `c-${tag}-a2`, displayName: 'A2', countryCode: countryA, isDefault: false, residencyLocked: true, capacityTenants: null, notes: null, reason: 'cell' });
    ids.cellA1 = a1.id; ids.cellA2 = a2.id;
    const s1: any = await registry.createShard(actor, { cellId: a1.id, shardIndex: 0, weight: 100, dsnSecretRef: 'vault/shards/a1-0', notes: null, reason: 'shard' });
    const s2: any = await registry.createShard(actor, { cellId: a2.id, shardIndex: 0, weight: 100, dsnSecretRef: null, notes: null, reason: 'shard' });
    ids.shardA1 = s1.id; ids.shardA2 = s2.id;
    expect(s1.hasDsn).toBe(true);     // a DSN was set but the value is never returned

    await assign.place(actor, { tenantId, cellId: a1.id, shardId: s1.id, pinned: false, reason: 'onboard' });
    const row = await inspect.query(`SELECT placed_count FROM cells WHERE id=$1`, [a1.id]);
    expect(row.rows[0].placed_count).toBe(1);

    // move within the same country → allowed; counters shift
    await assign.move(actor, tenantId, { cellId: a2.id, shardId: s2.id, reason: 'rebalance' });
    const place = await inspect.query(`SELECT cell_id, shard_id FROM tenant_placements WHERE placed_tenant_id=$1`, [tenantId]);
    expect(place.rows[0].cell_id).toBe(a2.id);
    expect((await inspect.query(`SELECT placed_count FROM cells WHERE id=$1`, [a1.id])).rows[0].placed_count).toBe(0);
    expect((await inspect.query(`SELECT placed_count FROM cells WHERE id=$1`, [a2.id])).rows[0].placed_count).toBe(1);

    // cross-residency move is blocked (DPDP) when a second country exists
    if (countryB) {
      const b: any = await registry.createCell(actor, { code: `c-${tag}-b`, displayName: 'B', countryCode: countryB, isDefault: false, residencyLocked: true, capacityTenants: null, notes: null, reason: 'cell' });
      const sb: any = await registry.createShard(actor, { cellId: b.id, shardIndex: 0, weight: 100, dsnSecretRef: null, notes: null, reason: 'shard' });
      ids.cellB = b.id; ids.shardB = sb.id;
      await expect(assign.move(actor, tenantId, { cellId: b.id, shardId: sb.id, reason: 'illegal cross-border' })).rejects.toBeInstanceOf(ResidencyViolationError);
      // still in cell A2 (the blocked move wrote nothing)
      expect((await inspect.query(`SELECT cell_id FROM tenant_placements WHERE placed_tenant_id=$1`, [tenantId])).rows[0].cell_id).toBe(a2.id);
    }

    await assign.remove(actor, tenantId, { reason: 'offboard' });
    expect((await inspect.query(`SELECT deleted_at FROM tenant_placements WHERE placed_tenant_id=$1`, [tenantId])).rows[0].deleted_at).not.toBeNull();
    expect((await inspect.query(`SELECT placed_count FROM cells WHERE id=$1`, [a2.id])).rows[0].placed_count).toBe(0);

    const ch = await inspect.query(`SELECT count(*)::int AS c FROM cell_map_changes WHERE entity_id=$1 AND action IN ('placed','moved','removed')`, [tenantId]);
    expect(ch.rows[0].c).toBe(3);
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action LIKE 'cells.placement.%'`, [tenantId]);
    expect(au.rows[0].c).toBe(3);
  });
});
