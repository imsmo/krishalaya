// modules/warehousing/__tests__/warehousing.integration.spec.ts
// REAL end-to-end proof of the warehouse-receipt spine against a live Postgres:
//   1. an operator lists a warehouse (₹50/qtl/month); a depositor requests to store 100 qtl;
//   2. the operator confirms → stores → records an assay → issues an eNWR (depositor is the holder);
//   3. the operator RELEASES: the storage fee (100 × ₹50 × ≥1 month) is collected depositor → operator
//      (zero-sum, txnType storage_fee); the booking goes released;
//   4. ROW-LEVEL SECURITY: tenant B cannot see tenant A's storage booking.
// Schema/seeds come from the REAL db/migrations + db/seeds (test/integration-global-setup.js).
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser, makeProduct, makeCategory, ensureUnitCurrency } from '../../../../test/helpers/fixtures';

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

import { WarehouseRepository } from '../repositories/warehouse.repository';
import { StorageBookingRepository } from '../repositories/storage-booking.repository';
import { AssayReportRepository } from '../repositories/assay-report.repository';
import { NwrReceiptRepository } from '../repositories/nwr-receipt.repository';
import { WarehouseService } from '../services/warehouse.service';
import { StorageBookingService } from '../services/storage-booking.service';
import { AssayReportService } from '../services/assay-report.service';
import { NwrReceiptService } from '../services/nwr-receipt.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
class AllowAllQuota extends QuotaService { async assertWithinLimit(): Promise<void> {} async increment(): Promise<void> {} }

run('warehousing receipt spine (integration, real Postgres + RLS + storage-fee settlement)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork; let wallet: InProcessWalletClient;
  let warehouses: WarehouseService; let bookings: StorageBookingService; let assays: AssayReportService; let nwr: NwrReceiptService;

  const tenantA = randomUUID(); const tenantB = randomUUID();
  const operator = randomUUID(); const depositor = randomUUID();
  let warehouseId = ''; let productId = ''; let bookingId = '';
  const opActor = { userId: operator, canManage: true, canStore: false, isAdmin: false };
  const depActor = { userId: depositor, canManage: false, canStore: true, isAdmin: false };

  const bal = async (u: string) => BigInt((await admin.query(`SELECT COALESCE(cached_balance_minor,0) b FROM wallet_accounts WHERE owner_kind='user' AND account_code='main' AND owner_user_id=$1`, [u])).rows[0]?.b ?? '0');
  const fund = (u: string, amount: bigint) => uow.run(tenantA, (tx) => wallet.post(tx, { tenantId: tenantA, txnType: 'order_payment', idempotencyKey: `fund:${randomUUID()}`, initiatedBy: 'system', legs: [{ account: userMain(u), amountMinor: amount }, { account: platform(PlatformAccount.Gateway), amountMinor: -amount }] }), { userId: 'system' });

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, operator); await makeUser(admin, depositor);
    await ensureUnitCurrency(admin, 'quintal');
    const categoryId = await makeCategory(admin);
    productId = await makeProduct(admin, { categoryId, tenantId: tenantA, unit: 'quintal' });

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const idem = new PgIdempotencyService(pools); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    wallet = new InProcessWalletClient(new LedgerRepository());
    const whRepo = new WarehouseRepository(replica as any); const bkRepo = new StorageBookingRepository(replica as any);
    const asRepo = new AssayReportRepository(replica as any); const nwrRepo = new NwrReceiptRepository(replica as any);
    warehouses = new WarehouseService(uow, outbox, idem, new AllowAllQuota(), metrics, audit, whRepo);
    bookings = new StorageBookingService(uow, outbox, idem, metrics, audit, wallet, bkRepo, whRepo);
    assays = new AssayReportService(uow, outbox, metrics, asRepo, bkRepo, whRepo);
    nwr = new NwrReceiptService(uow, outbox, idem, metrics, audit, nwrRepo, bkRepo, whRepo);

    await fund(depositor, 5_000_000n);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('operator lists a warehouse; depositor requests storage of 100 qtl', async () => {
    warehouseId = (await warehouses.register(tenantA, opActor, `idem-${randomUUID()}`, { defaultName: 'Anand WH', storageKinds: ['ambient'], commoditiesAccepted: [], ratePerQtlMonthMinor: '5000' } as any, null)).id;
    bookingId = (await bookings.request(tenantA, depActor, `idem-${randomUUID()}`, { warehouseId, productId, quantity: '100.000', unitCode: 'quintal' } as any)).id;
    expect(bookingId).toBeTruthy();
  });

  it('operator confirms → stores → assays → issues an eNWR (depositor holds it)', async () => {
    expect((await bookings.confirm(tenantA, opActor, bookingId)).status).toBe('confirmed');
    expect((await bookings.store(tenantA, opActor, bookingId)).status).toBe('stored');
    const assay = await assays.record(tenantA, opActor, { storageBookingId: bookingId, assayerName: 'AgriAssay Labs', parameters: { moisture: 11.2, fm: 0.8 } } as any);
    expect(assay.assayerName).toBe('AgriAssay Labs');
    const receipt = await nwr.issue(tenantA, opActor, `idem-${randomUUID()}`, { storageBookingId: bookingId, repository: 'NERL', enwrNo: `EN-${randomUUID().slice(0, 8)}`, valuationMinor: '20000000' } as any, null);
    expect(receipt.status).toBe('issued'); expect(receipt.holderUserId).toBe(depositor);
  });

  it('rejects a second active eNWR for the same booking', async () => {
    await expect(nwr.issue(tenantA, opActor, `idem-${randomUUID()}`, { storageBookingId: bookingId, repository: 'NERL', enwrNo: `EN-${randomUUID().slice(0, 8)}`, valuationMinor: '1' } as any, null)).rejects.toThrow();
  });

  it('RELEASE collects the storage fee depositor → operator (zero-sum, ≥1 month)', async () => {
    const dBefore = await bal(depositor); const oBefore = await bal(operator);
    const released = await bookings.release(tenantA, opActor, bookingId, `idem-${randomUUID()}`, null);
    expect(released.status).toBe('released');
    const fee = BigInt(released.storageFeeMinor);
    expect(fee).toBe(500000n);                                // 100 qtl × ₹50 × 1 month (just stored)
    expect(dBefore - (await bal(depositor))).toBe(fee);       // depositor debited
    expect((await bal(operator)) - oBefore).toBe(fee);        // operator credited
    expect((dBefore - (await bal(depositor))) - ((await bal(operator)) - oBefore)).toBe(0n);  // ZERO-SUM
  });

  it('RLS: tenant B cannot see tenant A\'s storage booking', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM storage_bookings WHERE id=$1`, [bookingId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM storage_bookings WHERE id=$1`, [bookingId])).rows.length).toBe(1);
  });
});
