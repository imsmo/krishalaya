// modules/tenancy/__tests__/tenant-self-serve.integration.spec.ts
// REAL Postgres proof of API-W3-05 (the in-tenant self-serve plane). Proves:
//   1. a tenant admin reads + edits its OWN tenant profile (UPDATE touches only profile columns; status untouched)
//      with an outbox event + audit row written in the same tx;
//   2. a tenant-scoped setting upserts + is type-checked; a PLATFORM-scoped setting is REFUSED (Law 11);
//   3. a custom domain is added (TLS pending), verified (platform path), then made primary;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's domain.
// Provisions a full tenants row directly (0002 columns) — provisioning itself is god-mode, not part of this plane.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';

import { TenantRepository } from '../repositories/tenant.repository';
import { TenantDomainRepository } from '../repositories/tenant-domain.repository';
import { TenantSettingsRepository } from '../repositories/tenant-settings.repository';
import { TenantFeatureRepository } from '../repositories/tenant-feature.repository';
import { UsageCounterRepository } from '../repositories/usage-counter.repository';
import { TenantService } from '../services/tenant.service';
import { TenantDomainService } from '../services/tenant-domain.service';
import { SettingNotTenantScopedError, TenantForbiddenError } from '../domain/tenancy.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('tenancy self-serve (integration, real Postgres + RLS + Law 11)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let tenants: TenantService; let domains: TenantDomainService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const adminUser = randomUUID();
  const manager = () => ({ userId: adminUser, canManage: true });
  const key = () => randomUUID();
  let domainId = '';

  // provision a full tenants profile row for `id` (god-mode in real life; done directly here for the test)
  async function provisionTenant(id: string, slug: string) {
    await admin.query(`INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES ('tenant_type','Tenant Type', false) ON CONFLICT (code) DO NOTHING`);
    const lt = await admin.query(`INSERT INTO lookup_values (type_code, tenant_id, code, default_name) VALUES ('tenant_type', NULL, 'fpo', 'FPO') ON CONFLICT (type_code, tenant_id, code) DO UPDATE SET default_name=EXCLUDED.default_name RETURNING id`);
    const typeId = lt.rows[0].id;
    // [PC-56 TENANT-6d-7] **THIS SUITE HAS BEEN RED SINCE `countries.currency_code` WAS MADE NOT NULL (0001).**
    // `INSERT ... ON CONFLICT DO NOTHING` still checks NOT NULL on the proposed tuple BEFORE it looks for a conflict, so
    // this fixture threw on every run whether or not 'IN' already existed — and 'IN' always does, because core/0002
    // seeds it. Found while widening a dairy wave's live pattern to `tenancy`; the columns are supplied rather than the
    // insert removed, so the fixture still says what it depends on.
    await admin.query(
      `INSERT INTO countries (code, default_name, currency_code, phone_prefix) VALUES ('IN','India','INR','+91')
       ON CONFLICT (code) DO NOTHING`);
    await admin.query(
      `INSERT INTO tenants (id, slug, legal_name, display_name, tenant_type_id, country_code, status)
       VALUES ($1,$2,$3,$4,$5,'IN','active') ON CONFLICT (id) DO NOTHING`,
      [id, slug, `${slug} Legal`, slug, typeId]);
  }

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await provisionTenant(tenantA, 'acme'); await provisionTenant(tenantB, 'globex');
    await makeUser(admin, adminUser);
    // a tenant-scoped + a platform-scoped setting definition
    await admin.query(`INSERT INTO setting_definitions (key, value_type, default_value, scope, description) VALUES ('order.auto_confirm_hours','int','24'::jsonb,'tenant','') ON CONFLICT (key) DO NOTHING`);
    await admin.query(`INSERT INTO setting_definitions (key, value_type, default_value, scope, description) VALUES ('platform.kill_switch','bool','false'::jsonb,'platform','') ON CONFLICT (key) DO NOTHING`);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const tRepo = new TenantRepository(replica as any);
    const dRepo = new TenantDomainRepository(replica as any);
    const sRepo = new TenantSettingsRepository(replica as any);
    tenants = new TenantService(uow, outbox, idem, metrics, audit, tRepo, sRepo, new TenantFeatureRepository(replica as any), new UsageCounterRepository(replica as any));
    domains = new TenantDomainService(uow, outbox, idem, metrics, audit, dRepo);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('reads and edits its own profile; status is never touched; emits event + audit', async () => {
    const before = await tenants.getMine(tenantA);
    expect(before.status).toBe('active');
    await tenants.updateProfile(tenantA, manager(), key(), { displayName: 'Acme Updated', gstin: '29ABCDE1234F1Z5' } as any, null);
    const row = await admin.query(`SELECT display_name, gstin, status FROM tenants WHERE id=$1`, [tenantA]);
    expect(row.rows[0].display_name).toBe('Acme Updated');
    expect(row.rows[0].gstin).toBe('29ABCDE1234F1Z5');
    expect(row.rows[0].status).toBe('active');   // unchanged — lifecycle is god-mode
    const ev = await admin.query(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_id=$1 AND event_type='tenancy.tenant_profile_updated'`, [tenantA]);
    expect(ev.rows[0].c).toBeGreaterThanOrEqual(1);
    const au = await admin.query(`SELECT count(*)::int c FROM audit_log WHERE tenant_id=$1 AND action='tenancy.tenant_profile_updated'`, [tenantA]);
    expect(au.rows[0].c).toBeGreaterThanOrEqual(1);
  });

  it('authorization throws without tenant.settings', async () => {
    await expect(tenants.updateProfile(tenantA, { userId: randomUUID(), canManage: false }, key(), { displayName: 'X' } as any, null))
      .rejects.toBeInstanceOf(TenantForbiddenError);
  });

  it('upserts a tenant-scoped setting; refuses a platform-scoped one (Law 11)', async () => {
    const res = await tenants.putSetting(tenantA, manager(), key(), { key: 'order.auto_confirm_hours', value: 12 } as any, null);
    expect(res.value).toBe(12);
    const stored = await admin.query(`SELECT value FROM tenant_settings WHERE tenant_id=$1 AND key='order.auto_confirm_hours'`, [tenantA]);
    expect(Number(stored.rows[0].value)).toBe(12);
    await expect(tenants.putSetting(tenantA, manager(), key(), { key: 'platform.kill_switch', value: true } as any, null))
      .rejects.toBeInstanceOf(SettingNotTenantScopedError);
  });

  it('adds a domain (pending), verifies (platform), makes it primary', async () => {
    const d = await domains.add(tenantA, manager(), key(), { domain: 'mandi.acme.example' } as any, null);
    domainId = d.id;
    expect(d.tlsStatus).toBe('pending'); expect(d.isPrimary).toBe(false);
    await admin.query(`UPDATE tenant_domains SET verified_at=now(), tls_status='active' WHERE id=$1`, [domainId]);   // platform/automation path
    const primary = await domains.makePrimary(tenantA, manager(), domainId, null);
    expect(primary.isPrimary).toBe(true);
  });

  it('RLS: tenant B cannot see tenant A\'s domain', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM tenant_domains WHERE id=$1`, [domainId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[tenancy] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
