// modules/cms/__tests__/tenant8d-banners.integration.spec.ts · PC-56 TENANT-8d · THE BANNERS, live.
//
// Real PG16, the test database the harness builds from the real chain (migrations + seeds), every tenant-realm query as
// `kv_app` under RLS. Run under TZ=Asia/Kolkata AND TZ=UTC: the window is the COOPERATIVE's wall-clock either way. Proves:
//   1. the activation law — a banner without gu words is refused by the verdict (TEXT_MISSING · gu) AND by 0178's deferred
//      trigger as kv_app (23514); with all three it activates; an ACTIVE banner cannot lose gu (review + trigger);
//   2. F-8 — tenant B's image id is refused for tenant A with a TYPED error (review, writer, and the guard as kv_app —
//      never a bare FK pass); an image the scanner has not cleared is refused; an image that turns infected stops resume;
//   3. F-7 — pause writes its reason on the row AND an audit row (actor · reason · before/after · the client IP · the
//      request id in its own column);
//   4. the window — "2026-07-01 06:00" is 06:00 in the tenant's zone (00:30Z), whatever the process zone;
//   5. another tenant sees none of it (rows, words, the live box), and kv_app cannot delete, re-tenant or write the legacy columns;
//   6. Law 3 — the same Idempotency-Key replays ONE banner; an edit a colleague overtook is a typed 409;
//   7. the reorder — two concurrent moves in one slot serialise under the lock: the slot stays 1..n, both audited;
//   8. the evaluator in the live box — a member outside the audience is not offered it, a member without words in their
//      language is not offered it either (no English fallback).
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
import { BannerRepository } from '../repositories/banner.repository';
import { BannerService } from '../services/banner.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL ? describe : describe.skip;

run('TENANT-8d · the banners (integration, real Postgres + RLS as kv_app)', () => {
  let pools: PgPoolProvider; let admin: Pool; let app: Pool; let svc: BannerService;
  const tenantA = randomUUID(); const tenantB = randomUUID();
  const adminA = randomUUID(); const colleague = randomUUID(); const adminB = randomUUID(); const farmerJun = randomUUID(); const farmerRaj = randomUUID(); const farmerMr = randomUUID();
  const A = { userId: adminA, canManage: true }; const A2 = { userId: colleague, canManage: true }; const B = { userId: adminB, canManage: true };
  const imgA = randomUUID(); const imgPending = randomUUID(); const imgB = randomUUID(); const imgLater = randomUUID();
  const IP = '203.0.113.9';
  const meta = (requestId = `req-${randomUUID().slice(0, 8)}`) => ({ ip: IP, requestId });
  const key = () => `k-${randomUUID()}`;
  let junagadh = ''; let rajkot = '';
  const form = (over: Record<string, string | undefined> = {}) => ({
    placement: 'home_hero', mediaId: imgA, startsDate: '2026-01-01', startsTime: '06:00', endsDate: '2099-12-31', endsTime: '22:00', reason: 'kharif seeds arrived',
    headline_gu: 'પ્રમાણિત GG-20 બિયારણ આવી ગયું', headline_hi: 'प्रमाणित GG-20 बीज उपलब्ध', headline_en: 'Certified GG-20 seed in stock', intent: 'new', ...over,
  }) as any;

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
  const probe = async (q: (sql: string, p?: unknown[]) => Promise<any>, sql: string, p?: unknown[]) => {
    await q('SAVEPOINT p');
    const code = await pgCode(q(sql, p));
    await q(code === 'ok' ? 'RELEASE SAVEPOINT p' : 'ROLLBACK TO SAVEPOINT p');
    return code;
  };
  const errOf = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as { code?: string; status?: number; details?: any; httpStatus?: number }; } };
  const image = (id: string, tenant: string, scan: string) => admin.query(
    `INSERT INTO media_assets (id, tenant_id, kind, s3_key, mime_type, bytes, sha256, scan_status) VALUES ($1,$2,'image',$3,'image/webp',1024,$4,$5) ON CONFLICT DO NOTHING`,
    [id, tenant, `tenants/${tenant}/banners/hero_${id.slice(0, 4)}.webp`, 'b'.repeat(64), scan]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL ?? APP_URL });
    app = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, tenantA, 'Anand FPO'); await makeTenant(admin, tenantB, 'B');
    for (const u of [adminA, colleague, adminB, farmerJun, farmerRaj, farmerMr]) await makeUser(admin, u);
    await admin.query(`UPDATE users SET full_name='Kavita Ben' WHERE id=$1`, [adminA]);
    await admin.query(`UPDATE users SET language_code='gu' WHERE id = ANY($1::uuid[])`, [[farmerJun, farmerRaj]]);
    await admin.query(`UPDATE users SET language_code='mr' WHERE id=$1`, [farmerMr]);
    await image(imgA, tenantA, 'clean'); await image(imgPending, tenantA, 'pending'); await image(imgB, tenantB, 'clean'); await image(imgLater, tenantA, 'clean');
    junagadh = (await admin.query(`SELECT id FROM admin_regions WHERE code='GJ-JUN' LIMIT 1`)).rows[0].id;
    rajkot = (await admin.query(`SELECT id FROM admin_regions WHERE code='GJ-RAJ' LIMIT 1`)).rows[0].id;
    const farmerRole = (await admin.query(`SELECT id FROM roles WHERE code='farmer'`)).rows[0].id;
    for (const [u, region] of [[farmerJun, junagadh], [farmerRaj, rajkot], [farmerMr, junagadh]] as const) {
      await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id) VALUES ($1,$2,$3)`, [u, tenantA, farmerRole]);
      await admin.query(`INSERT INTO addresses (user_id, tenant_id, line1, region_id, country_code) VALUES ($1,$2,'Village road',$3,'IN')`, [u, tenantA, region]);
    }
    const config = new AppConfig({ NODE_ENV: 'test', DATABASE_URL: APP_URL, JWT_ACCESS_SECRET: 'itest-secret-itest-secret', AUTH_HASH_PEPPER: 'itest-pepper-itest-pepper-32x!!', SHARD_COUNT: '1' });
    pools = new PgPoolProvider(config);
    const shards = new ShardRouter(config);
    const replica = new PgReadReplicaProvider(pools, shards);
    svc = new BannerService(new PgUnitOfWork(pools, shards), new PgOutboxWriter(), new PromMetrics(), new AuditWriter(pools), new BannerRepository(replica as any), new PgIdempotencyService(pools));
  }, 60000);
  afterAll(async () => { await pools?.onModuleDestroy(); await app?.end(); await admin?.end(); });

  it('the window is the COOPERATIVE\'s wall-clock: "2026-07-01 06:00" → 00:30Z, read back as 06:00 (process TZ is irrelevant)', async () => {
    const r = await svc.preview(tenantA, A, form({ startsDate: '2026-07-01', startsTime: '6:00', endsDate: '2026-07-20', endsTime: '22:00' }));
    expect(r.preview.timezone).toBe('Asia/Kolkata');
    expect(r.preview.startsAt?.toISOString()).toBe('2026-07-01T00:30:00.000Z');
    expect(r.preview.endsAt?.toISOString()).toBe('2026-07-20T16:30:00.000Z');
    expect(r.fields.find((f) => f.name === 'startsAt')).toMatchObject({ entered: '2026-07-01 6:00', stored: '2026-07-01 06:00' });
    const w = await svc.save(tenantA, A, key(), form({ startsDate: '2026-07-01', startsTime: '6:00', endsDate: '2099-07-20', endsTime: '22:00' }), meta());
    const v = await svc.view(tenantA, A, w.id);
    expect(v.startsLocal).toEqual({ date: '2026-07-01', time: '06:00' }); expect(new Date(v.startsAt).toISOString()).toBe('2026-07-01T00:30:00.000Z');
    expect(String(process.env.TZ)).toMatch(/Asia\/Kolkata|UTC/);
  });

  it('the activation law: no gu words → refused by the verdict AND by 0178 as kv_app; with en · hi · gu it activates; an active banner cannot lose gu', async () => {
    const w = await svc.save(tenantA, A, key(), form({ headline_gu: '' }), meta());
    expect(w).toMatchObject({ mode: 'create', state: 'draft', missingLanguages: ['gu'], activatable: false });
    const refused = await errOf(svc.act(tenantA, A, key(), w.id, 'activate', { reason: 'goes live' }, meta()));
    expect(refused).toMatchObject({ code: 'CMS_BANNER_ACT_REFUSED', details: { refusals: ['TEXT_MISSING'], missingLanguages: ['gu'] } });
    // The database says the same, whoever writes the row.
    expect(await asApp(tenantA, adminA, (q) => pgCode((async () => {
      await q(`UPDATE banners SET state='active', activated_at=now(), activated_by=$2 WHERE id=$1`, [w.id, adminA]);
      await q(`SET CONSTRAINTS ALL IMMEDIATE`);
    })()))).toBe('23514');
    const acts = await svc.acts(tenantA, A, w.id, { reason: 'goes live' });
    expect(acts.activation).toEqual({ codes: ['TEXT_MISSING'], missingLanguages: ['gu'], unknown: [] });
    // Add the gu variant (W174 "Add gu variant" → the edit chain), then it activates.
    const v0 = await svc.view(tenantA, A, w.id);
    await svc.save(tenantA, A, key(), form({ reason: 'gujarati words added', expect: v0.expect }), meta(), w.id);
    const on: any = await svc.act(tenantA, A, key(), w.id, 'activate', { reason: 'all three languages' }, meta());
    expect(on).toMatchObject({ state: 'active', phase: 'live', before: { state: 'draft' } });
    // an ACTIVE banner never loses a required language: the review first …
    const v1 = await svc.view(tenantA, A, w.id);
    const drop = await svc.preview(tenantA, A, form({ headline_gu: '', reason: 'drop gujarati' }), w.id);
    expect(drop.refusals).toContainEqual({ field: 'headline_gu', code: 'TEXT_REQUIRED_WHILE_ACTIVE' });
    expect(await errOf(svc.save(tenantA, A, key(), form({ headline_gu: '', reason: 'drop gujarati', expect: v1.expect }), meta(), w.id))).toMatchObject({ code: 'CMS_BANNER_FORM_REFUSED' });
    // … and the deferred trigger, as kv_app.
    expect(await asApp(tenantA, adminA, (q) => pgCode((async () => {
      await q(`DELETE FROM banner_texts WHERE banner_id=$1 AND language_code='gu'`, [w.id]);
      await q(`SET CONSTRAINTS ALL IMMEDIATE`);
    })()))).toBe('23514');
    expect((await admin.query(`SELECT count(*)::int n FROM banner_texts WHERE banner_id=$1`, [w.id])).rows[0].n).toBe(3);
  });

  it('F-8 · tenant B\'s image is refused for tenant A with a typed error (review · writer · the guard as kv_app); an unscanned image too; an image turned infected stops resume', async () => {
    const cross = await svc.preview(tenantA, A, form({ mediaId: imgB }));
    expect(cross.ready).toBe(false); expect(cross.refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_NOT_YOURS' }]);
    expect(await errOf(svc.save(tenantA, A, key(), form({ mediaId: imgB }), meta()))).toMatchObject({ code: 'CMS_BANNER_FORM_REFUSED', httpStatus: 422, details: { refusals: [{ field: 'mediaId', code: 'MEDIA_NOT_YOURS' }] } });
    // the FK alone would have passed it: the guard refuses as kv_app, and as the owner (the explicit tenant comparison)
    const asKvApp = await asApp(tenantA, adminA, (q) => probe(q,
      `INSERT INTO banners (tenant_id, placement, media_id, starts_at, ends_at, created_by) VALUES ($1,'home_hero',$2,now(),now()+interval '1 day',$3)`, [tenantA, imgB, adminA]));
    expect(asKvApp).toBe('23514');
    expect((await admin.query(`SELECT banner_media_issue($1, $2) AS i`, [tenantA, imgB])).rows[0].i).toBe('MEDIA_NOT_YOURS');
    expect((await admin.query(`SELECT banner_media_issue($1, $2) AS i`, [tenantA, imgA])).rows[0].i).toBeNull();
    expect((await admin.query(`SELECT count(*)::int n FROM banners WHERE media_id=$1`, [imgB])).rows[0].n).toBe(0);
    // unscanned
    expect((await svc.preview(tenantA, A, form({ mediaId: imgPending }))).refusals).toEqual([{ field: 'mediaId', code: 'MEDIA_NOT_CLEAN' }]);
    // scanned clean, banner live, then the scanner turns it: pause → resume is refused (re-checked at every activation)
    const w = await svc.save(tenantA, A, key(), form({ mediaId: imgLater, placement: 'wallet' }), meta());
    await svc.act(tenantA, A, key(), w.id, 'activate', { reason: 'wallet bonus' }, meta());
    await svc.act(tenantA, A, key(), w.id, 'pause', { reason: 'checking the image' }, meta());
    await admin.query(`UPDATE media_assets SET scan_status='infected' WHERE id=$1`, [imgLater]);
    expect(await errOf(svc.act(tenantA, A, key(), w.id, 'resume', { reason: 'back on' }, meta()))).toMatchObject({ code: 'CMS_BANNER_ACT_REFUSED', details: { refusals: ['MEDIA_NOT_CLEAN'] } });
    expect((await admin.query(`SELECT state FROM banners WHERE id=$1`, [w.id])).rows[0].state).toBe('paused');
  });

  it('F-7 · pause writes its reason on the row and an audit row: actor · reason · before/after · the client IP · the request id apart', async () => {
    const w = await svc.save(tenantA, A, key(), form({ placement: 'category_top' }), meta('req-create-1'));
    await svc.act(tenantA, A, key(), w.id, 'activate', { reason: 'ghee festival' }, meta());
    await svc.act(tenantA, A, key(), w.id, 'pause', { reason: '  stock of GG-20 ran out  ' }, meta('req-pause-1'));
    const row = (await admin.query(`SELECT state, paused_reason, paused_by, paused_at FROM banners WHERE id=$1`, [w.id])).rows[0];
    expect(row).toMatchObject({ state: 'paused', paused_reason: 'stock of GG-20 ran out', paused_by: adminA }); expect(row.paused_at).toBeTruthy();
    const au = (await admin.query(`SELECT actor_user_id, action, reason, host(ip) AS ip, request_id, old_value, new_value FROM audit_log WHERE entity_type='banner' AND entity_id=$1 ORDER BY created_at, action`, [w.id])).rows;
    expect(au.map((x) => x.action)).toEqual(['cms.banner_created', 'cms.banner_activated', 'cms.banner_paused']);
    const p = au.find((x) => x.action === 'cms.banner_paused');
    expect(p).toMatchObject({ actor_user_id: adminA, reason: 'stock of GG-20 ran out', ip: IP, request_id: 'req-pause-1', old_value: { state: 'active', phase: 'live' }, new_value: { state: 'paused', phase: 'paused' } });
    expect(au[0]).toMatchObject({ request_id: 'req-create-1', ip: IP, old_value: null }); expect(au[0].new_value.words.map((x: any) => x.lang)).toEqual(['en', 'hi', 'gu']);
    // a pause without a reason is refused by the verdict and by 0178
    const w2 = await svc.save(tenantA, A, key(), form({ placement: 'category_top' }), meta());
    await svc.act(tenantA, A, key(), w2.id, 'activate', { reason: 'goes on' }, meta());
    expect(await errOf(svc.act(tenantA, A, key(), w2.id, 'pause', { reason: '' }, meta()))).toMatchObject({ code: 'CMS_BANNER_ACT_REFUSED', details: { refusals: ['REASON_REQUIRED'] } });
    expect(await asApp(tenantA, adminA, (q) => probe(q, `UPDATE banners SET state='paused', paused_at=now(), paused_by=$2 WHERE id=$1`, [w2.id, adminA]))).toBe('23514');
    // and the old shape is gone: no route, no service method, no audit-less write
    expect((svc as any).setActive).toBeUndefined();
  });

  it('Law 3 · the same Idempotency-Key replays ONE banner; an edit a colleague overtook is a typed 409', async () => {
    const k = key();
    const [a, b] = await Promise.all([svc.save(tenantA, A, k, form({ groupKey: 'replay-probe' }), meta()), svc.save(tenantA, A, k, form({ groupKey: 'replay-probe' }), meta())].map((p) => p.catch((e) => e)));
    const again = await svc.save(tenantA, A, k, form({ groupKey: 'replay-probe' }), meta());
    const ids = [a, b, again].filter((x: any) => x && x.id).map((x: any) => x.id);
    expect(new Set(ids).size).toBe(1);
    expect((await admin.query(`SELECT count(*)::int n FROM banners WHERE tenant_id=$1 AND banner_group_key='replay-probe'`, [tenantA])).rows[0].n).toBe(1);
    expect((await admin.query(`SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND action='cms.banner_created'`, [again.id])).rows[0].n).toBe(1);
    // two editors reviewed the same version; the second save is a 409, not a silent overwrite
    const v = await svc.view(tenantA, A, again.id);
    await svc.save(tenantA, A, key(), form({ groupKey: 'replay-probe', headline_hi: 'नया शब्द', reason: 'hindi line', expect: v.expect }), meta(), again.id);
    expect(await errOf(svc.save(tenantA, A2, key(), form({ groupKey: 'replay-probe', headline_en: 'New words', reason: 'english line', expect: v.expect }), meta(), again.id)))
      .toMatchObject({ code: 'CMS_BANNER_CHANGED', httpStatus: 409 });
    const edited = (await admin.query(`SELECT old_value, new_value, reason FROM audit_log WHERE entity_id=$1 AND action='cms.banner_edited'`, [again.id])).rows;
    expect(edited).toHaveLength(1); expect(edited[0].new_value.diff).toEqual(['headline_hi']); expect(edited[0].reason).toBe('hindi line');
  });

  it('the reorder in a slot: two concurrent moves serialise under the lock — the slot stays 1..n, both audited', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await svc.save(tenantA, A, key(), form({ placement: 'home_hero', groupKey: `slot-${i}` }), meta())).id);
    const slotOf = async () => (await admin.query(`SELECT id, slot_order FROM banners WHERE tenant_id=$1 AND placement='home_hero' AND state <> 'archived' ORDER BY slot_order, id`, [tenantA])).rows;
    const before = await slotOf();
    const last = ids[2];
    // Force the race: a third session holds the slot's rows while BOTH moves start, so both are in flight before either
    // can write. Without the slot lock both would plan from the same order and one move would be lost (proven in the 8d
    // report by removing the lock: this test then fails).
    const blocker = await admin.connect();
    await blocker.query('BEGIN');
    await blocker.query(`SELECT id FROM banners WHERE tenant_id=$1 AND placement='home_hero' AND state <> 'archived' FOR UPDATE`, [tenantA]);
    const moves = Promise.allSettled([
      svc.slotMove(tenantA, A, key(), { id: last, direction: 'up', reason: 'the camp first' }, meta()),
      svc.slotMove(tenantA, A2, key(), { id: last, direction: 'up', reason: 'the camp first, again' }, meta()),
    ]);
    await new Promise((res) => setTimeout(res, 400));
    await blocker.query('COMMIT'); blocker.release();
    const r = await moves;
    expect(r.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
    const after = await slotOf();
    expect(after.map((x: any) => Number(x.slot_order))).toEqual(after.map((_: any, i: number) => i + 1));
    expect(after.length).toBe(before.length);
    const pos = (rows: any[]) => rows.findIndex((x) => x.id === last) + 1;
    expect(pos(after)).toBe(pos(before) - 2);               // moved up twice — neither move was lost to the other
    const au = (await admin.query(`SELECT action, old_value, new_value FROM audit_log WHERE entity_id=$1 AND action LIKE 'cms.banner_moved%'`, [last])).rows;
    expect(au).toHaveLength(2);
    expect(await errOf(svc.slotMove(tenantA, A, key(), { id: after[0].id, direction: 'up', reason: 'already first' }, meta()))).toMatchObject({ code: 'CMS_BANNER_SLOT_REFUSED', details: { refusals: ['AT_TOP'] } });
  });

  it('the evaluator in the live box: outside the audience → not offered; no words in your language → not offered (no English fallback)', async () => {
    const w = await svc.save(tenantA, A, key(), form({ placement: 'category_top', roles: 'farmer', regions: junagadh, groupKey: 'junagadh-farmers' }), meta());
    await svc.act(tenantA, A, key(), w.id, 'activate', { reason: 'for the junagadh belt' }, meta());
    const offered = async (u: string) => (await svc.live(tenantA, u, { placement: 'category_top', limit: 50 })).items.map((x) => x.id);
    expect(await offered(farmerJun)).toContain(w.id);                // a farmer in Junagadh, reads gu
    expect(await offered(farmerRaj)).not.toContain(w.id);            // a farmer in Rajkot — outside the region
    expect(await offered(farmerMr)).not.toContain(w.id);             // in Junagadh, reads Marathi — the banner has no mr words
    const gu = (await svc.live(tenantA, farmerJun, { placement: 'category_top', limit: 50 })).items.find((x) => x.id === w.id);
    expect(gu?.text).toMatchObject({ languageCode: 'gu', headline: 'પ્રમાણિત GG-20 બિયારણ આવી ગયું' });
    const v = await svc.view(tenantA, A, w.id);
    expect(v.reach).toMatchObject({ matched: 2, hiddenNoText: 1 });   // Junagadh farmers: gu (sees it) + mr (does not)
    expect(v.reader.surfaces).toEqual([]);
    // a role the registry does not hold, a region of nowhere: refused by name, and by 0178 as kv_app
    const bad = await svc.preview(tenantA, A, form({ roles: 'farmer sarpanch', regions: randomUUID() }));
    expect(bad.refusals).toEqual([{ field: 'roles', code: 'ROLE_UNKNOWN' }, { field: 'regions', code: 'REGION_UNKNOWN' }]);
    expect(await asApp(tenantA, adminA, (q) => probe(q, `UPDATE banners SET audience='{"roles":["sarpanch"],"regions":[]}' WHERE id=$1`, [w.id]))).toBe('23514');
    expect(await asApp(tenantA, adminA, (q) => probe(q, `UPDATE banners SET audience='{"roles":[],"regions":[],"min_orders":1}' WHERE id=$1`, [w.id]))).toBe('23514');
  });

  it('another tenant sees none of it; kv_app cannot delete, re-tenant or write the legacy columns (rolled back)', async () => {
    const own = await svc.save(tenantB, B, key(), form({ mediaId: imgB }), meta());
    const idxB = await svc.index(tenantB, B, { limit: 100 });
    expect(idxB.items.map((i) => i.id)).toEqual([own.id]);
    const idxA = await svc.index(tenantA, A, { limit: 100 });
    expect(idxA.items.map((i) => i.id)).not.toContain(own.id);
    const anA = idxA.items[0].id;
    expect(await errOf(svc.view(tenantB, B, anA))).toMatchObject({ code: 'CMS_BANNER_NOT_FOUND' });
    const seen = await asApp(tenantB, adminB, async (q) => ({
      banners: (await q(`SELECT count(*)::int n FROM banners WHERE tenant_id=$1`, [tenantA])).rows[0].n,
      texts: (await q(`SELECT count(*)::int n FROM banner_texts WHERE tenant_id=$1`, [tenantA])).rows[0].n,
      updateA: (await q(`UPDATE banners SET target_url='https://evil.example' WHERE tenant_id=$1`, [tenantA])).rowCount,
      insertForA: await probe(q, `INSERT INTO banners (tenant_id, placement, media_id, starts_at, ends_at, created_by) VALUES ($1,'home_hero',$2,now(),now()+interval '1 day',$3)`, [tenantA, imgA, adminB]),
      textForA: await probe(q, `INSERT INTO banner_texts (tenant_id, banner_id, language_code, headline) VALUES ($1,$2,'gu','x')`, [tenantA, anA]),
      del: await probe(q, `DELETE FROM banners WHERE id=$1`, [own.id]),
      retenant: await probe(q, `UPDATE banners SET tenant_id=$1 WHERE id=$2`, [tenantA, own.id]),
      legacy: await probe(q, `UPDATE banners SET language_code='en' WHERE id=$1`, [own.id]),
      bornActive: await probe(q, `INSERT INTO banners (tenant_id, placement, media_id, starts_at, ends_at, created_by, state) VALUES ($1,'home_hero',$2,now(),now()+interval '1 day',$3,'active')`, [tenantB, imgB, adminB]),
      freePlacement: await probe(q, `INSERT INTO banners (tenant_id, placement, media_id, starts_at, ends_at, created_by) VALUES ($1,'homepage',$2,now(),now()+interval '1 day',$3)`, [tenantB, imgB, adminB]),
    }));
    // A's banner and A's image are not there from B's realm: the guard refuses before RLS's WITH CHECK is reached (23514 —
    // the image is not B's to point at; 23503 — the banner a text would hang on does not exist here). Either wall holds.
    expect(seen).toEqual({ banners: 0, texts: 0, updateA: 0, insertForA: '23514', textForA: '23503', del: '42501', retenant: '42501', legacy: '42501', bornActive: '23514', freePlacement: '23514' });
    // RLS itself, past the guard: as the OWNER-less path the guard is satisfied only by A's own clean image, which B cannot
    // see — so the row-level wall is proven on UPDATE above (`updateA: 0`) and by `bn_tenant`'s WITH CHECK (pg_policy in the report).
    const liveB = await svc.live(tenantB, adminB, { limit: 50 });
    expect(liveB.items.map((x) => x.id)).not.toContain(anA);
  });
});
