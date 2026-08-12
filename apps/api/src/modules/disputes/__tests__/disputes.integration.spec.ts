// modules/disputes/__tests__/disputes.integration.spec.ts
// REAL end-to-end proof of the dispute-resolution path against a live Postgres, driven through the
// OUTBOX RELAY (Law 4 — no synchronous cross-module calls):
//   1. an order is delivered → the relay delivers orders.order_delivered → disputes' OrderDeliveredHandler
//      records dispute eligibility (buyer + seller) — idempotent;
//   2. the buyer raises a dispute against the seller (counterparty resolved server-side from eligibility);
//      a NON-party cannot; a second active dispute is rejected; the raise emits disputes.dispute_opened
//      → the relay → orders pauses the order ('disputed');
//   3. parties exchange threaded evidence; a moderator resolves refund_full → disputes.dispute_resolved
//      → the relay → orders applies it ('refunded');
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's dispute.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
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
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';
import { uuidv7 } from '../../../core/database/uuid.util';

import { OrderRepository } from '../../orders/repositories/order.repository';
import { DisputeOpenedHandler } from '../../orders/events/handlers/dispute-opened.handler';
import { DisputeResolvedHandler } from '../../orders/events/handlers/dispute-resolved.handler';
import { DisputeRepository } from '../repositories/dispute.repository';
import { DisputeMessageRepository } from '../repositories/dispute-message.repository';
import { RefundApprovalRepository } from '../repositories/refund-approval.repository';
import { RefundApprovalService } from '../services/refund-approval.service';
import { DisputeService } from '../services/dispute.service';
import { DisputeMessageService } from '../services/dispute-message.service';
import { OrderDeliveredHandler } from '../events/handlers/order-delivered.handler';
import { NotEligibleToDisputeError, DuplicateDisputeError } from '../domain/disputes.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('disputes slice (integration, real Postgres + RLS + outbox relay)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let disputes: DisputeService;
  let dispatcher: OutboxDispatcher;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const buyer = randomUUID();
  const seller = randomUUID();
  const stranger = randomUUID();
  const orderId = uuidv7();
  let disputeId = '';
  const buyerActor = () => ({ userId: buyer, canModerate: false });
  const sellerActor = () => ({ userId: seller, canModerate: false });
  const moderator = () => ({ userId: randomUUID(), canModerate: true });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, buyer); await makeUser(admin, seller); await makeUser(admin, stranger);
    // a delivered order (minimal header — the handlers only need id/status/parties)
    await admin.query(
      `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, total_minor, status, version, created_at)
       VALUES ($1,$2,$3,$4,$5,'direct','INR',100000,100000,'delivered',1, now())`,
      [orderId, tenantA, `KV-${orderId.slice(0, 8)}`, buyer, seller]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const disputeRepo = new DisputeRepository(replica as any);
    const msgRepo = new DisputeMessageRepository(replica as any);
    const msgService = new DisputeMessageService(uow, outbox, metrics, disputeRepo, msgRepo);
    // PC-56 TENANT-3b: resolving with a REFUND now consults the maker-checker plane (0139) first.
    const approvals = new RefundApprovalService(uow, audit, new RefundApprovalRepository(replica as any));
    disputes = new DisputeService(uow, outbox, idem, metrics, audit, disputeRepo, msgRepo, msgService, approvals);

    const orderRepo = new OrderRepository(replica as any);
    const registry = new OutboxHandlerRegistry();
    registry.register(new OrderDeliveredHandler(disputeRepo));            // orders.order_delivered → eligibility
    registry.register(new DisputeOpenedHandler(orderRepo, outbox));        // disputes.dispute_opened → order 'disputed'
    registry.register(new DisputeResolvedHandler(orderRepo, outbox));      // disputes.dispute_resolved → order 'refunded'/...
    dispatcher = new OutboxDispatcher(admin, registry, metrics);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('order delivered → relay records dispute eligibility (idempotent)', async () => {
    const seed = () => admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'order',$2,'orders.order_delivered',$3::jsonb)`,
      [tenantA, orderId, JSON.stringify({ v: 1, orderId, buyerUserId: buyer, sellerUserId: seller })]);
    await seed(); await dispatcher.relayBatch();
    await seed(); await dispatcher.relayBatch();   // re-deliver → still one row
    const e = await admin.query(`SELECT count(*)::int c FROM dispute_eligibility WHERE tenant_id=$1 AND order_id=$2`, [tenantA, orderId]);
    expect(e.rows[0].c).toBe(1);
  });

  it('buyer raises against seller; non-party blocked; duplicate blocked; relay pauses the order', async () => {
    const d = await disputes.raise(tenantA, buyer, `idem-${randomUUID()}`, { orderId, reasonCode: 'poor_quality', description: 'mouldy grain' } as any);
    disputeId = d.id;
    expect(d.againstUser).toBe(seller); expect(d.status).toBe('open');

    await expect(disputes.raise(tenantA, stranger, `idem-${randomUUID()}`, { orderId, reasonCode: 'late' } as any)).rejects.toBeInstanceOf(NotEligibleToDisputeError);
    await expect(disputes.raise(tenantA, buyer, `idem-${randomUUID()}`, { orderId, reasonCode: 'damaged' } as any)).rejects.toBeInstanceOf(DuplicateDisputeError);

    await dispatcher.relayBatch();   // disputes.dispute_opened → orders
    const ord = await admin.query(`SELECT status FROM orders WHERE id=$1`, [orderId]);
    expect(ord.rows[0].status).toBe('disputed');
  });

  it('parties exchange evidence; seller responds', async () => {
    await disputes.postMessage(tenantA, buyerActor(), disputeId, { body: 'photos attached' });
    await disputes.postMessage(tenantA, sellerActor(), disputeId, { body: 'looks fine to me' });
    const msgs = await disputes.listMessages(tenantA, buyerActor(), disputeId, { limit: 50 });
    expect(msgs.items.length).toBe(2);
    const r = await disputes.respond(tenantA, sellerActor(), disputeId);
    expect(r.status).toBe('seller_responded');
  });

  it('moderator resolves refund_full → relay → order refunded', async () => {
    const r = await disputes.resolve(tenantA, moderator(), disputeId, { resolutionType: 'refund_full' } as any, null);
    expect(r.status).toBe('resolved'); expect(r.resolutionType).toBe('refund_full');
    await dispatcher.relayBatch();   // disputes.dispute_resolved → orders
    const ord = await admin.query(`SELECT status FROM orders WHERE id=$1`, [orderId]);
    expect(ord.rows[0].status).toBe('refunded');
  });

  it('RLS: tenant B cannot see tenant A\'s dispute', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM disputes WHERE id=$1`, [disputeId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[disputes] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
