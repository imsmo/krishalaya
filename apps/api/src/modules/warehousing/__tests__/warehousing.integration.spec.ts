// modules/warehousing/__tests__/warehousing.integration.spec.ts
// REAL end-to-end proof of the warehouse-receipt spine against a live Postgres:
//   1. an operator lists a warehouse (₹50/qtl/month); a depositor requests to store 100 qtl;
//   2. the operator confirms → stores → records an assay; eNWR issue is REFUSED BY NAME (PC-56 OPS-2b, founder Q3-A) — nothing is recorded;
//   3. the operator's RELEASE is refused by name (PC-56 OPS-1a, founder Q3-A) — the fee would leave the depositor's wallet
//      without her word; the booking stays stored and no wallet moves;
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
    assays = new AssayReportService(uow, outbox, metrics, audit, asRepo, bkRepo, whRepo);   // PC-56 OPS-2b: the record act is audited (B4)
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

  // PC-56 OPS-2b · NAMED UPDATE (founder Q3-A, 2026-11-06): this case pinned the operator ISSUING an eNWR in the depositor's name (a typed number
  // and a typed valuation, no repository, no word from her). Issue is now REFUSED BY NAME before anything is read or written, so the case pins the
  // refusal against the real database: no receipt exists for the booking afterwards.
  it('operator confirms → stores → assays; eNWR issue is refused by name (ENWR_ISSUE_NOT_ON_PLATFORM) and nothing is recorded', async () => {
    expect((await bookings.confirm(tenantA, opActor, bookingId)).status).toBe('confirmed');
    expect((await bookings.store(tenantA, opActor, bookingId)).status).toBe('stored');
    const assay = await assays.record(tenantA, opActor, { storageBookingId: bookingId, assayerName: 'AgriAssay Labs', parameters: { moisture: 11.2, fm: 0.8 } } as any);
    expect(assay.assayerName).toBe('AgriAssay Labs');
    await expect(nwr.issue(tenantA, opActor, `idem-${randomUUID()}`, { storageBookingId: bookingId, repository: 'NERL', enwrNo: `EN-${randomUUID().slice(0, 8)}`, valuationMinor: '20000000' } as any, null))
      .rejects.toMatchObject({ code: 'ENWR_ISSUE_NOT_ON_PLATFORM', httpStatus: 409 });
    expect((await admin.query(`SELECT count(*)::int n FROM nwr_receipts WHERE storage_booking_id = $1`, [bookingId])).rows[0].n).toBe(0);
  });

  // PC-56 OPS-2b · NAMED UPDATE: "a second active eNWR is rejected" presupposed a first one; no route records one now, so a second attempt is
  // refused by the same name (and still throws — the original assertion is kept as the first line).
  it('rejects a second eNWR attempt for the same booking (refused by name again)', async () => {
    await expect(nwr.issue(tenantA, opActor, `idem-${randomUUID()}`, { storageBookingId: bookingId, repository: 'NERL', enwrNo: `EN-${randomUUID().slice(0, 8)}`, valuationMinor: '1' } as any, null)).rejects.toThrow();
    await expect(nwr.issue(tenantA, opActor, `idem-${randomUUID()}`, { storageBookingId: bookingId, repository: 'NERL', enwrNo: `EN-${randomUUID().slice(0, 8)}`, valuationMinor: '1' } as any, null)).rejects.toMatchObject({ code: 'ENWR_ISSUE_NOT_ON_PLATFORM' });
  });

  // PC-56 OPS-1a · NAMED UPDATE (founder Q3-A, 2026-11-05): this case pinned RELEASE collecting the storage fee depositor → operator.
  // The release that debits the depositor's wallet on the operator's act is now REFUSED BY NAME (until she confirms it in her own
  // session), so the case pins the refusal against the real database: the booking stays stored and neither wallet moves.
  it('RELEASE is refused by name (STORAGE_RELEASE_AWAITS_DEPOSITOR): the booking stays stored, no wallet moves', async () => {
    const dBefore = await bal(depositor); const oBefore = await bal(operator);
    await expect(bookings.release(tenantA, opActor, bookingId, `idem-${randomUUID()}`, null)).rejects.toMatchObject({ code: 'STORAGE_RELEASE_AWAITS_DEPOSITOR', httpStatus: 409 });
    expect((await bookings.getById(tenantA, opActor, bookingId)).status).toBe('stored');
    expect(await bal(depositor)).toBe(dBefore);
    expect(await bal(operator)).toBe(oBefore);
  });

  it('RLS: tenant B cannot see tenant A\'s storage booking', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM storage_bookings WHERE id=$1`, [bookingId])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM storage_bookings WHERE id=$1`, [bookingId])).rows.length).toBe(1);
  });
});
