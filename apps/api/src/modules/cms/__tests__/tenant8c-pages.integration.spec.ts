// modules/cms/__tests__/tenant8c-pages.integration.spec.ts · PC-56 TENANT-8c · THE PAGES, live.
//
// Real PG16, the test database the harness builds from the real chain (migrations + seeds), every tenant-realm query as
// `kv_app` under RLS. What this proves:
//   1. F-14 — a tenant's `about` v1 beats the platform's `about` v5 at `by-slug`; archived, the platform's answers again;
//   2. F-20 — two concurrent creates of ONE slug reviewed as `new_page:1`: one draft, one typed 409, versions contiguous;
//      two concurrent un-keyed re-writes serialise under the lock; the database's own UNIQUE backstop is a 23505;
//   3. maker ≠ checker on a POLICY page — refused by the verdict, and by 0177's trigger as kv_app (23514) both without a
//      checker and with checker = author; a second person publishes;
//   4. archive takes a reason from the vocabulary (a system code and a free word are refused, by the verdict AND the DB);
//   5. F-7 — the audit row carries actor · reason · before/after, the CLIENT IP in `ip` (or NULL) and the request id in
//      its own column; the PC-27 plumbing (`ctx.requestId` as `ip`) could never have committed: `ip` is `inet`;
//   6. another tenant sees none of it; kv_app cannot write a platform page (F-3's note) — all rolled back;
//   7. Law 3 — the same Idempotency-Key replays one page, never two; the FAQ reorder is keyed and audited.
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
import { PgIdempotencyService } from '../../../core/idempotency/idempotency.service.pg';
import { AuditWriter } from '../../../core/audit/audit.writer';
import { CmsPageRepository } from '../repositories/cms-page.repository';
import { CmsPageService } from '../services/cms-page.service';
import { versionsContiguous } from '../domain/page-rules';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('TENANT-8c · the pages (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let svc: CmsPageService; let audit: AuditWriter;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const author = randomUUID(); const checker = randomUUID(); const agent = randomUUID();
  const authorActor = { userId: author, canAuthor: true, canPublish: true };      // tenant_admin: BOTH verbs — and still no checker of their own policy
  const checkerActor = { userId: checker, canAuthor: false, canPublish: true };
  const agentActor = { userId: agent, canAuthor: true, canPublish: false };       // support_agent: author only (F-19)
  const IP = '203.0.113.7';
  const meta = (requestId = `req-${randomUUID().slice(0, 8)}`) => ({ ip: IP, requestId });
  const key = () => `k-${randomUUID()}`;
  const form = (over: Record<string, string> = {}) => ({ slug: 'about', pageKind: 'static', defaultTitle: 'આનંદ FPO વિશે', body: '# અમારી વાત', languageCode: 'gu', reason: 'our own about page', intent: 'new', ...over }) as any;

  async function asApp<T>(tenant: string, user: string | null, fn: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>): Promise<T> {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      if (user) await c.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
      return await fn((sql, p) => c.query(sql, p as unknown[]));
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const pgCode = async (p: Promise<unknown>) => { try { await p; return 'ok'; } catch (e) { return (e as { code?: string }).code ?? String(e); } };
  /** Inside one rolled-back transaction: each probe under its own savepoint, so one refusal does not abort the next. */
  const probe = async (q: (sql: string, p?: unknown[]) => Promise<any>, sql: string, p?: unknown[]) => {
    await q('SAVEPOINT p');
    const code = await pgCode(q(sql, p));
    await q(code === 'ok' ? 'RELEASE SAVEPOINT p' : 'ROLLBACK TO SAVEPOINT p');
    return code;
  };
  const errOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; status?: number; details?: any }; } };
  const versions = async (tenant: string, slug: string) => (await admin.query(`SELECT version FROM cms_pages WHERE tenant_id=$1 AND slug=$2 ORDER BY version`, [tenant, slug])).rows.map((r) => Number(r.version));

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B');
    for (const u of [author, checker, agent]) await makeUser(admin, u);
    await admin.query(`UPDATE users SET full_name = 'Kavita Ben D.' WHERE id = $1`, [author]);
    await admin.query(`UPDATE users SET full_name = 'Rajesh Checker' WHERE id = $1`, [checker]);
    for (const [l, d] of [['gu', true], ['hi', false], ['en', false]] as const) {
      await admin.query(`INSERT INTO tenant_languages (tenant_id, language_code, is_default) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantA, l, d]);
    }
    // THE PLATFORM'S `about`, v1..v5 (v5 live) — written as the owner, as the admin realm would.
    await admin.query(`DELETE FROM cms_pages WHERE tenant_id IS NULL AND slug = 'about'`);
    for (let v = 1; v <= 5; v++) {
      await admin.query(
        `INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, published_at, archived_at, archived_reason, language_code)
         VALUES (NULL, 'about', 'static', $1, $2, $3, $4, $5, $6, $7, 'en')`,
        [`About Krishalaya v${v}`, `# platform v${v}`, v, v === 5 ? 'published' : 'archived', v === 5 ? new Date() : null, v === 5 ? null : new Date(), v === 5 ? null : 'superseded']);
    }
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const replica = new PgReadReplicaProvider(pools, shards);
    audit = new AuditWriter(pools);
    svc = new CmsPageService(new PgUnitOfWork(pools, shards), new PgOutboxWriter(), new PromMetrics(), audit, new CmsPageRepository(replica as any), new PgIdempotencyService(pools));
  }, 60000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('F-14 · the platform serves `about` v5 until the tenant publishes its own v1 — then the tenant\'s v1 wins; archived, v5 again', async () => {
    expect((await svc.getBySlug(tenantA, 'about'))).toMatchObject({ version: 5, platform: true, defaultTitle: 'About Krishalaya v5' });
    const r = await svc.preview(tenantA, agentActor, form());
    expect(r.ready).toBe(true);
    expect(r.preview).toMatchObject({ mode: 'new_page', version: 1, expect: 'new_page:1', servingToday: { source: 'platform', version: 5 }, replacesPlatformVersion: 5 });
    const w = await svc.save(tenantA, agentActor, key(), form({ expect: r.preview.expect as string }), meta());
    expect(w).toMatchObject({ version: 1, mode: 'new_page', status: 'draft' });
    // the support agent wrote it and cannot publish; the admin (not a policy page) can
    expect(await errOf(svc.act(tenantA, agentActor, key(), w.id, 'publish', { reason: 'goes live' }, meta()))).toMatchObject({ code: 'CMS_PAGE_ACT_REFUSED', details: { refusals: ['NO_PERMISSION'] } });
    await svc.act(tenantA, authorActor, key(), w.id, 'publish', { reason: 'our words, not the platform\'s' }, meta());
    const live = await svc.getBySlug(tenantA, 'about');
    expect(live).toMatchObject({ version: 1, platform: false, defaultTitle: 'આનંદ FPO વિશે' });          // v1 BEATS v5
    expect((await svc.getBySlug(tenantB, 'about'))).toMatchObject({ version: 5, platform: true });     // B still reads the platform
    const idx = await svc.index(tenantA, authorActor, { limit: 50 });
    expect(idx.items.find((i) => i.slug === 'about')).toMatchObject({ state: 'published', serving: { source: 'own', version: 1 }, platform: { version: 5 } });
    expect(idx.reader.surfaces).toEqual([]);
    // take ours down: the platform's answers again
    await svc.act(tenantA, authorActor, key(), w.id, 'archive', { reason: 'rewriting it for kharif', archiveReason: 'outdated' }, meta());
    expect((await svc.getBySlug(tenantA, 'about'))).toMatchObject({ version: 5, platform: true });
  });

  it('F-20 · two concurrent creates of one slug, both reviewed new_page:1 → one draft, one typed 409; versions contiguous', async () => {
    const f = form({ slug: 'payment-policy', pageKind: 'policy', defaultTitle: 'Member payment policy', body: '# Paid every Friday', expect: 'new_page:1' });
    const results = await Promise.allSettled([svc.save(tenantA, authorActor, key(), f, meta()), svc.save(tenantA, authorActor, key(), f, meta())]);
    const ok = results.filter((x) => x.status === 'fulfilled'); const bad = results.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1); expect(bad).toHaveLength(1);
    expect(bad[0].reason).toMatchObject({ code: 'CMS_PAGE_CHANGED', httpStatus: 409, details: { expected: 'new_page:1', refusals: ['VERSION_CHANGED'] } });
    expect(await versions(tenantA, 'payment-policy')).toEqual([1]);
    // Un-keyed re-writes of a live slug serialise under the lock: one new draft (v2), the next EDITS it — never v2 twice.
    const h1 = await svc.save(tenantA, authorActor, key(), form({ slug: 'help-photos', pageKind: 'help_article', defaultTitle: 'Photos', body: '# 4 photos' }), meta());
    await svc.act(tenantA, authorActor, key(), h1.id, 'publish', { reason: 'first guide' }, meta());
    const v = (b: string) => form({ slug: 'help-photos', pageKind: 'help_article', defaultTitle: 'Photos', body: b, intent: 'version' });
    const both = await Promise.allSettled([svc.save(tenantA, authorActor, key(), v('# morning light'), meta()), svc.save(tenantA, authorActor, key(), v('# show scale'), meta())]);
    expect(both.every((x) => x.status === 'fulfilled')).toBe(true);
    expect((both as PromiseFulfilledResult<any>[]).map((x) => x.value.mode).sort()).toEqual(['edit_draft', 'new_version']);
    expect(await versions(tenantA, 'help-photos')).toEqual([1, 2]);
    expect(versionsContiguous(await versions(tenantA, 'help-photos'))).toBe(true);
    // The database's own backstop, as kv_app: the same version twice is 23505 (the service maps it to a typed 409).
    expect(await asApp(tenantA, author, (q) => pgCode(q(
      `INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code, created_by) VALUES ($1,'help-photos','help_article','x','# x',2,'draft','gu',$2)`, [tenantA, author])))).toBe('23505');
  });

  it('maker ≠ checker on a POLICY page — the verdict, and 0177\'s trigger as kv_app (23514): no checker, checker = author', async () => {
    const draft = (await svc.view(tenantA, authorActor, 'payment-policy')).draft!;
    expect(draft).toMatchObject({ version: 1, status: 'draft', authoredByYou: true });
    expect(draft.acts.find((a) => a.act === 'publish')).toMatchObject({ allowed: false, refusals: ['MAKER_IS_CHECKER'] });
    expect(await errOf(svc.act(tenantA, authorActor, key(), draft.id, 'publish', { reason: 'I wrote it, I approve it' }, meta())))
      .toMatchObject({ code: 'CMS_PAGE_ACT_REFUSED', httpStatus: 409, details: { refusals: ['MAKER_IS_CHECKER'] } });
    // the database, as kv_app: publishing with NO publisher, with the author as publisher, naming a colleague you are not
    expect(await asApp(tenantA, author, (q) => pgCode(q(`UPDATE cms_pages SET status='published', published_at=now() WHERE id=$1`, [draft.id])))).toBe('23514');
    expect(await asApp(tenantA, author, (q) => pgCode(q(`UPDATE cms_pages SET status='published', published_at=now(), published_by=$2 WHERE id=$1`, [draft.id, author])))).toBe('23514');
    expect(await asApp(tenantA, author, (q) => pgCode(q(`UPDATE cms_pages SET status='published', published_at=now(), published_by=$2 WHERE id=$1`, [draft.id, checker])))).toBe('23514');
    // a colleague who EDITS the draft becomes a maker too — and the database stamps it, whatever the caller sent
    expect(await asApp(tenantA, checker, async (q) => {
      await q(`UPDATE cms_pages SET body='# Paid every Friday by 6 pm', last_edited_by=$2 WHERE id=$1`, [draft.id, author]);
      const e = (await q(`SELECT last_edited_by FROM cms_pages WHERE id=$1`, [draft.id])).rows[0].last_edited_by;
      const after = await pgCode(q(`UPDATE cms_pages SET status='published', published_at=now(), published_by=$2 WHERE id=$1`, [draft.id, checker]));
      return { e, after };
    })).toEqual({ e: checker, after: '23514' });
    // the second person publishes
    const done = await svc.act(tenantA, checkerActor, key(), draft.id, 'publish', { reason: 'read against the bylaws' }, meta());
    expect(done).toMatchObject({ status: 'published', version: 1 });
    const row = (await admin.query(`SELECT status, published_by, created_by FROM cms_pages WHERE id=$1`, [draft.id])).rows[0];
    expect(row).toEqual({ status: 'published', published_by: checker, created_by: author });
    // and the words of a published version are history, even to the owner
    expect(await pgCode(admin.query(`UPDATE cms_pages SET body='# changed' WHERE id=$1`, [draft.id]))).toBe('23514');
  });

  it('archive takes a reason from the vocabulary — the verdict and the database both refuse a free word', async () => {
    const live = (await svc.view(tenantA, authorActor, 'payment-policy')).live!;
    expect(await errOf(svc.act(tenantA, authorActor, key(), live.id, 'archive', { reason: 'old', archiveReason: '' }, meta()))).toMatchObject({ details: { refusals: ['ARCHIVE_REASON_REQUIRED'] } });
    expect(await errOf(svc.act(tenantA, authorActor, key(), live.id, 'archive', { reason: 'old', archiveReason: 'because' }, meta()))).toMatchObject({ details: { refusals: ['ARCHIVE_REASON_UNKNOWN'] } });
    expect(await errOf(svc.act(tenantA, authorActor, key(), live.id, 'archive', { reason: 'old', archiveReason: 'superseded' }, meta()))).toMatchObject({ details: { refusals: ['ARCHIVE_REASON_UNKNOWN'] } });
    expect(await errOf(svc.act(tenantA, agentActor, key(), live.id, 'archive', { reason: 'take it down', archiveReason: 'outdated' }, meta()))).toMatchObject({ details: { refusals: ['NO_PERMISSION'] } });
    expect(await asApp(tenantA, author, (q) => pgCode(q(`UPDATE cms_pages SET status='archived', archived_at=now(), archived_reason='because' WHERE id=$1`, [live.id])))).toBe('23514');
    expect(await asApp(tenantA, author, (q) => pgCode(q(`UPDATE cms_pages SET status='archived' WHERE id=$1`, [live.id])))).toBe('23514');
    const vocab = (await admin.query(`SELECT count(*)::int n FROM lookup_values WHERE type_code='cms_page_archive_reason' AND tenant_id IS NULL`)).rows[0].n;
    expect(vocab).toBe(8);
  });

  it('F-7 · every write is audited with actor · reason · before/after, the client IP and the request id apart — and PC-27\'s `ip = requestId` could never commit', async () => {
    const rid = `req-${randomUUID().slice(0, 12)}`;
    const w = await svc.save(tenantA, authorActor, key(), form({ slug: 'refund-policy', pageKind: 'policy', defaultTitle: 'Refunds', body: '# Within 7 days' }), { ip: IP, requestId: rid });
    const created = (await admin.query(`SELECT actor_user_id, action, reason, host(ip) AS ip, request_id, old_value, new_value FROM audit_log WHERE entity_type='cms_page' AND entity_id=$1`, [w.id])).rows;
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ actor_user_id: author, action: 'cms.page_created', reason: 'our own about page', ip: IP, request_id: rid, old_value: null });
    expect(created[0].new_value).toMatchObject({ slug: 'refund-policy', version: 1, status: 'draft', mode: 'new_page', pageKind: 'policy', languageCode: 'gu' });
    // an edit keeps before AND after; an IP the API could not resolve is NULL, never a request id
    await svc.save(tenantA, agentActor, key(), form({ slug: 'refund-policy', pageKind: 'policy', defaultTitle: 'Refunds', body: '# Within 7 days of delivery', intent: 'version', reason: 'clearer' }), { ip: null, requestId: 'req-x' });
    const edited = (await admin.query(`SELECT actor_user_id, ip, request_id, old_value, new_value FROM audit_log WHERE entity_id=$1 AND action='cms.page_edited'`, [w.id])).rows[0];
    expect(edited).toMatchObject({ actor_user_id: agent, ip: null, request_id: 'req-x' });
    expect(edited.old_value.bodySha256).not.toBe(edited.new_value.bodySha256);
    expect(edited.new_value.bodyLength).toBe('# Within 7 days of delivery'.length);
    // The agent edited it, so the author may publish it? No — the author is still its author (maker). The checker may.
    await svc.act(tenantA, checkerActor, key(), w.id, 'publish', { reason: 'reviewed with the board' }, { ip: IP, requestId: rid });
    const pub = (await admin.query(`SELECT actor_user_id, reason, host(ip) ip, old_value, new_value FROM audit_log WHERE entity_id=$1 AND action='cms.page_published'`, [w.id])).rows[0];
    expect(pub).toMatchObject({ actor_user_id: checker, reason: 'reviewed with the board', ip: IP });
    expect(pub.old_value).toMatchObject({ status: 'draft', serving: { source: 'none', version: null } });
    expect(pub.new_value).toMatchObject({ status: 'published', serving: { source: 'own', version: 1 }, checker: { publishedBy: checker, author, lastEditor: agent } });
    // PC-27 handed `ctx.requestId` (a UUID the request-id middleware mints) to the `ip` column, which is `inet`:
    const c = await pools.writer(0).connect();
    try {
      await c.query('BEGIN');
      expect(await pgCode(audit.write({ query: (s: string, p?: readonly unknown[]) => c.query(s, p as unknown[]) } as any, { tenantId: tenantA, action: 'cms.page_published', ip: randomUUID() }))).toBe('22P02');
    } finally { await c.query('ROLLBACK'); c.release(); }
  });

  it('Law 3 · the same Idempotency-Key replays ONE page; a new key on the same review is a 409, not a second page', async () => {
    const k = key();
    const f = form({ slug: 'conduct', pageKind: 'static', defaultTitle: 'Code of conduct', body: '# Be fair', expect: 'new_page:1' });
    const a = await svc.save(tenantA, authorActor, k, f, meta());
    const b = await svc.save(tenantA, authorActor, k, f, meta());
    expect(b).toEqual(a);
    expect(await versions(tenantA, 'conduct')).toEqual([1]);
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE entity_id=$1`, [a.id])).rows[0].n).toBe(1);
    expect(await errOf(svc.save(tenantA, authorActor, key(), f, meta()))).toMatchObject({ code: 'CMS_PAGE_CHANGED' });
    // a publish under one key twice is one publish
    const pk = key();
    const p1 = await svc.act(tenantA, authorActor, pk, a.id, 'publish', { reason: 'ok' + 'k' }, meta());
    const p2 = await svc.act(tenantA, authorActor, pk, a.id, 'publish', { reason: 'ok' + 'k' }, meta());
    expect(p2).toEqual(p1);
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='cms.page_published'`, [a.id])).rows[0].n).toBe(1);
  });

  it('restore brings an archived version back as the NEXT draft; history is untouched', async () => {
    const view = await svc.view(tenantA, authorActor, 'about');
    const v1 = view.versions.find((v) => v.version === 1)!;
    expect(v1).toMatchObject({ status: 'archived', archivedReason: 'outdated', authorName: 'Test User', archiverName: 'Kavita Ben D.' });
    const r = await svc.act(tenantA, authorActor, key(), v1.id, 'restore', { reason: 'the old text was right' }, meta());
    expect(r).toMatchObject({ status: 'draft', version: 2 });
    expect(await versions(tenantA, 'about')).toEqual([1, 2]);
    expect((await admin.query(`SELECT status FROM cms_pages WHERE id=$1`, [v1.id])).rows[0].status).toBe('archived');
    expect(await errOf(svc.act(tenantA, authorActor, key(), v1.id, 'restore', { reason: 'again' }, meta()))).toMatchObject({ details: { refusals: ['DRAFT_OPEN'] } });
  });

  it('the FAQ: topic from the vocabulary, a keyed reorder inside the topic, audited', async () => {
    const q = (slug: string, title: string) => form({ slug, pageKind: 'faq', topic: 'payments', defaultTitle: title, body: '# દર શુક્રવારે સાંજ સુધીમાં' });
    const a = await svc.save(tenantA, authorActor, key(), q('payout-when', 'મારા પૈસા ક્યારે આવશે?'), meta());
    const b = await svc.save(tenantA, authorActor, key(), q('payout-date', 'પેમેન્ટ કઈ તારીખે?'), meta());
    expect(await errOf(svc.save(tenantA, authorActor, key(), form({ slug: 'x-faq', pageKind: 'faq', topic: 'weather', body: '# x' }), meta()))).toMatchObject({ details: { refusals: [{ field: 'topic', code: 'TOPIC_UNKNOWN' }] } });
    let faq = await svc.faqIndex(tenantA, authorActor, { topic: 'payments' });
    expect(faq.items.map((i) => [i.slug, i.position])).toEqual([['payout-when', 1], ['payout-date', 2]]);
    expect(faq.items[1]).toMatchObject({ canMoveUp: true, canMoveDown: false });
    expect(faq.tiles).toMatchObject({ entries: 2, drafts: 2, published: 0, bySourceLanguage: [{ code: 'gu', n: 2 }] });
    const pv = await svc.faqMovePreview(tenantA, authorActor, 'payout-date', 'up', '');
    expect(pv).toMatchObject({ allowed: false, refusals: ['REASON_REQUIRED'], position: 2 });
    const k = key();
    const m = await svc.faqMove(tenantA, authorActor, k, { slug: 'payout-date', direction: 'up', reason: 'asked more often' }, meta());
    expect(await svc.faqMove(tenantA, authorActor, k, { slug: 'payout-date', direction: 'up', reason: 'asked more often' }, meta())).toEqual(m);   // replay, not a second move
    expect(m).toMatchObject({ order: ['payout-date', 'payout-when'], position: 1 });
    faq = await svc.faqIndex(tenantA, authorActor, { topic: 'payments' });
    expect(faq.items.map((i) => i.slug)).toEqual(['payout-date', 'payout-when']);
    expect(await errOf(svc.faqMove(tenantA, authorActor, key(), { slug: 'payout-date', direction: 'up', reason: 'again' }, meta()))).toMatchObject({ code: 'CMS_FAQ_MOVE_REFUSED', details: { refusals: ['AT_TOP'] } });
    const au = (await admin.query(`SELECT action, old_value, new_value, reason FROM audit_log WHERE entity_id=$1 AND action LIKE 'cms.faq_moved%'`, [b.id])).rows;
    expect(au).toHaveLength(1);
    expect(au[0]).toMatchObject({ action: 'cms.faq_moved_up', reason: 'asked more often', old_value: { position: 2 }, new_value: { position: 1, topic: 'payments' } });
    void a;
  });

  it('another tenant sees none of it; kv_app cannot write a platform page or another tenant\'s (rolled back)', async () => {
    await expect(svc.view(tenantB, authorActor, 'payment-policy')).rejects.toMatchObject({ code: 'CMS_PAGE_NOT_FOUND' });
    const bIdx = await svc.index(tenantB, authorActor, { limit: 100 });
    expect(bIdx.items.map((i) => i.slug)).toEqual(['about']);                       // the platform's, and nothing of A's
    expect(bIdx.items[0]).toMatchObject({ state: 'platform', serving: { source: 'platform', version: 5 } });
    const aId = (await admin.query(`SELECT id FROM cms_pages WHERE tenant_id=$1 AND slug='payment-policy'`, [tenantA])).rows[0].id;
    const platId = (await admin.query(`SELECT id FROM cms_pages WHERE tenant_id IS NULL AND slug='about' AND version=5`)).rows[0].id;
    const seen = await asApp(tenantB, agent, async (q) => ({
      seeA: (await q(`SELECT count(*)::int n FROM cms_pages WHERE tenant_id=$1`, [tenantA])).rows[0].n,
      seePlatform: (await q(`SELECT count(*)::int n FROM cms_pages WHERE tenant_id IS NULL`)).rows[0].n,
      insertPlatform: await probe(q, `INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code, created_by) VALUES (NULL,'about','static','x','# x',6,'draft','en',$1)`, [agent]),
      insertForA: await probe(q, `INSERT INTO cms_pages (tenant_id, slug, page_kind, default_title, body, version, status, language_code, created_by) VALUES ($1,'x','static','x','# x',1,'draft','en',$2)`, [tenantA, agent]),
    }));
    expect(seen).toEqual({ seeA: 0, seePlatform: 5, insertPlatform: '42501', insertForA: '42501' });
    const upd = await asApp(tenantB, agent, async (q) => ({
      platform: (await q(`UPDATE cms_pages SET sort_order = 1 WHERE id=$1`, [platId])).rowCount,
      tenantA: (await q(`UPDATE cms_pages SET sort_order = 1 WHERE id=$1`, [aId])).rowCount,
      retenant: await probe(q, `UPDATE cms_pages SET tenant_id = $1 WHERE tenant_id = $2`, [tenantB, tenantA]),
      del: await probe(q, `DELETE FROM cms_pages WHERE tenant_id = $1`, [tenantB]),
    }));
    expect(upd).toEqual({ platform: 0, tenantA: 0, retenant: '42501', del: '42501' });
    // and the platform's `about` is untouched
    expect((await admin.query(`SELECT count(*)::int n FROM cms_pages WHERE tenant_id IS NULL AND slug='about'`)).rows[0].n).toBe(5);
  });
});
