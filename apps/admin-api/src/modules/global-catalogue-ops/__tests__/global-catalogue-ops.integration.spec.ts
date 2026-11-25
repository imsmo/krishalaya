// apps/admin-api/src/modules/global-catalogue-ops/__tests__/global-catalogue-ops.integration.spec.ts
// REAL end-to-end proof against a live Postgres (the schema apps/api builds + migration 0041). Proves the master-
// taxonomy write paths: a lookup type + PLATFORM value (tenant_id IS NULL), and a category tree create→child→
// MOVE-to-root→deactivate — asserting the persisted rows (code/path/depth recomputed across the subtree by the
// ltree splice), the catalogue_changes timeline, and the audit_log rows. All tables are GLOBAL/god-mode (no
// tenant_id ⇒ no RLS — kv_admin-only). Runs only when DATABASE_ADMIN_URL is set.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { AdminConfig } from '../../../core/config/admin-config';
import { AdminPool } from '../../../core/database/admin-pool';
import { AdminAuditWriter } from '../../../core/audit/admin-audit.writer';
import { CatalogueRepository } from '../repositories/catalogue.repository';
import { LookupVocabAdminService } from '../services/lookup-vocab-admin.service';
import { CategoriesAdminService } from '../services/categories-admin.service';
import { CategoryHasActiveChildrenError } from '../domain/catalogue.errors';

const APP_URL = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
const run = APP_URL ? describe : describe.skip;

run('global-catalogue-ops (integration, real Postgres — vocab + tree + audit)', () => {
  let pool: AdminPool; let inspect: Pool; let vocab: LookupVocabAdminService; let cats: CategoriesAdminService;
  const actor = { userId: randomUUID(), roles: ['platform_catalogue_ops'], amr: ['hwk'], authTimeSec: Math.floor(Date.now() / 1000), sessionId: '', permissions: new Set(['catalogue.manage']), ip: '10.0.0.1', requestId: 'itest' } as any;
  const tag = String(Date.now());
  const typeCode = `itest_type_${tag}`.slice(0, 60);
  const rootSlug = `itest_root_${tag}`.slice(0, 40);
  const childSlug = `cereals_${tag}`.slice(0, 40);
  let valueId = ''; let rootId = ''; let childId = ''; let grandId = '';
  const grandSlug = `grain_${tag}`.slice(0, 40);

  beforeAll(async () => {
    const config = new AdminConfig({ NODE_ENV: 'test', DATABASE_ADMIN_URL: APP_URL, ADMIN_JWT_SECRET: 's'.repeat(40) });
    pool = new AdminPool(config);
    const repo = new CatalogueRepository(pool); const audit = new AdminAuditWriter(pool);
    vocab = new LookupVocabAdminService(pool, audit, repo);
    cats = new CategoriesAdminService(pool, audit, repo);
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);

  afterAll(async () => {
    if (inspect) {
      for (const id of [grandId, childId, rootId, valueId].filter(Boolean)) await inspect.query(`DELETE FROM catalogue_changes WHERE entity_id=$1`, [id]).catch(() => undefined);
      await inspect.query(`DELETE FROM catalogue_changes WHERE entity_id=$1`, [typeCode]).catch(() => undefined);
      if (grandId) await inspect.query(`DELETE FROM categories WHERE id=$1`, [grandId]).catch(() => undefined);
      if (childId) await inspect.query(`DELETE FROM categories WHERE id=$1`, [childId]).catch(() => undefined);
      if (rootId) await inspect.query(`DELETE FROM categories WHERE id=$1`, [rootId]).catch(() => undefined);
      if (valueId) await inspect.query(`DELETE FROM lookup_values WHERE id=$1`, [valueId]).catch(() => undefined);
      await inspect.query(`DELETE FROM lookup_types WHERE code=$1`, [typeCode]).catch(() => undefined);
      await inspect.end();
    }
    await pool?.onModuleDestroy();
  });

  it('lookup type + platform value: persisted tenant_id NULL + audited', async () => {
    await vocab.createType(actor, { code: typeCode, defaultName: 'ITest Vocab', isTenantExtendable: false, reason: 'register vocab' });
    const created: any = await vocab.createValue(actor, { typeCode, code: 'npop', defaultName: 'NPOP', meta: { region: 'IN' }, sortOrder: 10, reason: 'add value' });
    valueId = created.id;
    const row = await inspect.query(`SELECT tenant_id, is_active, code FROM lookup_values WHERE id=$1`, [valueId]);
    expect(row.rows[0].tenant_id).toBeNull();      // PLATFORM value
    expect(row.rows[0].is_active).toBe(true);

    await vocab.setValueActive(actor, valueId, { isActive: false, reason: 'retire' });
    const after = await inspect.query(`SELECT is_active FROM lookup_values WHERE id=$1`, [valueId]);
    expect(after.rows[0].is_active).toBe(false);

    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action LIKE 'catalogue.lookup_value.%'`, [valueId]);
    expect(au.rows[0].c).toBe(2);                  // created + deactivated
  });

  it('category tree: create→child→move-to-root→deactivate recomputes path/depth + timeline', async () => {
    const root: any = await cats.create(actor, { slug: rootSlug, defaultName: 'ITest Root', commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, sortOrder: 100, reason: 'root' });
    rootId = root.id;
    expect(root.depth).toBe(1);

    const child: any = await cats.create(actor, { parentId: rootId, slug: childSlug, defaultName: 'ITest Child', commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, sortOrder: 100, reason: 'child' });
    childId = child.id;
    expect(child.depth).toBe(2);
    expect(child.code).toBe(`${rootSlug}.${childSlug}`);

    // PC-56 TEST-1: a grandchild, so the move proves the SUBTREE splice too (the node's own row and a descendant take different
    // branches of moveSubtree's UPDATE — the node's own row was the one that failed with "invalid positions").
    const grand: any = await cats.create(actor, { parentId: childId, slug: grandSlug, defaultName: 'ITest Grandchild', commerceKind: 'goods', requiresLicense: false, requiresCertificate: false, sortOrder: 100, reason: 'grandchild' });
    grandId = grand.id;
    expect(grand.code).toBe(`${rootSlug}.${childSlug}.${grandSlug}`);

    // move the child to root: code becomes the bare slug, depth → 1
    const moved: any = await cats.move(actor, childId, { newParentId: null, reason: 'promote' });
    expect(moved.depth).toBe(1);
    expect(moved.code).toBe(childSlug);
    const row = await inspect.query(`SELECT parent_id, code, path::text AS path, depth FROM categories WHERE id=$1`, [childId]);
    expect(row.rows[0].parent_id).toBeNull();
    expect(row.rows[0].code).toBe(childSlug);
    expect(row.rows[0].path).toBe(childSlug);
    expect(row.rows[0].depth).toBe(1);
    const g = await inspect.query(`SELECT parent_id, code, path::text AS path, depth FROM categories WHERE id=$1`, [grandId]);
    expect(g.rows[0]).toEqual({ parent_id: childId, code: `${childSlug}.${grandSlug}`, path: `${childSlug}.${grandSlug}`, depth: 2 });

    // an active child blocks retiring its parent (no orphaned active branch) — retire the grandchild first
    await expect(cats.setActive(actor, childId, { isActive: false, reason: 'retire branch' })).rejects.toBeInstanceOf(CategoryHasActiveChildrenError);
    await cats.setActive(actor, grandId, { isActive: false, reason: 'retire leaf' });
    await cats.setActive(actor, childId, { isActive: false, reason: 'retire branch' });
    const ch = await inspect.query(`SELECT count(*)::int AS c FROM catalogue_changes WHERE entity_id=$1 AND action IN ('created','moved','deactivated')`, [childId]);
    expect(ch.rows[0].c).toBe(3);
    const au = await inspect.query(`SELECT count(*)::int AS c FROM audit_log WHERE entity_id=$1 AND action LIKE 'catalogue.category.%'`, [childId]);
    expect(au.rows[0].c).toBe(3);
  });
});
