// apps/admin-api/src/modules/flags-ops/__tests__/flags-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (schema apps/api builds + migrations 0002/0036). Proves: create a
// flag (OFF), enable, ramp rollout to 25%, then KILL (disable + lock) — asserting feature_flags state, the lock,
// that a locked flag refuses re-enable, the feature_flag_changes timeline, and the audit_log rows. feature_flags
// is a GLOBAL/god-mode table (no tenant_id ⇒ no RLS — operated only by kv_admin); the isolation guarantee is
// role-based, asserted by db/scripts/verify-rls-coverage.js, not per-row here. Runs only when DATABASE_ADMIN_URL set.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { FlagsRepository } from '../repositories/flags.repository';
import { GlobalFlagsService } from '../services/global-flags.service';
import { KillSwitchService } from '../services/kill-switch.service';
import { PercentRolloutService } from '../services/percent-rollout.service';
import { FlagLockedError } from '../domain/flags-ops.errors';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('flags-ops (integration, real Postgres — flag lifecycle + kill-switch + history)', () => {
  let pool: AdminPool; let inspect: Pool;
  let flagsSvc: GlobalFlagsService; let killSvc: KillSwitchService; let rolloutSvc: PercentRolloutService;
  const actor = { userId: randomUUID(), roles: ['platform_flags_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['flags.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  const key = `itest.flag_${Date.now()}`;

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const audit = new AdminAuditWriter(pool);
    const repo = new FlagsRepository(pool);
    flagsSvc = new GlobalFlagsService(pool, audit, repo);
    killSvc = new KillSwitchService(pool, audit, repo);
    rolloutSvc = new PercentRolloutService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      await inspect.query(`DELETE FROM feature_flag_changes WHERE flag_key=$1`, [key]).catch(() => undefined);
      await inspect.query(`DELETE FROM feature_flags WHERE key=$1`, [key]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('create→enable→ramp→kill: state, lock, history + audit; locked flag refuses re-enable', async () => {
    const created: any = await flagsSvc.create(actor, { key, rolloutPct: 0, tenantIds: [], plans: [], countries: [], reason: 'launch behind flag' });
    expect(created.isEnabled).toBe(false);
    await killSvc.enable(actor, key, 'open to internal');
    await rolloutSvc.setRollout(actor, key, 25, 'ramp to 25%');
    const killed: any = await killSvc.kill(actor, key, 'incident #42 — kill now');
    expect(killed.isEnabled).toBe(false);
    expect(killed.isLocked).toBe(true);

    const row = await inspect.query(`SELECT is_enabled, rollout_pct, is_locked FROM feature_flags WHERE key=$1`, [key]);
    expect(row.rows[0].is_enabled).toBe(false);
    expect(row.rows[0].rollout_pct).toBe(25);
    expect(row.rows[0].is_locked).toBe(true);

    // locked ⇒ re-enable refused
    await expect(killSvc.enable(actor, key, 'try to re-enable')).rejects.toBeInstanceOf(FlagLockedError);

    const changes = await inspect.query(`SELECT count(*)::int AS c FROM feature_flag_changes WHERE flag_key=$1 AND action IN ('created','enabled','rollout_changed','killed')`, [key]);
    expect(changes.rows[0].c).toBe(4);
    const audits = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_key=$1 AND entity_id IS NULL AND action LIKE 'flags.%'`, [key]);   // a flag key, not a uuid (0247)
    expect(audits.rows[0].c).toBe(4);   // created + enabled + rollout_changed + killed (the failed re-enable wrote nothing)
  });
});
