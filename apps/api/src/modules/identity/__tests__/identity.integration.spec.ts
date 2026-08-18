// modules/identity/__tests__/identity.integration.spec.ts
// REAL end-to-end proof of the identity module against a live Postgres (no mocks for
// infra). It instantiates the CONCRETE stack (Pg UnitOfWork + RLS, outbox, in-memory
// cache for OTP/role-cache, real TokenService) and verifies the security-critical flow:
//   1. OTP request → verify → a brand-new user is registered, a session opens, and a
//      signed access token + opaque refresh token are issued;
//   2. the access token verifies and (pre-role) carries NO permissions;
//   3. assigning the `farmer` role (DB-backed RBAC) + invalidating the cache means the
//      NEXT token (via refresh) carries `listing.create` — permissions come from the DB,
//      never the client;
//   4. refresh rotates the refresh token (old hash no longer present);
//   5. ROW-LEVEL SECURITY: tenant B cannot see tenant A's role assignment.
// Requires DATABASE_URL (kv_app role). The schema + seeds are built ONCE from the REAL
// db/migrations + db/seeds by test/integration-global-setup.js; this spec only inserts the two
// test tenants it needs (roles/permissions come from the real seeds).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { TokenService } from '../../../core/auth/token.service';
import { OtpService, SmsSender } from '../../../core/auth/otp.service';
import { RefreshTokenService } from '../../../core/auth/refresh-token.service';
import { RoleCacheService } from '../../../core/rbac/role-cache.service';
import { TranslationService } from '../../../core/i18n/translation.service';
import { AuditWriter } from '../../../core/audit/audit.writer';

import { UserRepository } from '../repositories/user.repository';
import { SessionRepository } from '../repositories/session.repository';
import { DeviceRepository } from '../repositories/device.repository';
import { LoginEventRepository } from '../repositories/login-event.repository';
import { RoleRepository } from '../repositories/role.repository';
import { UserTenantRoleRepository } from '../repositories/user-tenant-role.repository';
import { AuthService } from '../services/auth.service';
import { UserTenantRoleService } from '../services/user-tenant-role.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

class CaptureSms extends SmsSender { last: { phone: string; msg: string } | null = null; async send(phone: string, msg: string) { this.last = { phone, msg }; } }

run('identity slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let inspect: Pool;
  let auth: AuthService;
  let rbac: UserTenantRoleService;
  let tokens: TokenService;
  let isSuperuser = false;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const admin = randomUUID();
  const phone = '+9198' + Math.floor(10000000 + Math.random() * 89999999);

  beforeAll(async () => {
    {
      const a = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
      await makeTenant(a, tenantA, 'A'); await makeTenant(a, tenantB, 'B');
      await a.end();
    }
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const cache = new InMemoryCacheService();
    const metrics = new PromMetrics();
    tokens = new TokenService(config);
    const otp = new OtpService(cache, config);
    const refresh = new RefreshTokenService(tokens, config);
    const roleCache = new RoleCacheService(pools, shards, cache);
    const audit = new AuditWriter(pools);

    auth = new AuthService(uow, outbox, metrics, otp, new CaptureSms(), tokens, refresh, roleCache, new TranslationService(), config,
      new UserRepository(replica as any), new SessionRepository(replica as any), new DeviceRepository(),
      new LoginEventRepository());
    rbac = new UserTenantRoleService(uow, outbox, audit, roleCache, new UserTenantRoleRepository(replica as any),
      new RoleRepository(replica as any), new UserRepository(replica as any),
      // PC-56 TENANT-4d-1: the member-seat gate (W118's pause). `plan_limit_enforcement` is OFF by default,
      // so the real service would allow here too; stubbed to keep this suite about identity.
      { assertMemberSeatAvailable: async () => ({ kind: 'allow' as const }) } as any);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); });

  it('OTP login registers a user and issues verifiable tokens (no perms before a role)', async () => {
    const { devCode } = await auth.requestOtp(phone, 'sms');
    expect(devCode).toBeTruthy(); // dev affordance (non-prod)
    const t = await auth.verifyOtp({ phone, code: devCode!, tenantId: tenantA, device: { fingerprint: 'itest-device-1' } } as any, '127.0.0.1');
    expect(t.accessToken).toBeTruthy();
    const claims = tokens.verifyAccessToken(t.accessToken)!;
    expect(claims.tid).toBe(tenantA);
    expect(claims.perms).toEqual([]); // no role yet
    const cnt = await inspect.query(`SELECT count(*)::int n FROM users WHERE phone=$1`, [phone]);
    expect(cnt.rows[0].n).toBe(1);
  });

  it('assigning the farmer role makes the next token carry listing.create (DB-resolved RBAC)', async () => {
    const u = await inspect.query(`SELECT id FROM users WHERE phone=$1`, [phone]);
    const userId = u.rows[0].id;
    await rbac.assign(tenantA, admin, { userId, roleCode: 'farmer' }, '127.0.0.1');

    // a fresh login resolves permissions from the DB via RoleCache
    const { devCode } = await auth.requestOtp(phone, 'sms');
    const t = await auth.verifyOtp({ phone, code: devCode!, tenantId: tenantA } as any, '127.0.0.1');
    const claims = tokens.verifyAccessToken(t.accessToken)!;
    expect(claims.roles).toContain('farmer');
    expect(claims.perms).toContain('listing.create');
  });

  it('refresh rotates the refresh token (old one stops working)', async () => {
    const { devCode } = await auth.requestOtp(phone, 'sms');
    const first = await auth.verifyOtp({ phone, code: devCode!, tenantId: tenantA } as any, '127.0.0.1');
    const rotated = await auth.refreshSession({ refreshToken: first.refreshToken, tenantId: tenantA }, '127.0.0.1');
    expect(rotated.refreshToken).not.toEqual(first.refreshToken);
    await expect(auth.refreshSession({ refreshToken: first.refreshToken, tenantId: tenantA }, '127.0.0.1')).rejects.toBeTruthy();
  });

  it('RLS isolates the role assignment to tenant A (tenant B sees zero)', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM user_tenant_roles`); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[identity] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBeGreaterThanOrEqual(1); return; }
    expect(await countAs(tenantA)).toBeGreaterThanOrEqual(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
