// modules/payments/__tests__/dispute-refund.integration.spec.ts
// REAL end-to-end proof of the dispute-refund money path against a live Postgres, via the OUTBOX RELAY
// (Law 4). Two flows, both behind the `dispute_refunds` flag, both ZERO-SUM:
//   A) NOT-settled full refund — escrow still holds the gross (dispute paused the order pre-settlement)
//      → refund_full moves escrow → buyer wallet.
//   B) SETTLED clawback — the order completed and escrow was released to the seller; a later refund_full
//      REVERSES the recorded settlement (seller → escrow, precise) then refunds escrow → buyer. Seller
//      ends at 0, buyer made whole, escrow at 0.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
import { randomUUID, createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';
import { uuidv7 } from '../../../core/database/uuid.util';

import { OrderRepository } from '../../orders/repositories/order.repository';
import { PaymentRepository } from '../repositories/payment.repository';
import { PaymentService } from '../services/payment.service';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';
import { SettlementPricingService } from '../services/settlement-pricing.service';
import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { DisputeResolvedHandler } from '../events/handlers/dispute-resolved.handler';
import { DisputeRepository } from '../../disputes/repositories/dispute.repository';
import { DisputeRefundedHandler } from '../../disputes/events/handlers/dispute-refunded.handler';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const SECRET = 'sandbox-secret';
const run = APP_URL ? describe : describe.skip;

run('dispute refund — escrow reversal + settled clawback via relay (integration, real Postgres)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let payments: PaymentService; let dispatcher: OutboxDispatcher;

  const tenantA = randomUUID();
  const buyer = randomUUID();
  const seller = randomUUID();
  const AMOUNT = '120000';
  let reasonId = '';

  const bal = async (kind: string, code: string, userId?: string) =>
    BigInt((await admin.query(
      `SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind=$1 AND account_code=$2 AND ($3::uuid IS NULL OR owner_user_id=$3)`,
      [kind, code, userId ?? null])).rows[0]?.b ?? '0');

  // S6 device-test P0 fix: createIntent now validates the order reference (existence, buyer,
  // payable state, exact amount) BEFORE calling the gateway — seed a real 'payment_pending' order
  // row for this orderId first (fixture fix, not a weakened check; see payment.service.ts).
  const seedOrder = (orderId: string) => admin.query(
    `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, total_minor, status, version, created_at)
     VALUES ($1,$2,$3,$4,$5,'direct','INR',$6,$6,'payment_pending',1, now())`,
    [orderId, tenantA, `KV-${orderId.slice(0, 8)}`, buyer, seller, AMOUNT]);

  const captureInto = async (orderId: string) => {
    await seedOrder(orderId);
    const intent = await payments.createIntent(tenantA, buyer, `idem-${randomUUID()}`, { purpose: 'direct_order', amountMinor: AMOUNT, currencyCode: 'INR', referenceType: 'order', referenceId: orderId } as any);
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, event: 'payment.captured', tenant_id: tenantA, order_id: intent.gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(AMOUNT), method: 'upi' });
    await payments.handleWebhook('sandbox', body, createHmac('sha256', SECRET).update(body).digest('hex'));
  };
  const seedResolved = (disputeId: string, orderId: string) => admin.query(
    `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'dispute',$2,'disputes.dispute_resolved',$3::jsonb)`,
    [tenantA, disputeId, JSON.stringify({ v: 1, disputeId, orderId, resolutionType: 'refund_full', raisedBy: buyer, againstUser: seller })]);
  const insertDispute = (disputeId: string, orderId: string) => admin.query(
    `INSERT INTO disputes (id, tenant_id, order_id, raised_by, against_user, reason_id, status, resolution_type) VALUES ($1,$2,$3,$4,$5,$6,'resolved','refund_full')`,
    [disputeId, tenantA, orderId, buyer, seller, reasonId]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeUser(admin, buyer); await makeUser(admin, seller);
    await admin.query(`UPDATE feature_flags SET is_enabled=true WHERE key='dispute_refunds'`);
    await admin.query(`UPDATE feature_flags SET is_enabled=false WHERE key='commission_split'`);   // full release (no commission rule needed)
    reasonId = (await admin.query(`SELECT id FROM lookup_values WHERE type_code='dispute_reason' AND code='poor_quality' AND tenant_id IS NULL`)).rows[0].id;

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const wallet = new InProcessWalletClient(new LedgerRepository());
    const registry = new GatewayRegistry();
    registry.register(new SandboxGateway(SECRET), true);
    payments = new PaymentService(uow, outbox, idem, metrics, wallet, audit, new PaymentRepository(replica as any), registry, new OrderRepository(replica as any),
    // PC-56 TENANT-4d-2: PaymentService now asks the tenancy module whether a 'saas_invoice' reference's amount
    // is exactly what is outstanding, and reads the self-pay flag. Neither is exercised by THIS suite (no intent
    // here carries that referenceType), so both are stubbed to throw/deny — a stub that silently allowed would
    // make a future test pass for the wrong reason.
    { assertPayableAmount: async () => { throw new Error('saas_invoice reference not expected in this suite'); } } as any,
    { isEnabled: async () => false } as any,
    );

    const flags = new FlagsService(pools, new InMemoryCacheService());
    const lines = new SettlementLineRepository();
    const pricing = new SettlementPricingService(new CommissionRuleRepository(replica as any), new TaxRuleRepository(replica as any));
    const handlers = new OutboxHandlerRegistry();
    handlers.register(new OrderCompletedHandler(wallet, flags, pricing, lines));                                          // settle escrow → seller
    handlers.register(new DisputeResolvedHandler(wallet, flags, new PaymentRepository(replica as any), lines, pricing, outbox, metrics));  // dispute refund / clawback
    handlers.register(new DisputeRefundedHandler(new DisputeRepository(replica as any)));                                 // stamp resolution_txn_id
    dispatcher = new OutboxDispatcher(admin, handlers, metrics);
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('A) not-settled refund_full → escrow → buyer wallet (zero-sum) + stamps resolution_txn_id', async () => {
    const orderId = uuidv7(); const disputeId = uuidv7();
    await captureInto(orderId);
    await insertDispute(disputeId, orderId);
    const escrowBefore = await bal('platform', 'escrow');
    const buyerBefore = await bal('user', 'main', buyer);

    await seedResolved(disputeId, orderId);
    await dispatcher.relayBatch();

    expect(await bal('platform', 'escrow')).toBe(escrowBefore - BigInt(AMOUNT));   // this order's escrow drained
    expect(await bal('user', 'main', buyer)).toBe(buyerBefore + BigInt(AMOUNT));    // buyer refunded
    const d = await admin.query(`SELECT resolution_txn_id FROM disputes WHERE id=$1`, [disputeId]);
    expect(d.rows[0].resolution_txn_id).not.toBeNull();
  });

  it('B) settled clawback: settle escrow → seller, then refund_full REVERSES it (seller→escrow→buyer), zero-sum', async () => {
    const orderId = uuidv7(); const disputeId = uuidv7();
    await captureInto(orderId);
    const sellerBefore = await bal('user', 'main', seller);

    // settle: escrow → seller (full release, commission_split OFF) — records a settlement_line
    await admin.query(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'order',$2,'orders.order_completed',$3::jsonb)`,
      [tenantA, orderId, JSON.stringify({ v: 1, orderId, sellerUserId: seller, totalMinor: AMOUNT, currencyCode: 'INR' })]);
    await dispatcher.relayBatch();
    expect(await bal('user', 'main', seller)).toBe(sellerBefore + BigInt(AMOUNT));            // seller paid
    expect((await admin.query(`SELECT count(*)::int c FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [tenantA, orderId])).rows[0].c).toBe(1);
    const escrowAfterSettle = await bal('platform', 'escrow');
    const buyerBefore = await bal('user', 'main', buyer);

    // resolve refund_full → clawback the settlement, then refund the buyer
    await insertDispute(disputeId, orderId);
    await seedResolved(disputeId, orderId);
    await dispatcher.relayBatch();

    expect(await bal('user', 'main', seller)).toBe(sellerBefore);                              // seller clawed back to baseline
    expect(await bal('user', 'main', buyer)).toBe(buyerBefore + BigInt(AMOUNT));               // buyer refunded
    expect(await bal('platform', 'escrow')).toBe(escrowAfterSettle);                           // escrow net unchanged (restored then refunded)
    expect((await admin.query(`SELECT count(*)::int c FROM settlement_lines WHERE tenant_id=$1 AND order_id=$2`, [tenantA, orderId])).rows[0].c).toBe(0);   // line reversed
    const d = await admin.query(`SELECT resolution_txn_id FROM disputes WHERE id=$1`, [disputeId]);
    expect(d.rows[0].resolution_txn_id).not.toBeNull();
  });
});
