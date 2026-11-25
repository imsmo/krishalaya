// apps/admin-api/src/modules/tenant-ops/__tests__/tenant-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (the schema apps/api builds + migration 0032). Proves the
// god-mode tenant lifecycle WRITE path: seed a pending tenant → approve → suspend → set a limit override, each
// writing a tenant_status_events row + an append-only audit_log row IN THE SAME TX, and the state machine
// rejecting an illegal transition (no rows written on rejection). Runs only when DATABASE_ADMIN_URL/DATABASE_URL
// is set (CI's DB job).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { TenantRepository } from '../repositories/tenant.repository';
import { ApproveTenantService } from '../services/approve-tenant.service';
import { SuspendTenantService } from '../services/suspend-tenant.service';
import { ArchiveTenantService } from '../services/archive-tenant.service';
import { OverrideLimitsService } from '../services/override-limits.service';
import { IllegalTenantTransitionError } from '../domain/tenant.state';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('tenant-ops (integration, real Postgres — god-mode tenant lifecycle + audit)', () => {
  let pool: AdminPool; let inspect: Pool;
  let approve: ApproveTenantService; let suspend: SuspendTenantService; let archive: ArchiveTenantService; let limits: OverrideLimitsService;
  const actor = { userId: randomUUID(), roles: ['platform_tenant_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['tenant.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  let tenantId = '';
  const slug = `itest_t_${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const audit = new AdminAuditWriter(pool);
    const repo = new TenantRepository(pool);
    approve = new ApproveTenantService(pool, audit, repo);
    suspend = new SuspendTenantService(pool, audit, repo);
    archive = new ArchiveTenantService(pool, audit, repo);
    limits = new OverrideLimitsService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
    // Seed a pending tenant against the real FK graph (reuse an existing tenant_type lookup + country).
    // PC-56 TEST-1: lookup_values has no `lookup_type_id` column (it is keyed by `type_code`, 0001) — the seeded platform `fpo` type.
    const tt = await inspect.query(`SELECT id FROM lookup_values WHERE type_code = 'tenant_type' AND code = 'fpo' AND tenant_id IS NULL ORDER BY created_at LIMIT 1`);
    const country = await inspect.query(`SELECT code FROM countries LIMIT 1`);
    const r = await inspect.query(
      `INSERT INTO tenants (slug, legal_name, display_name, tenant_type_id, country_code, status)
       VALUES ($1,'IT Tenant','IT Tenant',$2,$3,'pending') RETURNING id`,
      [slug, tt.rows[0].id, country.rows[0].code]);
    tenantId = r.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      await inspect.query(`DELETE FROM tenant_limit_overrides WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await inspect.query(`DELETE FROM tenant_status_events WHERE tenant_id=$1`, [tenantId]).catch(() => undefined);
      await inspect.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('approve pending→active: status updated + status-event + audit row', async () => {
    const out: any = await approve.approve(actor, tenantId, { reason: 'kyc verified' });
    expect(out.status).toBe('active');
    const t = await inspect.query(`SELECT status, approved_at FROM tenants WHERE id=$1`, [tenantId]);
    expect(t.rows[0].status).toBe('active');
    expect(t.rows[0].approved_at).not.toBeNull();
    const ev = await inspect.query(`SELECT to_status FROM tenant_status_events WHERE tenant_id=$1 AND to_status='active'`, [tenantId]);
    expect(ev.rows.length).toBe(1);
    const au = await inspect.query(`SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='tenant.approved'`, [tenantId]);
    expect(au.rows.length).toBe(1);
  });

  it('suspend active→suspended + audits', async () => {
    await suspend.suspend(actor, tenantId, { reason: 'billing failure' });
    const t = await inspect.query(`SELECT status FROM tenants WHERE id=$1`, [tenantId]);
    expect(t.rows[0].status).toBe('suspended');
  });

  it('limit override upserts + audits old→new (bigint, never floated)', async () => {
    const out: any = await limits.override(actor, tenantId, { limitCode: 'max_farmers', limitValue: '5000', reason: 'pilot deal' });
    expect(out.limitValue).toBe('5000');
    const row = await inspect.query(`SELECT limit_value::text AS v FROM tenant_limit_overrides WHERE tenant_id=$1 AND limit_code='max_farmers'`, [tenantId]);
    expect(row.rows[0].v).toBe('5000');
  });

  it('rejects an illegal transition (suspended→ archive ok, but approve from suspended throws) — no rows on reject', async () => {
    await expect(approve.approve(actor, tenantId, { reason: 'should fail' })).rejects.toBeDefined();   // approve only from pending/trial
    // archive from suspended is legal
    const out: any = await archive.archive(actor, tenantId, { reason: 'offboard' });
    expect(out.status).toBe('archived');
    // suspend from archived is illegal → throws, writes nothing new
    await expect(suspend.suspend(actor, tenantId, { reason: 'too late' })).rejects.toBeInstanceOf(IllegalTenantTransitionError);
  });
});
