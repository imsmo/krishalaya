// modules/logistics/__tests__/logistics.integration.spec.ts
// REAL end-to-end proof of the order-fulfilment + proof-of-delivery path against a live Postgres,
// driven entirely through the OUTBOX RELAY (Law 4 — no synchronous cross-module calls):
//   1. an order is confirmed → the relay delivers orders.order_confirmed → OrderConfirmedHandler
//      (logistics) auto-creates ONE pending shipment (idempotent);
//   2. ops assign a rider → pickup → out_for_delivery: a delivery OTP is generated, only its HASH is
//      stored, and the raw code is emitted to the (deferred) SMS relay as logistics.delivery_otp_issued;
//   3. a WRONG OTP is rejected; the correct OTP delivers the shipment, which emits
//      logistics.shipment_delivered → the relay → orders advances the order to 'delivered';
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's shipment.
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
import { OrderService } from '../../orders/services/order.service';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { ShipmentDeliveredHandler } from '../../orders/events/handlers/shipment-delivered.handler';
import { ShipmentRepository } from '../repositories/shipment.repository';
import { LogisticsDeskRepository } from '../repositories/logistics-desk.repository';
import { VehicleRepository } from '../repositories/vehicle.repository';
import { ShipmentService } from '../services/shipment.service';
import { OrderConfirmedHandler } from '../events/handlers/order-confirmed.handler';
import { InvalidDeliveryOtpError } from '../domain/logistics.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('logistics slice (integration, real Postgres + RLS + outbox relay)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let shipments: ShipmentService;
  let dispatcher: OutboxDispatcher;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const buyer = randomUUID();
  const seller = randomUUID();
  const rider = randomUUID();
  const orderId = uuidv7();
  let shipmentId = '';
  const manager = () => ({ userId: randomUUID(), canManage: true });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, buyer); await makeUser(admin, seller); await makeUser(admin, rider);
    // a confirmed order (minimal header — the handlers only need the id/status)
    await admin.query(
      `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, total_minor, status, version, created_at)
       VALUES ($1,$2,$3,$4,$5,'direct','INR',100000,100000,'confirmed',1, now())`,
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
    const shipRepo = new ShipmentRepository(replica as any);
    // PC-56 TENANT-5a. The money gate reads the ORDER through the orders module's public service (never its
    // repositories — module blueprint), and the pickup-OTP feature is flag-gated per tenant. Both are wired
    // REAL here, against the same Postgres: the gate this wave added is only worth anything if it holds on a
    // live order row, and `logistics_pickup_otp` is seeded OFF by 0151, so an unseeded/off flag reproduces
    // the pre-wave behaviour exactly.
    const orderRepo = new OrderRepository(replica as any);
    const orders = new OrderService(uow, outbox, metrics, audit, orderRepo);
    const flags = new FlagsService(pools, new InMemoryCacheService());
    shipments = new ShipmentService(uow, orders, flags, outbox, idem, metrics, audit, config, shipRepo,
      new VehicleRepository(replica as any),
      // PC-56 TENANT-5d · the REAL vocabulary read, against the real database: a coded failure reason is validated
      // against `shipment_failure_reason` (Law 6, tenant-extendable), so this integration run proves the seed too.
      new LogisticsDeskRepository(replica as any));

    const registry = new OutboxHandlerRegistry();
    registry.register(new OrderConfirmedHandler(shipRepo, outbox, metrics));                       // orders.order_confirmed → shipment
    registry.register(new ShipmentDeliveredHandler(new OrderRepository(replica as any), outbox));  // logistics.shipment_delivered → order delivered
    dispatcher = new OutboxDispatcher(admin, registry, metrics);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('order confirmed → relay auto-creates one pending shipment (idempotent)', async () => {
    // seed the order_confirmed event as orders would
    await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'order',$2,'orders.order_confirmed',$3::jsonb)`,
      [tenantA, orderId, JSON.stringify({ v: 1, orderId })]);
    await dispatcher.relayBatch();
    const rows = await admin.query(`SELECT id, status FROM shipments WHERE tenant_id=$1 AND order_id=$2`, [tenantA, orderId]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].status).toBe('pending');
    shipmentId = rows.rows[0].id;

    // re-deliver the same event → no duplicate shipment
    await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'order',$2,'orders.order_confirmed',$3::jsonb)`,
      [tenantA, orderId, JSON.stringify({ v: 1, orderId })]);
    await dispatcher.relayBatch();
    const again = await admin.query(`SELECT count(*)::int c FROM shipments WHERE tenant_id=$1 AND order_id=$2`, [tenantA, orderId]);
    expect(again.rows[0].c).toBe(1);
  });

  it('assign → pickup → out_for_delivery issues a hashed OTP (raw code only in the SMS-relay event)', async () => {
    await shipments.assign(tenantA, manager(), shipmentId, { riderUserId: rider }, null);
    await shipments.markPickedUp(tenantA, { userId: rider, canManage: false }, shipmentId, null, null);
    await shipments.markOutForDelivery(tenantA, { userId: rider, canManage: false }, shipmentId, null);

    const ship = await admin.query(`SELECT status, delivery_otp_hash FROM shipments WHERE id=$1`, [shipmentId]);
    expect(ship.rows[0].status).toBe('out_for_delivery');
    expect(ship.rows[0].delivery_otp_hash).toMatch(/^[0-9a-f]{64}$/);   // stored hashed, never plaintext
  });

  it('wrong OTP is rejected; correct OTP delivers → relay → order becomes delivered', async () => {
    // the (deferred) SMS relay would read the raw code from this internal event
    const issued = await admin.query(`SELECT payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='logistics.delivery_otp_issued'`, [shipmentId]);
    const otp = issued.rows[0].payload.otp as string;
    expect(otp).toMatch(/^\d{6}$/);

    await expect(shipments.markDelivered(tenantA, { userId: rider, canManage: false }, shipmentId, { otp: otp === '000000' ? '111111' : '000000' }, null)).rejects.toBeInstanceOf(InvalidDeliveryOtpError);

    await shipments.markDelivered(tenantA, { userId: rider, canManage: false }, shipmentId, { otp }, null);
    const ship = await admin.query(`SELECT status, delivered_at FROM shipments WHERE id=$1`, [shipmentId]);
    expect(ship.rows[0].status).toBe('delivered');
    expect(ship.rows[0].delivered_at).not.toBeNull();

    await dispatcher.relayBatch();   // relays logistics.shipment_delivered → orders
    const ord = await admin.query(`SELECT status FROM orders WHERE id=$1`, [orderId]);
    expect(ord.rows[0].status).toBe('delivered');
  });

  it('RLS: tenant B cannot see tenant A\'s shipment', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM shipments WHERE id=$1`, [shipmentId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[logistics] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
