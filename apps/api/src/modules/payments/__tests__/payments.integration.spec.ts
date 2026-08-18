// modules/payments/__tests__/payments.integration.spec.ts
// REAL end-to-end proof of the payments + wallet vertical against a live Postgres (no infra mocks).
// Instantiates the CONCRETE stack (PgUnitOfWork + RLS, outbox, idempotency, the in-process wallet
// client = the only ledger writer) and verifies the money path:
//   1. create a payment intent (sandbox gateway) → persisted 'initiated' + outbox payment_initiated;
//   2. a SIGNATURE-VERIFIED 'payment.captured' webhook → payment 'success', a ZERO-SUM double-entry
//      ledger txn posted (escrow credited, gateway debited), ledger_txn_id linked, outbox
//      payment_succeeded — IN ONE TX;
//   3. idempotency: replaying the same webhook event does NOT double-post the ledger;
//   4. a FORGED webhook (bad signature) is rejected (fail closed);
//   5. ROW-LEVEL SECURITY: tenant B cannot see tenant A's payment.
// Schema + seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
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
import { uuidv7 } from '../../../core/database/uuid.util';

import { OrderRepository } from '../../orders/repositories/order.repository';
import { PaymentRepository } from '../repositories/payment.repository';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { PaymentService } from '../services/payment.service';
import { WebhookSignatureError, PaymentCurrencyMismatchError } from '../domain/payments.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const SECRET = 'sandbox-secret';
const run = APP_URL ? describe : describe.skip;

run('payments + wallet (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let inspect: Pool;
  let payments: PaymentService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const buyer = randomUUID();
  const seller = randomUUID();
  const AMOUNT = '150000';                 // ₹1500.00
  let paymentId = '';
  let gatewayOrderId = '';

  const webhook = (event: string, extra: Record<string, unknown>) => {
    const body = JSON.stringify({ id: `evt_${randomUUID()}`, event, tenant_id: tenantA, ...extra });
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    return { body, sig };
  };
  const escrowBalance = async (): Promise<string> => {
    const r = await admin.query(`SELECT COALESCE(cached_balance_minor,0)::bigint b FROM wallet_accounts WHERE owner_kind='platform' AND account_code='escrow'`);
    return String(r.rows[0]?.b ?? '0');
  };
  // S6 device-test P0 fix: createIntent now validates the order reference (existence, buyer,
  // payable state, exact amount) BEFORE calling the gateway — seed a real 'payment_pending' order
  // for each intent (fixture fix, not a weakened check; see payment.service.ts).
  const seedOrder = (orderId: string, amountMinor = AMOUNT) => admin.query(
    `INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, source, currency_code, subtotal_minor, total_minor, status, version, created_at)
     VALUES ($1,$2,$3,$4,$5,'direct','INR',$6,$6,'payment_pending',1, now())`,
    [orderId, tenantA, `KV-${orderId.slice(0, 8)}`, buyer, seller, amountMinor]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, buyer); await makeUser(admin, seller);

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

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('creates a payment intent → persisted initiated + outbox payment_initiated', async () => {
    const orderId = uuidv7(); await seedOrder(orderId);
    const res = await payments.createIntent(tenantA, buyer, `idem-${randomUUID()}`, { purpose: 'direct_order', amountMinor: AMOUNT, currencyCode: 'INR', referenceType: 'order', referenceId: orderId } as any);
    paymentId = res.paymentId; gatewayOrderId = res.gatewayOrderId;
    expect(res.status).toBe('initiated');
    const row = await admin.query(`SELECT status, tenant_id FROM payments WHERE id=$1`, [paymentId]);
    expect(row.rows[0].status).toBe('initiated');
    expect(row.rows[0].tenant_id).toBe(tenantA);
    const ev = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='payments.payment_initiated'`, [paymentId]);
    expect(ev.rowCount).toBe(1);
  });

  it('captured webhook → success + ZERO-SUM ledger (escrow credited) + payment_succeeded', async () => {
    const { body, sig } = webhook('payment.captured', { order_id: gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(AMOUNT), method: 'upi' });
    await payments.handleWebhook('sandbox', body, sig);

    const p = await admin.query(`SELECT status, ledger_txn_id FROM payments WHERE id=$1`, [paymentId]);
    expect(p.rows[0].status).toBe('success');
    const txnId = p.rows[0].ledger_txn_id;
    expect(txnId).toBeTruthy();

    // the double-entry txn sums to ZERO (no money created/destroyed)
    const sum = await admin.query(`SELECT COALESCE(SUM(amount_minor),0)::bigint s FROM ledger_entries WHERE txn_id=$1`, [txnId]);
    expect(String(sum.rows[0].s)).toBe('0');
    // platform escrow holds the captured amount
    const esc = await admin.query(`SELECT cached_balance_minor FROM wallet_accounts WHERE owner_kind='platform' AND account_code='escrow'`);
    expect(String(esc.rows[0].cached_balance_minor)).toBe(AMOUNT);

    const ev = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='payments.payment_succeeded'`, [paymentId]);
    expect(ev.rowCount).toBe(1);
  });

  it('is idempotent — replaying the SAME webhook event does not double-post the ledger', async () => {
    const evt = `evt_dup_${randomUUID()}`;
    const body = JSON.stringify({ id: evt, event: 'payment.captured', tenant_id: tenantA, order_id: gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(AMOUNT), method: 'upi' });
    const sig = createHmac('sha256', SECRET).update(body).digest('hex');
    await payments.handleWebhook('sandbox', body, sig);
    await payments.handleWebhook('sandbox', body, sig);   // replay
    const esc = await admin.query(`SELECT cached_balance_minor FROM wallet_accounts WHERE owner_kind='platform' AND account_code='escrow'`);
    expect(String(esc.rows[0].cached_balance_minor)).toBe(AMOUNT); // unchanged — captured exactly once
  });

  it('rejects a forged webhook (bad signature) — fail closed', async () => {
    const body = JSON.stringify({ id: 'evt_forged', event: 'payment.captured', tenant_id: tenantA, order_id: gatewayOrderId, amount: Number(AMOUNT) });
    await expect(payments.handleWebhook('sandbox', body, 'deadbeef')).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('rejects a captured webhook whose CURRENCY differs from the payment — tamper guard', async () => {
    const orderId = uuidv7(); await seedOrder(orderId);
    const intent = await payments.createIntent(tenantA, buyer, `idem-${randomUUID()}`, { purpose: 'direct_order', amountMinor: AMOUNT, currencyCode: 'INR', referenceType: 'order', referenceId: orderId } as any);
    const { body, sig } = webhook('payment.captured', { order_id: intent.gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(AMOUNT), currency: 'USD', method: 'upi' });
    await expect(payments.handleWebhook('sandbox', body, sig)).rejects.toBeInstanceOf(PaymentCurrencyMismatchError);
    const p = await admin.query(`SELECT status FROM payments WHERE id=$1`, [intent.paymentId]);
    expect(p.rows[0].status).not.toBe('success');   // money was NOT moved
  });

  it('dedups on the delivery event-id header — same header, different body, is a no-op', async () => {
    const orderId = uuidv7(); await seedOrder(orderId);
    const intent = await payments.createIntent(tenantA, buyer, `idem-${randomUUID()}`, { purpose: 'direct_order', amountMinor: AMOUNT, currencyCode: 'INR', referenceType: 'order', referenceId: orderId } as any);
    const before = await escrowBalance();
    const hdr = `evt_hdr_${randomUUID()}`;
    const a = webhook('payment.captured', { order_id: intent.gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(AMOUNT), currency: 'INR', method: 'upi' });
    const b = webhook('payment.captured', { order_id: intent.gatewayOrderId, payment_id: `pay_${randomUUID()}`, amount: Number(AMOUNT), currency: 'INR', method: 'upi' });
    await payments.handleWebhook('sandbox', a.body, a.sig, hdr);
    await payments.handleWebhook('sandbox', b.body, b.sig, hdr);   // same delivery id → deduped, never processed twice
    const delta = BigInt(await escrowBalance()) - BigInt(before);
    expect(delta.toString()).toBe(AMOUNT);   // escrow moved EXACTLY once despite two deliveries
  });

  it('the WHOLE ledger nets to zero (global double-entry invariant — what reconciliation asserts)', async () => {
    const sum = await admin.query(`SELECT COALESCE(SUM(amount_minor),0)::bigint s FROM ledger_entries`);
    expect(String(sum.rows[0].s)).toBe('0');
  });

  it('RLS: tenant B cannot see tenant A\'s payment', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM payments WHERE id=$1`, [paymentId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[payments] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
