// modules/memberships/__tests__/memberships.integration.spec.ts
// REAL end-to-end proof of the membership engine against a live Postgres:
//   1. an admin creates a paid tier (₹99/mo) + a free tier; a user subscribes to the paid tier → the
//      wallet is DEBITED (userMain → platform fees, zero-sum) and the membership goes active;
//   2. one LIVE membership per user (a second subscribe is rejected); a free tier moves no money;
//      cancel ends it (then re-subscribe is allowed);
//   3. the expiry worker lapses a membership past its period end;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's membership.
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
import { LedgerRepository } from '../../../core/wallet/ledger.repository';
import { InProcessWalletClient } from '../../../core/wallet/wallet.client.inprocess';
import { userMain, platform, PlatformAccount } from '../../../core/wallet/account-codes';

import { MembershipTierRepository } from '../repositories/membership-tier.repository';
import { UserMembershipRepository } from '../repositories/user-membership.repository';
import { MembershipTierService } from '../services/membership-tier.service';
import { UserMembershipService } from '../services/user-membership.service';
import { AlreadySubscribedError } from '../domain/memberships.errors';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('memberships slice (integration, real Postgres + RLS + wallet)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool;
  let tiers: MembershipTierService; let memberships: UserMembershipService; let wallet: InProcessWalletClient; let uow: PgUnitOfWork;
  let isSuperuser = false;

  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const adminUser = randomUUID();
  const buyer = randomUUID();
  const freeUser = randomUUID();
  const expUser = randomUUID();
  const mgr = () => ({ userId: adminUser, canManage: true });
  const FEE = 9900n;
  let paidTierId = ''; let freeTierId = ''; let membershipId = '';

  const bal = async (kind: string, code: string, userId?: string) =>
    BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind=$1 AND account_code=$2 AND currency_code='INR' AND ($3::uuid IS NULL OR owner_user_id=$3)`, [kind, code, userId ?? null])).rows[0]?.b ?? '0');
  const fund = (u: string, amount: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, adminUser); await makeUser(admin, buyer); await makeUser(admin, freeUser); await makeUser(admin, expUser);

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
    const tierRepo = new MembershipTierRepository(replica as any);
    const membershipRepo = new UserMembershipRepository(replica as any);
    tiers = new MembershipTierService(uow, outbox, idem, metrics, audit, tierRepo);
    memberships = new UserMembershipService(uow, outbox, idem, metrics, wallet, audit, tierRepo, membershipRepo);

    await fund(buyer, 20000n);
    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('admin creates a paid + a free tier', async () => {
    paidTierId = (await tiers.create(tenantA, mgr(), `idem-${randomUUID()}`, { code: 'plus', defaultName: 'Plus', monthlyFeeMinor: FEE.toString(), benefits: { freeDelivery: true, creditDays: 30 } } as any)).id;
    freeTierId = (await tiers.create(tenantA, mgr(), `idem-${randomUUID()}`, { code: 'free', defaultName: 'Free', monthlyFeeMinor: '0' } as any)).id;
    expect(paidTierId).toBeTruthy(); expect(freeTierId).toBeTruthy();
  });

  it('subscribe to a paid tier debits the wallet (zero-sum) → active; one live membership per user', async () => {
    const feesBefore = await bal('platform', 'fees');
    const m = await memberships.subscribe(tenantA, buyer, `idem-${randomUUID()}`, { tierId: paidTierId, billingCycle: 'monthly' } as any);
    membershipId = m.id; expect(m.status).toBe('active'); expect(m.benefits?.freeDelivery).toBe(true);
    expect(await bal('user', 'main', buyer)).toBe(20000n - FEE);          // buyer debited
    expect(await bal('platform', 'fees')).toBe(feesBefore + FEE);          // fee → platform (zero-sum)
    const ms = await admin.query(`SELECT status FROM user_memberships WHERE id=$1`, [membershipId]);
    expect(ms.rows[0].status).toBe('active');

    await expect(memberships.subscribe(tenantA, buyer, `idem-${randomUUID()}`, { tierId: freeTierId, billingCycle: 'monthly' } as any)).rejects.toBeInstanceOf(AlreadySubscribedError);
  });

  it('a free tier moves no money; cancel ends the membership and frees a re-subscribe', async () => {
    const fm = await memberships.subscribe(tenantA, freeUser, `idem-${randomUUID()}`, { tierId: freeTierId, billingCycle: 'monthly' } as any);
    expect(fm.status).toBe('active');
    expect(await bal('user', 'main', freeUser)).toBe(0n);            // no debit (free tier)

    await memberships.cancel(tenantA, { userId: buyer, canManage: false }, membershipId, null);
    expect((await admin.query(`SELECT status FROM user_memberships WHERE id=$1`, [membershipId])).rows[0].status).toBe('cancelled');
    // no live membership now → re-subscribe allowed (free this time)
    const again = await memberships.subscribe(tenantA, buyer, `idem-${randomUUID()}`, { tierId: freeTierId, billingCycle: 'monthly' } as any);
    expect(again.status).toBe('active');
  });

  it('the expiry worker lapses a membership past its period end', async () => {
    const m = await memberships.subscribe(tenantA, expUser, `idem-${randomUUID()}`, { tierId: freeTierId, billingCycle: 'monthly' } as any);
    await admin.query(`UPDATE user_memberships SET current_period_end = (now() - interval '1 day')::date WHERE id=$1`, [m.id]);
    await memberships.expire(tenantA, m.id);
    expect((await admin.query(`SELECT status FROM user_memberships WHERE id=$1`, [m.id])).rows[0].status).toBe('expired');
  });

  it('RLS: tenant B cannot see tenant A\'s membership', async () => {
    const countAs = async (t: string) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM user_memberships WHERE id=$1`, [membershipId]); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[memberships] superuser bypasses RLS; use kv_app for the strict check'); expect(await countAs(tenantA)).toBe(1); return; }
    expect(await countAs(tenantA)).toBe(1);
    expect(await countAs(tenantB)).toBe(0);
  });
});
