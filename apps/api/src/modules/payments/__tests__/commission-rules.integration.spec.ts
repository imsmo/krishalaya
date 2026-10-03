// modules/payments/__tests__/commission-rules.integration.spec.ts
// REAL Postgres proof of the API-W3-07 commission-rule catalog — on the PC-56 TENANT-SW-a model (a tenant rule is PROPOSED by one
// tenant_admin and CONFIRMED by another; the platform's share is the plan's floor; 7 days' notice). Proves:
//   1. a tenant rule (tenant_id = caller) exists only after a second admin confirms; its share is the floor; audit rows for both;
//   2. authorization THROWS without commission.manage;
//   3. a tenant cannot touch a platform-default (tenant_id NULL) rule → 404 (no god-mode);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's commission rule.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';

import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { CommissionRuleProposalRepository } from '../repositories/commission-rule-proposal.repository';
import { addDays, istToday } from '../domain/commission-proposal';
import { CommissionRuleService } from '../services/commission-rule.service';
import { CommissionRuleForbiddenError, CommissionRuleNotFoundError } from '../domain/commission.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('payments commission-rule catalog (integration, real Postgres + RLS + Law 11)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let rules: CommissionRuleService;
  let isSuperuser = false;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const a1 = randomUUID(); const a2 = randomUUID();
  const mgr = (u: string) => ({ userId: u, canManage: true });
  const key = () => randomUUID();
  let ruleId = ''; let platformRuleId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    for (const u of [a1, a2]) {
      await makeUser(admin, u as ReturnType<typeof randomUUID>);
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code='tenant_admin' ON CONFLICT DO NOTHING`, [u, tenantA]);
    }
    // a platform-default rule (tenant_id NULL) — must NOT be editable via the tenant API
    platformRuleId = randomUUID();
    // (end-dated so it never collides with the seeded open-ended platform defaults — 0196's one-per-scope index)
    await admin.query(`INSERT INTO commission_rules (id, tenant_id, rate_bps, fixed_minor, platform_share_bps, charged_to, priority, effective_to) VALUES ($1, NULL, 300, 0, 1000, 'seller', 100, '2099-12-31')`, [platformRuleId]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    rules = new CommissionRuleService(uow, new PgIdempotencyService(pools), new PgOutboxWriter(), new PromMetrics(), new AuditWriter(pools),
      new CommissionRuleRepository(replica as any), new CommissionRuleProposalRepository(replica as any));

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('a tenant rule exists only after a SECOND admin confirms; tenant_id = caller; share = the plan floor; audited', async () => {
    const p = await rules.proposeCreate(tenantA, mgr(a1), key(), { rateBps: 350, fixedMinor: '0', chargedTo: 'seller', priority: 50,
      effectiveFrom: addDays(istToday(), 8), reason: 'Season rate agreed at the board meeting' } as any, null);
    expect(await admin.query(`SELECT 1 FROM commission_rules WHERE tenant_id=$1`, [tenantA]).then((r) => r.rowCount)).toBe(0);
    await expect(rules.confirm(tenantA, mgr(a1), key(), p.id, null)).rejects.toMatchObject({ code: 'COMMISSION_CHECKER_IS_MAKER' });
    const c = await rules.confirm(tenantA, mgr(a2), key(), p.id, null);
    expect(c.status).toBe('confirmed');
    const row = await admin.query(`SELECT id, tenant_id, rate_bps, platform_share_bps, kv_commission_platform_share_bps($1) AS floor FROM commission_rules WHERE tenant_id=$1`, [tenantA]);
    ruleId = row.rows[0].id;
    expect(row.rows[0].tenant_id).toBe(tenantA);
    expect(row.rows[0].rate_bps).toBe(350);
    expect(row.rows[0].platform_share_bps).toBe(row.rows[0].floor);
    const au = await admin.query(`SELECT array_agg(DISTINCT action ORDER BY action) a FROM audit_log WHERE tenant_id=$1 AND action LIKE 'payments.commission_rule_%'`, [tenantA]);
    expect(au.rows[0].a).toEqual(['payments.commission_rule_confirmed', 'payments.commission_rule_proposed']);
  });

  it('authorization throws without commission.manage', async () => {
    await expect(rules.proposeCreate(tenantA, { userId: a1, canManage: false }, key(), { rateBps: 1, fixedMinor: '0', chargedTo: 'seller', priority: 100,
      effectiveFrom: addDays(istToday(), 8), reason: 'should never get past the guard at all' } as any, null)).rejects.toBeInstanceOf(CommissionRuleForbiddenError);
  });

  it('cannot touch a platform-default rule via the tenant API → 404 (no god-mode escalation)', async () => {
    await expect(rules.proposeDeactivate(tenantA, mgr(a1), key(), platformRuleId, { effectiveFrom: addDays(istToday(), 8), reason: 'trying to end the platform default' } as any, null))
      .rejects.toBeInstanceOf(CommissionRuleNotFoundError);
    const row = await admin.query(`SELECT is_active, effective_to::text FROM commission_rules WHERE id=$1`, [platformRuleId]);
    expect(row.rows[0]).toEqual({ is_active: true, effective_to: '2099-12-31' });   // untouched
  });

  it('RLS: tenant B cannot see tenant A\'s commission rule', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM commission_rules WHERE id=$1`, [ruleId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[commission-rules] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
