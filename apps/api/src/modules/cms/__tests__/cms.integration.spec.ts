// modules/cms/__tests__/cms.integration.spec.ts
// REAL end-to-end proof of the CMS spine against a live Postgres:
//   1. admin creates + publishes a page (v1); re-edits → new version (v2) published, v1 archived (single-live);
//   2. public getBySlug returns the latest published version; a banner is scheduled + click-tracked;
//   3. ROW-LEVEL SECURITY: tenant B cannot see tenant A's page.
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { makeTenant, makeUser } from '../../../../test/helpers/fixtures';
import { AppConfig } from '../../../core/config/app-config';
import { PgPoolProvider } from '../../../core/database/pg-pool.provider';
import { ShardRouter } from '../../../core/sharding/shard-router';
import { PgUnitOfWork } from '../../../core/database/unit-of-work.pg';
import { PgReadReplicaProvider } from '../../../core/database/read-replica.pg';
import { PgOutboxWriter } from '../../../core/outbox/outbox.writer.pg';
import { PromMetrics } from '../../../core/observability/metrics.prom';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { CmsPageRepository } from '../repositories/cms-page.repository';
import { BannerRepository } from '../repositories/banner.repository';
import { CmsPageService } from '../services/cms-page.service';
import { BannerService } from '../services/banner.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('cms spine (integration, real Postgres + RLS + page versioning)', () => {
  let pools: PgPoolProvider; let admin: Pool; let inspect: Pool; let uow: PgUnitOfWork;
  let pages: CmsPageService; let banners: BannerService;
  const tenantA = randomUUID(); const tenantB = randomUUID(); const editor = randomUUID();
  const slug = 'privacy-policy'; let v1 = ''; let v2 = '';
  const actor = { userId: editor, canAuthor: true, canPublish: true };
  const bannerActor = { userId: editor, canManage: true };
  const checker = randomUUID(); const checkerActor = { userId: checker, canAuthor: false, canPublish: true };
  const meta = { ip: null, requestId: null };
  let mediaId = '';

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    await makeTenant(admin, tenantA, 'A'); await makeTenant(admin, tenantB, 'B'); await makeUser(admin, editor); await makeUser(admin, checker);
    mediaId = randomUUID();
    // [PC-56 TENANT-8c] media_assets.kind / mime_type / bytes / sha256 are NOT NULL — this fixture predates them and the suite
    // could not start (red at 4097b28 too — see the 8c report).
    await admin.query(`INSERT INTO media_assets (id, tenant_id, kind, s3_key, mime_type, bytes, sha256) VALUES ($1,$2,'image',$3,'image/png',1,$4) ON CONFLICT DO NOTHING`, [mediaId, tenantA, `banners/${mediaId}.png`, 'a'.repeat(64)]);
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    uow = new PgUnitOfWork(pools, shards);
    const replica = new PgReadReplicaProvider(pools, shards);
    const outbox = new PgOutboxWriter(); const metrics = new PromMetrics(); const audit = new AuditWriter(pools);
    pages = new CmsPageService(uow, outbox, metrics, audit, new CmsPageRepository(replica as any), new PgIdempotencyService(pools));
    banners = new BannerService(uow, outbox, metrics, audit, new BannerRepository(replica as any));
    inspect = new Pool({ connectionString: APP_URL });
  }, 30000);
  afterAll(async () => { await pools?.onModuleDestroy(); await inspect?.end(); await admin?.end(); });

  it('create + publish v1; new version v2 publish archives v1 (single live)', async () => {
    // PC-56 TENANT-8c: a policy page is written by one person and published by another; every write is keyed.
    const w = (title: string, body: string) => ({ slug, pageKind: 'policy', defaultTitle: title, body, languageCode: 'en', reason: 'policy text', intent: 'version' }) as any;
    v1 = (await pages.save(tenantA, actor, randomUUID(), w('Privacy v1', '# v1'), meta)).id;
    expect((await pages.act(tenantA, checkerActor, randomUUID(), v1, 'publish', { reason: 'read it' }, meta)).status).toBe('published');
    v2 = (await pages.save(tenantA, actor, randomUUID(), w('Privacy v2', '# v2'), meta)).id;
    const pub2: any = await pages.act(tenantA, checkerActor, randomUUID(), v2, 'publish', { reason: 'read it' }, meta);
    expect(pub2.version).toBe(2);
    const v1row = (await admin.query(`SELECT status FROM cms_pages WHERE id=$1`, [v1])).rows[0];
    expect(v1row.status).toBe('archived');   // prior version retired
  });
  it('public getBySlug returns the latest published version (v2)', async () => {
    const p: any = await pages.getBySlug(tenantA, slug);
    expect(p.version).toBe(2); expect(p.defaultTitle).toBe('Privacy v2');
  });
  it('schedules a banner + tracks a click', async () => {
    const b: any = await banners.create(tenantA, bannerActor, { placement: 'home_hero', mediaId, startsAt: new Date(Date.now() - 3600000).toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString(), audienceRules: {} } as any, null);
    await banners.recordClick(tenantA, { userId: randomUUID(), canManage: false }, b.id);
    const row = (await admin.query(`SELECT click_count FROM banners WHERE id=$1`, [b.id])).rows[0];
    expect(row.click_count).toBe(1);
    const { items } = await banners.list(tenantA, bannerActor, { box: 'live', limit: 50 });
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
  it('RLS: tenant B cannot see tenant A\'s page', async () => {
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantB]);
    expect((await inspect.query(`SELECT id FROM cms_pages WHERE id=$1`, [v2])).rows.length).toBe(0);
    await inspect.query(`SELECT set_config('app.tenant_id',$1,false)`, [tenantA]);
    expect((await inspect.query(`SELECT id FROM cms_pages WHERE id=$1`, [v2])).rows.length).toBe(1);
  });
});
