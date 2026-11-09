// modules/equipment/__tests__/equipment.integration.spec.ts
// REAL end-to-end proof of the CHC rental spine against a live Postgres:
//   1. an owner lists an asset + a per-hour rate card; a renter requests a job (rate snapshotted);
//   2. the owner quotes a ₹800 deposit; the renter CONFIRMS → the advance is ESCROWED (renter → Escrow);
//   3. the owner starts (OTP-gated), completes with 3.50h actual (total ₹1750), the renter confirms those hours (PC-56
//      HOTFIX-13 — named update), and the owner SETTLES: the escrow
//      releases to the owner and the ₹950 shortfall is collected from the renter — owner nets ₹1750, all
//      zero-sum; the renter's wallet falls by exactly ₹1750;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's booking.
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
import { QuotaService } from '../../../core/quota/quota.service';

import { EquipmentAssetRepository } from '../repositories/equipment-asset.repository';
import { EquipmentRateRepository } from '../repositories/equipment-rate.repository';
import { EquipmentBookingRepository } from '../repositories/equipment-booking.repository';
import { EquipmentAssetService } from '../services/equipment-asset.service';
import { EquipmentRateService } from '../services/equipment-rate.service';
import { EquipmentBookingService } from '../services/equipment-booking.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

run('equipment CHC rental spine (integration, real Postgres + RLS + escrow settlement)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let assets: EquipmentAssetService; let rates: EquipmentRateService; let rentals: EquipmentBookingService;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const owner = randomUUID(); const renter = randomUUID();
  let categoryId = ''; let assetId = ''; let bookingId = ''; let startOtp = '';
  const ownerActor = { userId: owner, canManage: true, canRent: false, isAdmin: false };
  const renterActor = { userId: renter, canManage: false, canRent: true, isAdmin: false };
  const scheduledAt = new Date(Date.now() + 86400000).toISOString();

  const bal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const escrowBal = async () => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='platform' AND account_code='escrow'`)).rows[0]?.b ?? '0');
  const fund = (u: string, amount: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, owner); await makeUser(admin, renter);
    // [PC-56 HOTFIX-13 · NAMED UPDATE — found on the way] `makeCategory` (test/helpers/fixtures.ts:58-63) binds $2 as both varchar and
    // ltree ("inconsistent types deduced for parameter $2"), so this whole spec was RED at d0ec6717 before any assertion ran (the
    // known fixture trap). It now uses a seeded category, as the newer specs do; no assertion changed for it.
    categoryId = (await admin.query(`SELECT id FROM categories ORDER BY id LIMIT 1`)).rows[0].id;

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
    const assetRepo = new EquipmentAssetRepository(replica as any);
    const rateRepo = new EquipmentRateRepository(replica as any);
    const bookingRepo = new EquipmentBookingRepository(replica as any);
    assets = new EquipmentAssetService(uow, outbox, idem, new AllowAllQuota(), metrics, assetRepo);
    rates = new EquipmentRateService(uow, outbox, metrics, rateRepo, assetRepo);
    rentals = new EquipmentBookingService(uow, outbox, idem, metrics, audit, config, wallet, bookingRepo, assetRepo, rateRepo);

    await fund(renter, 1_000_000n);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('owner lists an asset + a ₹500/hr rate card', async () => {
    assetId = (await assets.register(tenantA, ownerActor, `idem-${randomUUID()}`, { categoryId, regNo: 'GJ01AB1234', hpRating: 50 } as any)).id;
    const rate = await rates.setRate(tenantA, ownerActor, assetId, { rateBasis: 'per_hour', rateMinor: '50000', includesOperator: true, includesFuel: false } as any);
    expect(rate.rateMinor).toBe('50000');
  });

  it('renter requests → owner quotes ₹800 deposit → renter confirms (escrow hold)', async () => {
    const b = await rentals.request(tenantA, renterActor, `idem-${randomUUID()}`, { assetId, rateBasis: 'per_hour', estQuantity: '4.00', scheduledAt, taskDesc: 'Ploughing' } as any);
    bookingId = b.id; expect(b.status).toBe('requested'); expect(b.rateMinor).toBe('50000');
    await rentals.quote(tenantA, ownerActor, bookingId, { advanceMinor: '80000' } as any);
    const escBefore = await escrowBal(); const rBefore = await bal(renter);
    const confirmed: any = await rentals.confirm(tenantA, renterActor, bookingId, `idem-${randomUUID()}`);
    expect(confirmed.status).toBe('confirmed'); startOtp = confirmed.startOtp; expect(startOtp).toMatch(/^\d{6}$/);
    expect((await escrowBal()) - escBefore).toBe(80000n);     // advance escrowed
    expect(rBefore - (await bal(renter))).toBe(80000n);       // renter debited the deposit
  });

  it('rejects start with a wrong OTP, accepts the right one', async () => {
    await expect(rentals.start(tenantA, ownerActor, bookingId, { otp: '000000' } as any)).rejects.toThrow();
    expect((await rentals.start(tenantA, ownerActor, bookingId, { otp: startOtp } as any)).status).toBe('in_progress');
  });

  it('completes (3.50h) and SETTLES: owner nets ₹1750, renter pays ₹1750, escrow→0 (zero-sum)', async () => {
    await rentals.complete(tenantA, ownerActor, bookingId, { actualQuantity: '3.50' } as any);
    // [PC-56 HOTFIX-13 · NAMED UPDATE, founder Q1-A 2026-11-09] the bill (₹1750) is above the deposit (₹800), so nothing beyond the
    // deposit leaves the renter's wallet until SHE confirms the hours: settling first is refused by name, then she confirms in her
    // own session, then the owner settles. The money assertions below are unchanged.
    await expect(rentals.settle(tenantA, ownerActor, bookingId, `idem-${randomUUID()}`, null)).rejects.toMatchObject({ code: 'SETTLE_HOURS_NOT_CONFIRMED' });
    await rentals.confirmUsage(tenantA, renterActor, bookingId, `idem-${randomUUID()}`, null);
    const oBefore = await bal(owner); const rBefore = await bal(renter); const escBefore = await escrowBal();
    const settled = await rentals.settle(tenantA, ownerActor, bookingId, `idem-${randomUUID()}`, null);
    expect(settled.status).toBe('settled'); expect(settled.settledTotalMinor).toBe('175000');
    expect((await bal(owner)) - oBefore).toBe(175000n);       // owner receives the full rental
    expect(rBefore - (await bal(renter))).toBe(95000n);       // renter pays the shortfall (175000 − 80000 escrowed)
    expect((await escrowBal()) - escBefore).toBe(-80000n);    // escrow fully released
  });

  it('double-settle is refused (already settled)', async () => {
    await expect(rentals.settle(tenantA, ownerActor, bookingId, `idem-${randomUUID()}`, null)).rejects.toThrow();
  });

  it('RLS: tenant B cannot see tenant A\'s booking', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM equipment_bookings WHERE id=$1`, [bookingId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM equipment_bookings WHERE id=$1`, [bookingId])).rows.length).toBe(1);
  });
});
