// modules/catalogue/__tests__/eav.integration.spec.ts
// REAL end-to-end proof of the EAV/brands READ engine against a live Postgres (no infra mocks). Seeds a global
// brand + attribute definition (+options) + template + a category_attribute binding on a shared category, then
// reads them through the concrete services as a tenant — proving: brands/options/templates/bindings resolve, the
// bindings inherit down the ltree tree, and (RLS) these GLOBAL master rows are visible to ANY tenant (shared
// reference data, no tenant_id). Requires DATABASE_URL (kv_app); DATABASE_ADMIN_URL loads the fixtures.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { InMemoryCacheService } from '../../../core/cache/cache.service.in-memory';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { BrandRepository } from '../repositories/brand.repository';
import { AttributeOptionRepository } from '../repositories/attribute-option.repository';
import { AttributeTemplateRepository } from '../repositories/attribute-template.repository';
import { CategoryAttributeRepository } from '../repositories/category-attribute.repository';
import { BrandService } from '../services/brand.service';
import { AttributeOptionService } from '../services/attribute-option.service';
import { AttributeTemplateService } from '../services/attribute-template.service';
import { CategoryAttributeService } from '../services/category-attribute.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('catalogue-eav read engine (integration, real Postgres + RLS shared-read)', () => {
  let pools: PgPoolProvider; let admin: Pool;
  let brands: BrandService; let options: AttributeOptionService; let templates: AttributeTemplateService; let bindings: CategoryAttributeService;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const tag = Date.now().toString(36).slice(-6);
  const categoryId = randomUUID(); const attrId = randomUUID(); const brandId = randomUUID();
  let optionId = ''; const templateCode = `wheat_std_${tag}`;

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B');
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2,'EAV Crops',$3::ltree,1,true) ON CONFLICT (id) DO NOTHING`, [categoryId, `eav_crops_${tag}`, `eav_crops_${tag}`]);
    await admin.query(`INSERT INTO brands (id, default_name, manufacturer, is_verified) VALUES ($1,'Mahindra ITest','M&M',true) ON CONFLICT (id) DO NOTHING`, [brandId]);
    await admin.query(`INSERT INTO attribute_definitions (id, code, default_name, data_type, validation, is_active) VALUES ($1,$2,'Variety','option','{}',true) ON CONFLICT (id) DO NOTHING`, [attrId, `variety_${tag}`]);
    const opt = await admin.query(`INSERT INTO attribute_options (attribute_id, code, default_name, sort_order, is_active) VALUES ($1,'hd2967','HD-2967',10,true) RETURNING id`, [attrId]);
    optionId = opt.rows[0].id;
    await admin.query(`INSERT INTO category_attributes (category_id, attribute_id, is_required, show_in_filters, show_on_card, sort_order) VALUES ($1,$2,true,true,false,10) ON CONFLICT (category_id, attribute_id) DO NOTHING`, [categoryId, attrId]);
    await admin.query(`INSERT INTO attribute_templates (code, default_name, category_id, payload) VALUES ($1,'Wheat Standard',$2,$3::jsonb) ON CONFLICT (code) DO NOTHING`, [templateCode, categoryId, JSON.stringify({ items: [{ attributeId: attrId, required: true, sortOrder: 10 }] })]);

    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const replica = new PgReadReplicaProvider(pools, new ShardRouter(config));
    const cache = new InMemoryCacheService(); const metrics = new PromMetrics();
    brands = new BrandService(metrics, new BrandRepository(replica as any));
    options = new AttributeOptionService(cache, metrics, new AttributeOptionRepository(replica as any));
    templates = new AttributeTemplateService(metrics, new AttributeTemplateRepository(replica as any));
    bindings = new CategoryAttributeService(metrics, new CategoryAttributeRepository(replica as any));
  }, 30000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DELETE FROM attribute_templates WHERE code=$1`, [templateCode]).catch(() => undefined);
      await admin.query(`DELETE FROM category_attributes WHERE category_id=$1`, [categoryId]).catch(() => undefined);
      await admin.query(`DELETE FROM attribute_options WHERE attribute_id=$1`, [attrId]).catch(() => undefined);
      await admin.query(`DELETE FROM attribute_definitions WHERE id=$1`, [attrId]).catch(() => undefined);
      await admin.query(`DELETE FROM brands WHERE id=$1`, [brandId]).catch(() => undefined);
      await admin.query(`DELETE FROM categories WHERE id=$1`, [categoryId]).catch(() => undefined);
      await admin.end();
    }
    await pools?.onModuleDestroy();
  });

  it('brand list + get resolve for a tenant (global shared read)', async () => {
    const got: any = await brands.get(tenantA, brandId);
    expect(got.defaultName).toBe('Mahindra ITest');
    const page: any = await brands.list(tenantA, { verifiedOnly: true, limit: 50 } as any);
    expect(page.items.some((b: any) => b.id === brandId)).toBe(true);
  });

  it('attribute options resolve + are visible to a DIFFERENT tenant too (shared master)', async () => {
    const a: any = await options.listForAttribute(tenantA, attrId, true);
    expect(a.some((o: any) => o.id === optionId)).toBe(true);
    const b: any = await options.listForAttribute(tenantB, attrId, true);
    expect(b.some((o: any) => o.id === optionId)).toBe(true);   // GLOBAL: shared across tenants
  });

  it('category-attribute bindings resolve (inherited via ltree)', async () => {
    const list: any = await bindings.listForCategory(tenantA, categoryId);
    const b = list.find((x: any) => x.attributeId === attrId);
    expect(b).toBeTruthy();
    expect(b.isRequired).toBe(true);
    expect(b.showInFilters).toBe(true);
  });

  it('attribute template resolves + clones its ordered items', async () => {
    const t: any = await templates.getByCode(tenantA, templateCode);
    expect(t.code).toBe(templateCode);
    expect(t.items[0].attributeId).toBe(attrId);
    expect(t.items[0].required).toBe(true);
  });
});
