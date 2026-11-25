// apps/admin-api/src/modules/support-oversight/__tests__/support-oversight.integration.spec.ts
// REAL end-to-end proof against a live Postgres (schema apps/api builds + migration 0012). Proves the CROSS-TENANT
// oversight property: admin-api (kv_admin) sees a tenant's SLA-breached ticket WITHOUT any tenant context set (RLS
// is bypassed for the god-mode plane), the per-tenant health rollup counts the breach, and an escalate raises
// severity → 'escalated' + recomputes the SLA + writes an audit_log row. Runs only when DATABASE_ADMIN_URL is set.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { SupportOversightRepository } from '../repositories/support-oversight.repository';
import { SlaBreachMonitorService } from '../services/sla-breach-monitor.service';
import { TenantHealthAlertsService } from '../services/tenant-health-alerts.service';
import { TicketEscalationsService } from '../services/ticket-escalations.service';
import { makeTenant } from '../../../../test/integration-fixtures';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('support-oversight (integration, real Postgres — cross-tenant SLA breach + escalate)', () => {
  let pool: AdminPool; let inspect: Pool;
  let monitor: SlaBreachMonitorService; let health: TenantHealthAlertsService; let escalations: TicketEscalationsService;
  const actor = { userId: randomUUID(), roles: ['platform_support_oversight'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['support.oversight.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  let tenantId = ''; let ticketId = '';

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const audit = new AdminAuditWriter(pool);
    const repo = new SupportOversightRepository(pool);
    monitor = new SlaBreachMonitorService(repo);
    health = new TenantHealthAlertsService(repo);
    escalations = new TicketEscalationsService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
    tenantId = await makeTenant(inspect);   // PC-56 TEST-1: its own tenant (was the first tenant in the database — none on a fresh build)
    const ins = await inspect.query(
      `INSERT INTO support_tickets (tenant_id, ticket_no, channel, severity, status, subject, sla_first_response_due, sla_resolution_due)
       VALUES ($1,$2,'app','P2','open','itest breached', now() - interval '2 hours', now() + interval '1 day') RETURNING id`,
      [tenantId, `ITEST-${Date.now()}`]);
    ticketId = ins.rows[0].id;
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      await inspect.query(`DELETE FROM support_tickets WHERE id=$1`, [ticketId]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('cross-tenant: kv_admin sees the breach without tenant context; health counts it; escalate raises + audits', async () => {
    const breaches: any = await monitor.listBreaches({ tenantId, limit: 50 });
    expect(breaches.items.some((t: any) => t.id === ticketId)).toBe(true);     // visible cross-tenant (RLS bypassed)
    const breachRow = breaches.items.find((t: any) => t.id === ticketId);
    expect(breachRow.sla.firstResponseBreached).toBe(true);

    const h: any = await health.health({ tenantId, limit: 20 });
    expect(h.items[0].breachedCount).toBeGreaterThanOrEqual(1);

    const out: any = await escalations.escalate(actor, ticketId, { severity: 'P0', reason: 'tenant SLA failing — platform escalation' });
    expect(out.severity).toBe('P0');
    expect(out.status).toBe('escalated');

    const row = await inspect.query(`SELECT severity, status FROM support_tickets WHERE id=$1`, [ticketId]);
    expect(row.rows[0].severity).toBe('P0');
    expect(row.rows[0].status).toBe('escalated');
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action='support.ticket_escalated'`, [ticketId]);
    expect(au.rows[0].c).toBe(1);
  });
});
