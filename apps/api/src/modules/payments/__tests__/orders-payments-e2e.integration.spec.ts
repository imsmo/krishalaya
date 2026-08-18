// modules/payments/__tests__/orders-payments-e2e.integration.spec.ts
// REAL end-to-end proof that order ↔ payment events flow through the OUTBOX RELAY (Law 4), against
// a live Postgres. No synchronous cross-module calls — everything moves via outbox + dispatcher:
//   1. an order sits in payment_pending; a payment intent is created for it;
//   2. a signed 'payment.captured' webhook → payment success + escrow credited + emits
//      payments.payment_succeeded;
//   3. the dispatcher relays it → PaymentSucceededHandler (orders) → the order becomes 'confirmed';
//   4. an orders.order_completed event → the dispatcher relays it → OrderCompletedHandler
//      (payments) → escrow is RELEASED to the seller's wallet (zero-sum throughout);
//   5. the seller withdraws via PayoutService → wallet debited, a payout queued.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
// The relay runs on the ADMIN (privileged) pool — the production equivalent is the worker as the
// BYPASSRLS kv_relay role (migration 0018).
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
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../../../core/outbox/outbox.dispatcher';
import { uuidv7 } from '../../../core/database/uuid.util';

import { OrderRepository } from '../../orders/repositories/order.repository';
import { PaymentSucceededHandler } from '../../orders/events/handlers/payment-succeeded.handler';
import { PaymentRepository } from '../repositories/payment.repository';
import { PayoutRepository } from '../repositories/payout.repository';
import { PaymentService } from '../services/payment.service';
import { PayoutService } from '../services/payout.service';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { SandboxPayoutGateway } from '../gateway/sandbox-payout.gateway';
import { OrderCompletedHandler } from '../events/handlers/order-completed.handler';
import { FlagsService } from '../../../core/feature-flags/flags.service';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { SettlementPricingService } from '../services/settlement-pricing.service';
import { CommissionRuleRepository } from '../repositories/commission-rule.repository';
import { TaxRuleRepository } from '../repositories/tax-rule.repository';
import { SettlementLineRepository } from '../repositories/settlement-line.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const SECRET = 'sandbox-secret';
const run = APP_URL ? describe : describe.skip;

run('orders ↔ payments end-to-end via outbox relay (integration, real Postgres)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let payments: PaymentService;
  let payouts: PayoutService;
  let dispatcher: OutboxDispatcher;

  const tenantA = randomUUID();
  const buyer = randomUUID();
  const seller = randomUUID();
  const bankAccountId = randomUUID();
  const orderId = uuidv7();
  const AMOUNT = '150000';

  const escrowBal = async () => (await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='platform' AND account_code='escrow'`)).rows[0]?.b ?? '0';
  const sellerBal = async () => (await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND owner_user_id=$1 AND account_code='main'`, [seller])).rows[0]?.b ?? '0';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A');
    await makeUser(admin, buyer); await makeUser(admin, seller);
    await admin.query(`INSERT INTO bank_accounts (id, user_id, tenant_id, account_kind, vault_ref) VALUES ($1,$2,$3,'upi','vault_seller') ON CONFLICT DO NOTHING`, [bankAccountId, seller, tenantA]);
    // S3 review finding: requestPayout now gates on kyc_status='verified' — seed a verified role for
    // the seller (this fixture predates the KYC gate; makeUser() alone leaves no role row).
    await admin.query(
      `INSERT INTO user_tenant_roles (id, user_id, tenant_id, role_id, kyc_status, is_active)
       SELECT gen_random_uuid(), $1, $2, r.id, 'verified', true FROM roles r WHERE r.code='farmer'
       ON CONFLICT (user_id, tenant_id, role_id) DO NOTHING`, [seller, tenantA]);
    // an order awaiting payment (minimal row — the relay handler only needs the header)
    await admin.query(
      `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, total_minor, status, version, created_at)
       VALUES ($1,$2,$3,$4,$5,'direct','INR',$6,$6,'payment_pending',1, now())`,
      [orderId, tenantA, `KV-${orderId.slice(0, 8)}`, buyer, seller, AMOUNT]);

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
    payouts = new PayoutService(uow, outbox, idem, metrics, wallet, new SandboxPayoutGateway('success'), audit, new PayoutRepository(replica as any));

    // the relay + both handlers (orders consumes payment_succeeded; payments consumes order_completed)
    const handlers = new OutboxHandlerRegistry();
    handlers.register(new PaymentSucceededHandler(new OrderRepository(replica as any), outbox));
    // commission_split defaults OFF → full escrow release to the seller (this spec asserts that path)
    const pricing = new SettlementPricingService(new CommissionRuleRepository(replica as any), new TaxRuleRepository(replica as any));
    handlers.register(new OrderCompletedHandler(wallet, new FlagsService(pools, new InMemoryCacheService()), pricing, new SettlementLineRepository()));
    dispatcher = new OutboxDispatcher(admin, handlers, metrics);
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('payment capture → relay → order becomes confirmed; escrow holds the funds', async () => {
    const intent = await payments.createIntent(tenantA, buyer, `idem-${randomUUID()}`, { purpose: 'direct_order', amountMinor: AMOUNT, currencyCode: 'INR', referenceType: 'order', referenceId: orderId } as any);
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, event: 'payment.captured', tenant_id: tenantA, order_id: intent.gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(AMOUNT), method: 'upi' });
    await payments.handleWebhook('sandbox', body, createHmac('sha256', SECRET).update(body).digest('hex'));
    expect(String(await escrowBal())).toBe(AMOUNT);

    // before relay the order is still awaiting payment
    let st = await admin.query(`SELECT status FROM orders WHERE id=$1`, [orderId]);
    expect(st.rows[0].status).toBe('payment_pending');

    const n = await dispatcher.relayBatch();        // relays payment_succeeded → orders handler
    expect(n).toBeGreaterThanOrEqual(1);
    st = await admin.query(`SELECT status FROM orders WHERE id=$1`, [orderId]);
    expect(st.rows[0].status).toBe('confirmed');     // confirmed via the event, not a direct call
  });

  it('order_completed → relay → escrow released to the seller wallet (zero-sum)', async () => {
    await admin.query(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1,'order',$2,'orders.order_completed',$3::jsonb)`,
      [tenantA, orderId, JSON.stringify({ v: 1, orderId, sellerUserId: seller, totalMinor: AMOUNT, currencyCode: 'INR' })]);

    await dispatcher.relayBatch();
    expect(String(await sellerBal())).toBe(AMOUNT);   // seller credited
    expect(String(await escrowBal())).toBe('0');      // escrow released

    // the settlement is idempotent — replaying the same completion does not double-pay the seller
    await admin.query(
      `INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
       VALUES ($1,'order',$2,'orders.order_completed',$3::jsonb)`,
      [tenantA, orderId, JSON.stringify({ v: 1, orderId, sellerUserId: seller, totalMinor: AMOUNT, currencyCode: 'INR' })]);
    await dispatcher.relayBatch();
    expect(String(await sellerBal())).toBe(AMOUNT);   // unchanged — settled exactly once
  });

  it('seller withdraws via payout → wallet debited, payout queued (no overdraw)', async () => {
    const res = await payouts.requestPayout(tenantA, seller, `idem-${randomUUID()}`, { amountMinor: AMOUNT, bankAccountId, purpose: 'settlement', currencyCode: 'INR' } as any);
    expect(res.status).toBe('queued');
    expect(String(await sellerBal())).toBe('0');       // funds reserved out of the wallet
    const row = await admin.query(`SELECT status, amount_minor FROM payouts WHERE id=$1`, [res.payoutId]);
    expect(row.rows[0].status).toBe('queued');
    expect(String(row.rows[0].amount_minor)).toBe(AMOUNT);

    // a further withdrawal beyond the (now zero) balance is rejected — no overdraw
    await expect(payouts.requestPayout(tenantA, seller, `idem-${randomUUID()}`, { amountMinor: '1', bankAccountId, purpose: 'settlement', currencyCode: 'INR' } as any)).rejects.toBeTruthy();
  });
});
