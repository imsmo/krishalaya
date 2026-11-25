// apps/admin-api/src/modules/impersonation/__tests__/impersonation.integration.spec.ts
// REAL end-to-end proof against a live Postgres (schema apps/api builds + migrations 0003/0038). Proves: start a
// READ-ONLY act-as grant against a real tenant member → verify the minted token → record an action under it → end
// it — asserting impersonation_grants state, the time-box (expires_at), impersonation_actions, and audit_log rows;
// and that ending an already-ended grant is refused. impersonation_grants/_actions are GLOBAL/god-mode (target_*,
// not tenant_id ⇒ no RLS — kv_admin-only; isolation asserted by verify-rls-coverage.js). Runs only when
// DATABASE_ADMIN_URL is set (CI's DB job). If the seeded DB has no tenant-scoped membership, the body is skipped.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { ImpersonationRepository } from '../repositories/impersonation.repository';
import { StartImpersonationService } from '../services/start-impersonation.service';
import { EndImpersonationService } from '../services/end-impersonation.service';
import { ImpersonationHistoryService } from '../services/impersonation-history.service';
import { verifyImpersonationToken } from '../domain/impersonation-token';
import { IllegalGrantTransitionError } from '../domain/impersonation.errors';
import { makeTenant, makeUser } from '../../../../test/integration-fixtures';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;
const SECRET = 's'.repeat(40);

run('impersonation (integration, real Postgres — act-as grant lifecycle + audit)', () => {
  let pool: AdminPool; let inspect: Pool; let config: AdminConfig;
  let startSvc: StartImpersonationService; let endSvc: EndImpersonationService; let history: ImpersonationHistoryService;
  const actor = { userId: randomUUID(), roles: ['platform_support_impersonator'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['impersonation.grant']), ip: '10.0.0.1', requestId: 'itest' } as any;
  let tenantId = ''; let targetUserId = ''; let grantId = '';

  beforeAll(async () => {
    config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: SECRET, IMPERSONATION_ENABLED: 'true', IMPERSONATION_TOKEN_SECRET: SECRET });
    pool = new AdminPool(config);
    const audit = new AdminAuditWriter(pool);
    const repo = new ImpersonationRepository(pool);
    startSvc = new StartImpersonationService(pool, audit, repo, config);
    endSvc = new EndImpersonationService(pool, audit, repo);
    history = new ImpersonationHistoryService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
    // PC-56 TEST-1: its OWN tenant + member. It used to borrow the first active tenant-scoped membership in the database and,
    // finding none on a database built from migrations + seeds, SKIPPED ITS WHOLE BODY with a console.warn — a green test that
    // tested nothing. The target is now always there, so the body always runs.
    tenantId = await makeTenant(inspect);
    targetUserId = await makeUser(inspect);
    const role = await inspect.query(`SELECT id FROM roles WHERE scope = 'tenant' AND code = 'farmer' LIMIT 1`);
    await inspect.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1, $2, $3, true)`, [targetUserId, tenantId, role.rows[0].id]);
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      if (grantId) {
        await inspect.query(`DELETE FROM impersonation_actions WHERE grant_id=$1`, [grantId]).catch(() => undefined);
        await inspect.query(`DELETE FROM impersonation_grants WHERE id=$1`, [grantId]).catch(() => undefined);
      }
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('start→record→end: state, time-box, actions + audit; re-end refused', async () => {
    expect(targetUserId).toBeTruthy();

    const started: any = await startSvc.start(actor, { targetTenantId: tenantId, targetUserId, reason: 'reproduce a reported issue', ttlSec: 600, scope: 'read_only' });
    grantId = started.grant.id;
    expect(started.grant.status).toBe('active');
    const claims = verifyImpersonationToken(started.token, SECRET, config.impersonation.issuer, config.impersonation.audience);
    expect(claims.sub).toBe(targetUserId); expect(claims.act.sub).toBe(actor.userId); expect(claims.scope).toBe('read_only');

    const g = await inspect.query(`SELECT status, scope, expires_at, created_at FROM impersonation_grants WHERE id=$1`, [grantId]);
    expect(g.rows[0].status).toBe('active');
    expect(g.rows[0].scope).toBe('read_only');
    expect(new Date(g.rows[0].expires_at).getTime()).toBeGreaterThan(new Date(g.rows[0].created_at).getTime());  // time-boxed

    await history.recordAction(actor, grantId, { method: 'GET', path: '/v1/orders' });
    const acts = await inspect.query(`SELECT count(*)::int AS c FROM impersonation_actions WHERE grant_id=$1`, [grantId]);
    expect(acts.rows[0].c).toBe(1);

    const ended: any = await endSvc.end(actor, grantId, 'finished reproducing the issue');
    expect(ended.status).toBe('ended');
    await expect(endSvc.end(actor, grantId, 'again')).rejects.toBeInstanceOf(IllegalGrantTransitionError);

    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action IN ('impersonation.started','impersonation.ended')`, [grantId]);
    expect(au.rows[0].c).toBe(2);
  });
});
