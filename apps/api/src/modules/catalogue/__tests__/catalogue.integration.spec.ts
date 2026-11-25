// modules/catalogue/__tests__/catalogue.integration.spec.ts
// REAL end-to-end proof of the catalogue slice against a live Postgres (no infra mocks).
// Instantiates the CONCRETE stack and verifies:
//   1. create a tenant-private product → it persists, emits catalogue.product_created to the
//      outbox in the SAME tx, and is returned by getById + the search read-model;
//   2. the seeded PLATFORM-master product (tenant_id NULL) is visible to the tenant too;
//   3. idempotency: same key → same product id (no duplicate);
//   4. a store batch is created and recalled (audit row written);
//   5. ROW-LEVEL SECURITY: tenant B cannot see tenant A's private product, but CAN see the
//      platform-master product.
// Requires DATABASE_URL (kv_app). DATABASE_ADMIN_URL (superuser) loads the slice.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';

import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PgQuotaService } from '../../../core/quota/quota.service.pg';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';

import { CategoryRepository } from '../repositories/category.repository';
import { AttributeDefinitionRepository } from '../repositories/attribute-definition.repository';
import { ProductRepository } from '../repositories/product.repository';
import { ProductBatchRepository } from '../repositories/product-batch.repository';
import { ProductService } from '../services/product.service';
import { ProductBatchService } from '../services/product-batch.service';
import { ProductSearchReadModel } from '../read-models/product-search.read-model';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;
const CROPS = '00000000-0000-0000-0000-0000000000c1';
const PLATFORM_PRODUCT = '00000000-0000-0000-0000-0000000000d1';

run('catalogue slice (integration, real Postgres + RLS)', () => {
  let pools: PgPoolProvider;
  let admin: Pool;          // superuser: fixtures + assertion reads (bypasses RLS)
  let inspect: Pool;        // kv_app: the RLS isolation proof only
  let products: ProductService;
  let batches: ProductBatchService;
  let search: ProductSearchReadModel;
  let isSuperuser = false;
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const user = randomUUID();

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await makeUser(admin, user);   // PC-56 TEST-1: product_batches.seller_user_id REFERENCES users — the actor must be a real user
    // a tenant-shared 'crops' category (fixed id the tests reference) + a PLATFORM-master product
    // (tenant_id NULL → visible to every tenant). Categories/units already come from the real seeds.
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active)
      VALUES ($1,'itest_crops','Crops','itest_crops',1,true) ON CONFLICT (id) DO NOTHING`, [CROPS]);
    await admin.query(`INSERT INTO units (code, default_name, unit_class, is_active) VALUES ('quintal','Quintal','mass',true) ON CONFLICT (code) DO NOTHING`);
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
      VALUES ($1,$2,'Wheat (platform master)','quintal',NULL,true, to_tsvector('simple','Wheat')) ON CONFLICT (id) DO NOTHING`, [PLATFORM_PRODUCT, CROPS]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter();
    const quota = new PgQuotaService(pools, shards);
    const idem = new PgIdempotencyService(pools);
    const cache = new InMemoryCacheService();
    const metrics = new PromMetrics();
    const audit = new AuditWriter(pools);
    const catRepo = new CategoryRepository(replica as any);
    const attrRepo = new AttributeDefinitionRepository(replica as any);
    const prodRepo = new ProductRepository(replica as any);
    const batchRepo = new ProductBatchRepository(replica as any);
    products = new ProductService(uow, outbox, quota, idem, cache, metrics, prodRepo, catRepo, attrRepo);
    batches = new ProductBatchService(uow, outbox, idem, metrics, audit, batchRepo, prodRepo);
    search = new ProductSearchReadModel(replica as any, metrics);

    inspect = new Pool({ connectionString: APP_URL });
    isSuperuser = (await inspect.query(`SELECT rolsuper FROM pg_roles WHERE rolname=current_user`)).rows[0]?.rolsuper === true;
  }, 30000);

  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  let createdId = '';

  it('creates a tenant-private product → persisted + outbox event; visible via getById & search', async () => {
    const { id } = await products.create(tenantA, user, `idem-${randomUUID()}`, { categoryId: CROPS, defaultName: 'Cumin (Tenant A)', defaultUnit: 'quintal', isPerishable: false } as any);
    createdId = id;
    const row = await admin.query(`SELECT tenant_id FROM products WHERE id=$1`, [id]);
    expect(row.rows[0].tenant_id).toBe(tenantA);
    const ev = await admin.query(`SELECT 1 FROM outbox_events WHERE aggregate_id=$1 AND event_type='catalogue.product_created'`, [id]);
    expect(ev.rowCount).toBe(1);

    const got = await products.getById(tenantA, id);
    expect((got as any).defaultName).toBe('Cumin (Tenant A)');

    const page = await search.query(tenantA, { limit: 50, activeOnly: true } as any);
    const ids = page.items.map((i) => i.id);
    expect(ids).toContain(id);                 // own product
    expect(ids).toContain(PLATFORM_PRODUCT);   // platform master visible to the tenant
  });

  it('is idempotent — same key returns the same product id', async () => {
    const key = `idem-${randomUUID()}`;
    const a = await products.create(tenantA, user, key, { categoryId: CROPS, defaultName: 'Dup', defaultUnit: 'quintal', isPerishable: false } as any);
    const b = await products.create(tenantA, user, key, { categoryId: CROPS, defaultName: 'Dup', defaultUnit: 'quintal', isPerishable: false } as any);
    expect(a.id).toEqual(b.id);
  });

  it('creates and recalls a store batch (audit row written)', async () => {
    const { id } = await batches.create(tenantA, user, `idem-${randomUUID()}`, { productId: createdId, batchNo: 'B-1', qtyReceived: 50, unitCode: 'quintal', currencyCode: 'INR' } as any);
    await batches.recall(tenantA, user, id, 'contamination', '127.0.0.1');
    const r = await admin.query(`SELECT is_recalled FROM product_batches WHERE id=$1`, [id]);
    expect(r.rows[0].is_recalled).toBe(true);
    const a = await admin.query(`SELECT 1 FROM audit_log WHERE entity_id=$1 AND action='catalogue.batch_recalled'`, [id]);
    expect(a.rowCount).toBe(1);
  });

  it('RLS: tenant B cannot see tenant A private product, but sees the platform master', async () => {
    const countAs = async (t: string, where: string, p: any[]) => {
      const c = await inspect.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [t]);
        const r = await c.query(`SELECT count(*)::int n FROM products WHERE ${where}`, p); await c.query('COMMIT'); return r.rows[0].n as number;
      } finally { c.release(); }
    };
    if (isSuperuser) { console.warn('[catalogue] superuser bypasses RLS; use kv_app for the strict check'); return; }
    // PC-56 TEST-1: the tenant is the session GUC set above, not a query parameter — an unused `$1` is refused by Postgres
    // ("could not determine data type of parameter $1"), so this proof had never executed.
    expect(await countAs(tenantB, 'id = $1', [createdId])).toBe(0);          // A's private product hidden from B
    expect(await countAs(tenantB, 'id = $1', [PLATFORM_PRODUCT])).toBe(1);   // platform master visible to B
  });
});
