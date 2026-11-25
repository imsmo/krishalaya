// modules/payments/__tests__/wallet-autopay-insights.integration.spec.ts
// REAL end-to-end proof of P0-8 (wallet money-insights + UPI autopay mandates) against a live Postgres
// (no infra mocks). Instantiates the CONCRETE stack (PgUnitOfWork + RLS, outbox, idempotency, the
// in-process wallet client = the only ledger writer) and verifies:
//   1. EARNINGS read-model: a real credit posted to the user's wallet is aggregated FLOAT-FREE (sums are
//      bigint strings), bounded by the resolved window, and is the caller's OWN wallet only;
//   2. anti-IDOR: a DIFFERENT viewer (non-owner, non-moderator) gets a zero/empty insights view;
//   3. AUTOPAY: register → pending mandate persisted with a MASKED vpa (never the raw VPA) + mandate_registered
//      outbox; list returns it; cancel transitions it to 'cancelled'; a non-owner cancel fails closed (404);
//   4. RLS: tenant B cannot see tenant A's mandate row.
// Schema + seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { platform, userMain, PlatformAccount } from '../../../core/wallet/account-codes';

import { MandateRepository } from '../repositories/mandate.repository';
import { MandateService } from '../services/mandate.service';
import { WalletInsightsReadModel } from '../read-models/wallet-insights.read-model';
import { GatewayRegistry } from '../gateway/gateway.registry';
import { SandboxGateway } from '../gateway/sandbox.gateway';
import { MandateNotFoundError } from '../domain/payments.errors';
import { RegisterMandateSchema } from '../dto/create-mandate.dto';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('wallet insights + autopay (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;
  let mandates: MandateService;
  let insights: WalletInsightsReadModel;
  let wallet: InProcessWalletClient;
  let uow: PgUnitOfWork;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const earner = randomUUID();
  const other = randomUUID();
  const CREDIT = 250000n;                  // ₹2500.00 credited to the earner's wallet

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, earner); await makeUser(admin, other);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const registry = new GatewayRegistry();
    registry.register(new SandboxGateway('sandbox-secret'), true);
    mandates = new MandateService(uow, outbox, idem, metrics, audit, new MandateRepository(replica as any), registry);
    insights = new WalletInsightsReadModel(pools as any);
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await admin?.end(); });

  it('EARNINGS: a real wallet credit is aggregated float-free as a bigint string (caller\'s own wallet)', async () => {
    // post a real double-entry credit: platform escrow → earner main (zero-sum), via the only ledger writer.
    await uow.run(tenantA, async (tx) => {
      await wallet.post(tx, {
        tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `itest:earn:${randomUUID()}`,
        referenceType: 'payment', referenceId: randomUUID(), initiatedBy: earner,
        legs: [
          { account: userMain(earner, 'INR'), amountMinor: CREDIT },
          { account: platform(PlatformAccount.Escrow, 'INR'), amountMinor: -CREDIT },
        ],
      });
    }, { userId: earner });

    const view = await insights.earnings(earner, earner, false, { currencyCode: 'INR' });
    expect(typeof view.totalMinor).toBe('string');
    expect(BigInt(view.totalMinor)).toBeGreaterThanOrEqual(CREDIT);   // includes at least our credit
    expect(view.byMonth.every((b) => typeof b.amountMinor === 'string')).toBe(true);
    // window is bounded + ordered
    expect(new Date(view.fromIso).getTime()).toBeLessThan(new Date(view.toIso).getTime());
  });

  it('anti-IDOR: a non-owner / non-moderator viewer gets an empty insights view (never another user\'s money)', async () => {
    const view = await insights.earnings(other, earner, false, { currencyCode: 'INR' }); // other ≠ earner, canModerate=false
    expect(view.totalMinor).toBe('0');
    expect(view.byMonth).toHaveLength(0);
    expect(view.byType).toHaveLength(0);
  });

  it('AUTOPAY register → pending mandate with a MASKED vpa + mandate_registered outbox (raw VPA never stored)', async () => {
    const m = await mandates.register(tenantA, earner, `idem-${randomUUID()}`, {
      vpa: 'ramesh.farmer@okhdfcbank', purpose: 'membership', maxAmountMinor: '50000', currencyCode: 'INR', frequency: 'monthly',
    } as any, null);
    expect(m.status).toBe('pending');
    expect(m.vpaMasked).toBe('ra***@okhdfcbank');

    const row = await admin.query(`SELECT status, vpa_masked, user_id, tenant_id FROM upi_mandates WHERE id=$1`, [m.id]);
    expect(row.rows[0].status).toBe('pending');
    expect(row.rows[0].vpa_masked).toBe('ra***@okhdfcbank');
    expect(row.rows[0].vpa_masked).not.toContain('ramesh.farmer');     // raw VPA never persisted
    const ev = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='payments.mandate_registered'`, [m.id]);
    expect(ev.rowCount).toBe(1);
    const evPayload = await admin.query(`SELECT payload::text p FROM outbox_events WHERE aggregate_id=$1`, [m.id]);
    expect(evPayload.rows[0].p).not.toContain('ramesh.farmer');        // raw VPA never in the event either
  });

  it('AUTOPAY list returns the caller\'s mandate; cancel transitions it to cancelled', async () => {
    const list = await mandates.list(tenantA, earner, { limit: 20 });
    expect(list.items.length).toBeGreaterThanOrEqual(1);
    const id = list.items[0].id;
    const cancelled = await mandates.cancel(tenantA, { userId: earner, canModerate: false }, id, { reason: 'itest' }, null);
    expect(cancelled.status).toBe('cancelled');
    const row = await admin.query(`SELECT status FROM upi_mandates WHERE id=$1`, [id]);
    expect(row.rows[0].status).toBe('cancelled');
  });

  it('anti-IDOR: a non-owner cancel fails closed with 404 (no enumeration)', async () => {
    const m = await mandates.register(tenantA, earner, `idem-${randomUUID()}`, {
    // PC-56 TEST-1: through the controller's own schema, so its defaults (currency, frequency) apply as they do over HTTP —
    // the raw object `as any` reached the INSERT with NULLs the DTO never lets through.
    ...RegisterMandateSchema.parse({ vpa: 'second.handle@ybl', purpose: 'loan_emi', maxAmountMinor: '10000' }),
    }, null);
    await expect(mandates.cancel(tenantA, { userId: other, canModerate: false }, m.id, {}, null))
      .rejects.toBeInstanceOf(MandateNotFoundError);
    const row = await admin.query(`SELECT status FROM upi_mandates WHERE id=$1`, [m.id]);
    expect(row.rows[0].status).toBe('pending');   // untouched by the non-owner
  });

  it('RLS: tenant B cannot see tenant A\'s mandate row', async () => {
    const m = await mandates.register(tenantA, earner, `idem-${randomUUID()}`, {
    ...RegisterMandateSchema.parse({ vpa: 'third.handle@ybl', purpose: 'general', maxAmountMinor: '20000' }),
    }, null);
    const inspect = new Pool({ connectionString: APP_URL });
    try {
      const countAs = async (t: string) => {
        const c = await inspect.connect();
        try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
          const r = await c.query(`SELECT count(*)::int n FROM upi_mandates WHERE id=$1`, [m.id]); await c.query('COMMIT'); return r.rows[0].n as number;
        } finally { c.release(); }
      };
      const seenByA = await countAs(tenantA);
      const seenByB = await countAs(tenantB);
      const isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
      expect(seenByA).toBe(1);
      if (!isSuperuser) expect(seenByB).toBe(0);   // RLS blocks cross-tenant read (superuser bypasses RLS)
    } finally { await inspect.end(); }
  });
});
