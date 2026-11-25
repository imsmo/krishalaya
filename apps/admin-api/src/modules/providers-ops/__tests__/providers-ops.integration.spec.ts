// apps/admin-api/src/modules/providers-ops/__tests__/providers-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (schema apps/api builds + migration 0039). Proves: disable→enable a
// provider (is_active flips, provider_changes timeline, audit_log rows, no-op rejected), and the credential-ref
// HEALTH rollup counts tenant_integrations cross-tenant (kv_admin) while NEVER returning secret_ref. Uses a
// throwaway test provider so seeded PSPs are untouched. Runs only when DATABASE_ADMIN_URL is set (CI's DB job).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { ProvidersRepository } from '../repositories/providers.repository';
import { IntegrationProvidersAdminService } from '../services/integration-providers-admin.service';
import { ProviderSlaMonitorService } from '../services/provider-sla-monitor.service';
import { ProviderAlreadyInStateError } from '../domain/providers-ops.errors';
import { makeTenant } from '../../../../test/integration-fixtures';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('providers-ops (integration, real Postgres — registry toggle + credential health, no secret leak)', () => {
  let pool: AdminPool; let inspect: Pool; let repo: ProvidersRepository;
  let admin: IntegrationProvidersAdminService; let monitor: ProviderSlaMonitorService;
  const actor = { userId: randomUUID(), roles: ['platform_providers_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['providers.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  const code = `itest_prov_${Date.now()}`;
  let tenantId = ''; let integrationId = '';

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    repo = new ProvidersRepository(pool);
    admin = new IntegrationProvidersAdminService(pool, new AdminAuditWriter(pool), repo);
    monitor = new ProviderSlaMonitorService(repo);
    inspect = new Pool({ connectionString: APP_URL });
    // tenant_ownable: 0193 (TENANT-13c) refuses a tenant credential on a platform-managed provider (INTEGRATION_PROVIDER_NOT_OWNABLE),
    // and the credential-health read below needs a tenant to hold one; an ownable provider must name how it is verified (PC-56 TEST-1).
    await inspect.query(`INSERT INTO integration_providers (code, default_name, category, is_active, tenant_ownable, verify_method) VALUES ($1,'ITest provider','sms',true,true,'token_check') ON CONFLICT (code) DO NOTHING`, [code]);
    tenantId = await makeTenant(inspect);   // PC-56 TEST-1: its own tenant (was the first tenant in the database — none on a fresh build)
    const ti = await inspect.query(
      `INSERT INTO tenant_integrations (tenant_id, provider_code, secret_ref, is_active) VALUES ($1,$2,'arn:aws:secretsmanager:itest:SECRET',true)
       ON CONFLICT (tenant_id, provider_code) DO UPDATE SET secret_ref=EXCLUDED.secret_ref RETURNING id`, [tenantId, code]);
    integrationId = ti.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      await inspect.query(`DELETE FROM tenant_integrations WHERE id=$1`, [integrationId]).catch(() => undefined);
      await inspect.query(`DELETE FROM provider_changes WHERE provider_code=$1`, [code]).catch(() => undefined);
      await inspect.query(`DELETE FROM integration_providers WHERE code=$1`, [code]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('disable→enable: is_active flips, change + audit rows; no-op rejected', async () => {
    const off: any = await admin.toggle(actor, code, { action: 'disable', reason: 'itest provider outage' });
    expect(off.isActive).toBe(false);
    let row = await inspect.query(`SELECT is_active FROM integration_providers WHERE code=$1`, [code]);
    expect(row.rows[0].is_active).toBe(false);

    await expect(admin.toggle(actor, code, { action: 'disable', reason: 'again' })).rejects.toBeInstanceOf(ProviderAlreadyInStateError);

    const on: any = await admin.toggle(actor, code, { action: 'enable', reason: 'recovered' });
    expect(on.isActive).toBe(true);
    row = await inspect.query(`SELECT is_active FROM integration_providers WHERE code=$1`, [code]);
    expect(row.rows[0].is_active).toBe(true);

    const ch = await inspect.query(`SELECT count(*)::int AS c FROM provider_changes WHERE provider_code=$1 AND action IN ('enabled','disabled')`, [code]);
    expect(ch.rows[0].c).toBe(2);
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_key=$1 AND entity_id IS NULL AND action LIKE 'providers.%'`, [code]);   // a code, not a uuid (0247)
    expect(au.rows[0].c).toBe(2);
  });

  it('credential-ref health counts the integration cross-tenant; NEVER returns secret_ref', async () => {
    const h = await repo.credentialHealthFor(code);
    expect(h.configuredTenants).toBe(1);
    expect(h.activeTenants).toBe(1);
    expect((h as any).secretRef).toBeUndefined();
    expect((h as any).secret_ref).toBeUndefined();

    const detail: any = await admin.get(code);
    expect(detail.health.configuredTenants).toBe(1);
    expect(JSON.stringify(detail)).not.toContain('arn:aws:secretsmanager');   // the vault ref never leaks

    const roll: any = await monitor.healthRollup();
    const me = roll.items.find((x: any) => x.code === code);
    expect(me.health.configuredTenants).toBe(1);
    expect(JSON.stringify(roll)).not.toContain('secret_ref');
  });
});
