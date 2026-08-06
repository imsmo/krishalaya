// modules/disputes/__tests__/returns.integration.spec.ts
// REAL Postgres proof of the API-W3-09 returns/RMA sub-domain + the dispute SLA worker jobs:
//   1. the order's BUYER requests a return (eligibility from delivery); a non-buyer is blocked; a
//      second active return on the same order is blocked;
//   2. the lifecycle runs through the wallet-free state machine: seller approves → buyer ships →
//      seller receives → moderator refunds; party authority is enforced per-row (seller can't ship,
//      buyer can't approve) and a non-party gets 404 (no enumeration);
//   3. the SLA jobs (worker, privileged pool): an 'open' dispute past seller_respond_by → 'under_review';
//      an active dispute past sla_due_at → 'escalated' (each emits an outbox event);
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's return.
// Schema/seeds from the REAL db/migrations + db/seeds.
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
import { uuidv7 } from '../../../core/database/uuid.util';

import { ReturnRepository } from '../repositories/return.repository';
import { DisputeRepository } from '../repositories/dispute.repository';
import { ReturnService } from '../services/return.service';
import { SellerResponseTimeoutJob } from '../jobs/seller-response-timeout.job';
import { SlaEscalationJob } from '../jobs/sla-escalation.job';
import { NotEligibleToReturnError, DuplicateReturnError, ReturnForbiddenError, ReturnNotFoundError } from '../domain/disputes.errors';
import { IllegalReturnTransitionError } from '../domain/return.state';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('returns + SLA jobs (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let returns: ReturnService; let isSuperuser = false;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const buyer = randomUUID(); const seller = randomUUID(); const stranger = randomUUID();
  const orderId = uuidv7();
  let returnId = '';
  const buyerActor = () => ({ userId: buyer, canModerate: false });
  const sellerActor = () => ({ userId: seller, canModerate: false });
  const strangerActor = () => ({ userId: stranger, canModerate: false });
  const moderator = () => ({ userId: randomUUID(), canModerate: true });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, buyer); await makeUser(admin, seller); await makeUser(admin, stranger);
    await admin.query(`INSERT INTO dispute_eligibility (tenant_id, order_id, buyer_user_id, seller_user_id) VALUES ($1,$2,$3,$4) ON CONFLICT (order_id) DO NOTHING`, [tenantA, orderId, buyer, seller]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const returnRepo = new ReturnRepository(replica as any);
    const disputeRepo = new DisputeRepository(replica as any);
    returns = new ReturnService(uow, new PgOutboxWriter(), new PgIdempotencyService(pools), new PromMetrics(), new AuditWriter(pools), returnRepo, disputeRepo);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('buyer requests a return; non-buyer blocked; duplicate blocked', async () => {
    const r = await returns.request(tenantA, buyer, `idem-${randomUUID()}`, { orderId, reasonCode: 'damaged' } as any);
    returnId = r.id;
    expect(r.status).toBe('requested');
    // PC-55 B8: the read model carries the reason CODE, not just the internal lookup id — every console needs a
    // code to translate the reason, and an id on the wire would force each of them to fetch the lookup table.
    expect(r.reasonCode).toBe('damaged');
    expect((await returns.getById(tenantA, buyerActor(), returnId)).reasonCode).toBe('damaged');
    const mine = await returns.list(tenantA, buyerActor(), { box: 'mine', limit: 20 });
    expect(mine.items.find((x) => x.id === returnId)?.reasonCode).toBe('damaged');
    await expect(returns.request(tenantA, stranger, `idem-${randomUUID()}`, { orderId, reasonCode: 'damaged' } as any)).rejects.toBeInstanceOf(NotEligibleToReturnError);
    await expect(returns.request(tenantA, seller, `idem-${randomUUID()}`, { orderId } as any)).rejects.toBeInstanceOf(NotEligibleToReturnError);   // seller isn't the buyer
    await expect(returns.request(tenantA, buyer, `idem-${randomUUID()}`, { orderId } as any)).rejects.toBeInstanceOf(DuplicateReturnError);
  });

  it('enforces per-row party authority across the lifecycle', async () => {
    await expect(returns.approve(tenantA, buyerActor(), returnId, null)).rejects.toBeInstanceOf(ReturnForbiddenError);   // buyer can't approve
    await expect(returns.getById(tenantA, strangerActor(), returnId)).rejects.toBeInstanceOf(ReturnNotFoundError);       // non-party → 404
    const approved = await returns.approve(tenantA, sellerActor(), returnId, null);
    expect(approved.status).toBe('approved');
    // seller is an allowed role for receive, but the state machine forbids approved→received (must ship first)
    await expect(returns.receive(tenantA, sellerActor(), returnId, null)).rejects.toBeInstanceOf(IllegalReturnTransitionError);
  });

  it('completes buyer-ships → seller-receives → moderator-refunds', async () => {
    const shipped = await returns.ship(tenantA, buyerActor(), returnId);
    expect(shipped.status).toBe('in_transit');
    await expect(returns.ship(tenantA, sellerActor(), returnId)).rejects.toBeInstanceOf(ReturnForbiddenError);   // (idempotency aside) seller isn't the shipper
    const received = await returns.receive(tenantA, sellerActor(), returnId, null);
    expect(received.status).toBe('received');
    await expect(returns.refund(tenantA, sellerActor(), returnId, null)).rejects.toBeInstanceOf(ReturnForbiddenError);   // only a moderator refunds
    const refunded = await returns.refund(tenantA, moderator(), returnId, null);
    expect(refunded.status).toBe('refunded');
    const ev = await admin.query(`SELECT count(*)::int c FROM outbox_events WHERE aggregate_type='return' AND aggregate_id=$1 AND event_type='disputes.return_refunded'`, [returnId]);
    expect(ev.rows[0].c).toBeGreaterThanOrEqual(1);
  });

  it('SLA jobs advance overdue disputes (seller-timeout → under_review; sla breach → escalated)', async () => {
    const d1 = uuidv7(); const d2 = uuidv7(); const reason = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='dispute_reason' AND code='damaged' AND tenant_id IS NULL`)).rows[0]?.id;
    await admin.query(`INSERT INTO disputes (id, tenant_id, order_id, raised_by, against_user, reason_id, status, seller_respond_by, sla_due_at) VALUES ($1,$2,$3,$4,$5,$6,'open', now()-interval '1 hour', now()+interval '1 day')`, [d1, tenantA, orderId, buyer, seller, reason]);
    await admin.query(`INSERT INTO disputes (id, tenant_id, order_id, raised_by, against_user, reason_id, status, seller_respond_by, sla_due_at) VALUES ($1,$2,$3,$4,$5,$6,'seller_responded', now()-interval '2 day', now()-interval '1 hour')`, [d2, tenantA, orderId, buyer, seller, reason]);

    const t = await new SellerResponseTimeoutJob(admin).run(50);
    expect(t.advanced).toBeGreaterThanOrEqual(1);
    expect((await admin.query(`SELECT status FROM disputes WHERE id=$1`, [d1])).rows[0].status).toBe('under_review');

    const e = await new SlaEscalationJob(admin).run(50);
    expect(e.escalated).toBeGreaterThanOrEqual(1);
    expect((await admin.query(`SELECT status FROM disputes WHERE id=$1`, [d2])).rows[0].status).toBe('escalated');
  });

  it('RLS: tenant B cannot see tenant A\'s return', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM returns WHERE id=$1`, [returnId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[returns] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
