// modules/support/__tests__/support.integration.spec.ts
// REAL end-to-end proof of the support spine against a live Postgres:
//   1. a requester opens a P1 ticket (SLA due dates derived); an agent assigns + resolves it;
//   2. the requester rates it (CSAT); a stranger cannot read it (404, RLS + ownership);
//   3. ROW-LEVEL SECURITY: tenant B cannot see tenant A's ticket.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { SupportTicketRepository } from '../repositories/support-ticket.repository';
import { CsatResponseRepository } from '../repositories/csat-response.repository';
import { SupportTicketService } from '../services/support-ticket.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('support spine (integration, real Postgres + RLS + SLA)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let svc: SupportTicketService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const requester = randomUUID(); const agentUser = randomUUID();
  let ticketId = '';
  const reqActor = { userId: requester, isAgent: false };
  const agentActor = { userId: agentUser, isAgent: true };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, requester); await makeUser(admin, agentUser);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    svc = new SupportTicketService(uow, new PgOutboxWriter(), new PgIdempotencyService(pools), new PromMetrics(), new AuditWriter(pools), new SupportTicketRepository(replica as any),
      // PC-56 ADMIN-2c: the real ledger repository — this suite is DB-gated, so the rating and its derived column are
      // exercised against actual rows rather than a fake
      new CsatResponseRepository(replica as any));
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('requester opens a ticket with SLA due dates', async () => {
    const t: any = await svc.open(tenantA, reqActor, `idem-${randomUUID()}`, { channel: 'app', severity: 'P1', subject: 'Payment stuck' } as any);
    ticketId = t.id; expect(t.status).toBe('open'); expect(t.slaResolutionDue).toBeTruthy();
  });
  it('agent assigns + resolves; requester rates CSAT', async () => {
    await svc.assign(tenantA, agentActor, ticketId, agentUser, null);
    expect((await svc.transition(tenantA, agentActor, ticketId, { to: 'resolved' } as any, null)).status).toBe('resolved');
    expect((await svc.submitCsat(tenantA, reqActor, ticketId, { score: 5 })).csatScore).toBe(5);
  });
  it('a stranger cannot read the ticket (404, no IDOR)', async () => {
    await expect(svc.getById(tenantA, { userId: randomUUID(), isAgent: false }, ticketId)).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });
  it('RLS: tenant B cannot see tenant A\'s ticket', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM support_tickets WHERE id=$1`, [ticketId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM support_tickets WHERE id=$1`, [ticketId])).rows.length).toBe(1);
  });
});
