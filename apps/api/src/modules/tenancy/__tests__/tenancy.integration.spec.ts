// modules/tenancy/__tests__/tenancy.integration.spec.ts
// REAL end-to-end proof that a tenancy subscription is the QUOTA FOUNDATION, against a live Postgres:
//   1. a platform admin creates a plan with a limit (max_orders_month=2); a tenant subscribes → active;
//   2. GET-current returns the plan limits + usage; the REAL core QuotaService now ENFORCES that limit
//      (passes under the cap, throws QuotaExceededError at it) — driven entirely by the subscription;
//   3. cancelling the subscription removes the limit (no active subscription ⇒ unlimited) — quota follows
//      the subscription status; one LIVE subscription per tenant is enforced;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's subscription.
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
import { PgQuotaService } from '../../../core/quota/quota.service.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { QuotaExceededError } from '../../../shared/errors/app-error';

import { PlanRepository } from '../repositories/plan.repository';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { PlanService } from '../services/plan.service';
import { SubscriptionService } from '../services/subscription.service';
import { AlreadySubscribedError } from '../domain/tenancy.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('tenancy slice (integration, real Postgres + RLS + quota)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let quota: PgQuotaService;
  let plans: PlanService; let subscriptions: SubscriptionService;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const platformAdmin = randomUUID();
  const tenantAdmin = randomUUID();
  const METRIC = 'max_orders_month';
  let planId = ''; let subId = '';
  const planActor = () => ({ userId: platformAdmin, tenantId: tenantA, canManagePlans: true, canManageSub: true });
  const subActor = () => ({ userId: tenantAdmin, tenantId: tenantA, canManagePlans: false, canManageSub: true });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, platformAdmin); await makeUser(admin, tenantAdmin);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const idem = new PgIdempotencyService(pools);
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    quota = new PgQuotaService(pools, shards);
    const planRepo = new PlanRepository(replica as any);
    const subRepo = new SubscriptionRepository(replica as any);
    plans = new PlanService(uow, outbox, idem, metrics, audit, planRepo);
    // PC-56 TENANT-4d-5 added the billing-notice enricher to this service's constructor. A no-op here on
    // purpose: these integration specs exercise the money arithmetic and RLS against real Postgres, and
    // returning the payload unchanged is exactly what the real service does for a tenant with billing
    // notices switched off — which is the default on every deployment. The notice plane has its own
    // behavioural suite (tenant4d5-billing-notices.spec.ts).
    const noNotices = { enrich: async (_tx: unknown, _t: string, _e: string, payload: unknown) => payload } as never;
    subscriptions = new SubscriptionService(uow, outbox, idem, metrics, audit, planRepo, subRepo, noNotices);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('platform admin creates a plan; tenant subscribes → active; current shows limits', async () => {
    const p = await plans.create(planActor(), `idem-${randomUUID()}`, { code: `growth_${randomUUID().slice(0, 6)}`, defaultName: 'Growth', countryCode: 'IN', currencyCode: 'INR', monthlyPriceMinor: '99900', annualPriceMinor: '999000', limits: { [METRIC]: '2' } } as any);
    planId = p.id; expect(p.limits[METRIC]).toBe('2');
    const s = await subscriptions.subscribe(tenantA, subActor(), `idem-${randomUUID()}`, { planId, billingCycle: 'monthly' } as any);
    subId = s.id; expect(s.status).toBe('active');
    const cur = await subscriptions.getCurrent(tenantA);
    expect(cur.subscription!.id).toBe(subId); expect(cur.limits[METRIC]).toBe('2');

    await expect(subscriptions.subscribe(tenantA, subActor(), `idem-${randomUUID()}`, { planId, billingCycle: 'monthly' } as any)).rejects.toBeInstanceOf(AlreadySubscribedError);
  });

  it('core QuotaService enforces the subscription\'s limit (passes under, throws at the cap)', async () => {
    await quota.assertWithinLimit(tenantA, METRIC);                          // 0 < 2 ✓
    await uow.run(tenantA, (tx) => quota.increment(tx, tenantA, METRIC, 1), { userId: 'system' });
    await quota.assertWithinLimit(tenantA, METRIC);                          // 1 < 2 ✓
    await uow.run(tenantA, (tx) => quota.increment(tx, tenantA, METRIC, 1), { userId: 'system' });
    await expect(quota.assertWithinLimit(tenantA, METRIC)).rejects.toBeInstanceOf(QuotaExceededError);   // 2 >= 2 ✗
  });

  it('cancelling the subscription removes the limit (no active subscription ⇒ unlimited)', async () => {
    await subscriptions.cancel(tenantA, subActor(), subId, false, null);
    expect((await admin.query(`SELECT status FROM subscriptions WHERE id=$1`, [subId])).rows[0].status).toBe('cancelled');
    await quota.assertWithinLimit(tenantA, METRIC);                          // no active sub ⇒ no limit ⇒ passes despite usage=2
    expect((await subscriptions.getCurrent(tenantA)).subscription).toBeNull();
  });

  it('RLS: tenant B cannot see tenant A\'s subscription', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM subscriptions WHERE id=$1`, [subId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[tenancy] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
