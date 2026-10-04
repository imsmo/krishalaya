// apps/api/src/__tests__/tenant-swf-insights-offline.integration.spec.ts · PC-56 TENANT-SW-f · INSIGHTS, LEARNER INSIGHTS, OFFLINE — the live
// proof against real Postgres + RLS + 0202, through the REAL AppModule over HTTP with the BUILT SDK (what the console imports), the relay
// handlers dispatched AS kv_relay through the real OutboxDispatcher, the export plane's real worker, and the report runner in kv_app's UoW.
//   A  mandi pulse: the member-crop filter (listings + crop seasons) and LISTED stock are real; modal + Δ d/d per mandi; alerts active /
//      fired this week real; stored stock, "sold on an alert" and the AI band REFUSED BY NAME; the export → ready, unsigned.
//   B  demand map: stock fit computed (covers / partial), value = qty × budget or REFUSED (NO_PRICE_ON_REQUIREMENT), reach a REAL filter
//      (pincode → district) or REFUSED (NO_GEO_REACH) for a cooperative with no district, member rows only where consented, µs paging,
//      the export carries no member name.
//   C  wastage: each source event writes ONE event (a redelivery adds nothing), facts derived by the database, a POD rejection and its
//      dispute counted once, the re-run backfill counts, the 90-day sum with its method, loss ÷ GMV, external statistic refused, manual
//      entry refused, kv_app INSERT-only.
//   D  reports: an allow-listed run → CSV on the plane with the watermark header + audit; > 92 days refused; the row cap refused; the
//      statement timeout observed INSIDE the run's transaction; platform definitions read-only; the auditor limited to its datasets; a
//      schedule's next run computed in IST and materialised.
//   E  offline: verify-before-write — the shared chain's re-read returns STALE_ROW with the diff on a changed row (SW-e carrier act).
//   F  learner insights: a quiz submit writes quiz_answers + progress atomically; a watch event is written; the heatmap refused below 50
//      learners and printed at 50; the funnel is real; µs paging.
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import { Pool, PoolClient } from 'pg';
import type { INestApplication } from '@nestjs/common';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { KrishalayaClient, SdkError } from '../../../../packages/sdk-js/dist';
import { ExportWorker } from '../core/exports-plane/export-worker';
import { UNIT_OF_WORK } from '../core/database/unit-of-work';
import { OUTBOX_WRITER } from '../core/outbox/outbox.writer';
import { READ_REPLICA } from '../core/database/read-replica.provider';
import { METRICS } from '../core/observability/metrics';
import { DATASET_REGISTRY } from '../core/exports-plane/dataset.registry';
import { ExportJobRepository } from '../core/exports-plane/export-job.repository';
import { OUTBOX_HANDLER_REGISTRY } from '../core/outbox/event-envelope';
import { OutboxDispatcher, OutboxHandlerRegistry } from '../core/outbox/outbox.dispatcher';
import { WastageSourceHandler } from '../modules/insights/events/handlers/wastage-source.handler';
import { ReportRunner } from '../modules/insights/services/report.service';
import { nextRunAt } from '../modules/insights/domain/report-builder';
import { seenToken, verifyBeforeWrite } from '../../../web-tenant/src/features/mutate/verify';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const idem = () => `idem-${randomUUID()}`;
const cursorInstant = (c: string) => Buffer.from(c, 'base64url').toString('utf8').split('|')[0];
const codeOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return 'ok'; } catch (e) { return e instanceof SdkError ? e.code : ((/\[([A-Z_]+)\]/.exec(String((e as Error)?.message)) ?? [])[1] ?? String((e as { code?: string })?.code ?? e)); } };
const day = (offset: number) => new Date(Date.now() + 330 * 60_000 + offset * 86_400_000).toISOString().slice(0, 10);   // an IST calendar day

class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObject(k: string, body: Buffer): Promise<void> { this.objects.set(k, Buffer.from(body)); }
  async getObject(k: string): Promise<Buffer> { const b = this.objects.get(k); if (!b) throw new Error('S3 getObject failed (404)'); return b; }
  async putObjectStream(k: string, body: Readable, _ct: string, len: number): Promise<void> {
    const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks); if (b.length !== len) throw new Error('length'); this.objects.set(k, b);
  }
  async getObjectStream(k: string): Promise<Readable> { return Readable.from([await this.getObject(k)]); }
}

run('PC-56 TENANT-SW-f · insights, learner insights, offline (integration, real Postgres + RLS + 0202, real HTTP + SDK)', () => {
  let app: INestApplication; let admin: Pool; let relayPool: Pool; let base = '';
  const T = randomUUID(); const T2 = randomUUID();
  const flagBackup: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: any }> = [];
  const U = { admin1: '', admin2: '', coord: '', auditor: '', staff: '', m1: '', m2: '', buyer: '', instructor: '', t2admin: '' };
  const tok: Record<string, string> = {};
  const store = new MemoryStore();
  let worker: ExportWorker;
  let cat = ''; let P1 = ''; let P2 = ''; let P3 = ''; let D1 = ''; let D2 = '';

  const sdk = (who: keyof typeof U | string, tenant = T) => new KrishalayaClient({ baseUrl: base, apiVersion: 'v1', retries: 0, timeoutMs: 60_000,
    getToken: () => tok[who] ?? null, getHeaders: () => ({ 'x-tenant-id': tenant }) });
  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const role = (u: string, code: string, tenant = T) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, r.id, true FROM roles r WHERE r.code=$3 ON CONFLICT DO NOTHING`, [u, tenant, code]);
  const permsOf = async (code: string) => (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code=$1`, [code])).rows.map((x) => x.permission_code as string);
  async function history(fn: (c: PoolClient) => Promise<void>): Promise<void> {
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query('SET LOCAL session_replication_role = replica'); await fn(c); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  async function asApp(userId: string, sql: string, p: unknown[] = [], tenant = T): Promise<string> {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_app');
      await c.query(`SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`, [tenant, userId]);
      const r = await c.query(sql, p); return `ok:${r.rowCount}`;
    } catch (e) { const m = /\[([A-Z_]+)\]/.exec(String((e as Error).message)); return m ? m[1] : `${(e as { code?: string }).code}`; }
    finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  }
  const allow = async (flag: string, tenants: string[] = [T, T2]) => {
    const row = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key=$1`, [flag])).rows[0];
    if (!row) throw new Error(`flag ${flag} missing`);
    if (!flagBackup.find((f) => f.key === flag)) flagBackup.push(row);
    const rules = row.is_enabled ? { ...(row.rules ?? {}), tenant_ids: [...((row.rules ?? {}).tenant_ids ?? []), ...tenants] } : { tenant_ids: tenants };
    await admin.query(`UPDATE feature_flags SET is_enabled=true, rollout_pct=$2, rules=$3::jsonb WHERE key=$1`, [flag, row.is_enabled ? row.rollout_pct : 0, JSON.stringify(rules)]);
  };
  const mkUser = async (name: string, roles: string[], tenant = T) => {
    const u = await makeUser(admin);
    await admin.query(`UPDATE users SET full_name=$2, language_code='gu' WHERE id=$1`, [u, name]);
    for (const r of roles) await role(u, r, tenant);
    return u;
  };
  const product = async (name: string, tenant = T) => {
    const id = randomUUID();
    await admin.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv) VALUES ($1,$2,$3::text,'quintal',$4,true, to_tsvector('simple',$3::text))`, [id, cat, name, tenant]);
    return id;
  };
  const listing = async (seller: string, productId: string, qty: number, o: { status?: string; region?: string | null; tenant?: string } = {}) => {
    const id = randomUUID();
    await history((c) => c.query(
      `INSERT INTO listings (id, tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility, region_id)
       VALUES ($1,$2,$3,$4,$5,'lot',$6,$6,1,'quintal',2500000,'INR',$7,'public',$8)`, [id, o.tenant ?? T, seller, productId, cat, qty, o.status ?? 'published', o.region ?? null]).then(() => undefined));
    return id;
  };
  /** A minimal order (+ one line) — orders is partitioned on created_at; the repositories prune with uuid_v7_time(id). */
  const order = async (o: { status?: string; subtotal?: number; completedDaysAgo?: number | null; productId?: string } = {}) => {
    const id = (await q1(`SELECT uuid_generate_v7() AS id`)).id as string;
    await history(async (c) => {
      await c.query(`INSERT INTO orders (id, tenant_id, order_no, buyer_user_id, seller_user_id, currency_code, subtotal_minor, total_minor, status, completed_at, created_at)
                     VALUES ($1,$2,$3,$4,$5,'INR',$6,$6,$7, CASE WHEN $8::int IS NULL THEN NULL ELSE now() - make_interval(days => $8::int) END, uuid_v7_time($1))`,
        [id, T, `SWF-${id.slice(0, 12)}`, U.buyer, U.m1, o.subtotal ?? 100000, o.status ?? 'delivered', o.completedDaysAgo ?? null]);
      await c.query(`INSERT INTO order_items (order_id, order_created_at, tenant_id, listing_id, product_id, title_snapshot, quantity, unit_code, unit_price_minor, line_total_minor)
                     SELECT $1, o.created_at, $2, $3, $4, 'lot', 8, 'quintal', 12500, $5 FROM orders o WHERE o.id=$1`, [id, T, randomUUID(), o.productId ?? P1, o.subtotal ?? 100000]);
    });
    return id;
  };
  const wastageHandlers = (): OutboxHandlerRegistry => {
    const reg = new OutboxHandlerRegistry();
    for (const e of app.get<OutboxHandlerRegistry>(OUTBOX_HANDLER_REGISTRY).entries()) if (e.handler instanceof WastageSourceHandler) reg.register(e.handler);
    return reg;
  };
  /** Insert ONE pending source event and relay it AS kv_relay through the real dispatcher, with the registered wastage handlers. */
  const relay = async (eventType: string, payload: Record<string, unknown>) => {
    const id = (await admin.query(`INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload) VALUES ($1,'x',$2,$3,$4::jsonb) RETURNING id`,
      [T, randomUUID(), eventType, JSON.stringify({ v: 1, ...payload })])).rows[0].id as string;
    return new OutboxDispatcher(relayPool, wastageHandlers(), { inc: () => undefined, observe: () => undefined } as never).relayById(String(id));
  };
  const fileOf = (jobId: string) => { const k = [...store.objects.keys()].find((x) => x.includes(jobId)); if (!k) throw new Error(`no file for ${jobId}`); return store.objects.get(k)!.toString('utf8'); };

  beforeAll(async () => {
    admin = new Pool({ connectionString: ADMIN_URL });
    await admin.query(`ALTER ROLE kv_relay WITH LOGIN PASSWORD 'dev'`);
    const as = (r: string) => { const u = new URL(APP_URL as string); u.username = r; u.password = 'dev'; return u.toString(); };
    relayPool = new Pool({ connectionString: as('kv_relay'), max: 2 });

    await makeTenant(admin, T, 'Anand FPO'); await makeTenant(admin, T2, 'Quiet FPO');
    // a district (level 2) and a second one, each with a pincode of its own; the cooperative's region is the first
    const lvl2 = (await admin.query(`SELECT id FROM admin_regions WHERE level = 2 ORDER BY id LIMIT 2`)).rows;
    D1 = lvl2[0].id; D2 = lvl2[1]?.id ?? lvl2[0].id;
    await admin.query(`INSERT INTO pincodes (pincode, country_code, region_id) VALUES ('990001','IN',$1), ('990002','IN',$2) ON CONFLICT (country_code, pincode) DO UPDATE SET region_id = EXCLUDED.region_id`, [D1, D2]);
    await history((c) => c.query(`UPDATE tenants SET region_id = $2 WHERE id = $1`, [T, D1]).then(() => undefined));

    U.admin1 = await mkUser('Kiran Admin', ['tenant_admin']); U.admin2 = await mkUser('Mehul Admin', ['tenant_admin']);
    U.coord = await mkUser('Coord Bhai', ['fpo_coordinator']); U.auditor = await mkUser('CA Mehta', ['auditor']); U.staff = await mkUser('Staff Ben', ['tenant_staff']);
    U.m1 = await mkUser('Ramesh Patel', ['farmer']); U.m2 = await mkUser('Suresh Patel', ['farmer']); U.buyer = await mkUser('Unjha Trading', ['vyapari']);
    U.instructor = await mkUser('Dr Kavita', ['instructor', 'tenant_staff']); U.t2admin = await mkUser('Quiet Admin', ['tenant_admin'], T2);
    for (const f of ['market_intel', 'requirements', 'insights_wastage', 'insights_reports', 'tenant_exports', 'education', 'logistics']) await allow(f);

    cat = randomUUID(); const code = `swf${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await admin.query(`INSERT INTO categories (id, code, default_name, path, depth, is_active) VALUES ($1,$2::text,'Crops',$3::ltree,1,true)`, [cat, code, code]);
    P1 = await product('Cumin'); P2 = await product('GG-20 groundnut'); P3 = await product('Draft-only sesame');

    app = await bootstrapE2EApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const adminPerms = await permsOf('tenant_admin');
    tok.admin1 = mintToken(app, { userId: U.admin1, tenantId: T, perms: adminPerms, roles: ['tenant_admin'] });
    tok.admin2 = mintToken(app, { userId: U.admin2, tenantId: T, perms: adminPerms, roles: ['tenant_admin'] });
    tok.coord = mintToken(app, { userId: U.coord, tenantId: T, perms: await permsOf('fpo_coordinator'), roles: ['fpo_coordinator'] });
    tok.auditor = mintToken(app, { userId: U.auditor, tenantId: T, perms: await permsOf('auditor'), roles: ['auditor'] });
    tok.staff = mintToken(app, { userId: U.staff, tenantId: T, perms: await permsOf('tenant_staff'), roles: ['tenant_staff'] });
    tok.t2admin = mintToken(app, { userId: U.t2admin, tenantId: T2, perms: adminPerms, roles: ['tenant_admin'] });
    tok.instructor = mintToken(app, { userId: U.instructor, tenantId: T, perms: [...await permsOf('instructor'), 'course.author'], roles: ['instructor'] });
    worker = new ExportWorker(app.get(UNIT_OF_WORK), app.get(OUTBOX_WRITER), app.get(READ_REPLICA), app.get(METRICS), app.get(DATASET_REGISTRY), store as never, app.get(ExportJobRepository));
  }, 300_000);

  afterAll(async () => {
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = ANY($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    // the plane's queue is ONE cross-tenant FIFO: this spec's jobs are finished or removed so a neighbour's head is its own
    await admin?.query(`DELETE FROM tenant_export_downloads WHERE tenant_id = ANY($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    await admin?.query(`DELETE FROM tenant_export_jobs WHERE tenant_id = ANY($1::uuid[])`, [[T, T2]]).catch(() => undefined);
    for (const f of flagBackup) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [f.key, f.is_enabled, f.rollout_pct, JSON.stringify(f.rules ?? {})]).catch(() => undefined);
    await app?.close().catch(() => undefined); await relayPool?.end().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  /* ═══════════════════════════════════════════ A · MANDI PULSE ═══════════════════════════════════════════ */
  describe('A · mandi pulse (W193 · W2678–W2682)', () => {
    beforeAll(async () => {
      await listing(U.m1, P1, 418, { region: D1 });                         // a published listing → in the filter, listed stock 418
      await listing(U.m2, P3, 50, { status: 'draft' });                     // a DRAFT listing → not in the filter
      await history((c) => c.query(`INSERT INTO crop_seasons (tenant_id, parcel_id, product_id, season, year, status, expected_yield, yield_unit_code)
                                    VALUES ($1,$2,$3,'kharif', extract(year FROM now())::int, 'sown', 20, 'quintal')`, [T, randomUUID(), P2]).then(() => undefined));
      const m = randomUUID();
      await admin.query(`INSERT INTO mandis (id, default_name, region_id) VALUES ($1,'Unjha APMC',$2)`, [m, D1]);
      await history(async (c) => {
        for (const [pid, d, modal] of [[P1, day(-1), 2400000], [P1, day(0), 2485000], [P3, day(0), 1230000]] as const) {
          await c.query(`INSERT INTO mandi_prices (mandi_id, region_id, product_id, price_date, modal_minor, unit_code, source, currency_code) VALUES ($1,$2,$3,$4::date,$5,'quintal','agmarknet','INR')`, [m, D1, pid, d, modal]);
        }
        await c.query(`INSERT INTO price_alerts (tenant_id, user_id, product_id, direction, threshold_minor, is_active) VALUES ($1,$2,$3,'above',2400000,true), ($1,$4,$3,'below',2000000,true), ($1,$4,$3,'below',1000000,false)`, [T, U.m1, P1, U.m2]);
        const a = (await c.query(`SELECT id FROM price_alerts WHERE tenant_id=$1 AND user_id=$2`, [T, U.m1])).rows[0].id;
        await c.query(`INSERT INTO price_alert_triggers (tenant_id, alert_id, user_id, product_id, direction, modal_minor, threshold_minor, triggered_at) VALUES
                       ($1,$2,$3,$4,'above',2485000,2400000, now() - interval '1 minute'), ($1,$2,$3,$4,'above',2485000,2400000, now() - interval '9 days')`, [T, a, U.m1, P1]);
      });
    });
    it('your crops = published listings ∪ crop seasons; listed stock is the listings\' sum; modal + Δ per mandi; alerts real; three refusals by name', async () => {
      const p = await sdk('admin1').insights.memberPulse();
      expect(p.cropsTracked).toMatchObject({ count: 2, fromListings: 1, fromSeasons: 1, method: 'member_crops' });
      const cumin = p.crops.items.find((c) => c.productId === P1)!;
      expect(cumin).toMatchObject({ listed: true, declared: false });
      expect(cumin.listedStock).toEqual([{ unit: 'quintal', quantity: '418', listings: 1 }]);
      expect(cumin.mandis[0]).toMatchObject({ mandi: 'Unjha APMC', modalMinor: '2485000', currency: 'INR', priceDate: day(0) });
      expect(cumin.mandis[0].change).toMatchObject({ previousModalMinor: '2400000', changeMinor: '85000', changeBps: 354 });
      expect(p.crops.items.find((c) => c.productId === P2)).toMatchObject({ listed: false, declared: true, listedStock: [] });
      expect(p.crops.items.some((c) => c.productId === P3)).toBe(false);           // a draft listing tracks nothing
      expect(p.alerts).toMatchObject({ active: 2, firedThisWeek: 1 });
      expect(p.storedStock).toEqual({ kind: 'refused', code: 'NO_STOCK_DECLARATION' });
      expect(p.soldOnAlert).toEqual({ kind: 'refused', code: 'NO_CAUSAL_METHOD' });
      expect(p.band).toEqual({ kind: 'refused', code: 'NO_REGISTERED_MODEL' });
      expect(p.methods.listed_stock.en).toContain('not what is held in store');
      expect(p.methods.listed_stock.gu).toBeTruthy(); expect(p.refusals.NO_CAUSAL_METHOD.hi).toBeTruthy();
      expect(await codeOf(sdk('staff').insights.memberPulse())).toBe('FORBIDDEN');          // "needs analytics scope"
    });
    it('the export: dataset mandi_pulse_member_crops on the plane → ready; the file names its methods and refusals and says unsigned', async () => {
      const job = await sdk('admin1').insights.exportMemberPulse(idem());
      expect(job).toMatchObject({ status: 'queued', datasetCode: 'mandi_pulse_member_crops' });
      expect(await worker.generate({ id: job.id, tenantId: T } as never)).toBe('ready');
      const ready = await sdk('admin1').exportsPlane.get(job.id);
      expect(ready.receipt?.notes.join('\n')).toContain('unsigned — signing is a founder-physical key');
      expect(ready.receipt?.notes.join('\n')).toContain('NO_REGISTERED_MODEL');
      expect(fileOf(job.id)).toContain('Cumin');
    });
  });

  /* ═══════════════════════════════════════════ B · DEMAND MAP ═══════════════════════════════════════════ */
  describe('B · demand map (W194 · W2569–W2573)', () => {
    const R: Record<string, string> = {};
    beforeAll(async () => {
      await listing(U.m2, P1, 100, { region: D1 });                         // listed stock of cumin: 418 + 100 = 518 quintal (m1 + m2)
      await history(async (c) => {
        for (const [k, qty, bmin, bmax, pin] of [['r1', 200, 2400000, 2500000, '990001'], ['r2', 1000, null, null, '990002'], ['r3', 50, null, 2600000, null]] as const) {
          const id = randomUUID(); R[k] = id;
          await c.query(`INSERT INTO requirements (id, tenant_id, buyer_user_id, product_id, category_id, title, quantity, unit_code, budget_min_minor, budget_max_minor, delivery_pincode, status, created_at)
                         VALUES ($1,$2,$3,$4,$5,$6,$7,'quintal',$8,$9,$10,'open', now() - make_interval(secs => $11::int))`,
            [id, T, U.buyer, P1, cat, `cumin export grade ${k}`, qty, bmin, bmax, pin, k === 'r1' ? 30 : k === 'r2' ? 20 : 10]);
        }
        // m1 CONSENTED to a quote of 150 quintal on r1 (11d) — the only member-level row the map may show
        await c.query(`INSERT INTO requirement_consents (tenant_id, requirement_id, act, member_user_id, group_id, line_id, listing_id, quantity, price_minor, channel, recorded_by)
                       VALUES ($1,$2,'quote',$3,$4,$5,$6,150,2450000,'app',$3)`, [T, R.r1, U.m1, randomUUID(), randomUUID(), (await q1(`SELECT id FROM listings WHERE seller_user_id=$1 LIMIT 1`, [U.m1])).id]);
      });
    });
    it('stock fit covers / partial from listed stock; value = qty × budget or REFUSED; reach in / out / unknown; consented rows only; unmet demand refused', async () => {
      const m = await sdk('admin1').insights.demandMap();
      const r1 = m.items.find((x) => x.id === R.r1)!; const r2 = m.items.find((x) => x.id === R.r2)!; const r3 = m.items.find((x) => x.id === R.r3)!;
      expect(r1.wanted).toEqual({ quantity: '200', unit: 'quintal' });
      expect(r1.stock).toMatchObject({ quantity: '518', fit: 'covers', sellers: 2 });
      expect(r1.value).toEqual({ kind: 'value', upToMinor: '500000000', fromMinor: '480000000', currency: 'INR' });
      expect(r1.reach).toBe('in_reach');
      expect(r1.consented).toEqual([expect.objectContaining({ memberName: 'Ramesh Patel', quantity: '150.000', priceMinor: '2450000' })]);
      expect(r2.stock.fit).toBe('partial');
      expect(r2.value).toEqual({ kind: 'refused', code: 'NO_PRICE_ON_REQUIREMENT' });
      expect(r2.reach).toBe('out_of_reach');
      expect(r2.consented).toEqual([]);                                   // no consent → aggregates only
      expect(r3.reach).toBe('unknown');
      expect(m.reach).toMatchObject({ kind: 'filter', districts: 1, applied: false });
      expect(m.unmetDemand).toEqual({ kind: 'refused', code: 'NO_UNMET_DEMAND_METHOD' });
      expect(m.privacy).toBe('aggregates_until_consent');
    });
    it('"within reach of your districts" is a REAL filter; a cooperative with no district gets it REFUSED BY NAME (NO_GEO_REACH)', async () => {
      const near = await sdk('admin1').insights.demandMap({ reach: 'districts' });
      expect(near.items.map((x) => x.id)).toEqual([R.r1]);
      expect(near.reach).toMatchObject({ kind: 'filter', applied: true });
      const quiet = await sdk('t2admin', T2).insights.demandMap({ reach: 'districts' });
      expect(quiet.reach).toEqual({ kind: 'refused', code: 'NO_GEO_REACH' });
    });
    it('µs paging: three pages of one, each cursor a microsecond instant, no row twice', async () => {
      const seen: string[] = []; let cursor: string | undefined;
      for (let i = 0; i < 5; i++) {
        const pg = await sdk('admin1').insights.demandMap({ limit: 1, cursor });
        seen.push(...pg.items.map((x) => x.id));
        if (!pg.nextCursor) break;
        expect(cursorInstant(pg.nextCursor)).toMatch(/\.\d{6}Z$/);
        cursor = pg.nextCursor;
      }
      expect(seen).toEqual([R.r3, R.r2, R.r1]);
    });
    it('the export: dataset demand_map → ready; aggregates only — no member is named in the file', async () => {
      const job = await sdk('admin1').insights.exportDemandMap('all', idem());
      expect(await worker.generate({ id: job.id, tenantId: T } as never)).toBe('ready');
      const f = fileOf(job.id);
      expect(f).toContain('NO_PRICE_ON_REQUIREMENT'); expect(f).not.toContain('Ramesh');
      expect((await sdk('admin1').exportsPlane.get(job.id)).receipt?.rowCount).toBe(3);
    });
  });

  /* ═══════════════════════════════════════════ C · WASTAGE ═══════════════════════════════════════════ */
  describe('C · wastage from recorded facts (W195 · W2824–W2828)', () => {
    const S: Record<string, string> = {};
    beforeAll(async () => {
      const o1 = await order({ status: 'delivered' }); const o2 = await order({ status: 'delivered' }); const o3 = await order({ status: 'delivered' }); const o4 = await order({ status: 'delivered' });
      await order({ status: 'completed', subtotal: 10_000_000, completedDaysAgo: 5 });            // the 90-day GMV: ₹1,00,000 goods value
      S.ret = randomUUID(); S.ret2 = randomUUID(); S.mqr = randomUUID(); S.mqrClear = randomUUID(); S.pod = randomUUID(); S.disp = randomUUID(); S.pod2 = randomUUID(); S.disp2 = randomUUID();
      await history(async (c) => {
        await c.query(`INSERT INTO returns (id, tenant_id, order_id, status, refund_amount_minor, inspected_at, inspected_by, inspection_note) VALUES
                       ($1,$3,$4,'refunded',30000, now(), $6, 'goods back damaged in transit, refund approved'),
                       ($2,$3,$5,'refunded',10000, now(), $6, 'second return: inspected and refunded in full')`, [S.ret, S.ret2, T, o1, o2, U.admin1]);
        for (const [id, st, amt] of [[S.mqr, 'rejected', 4500], [S.mqrClear, 'cleared', 3000]] as const) {
          await c.query(`INSERT INTO milk_quality_reviews (id, tenant_id, collection_id, collected_on, membership_id, mcc_id, shift, amount_withheld_minor, currency_code, status, decided_at, decided_by)
                         VALUES ($1,$2,$3, current_date, $4, $5, 'morning', $6, 'INR', $7, now(), $8)`, [id, T, randomUUID(), randomUUID(), randomUUID(), amt, st, U.admin1]);
        }
        // a POD rejected (variance ₹250) that opened a dispute later resolved with a ₹200 refund: ONE loss, counted as the dispute's ₹200
        await c.query(`INSERT INTO pod_reviews (id, tenant_id, shipment_id, shipment_created_at, order_id, otp_verified, delivered_at, timer_due_at, status, flag_reason, flagged_by, flagged_at, variance_minor,
                         decided_by, decided_at, reject_proposed_by, reject_proposed_at, checker_user_id, dispute_id)
                       VALUES ($1,$2,$3, now(), $4, true, now(), now(), 'rejected', 'weight_variance', $5, now(), 25000, $6, now(), $5, now(), $6, $7)`, [S.pod, T, randomUUID(), o3, U.admin1, U.admin2, S.disp]);
        await c.query(`INSERT INTO disputes (id, tenant_id, order_id, raised_by, against_user, reason_id, status, resolution_type, resolution_amount_minor, resolved_by, resolved_at, opened_via, pod_review_id, opened_by_staff, disputed_amount_minor, disputed_quantity)
                       VALUES ($1,$2,$3,$4,$5,$6,'resolved','refund_partial',20000,$7, now(),'pod_review',$8,$7,25000,2)`, [S.disp, T, o3, U.buyer, U.m1, randomUUID(), U.admin1, S.pod]);
        // a second POD rejection, NO variance entered, its dispute still open: counted, never valued
        await c.query(`INSERT INTO pod_reviews (id, tenant_id, shipment_id, shipment_created_at, order_id, otp_verified, delivered_at, timer_due_at, status, flag_reason, flagged_by, flagged_at,
                         decided_by, decided_at, reject_proposed_by, reject_proposed_at, checker_user_id, dispute_id)
                       VALUES ($1,$2,$3, now(), $4, true, now(), now(), 'rejected', 'mismatch', $5, now(), $6, now(), $5, now(), $6, $7)`, [S.pod2, T, randomUUID(), o4, U.admin1, U.admin2, S.disp2]);
      });
    });
    it('each source event writes ONE event (redelivery adds nothing); a cleared pour writes none; the database derives the facts', async () => {
      for (let i = 0; i < 2; i++) {                                      // at-least-once: every event twice
        expect((await relay('disputes.return_refunded', { returnId: S.ret })).status).toBe('published');
        expect((await relay('dairy.quality_flag_decided', { reviewId: S.mqr, outcomeCode: 'rejected' })).status).toBe('published');
        expect((await relay('dairy.quality_flag_decided', { reviewId: S.mqrClear, outcomeCode: 'cleared' })).status).toBe('published');
        expect((await relay('logistics.pod_rejected', { podReviewId: S.pod })).status).toBe('published');
        expect((await relay('disputes.dispute_resolved', { disputeId: S.disp })).status).toBe('published');
        expect((await relay('logistics.pod_rejected', { podReviewId: S.pod2 })).status).toBe('published');
      }
      for (const id of [S.ret, S.mqr, S.pod, S.disp, S.pod2]) expect(await n(`SELECT count(*) n FROM wastage_events WHERE source_id=$1`, [id])).toBe(1);
      expect(await n(`SELECT count(*) n FROM wastage_events WHERE source_id=$1`, [S.mqrClear])).toBe(0);
      expect(await q1(`SELECT kind, source_kind, value_minor::text v, currency_code c, method_code m, product_id p FROM wastage_events WHERE source_id=$1`, [S.ret]))
        .toEqual({ kind: 'other', source_kind: 'return_accepted', v: '30000', c: 'INR', m: 'event', p: P1 });
      expect(await q1(`SELECT kind, value_minor::text v FROM wastage_events WHERE source_id=$1`, [S.mqr])).toEqual({ kind: 'milk', v: '4500' });
      expect(await q1(`SELECT chain_key, value_minor::text v, quantity::text q, unit_code u FROM wastage_events WHERE source_id=$1`, [S.disp])).toEqual({ chain_key: `dispute:${S.disp}`, v: '20000', q: '2.000', u: 'quintal' });
      expect(await q1(`SELECT value_minor, value_reason FROM wastage_events WHERE source_id=$1`, [S.pod2])).toEqual({ value_minor: null, value_reason: 'no_variance_entered' });
    });
    it('a cold-chain loss recorded through the API is told on the outbox and becomes ONE wastage event (storage / transit by subject)', async () => {
      const breach = randomUUID();
      await history((c) => c.query(`INSERT INTO cold_chain_breaches (id, tenant_id, subject_type, subject_id, band_min_c, band_max_c, direction, first_out_at, first_log_id, opened_log_id, peak_c, last_out_at, alert_state, closed_at, closed_log_id, duration_seconds)
                                    VALUES ($1,$2,'warehouse_chamber',$3,2,8,'above', now() - interval '2 hours', 1, 2, 11, now() - interval '1 hour', 'alerted', now() - interval '30 minutes', 3, 5400)`, [breach, T, randomUUID()]).then(() => undefined));
      await sdk('admin1').coldChain.breachAct(breach, 'record_outcome', { outcome: 'loss_recorded', reason: 'two crates of vaccine lost to heat', lossMinor: '125000', lossCurrency: 'INR' }, idem());
      const ev = await q1(`SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='logistics.cold_chain_outcome_recorded' AND payload->>'breachId' = $2`, [T, breach]);
      expect(ev.payload).toMatchObject({ breachId: breach, outcome: 'loss_recorded', lossMinor: '125000' });
      expect((await relay('logistics.cold_chain_outcome_recorded', { breachId: breach })).status).toBe('published');
      expect((await relay('logistics.cold_chain_outcome_recorded', { breachId: breach })).status).toBe('published');
      expect(await q1(`SELECT count(*)::int n, min(kind) k, min(value_minor)::text v FROM wastage_events WHERE source_id=$1`, [breach])).toEqual({ n: 1, k: 'storage', v: '125000' });
      S.breach = breach;
    });
    it('the backfill: a source row whose event never came is recorded by the re-run (counts per source); a second re-run writes nothing', async () => {
      expect(await codeOf(sdk('admin1').insights.rerunWastage('short', idem()))).toMatch(/VALIDATION|REASON/);
      expect(await codeOf(sdk('coord').insights.rerunWastage('a coordinator may not re-run this', idem()))).toBe('FORBIDDEN');
      const r = await sdk('admin1').insights.rerunWastage('monthly reconciliation of loss facts', idem());
      expect(r.written).toBe(1);                                         // the second return — its event never came
      expect(r.counts.find((c) => c.source === 'returns')).toEqual({ source: 'returns', written: 1, existing: 1 });
      expect(r.counts.find((c) => c.source === 'pod_reviews')).toEqual({ source: 'pod_reviews', written: 0, existing: 2 });
      expect(await q1(`SELECT method_code m FROM wastage_events WHERE source_id=$1`, [S.ret2])).toEqual({ m: 'rerun' });
      const again = await sdk('admin1').insights.rerunWastage('monthly reconciliation of loss facts, again', idem());
      expect(again.written).toBe(0);
      expect(await q1(`SELECT reason FROM audit_log WHERE tenant_id=$1 AND action='insights.wastage_rerun' ORDER BY created_at DESC LIMIT 1`, [T])).toEqual({ reason: 'monthly reconciliation of loss facts, again' });
    });
    it('the 90-day tiles: measured loss with its method (a POD and its dispute once), split by kind, ÷ GMV; refusals by name; manual entry refused', async () => {
      const w = await sdk('admin1').insights.wastage();
      // 30000 + 10000 (returns) + 4500 (milk) + 20000 (the POD dispute, not also its 25000 variance) + 125000 (cold chain) = 189500
      expect(w.loss.byCurrency).toEqual([{ currency: 'INR', valueMinor: '189500', events: 5 }]);
      expect(w.loss.withoutValueOrQuantity).toBe(1);                     // the POD rejection with no variance: counted, never valued
      expect(w.loss.events).toBe(6);
      expect(w.loss.split.find((s) => s.kind === 'transit')?.byCurrency).toEqual([{ currency: 'INR', valueMinor: '20000' }]);
      expect(w.loss.split.find((s) => s.kind === 'storage')?.byCurrency).toEqual([{ currency: 'INR', valueMinor: '125000' }]);
      expect(w.share).toEqual({ kind: 'share', bps: 189, currency: 'INR', lossMinor: '189500', gmvMinor: '10000000' });
      expect(w.methods.measured_loss.en).toContain('count once');
      expect(w.refused).toEqual({ externalStatistic: { kind: 'refused', code: 'EXTERNAL_STATISTIC_UNSOURCED' }, savedMoney: { kind: 'refused', code: 'NO_COUNTERFACTUAL_METHOD' },
        weighbridge: { kind: 'refused', code: 'NO_WEIGHBRIDGE_OBJECT' }, manualEntry: { kind: 'refused', code: 'MANUAL_WASTAGE_REFUSED' } });
      expect(await codeOf(sdk('admin1').insights.recordManualWastage({ kind: 'storage', valueMinor: '186400', reason: 'monsoon moisture' }, idem()))).toBe('MANUAL_WASTAGE_REFUSED');
    });
    it('kv_app is INSERT-only on wastage_events; the trigger refuses an update, a delete, a second row, a forged source', async () => {
      const priv = async (p: string) => (await q1(`SELECT has_table_privilege('kv_app','wastage_events',$1) AS v`, [p])).v as boolean;
      expect({ s: await priv('SELECT'), i: await priv('INSERT'), u: await priv('UPDATE'), d: await priv('DELETE') }).toEqual({ s: true, i: true, u: false, d: false });
      expect(await asApp(U.admin1, `UPDATE wastage_events SET value_minor = 1 WHERE tenant_id = $1`, [T])).toBe('42501');
      expect(await asApp(U.admin1, `DELETE FROM wastage_events WHERE tenant_id = $1`, [T])).toBe('42501');
      expect(await asApp(U.admin1, `INSERT INTO wastage_events (tenant_id, occurred_at, kind, source_kind, source_table, source_id, method_code) VALUES ($1, now(), 'other', 'return_accepted', 'returns', $2, 'event')`, [T, S.ret])).toBe('WASTAGE_EVENT_ONCE');
      expect(await asApp(U.admin1, `INSERT INTO wastage_events (tenant_id, occurred_at, kind, source_kind, source_table, source_id, method_code, value_minor, currency_code) VALUES ($1, now(), 'storage', 'return_accepted', 'returns', $2, 'event', 18640000, 'INR')`, [T, randomUUID()])).toBe('WASTAGE_SOURCE_NOT_A_FACT');
      expect(await asApp(U.admin1, `SELECT kv_wastage_record('returns', $1::uuid, 'event', NULL)`, [S.ret])).toBe('ok:1');
      expect(await n(`SELECT count(*) n FROM wastage_events WHERE source_id=$1`, [S.ret])).toBe(1);
    });
    it('µs paging of the facts; the export: dataset wastage_events → ready, unsigned, chain keys present', async () => {
      const p1 = await sdk('admin1').insights.wastageEvents({ limit: 2 });
      expect(p1.items).toHaveLength(2); expect(cursorInstant(p1.nextCursor!)).toMatch(/\.\d{6}Z$/);
      const all: string[] = []; let c: string | undefined;
      for (let i = 0; i < 10; i++) { const pg = await sdk('admin1').insights.wastageEvents({ limit: 2, cursor: c }); all.push(...pg.items.map((x) => x.id)); if (!pg.nextCursor) break; c = pg.nextCursor; }
      expect(new Set(all).size).toBe(all.length); expect(all.length).toBe(7);
      const job = await sdk('admin1').insights.exportWastage(idem());
      expect(await worker.generate({ id: job.id, tenantId: T } as never)).toBe('ready');
      const ready = await sdk('admin1').exportsPlane.get(job.id);
      expect(ready.receipt?.rowCount).toBe(7);
      expect(ready.receipt?.notes.join('\n')).toContain('unsigned');
      expect(fileOf(job.id)).toContain(`dispute:${S.disp}`);
    });
  });

  /* ═══════════════════════════════════════════ D · REPORTS ═══════════════════════════════════════════ */
  describe('D · the report builder (W196 · W2738–W2740)', () => {
    let defId = ''; let platformDef = '';
    it('the catalogue: eight allow-listed datasets, the bounds, the plane registry; analytics replica and member dimension refused by name', async () => {
      const c = await sdk('admin1').reports.catalogue();
      expect(c.datasets.map((d) => d.code)).toEqual(['orders', 'settlements', 'listings', 'memberships', 'dairy_cycles', 'cold_chain_breaches', 'wastage_events', 'mandi_pulse']);
      expect(c.bounds).toEqual({ maxRangeDays: 92, rowCap: 50000, statementTimeout: '60s', maxDimensions: 3, maxMeasures: 6 });
      expect(c.replica).toEqual({ kind: 'refused', code: 'NO_ANALYTICS_REPLICA' });
      expect(c.memberDimension).toEqual({ kind: 'refused', code: 'MEMBER_DIMENSION_NOT_OFFERED' });
      expect(c.planeRegistry).toEqual(expect.arrayContaining(['dairy.insights', 'mandi_pulse_member_crops', 'demand_map', 'wastage_events', 'report_run', 'governance.agm_pack']));
      const aud = await sdk('auditor').reports.catalogue();
      expect(aud.datasets.filter((d) => d.permitted).map((d) => d.code)).toEqual(['orders', 'settlements']);
    });
    it('save a definition; a platform definition is listed READ-ONLY (service and database refuse a write)', async () => {
      platformDef = randomUUID();
      await admin.query(`INSERT INTO saved_report_definitions (id, slug, title, metric, created_by_admin_id) VALUES ($1, $2, 'Platform GMV', 'gmv', $3)`, [platformDef, `p-${platformDef.slice(0, 8)}`, randomUUID()]);
      const d = await sdk('admin1').reports.saveDefinition({ title: 'Orders by month and status', datasetCode: 'orders', dimensions: ['month', 'status'], measures: ['orders', 'goods_value_minor'], rangeDays: 30 }, idem());
      defId = d.id;
      const list = await sdk('admin1').reports.definitions();
      expect(list.items.find((x) => x.id === defId)).toMatchObject({ scope: 'tenant', readOnly: false, datasetCode: 'orders' });
      expect(list.items.find((x) => x.id === platformDef)).toMatchObject({ scope: 'platform', readOnly: true, runnable: false });
      expect(await codeOf(sdk('admin1').reports.archiveDefinition(platformDef, 'tenants cannot archive platform rows', idem()))).toBe('PLATFORM_DEFINITION_READ_ONLY');
      expect(await asApp(U.admin1, `UPDATE saved_report_definitions SET title = 'hijacked' WHERE id = $1`, [platformDef])).toBe('ok:0');      // RLS: invisible to an update
      expect((await q1(`SELECT title FROM saved_report_definitions WHERE id=$1`, [platformDef])).title).toBe('Platform GMV');
      expect(await codeOf(sdk('admin1').reports.saveDefinition({ title: 'bad', datasetCode: 'orders', dimensions: ['member'], measures: ['orders'], rangeDays: 30 }, idem()))).toBe('UNKNOWN_DIMENSION');
      expect(await codeOf(sdk('admin1').reports.saveDefinition({ title: 'raw sql', datasetCode: 'users', dimensions: [], measures: ['orders'], rangeDays: 30 }, idem()))).toBe('UNKNOWN_DATASET');
    });
    it('a run: queued + audited (definition, range) → the runner reads under statement_timeout 60 s (observed inside the tx) → CSV on the plane with the watermark header', async () => {
      const r = await sdk('admin1').reports.requestRun({ definitionId: defId, from: day(-30), to: day(0) }, idem());
      expect(r).toMatchObject({ status: 'queued', datasetCode: 'orders', implied: ['currency'] });
      const audit = await q1(`SELECT new_value FROM audit_log WHERE tenant_id=$1 AND action='report.run' AND entity_id=$2`, [T, r.id]);
      expect(audit.new_value).toMatchObject({ definitionId: defId, dataset: 'orders', from: day(-30), to: day(0), days: 31 });
      expect(await app.get(ReportRunner).execute(T, r.id)).toBe('ready');
      const done = await sdk('admin1').reports.run(r.id);
      expect(done.status).toBe('ready');
      expect(done.statementTimeout).toBe('1min');                         // current_setting('statement_timeout') INSIDE the run tx after SET LOCAL '60s'
      expect(done.rowCount).toBeGreaterThan(0);
      expect(await worker.generate({ id: done.exportJobId!, tenantId: T } as never)).toBe('ready');
      const job = await sdk('admin1').exportsPlane.get(done.exportJobId!);
      expect(job.receipt?.rowCount).toBe(done.rowCount);                  // the watermark lines are not data rows
      const lines = fileOf(done.exportJobId!).replace(/^﻿/, '').split('\r\n');
      expect(lines[0]).toMatch(/^# krishalaya report,/);
      expect(lines.find((l) => l.startsWith('# tenant,'))).toContain(T);
      expect(lines.find((l) => l.startsWith('# requested_by,'))).toContain(U.admin1);
      expect(lines.find((l) => l.startsWith('# generated_at,'))).toMatch(/IST$/);
      expect(lines.find((l) => l.startsWith('# run_id,'))).toBe(`# run_id,${r.id}`);
      expect(lines.find((l) => l.startsWith('# definition_id,'))).toBe(`# definition_id,${defId}`);
      expect(lines.find((l) => l.startsWith('# row_count,'))).toBe(`# row_count,${done.rowCount}`);
      expect(lines.find((l) => l.startsWith('# signature,'))).toContain('unsigned');
      expect(lines[13]).toBe('month,status,currency,orders,goods_value_minor');   // the header, after the 13 watermark lines
    });
    it('> 92 days is REFUSED (RANGE_TOO_WIDE); 92 days is accepted', async () => {
      expect(await codeOf(sdk('admin1').reports.requestRun({ datasetCode: 'orders', measures: ['orders'], from: day(-92), to: day(0) }, idem()))).toBe('RANGE_TOO_WIDE');
      expect(await codeOf(sdk('admin1').reports.requestRun({ datasetCode: 'orders', measures: ['orders'], from: day(-91), to: day(0) }, idem()))).toBe('ok');
    });
    it('the row cap: a run that would read more than 50,000 rows is REFUSED (ROW_CAP), never truncated', async () => {
      await history(async (c) => {
        await c.query(`INSERT INTO products (id, category_id, default_name, default_unit, tenant_id, is_active, search_tsv)
                       SELECT gen_random_uuid(), $1, 'crop ' || g, 'quintal', $2, true, to_tsvector('simple','crop') FROM generate_series(1, 50001) g`, [cat, T2]);
        await c.query(`INSERT INTO listings (tenant_id, seller_user_id, product_id, category_id, title, quantity_total, quantity_available, min_order_qty, unit_code, price_minor, currency_code, status, visibility)
                       SELECT $1, $2, p.id, $3, 'lot', 1, 1, 1, 'quintal', 100, 'INR', 'published', 'public' FROM products p WHERE p.tenant_id = $1`, [T2, U.t2admin, cat]);
      });
      const r = await sdk('t2admin', T2).reports.requestRun({ datasetCode: 'listings', dimensions: ['crop'], measures: ['listings'], from: day(-1), to: day(0) }, idem());
      expect(await app.get(ReportRunner).execute(T2, r.id)).toBe('refused');
      expect(await sdk('t2admin', T2).reports.run(r.id)).toMatchObject({ status: 'refused', errorCode: 'ROW_CAP', exportJobId: null, statementTimeout: '1min' });
      expect(await n(`SELECT count(*) n FROM report_run_results WHERE run_id=$1`, [r.id])).toBe(0);
    }, 180_000);
    it('the auditor: runs ONLY its realm\'s datasets (via the named export exception), and cannot save a definition (AUDITOR_READ_ONLY)', async () => {
      expect(await codeOf(sdk('auditor').reports.requestRun({ datasetCode: 'listings', measures: ['listings'], from: day(-7), to: day(0) }, idem()))).toBe('AUDITOR_DATASET_NOT_PERMITTED');
      const ok = await sdk('auditor').reports.requestRun({ datasetCode: 'settlements', measures: ['lines', 'net_minor'], from: day(-7), to: day(0) }, idem());
      expect(ok.status).toBe('queued');
      expect(await codeOf(sdk('auditor').reports.saveDefinition({ title: 'auditor def', datasetCode: 'orders', dimensions: [], measures: ['orders'], rangeDays: 7 }, idem()))).toBe('AUDITOR_READ_ONLY');
      expect(await codeOf(sdk('staff').reports.catalogue())).toBe('FORBIDDEN');
    });
    it('a schedule: the next run is computed in IST; when due, the job queues an audited run and the recipients are told', async () => {
      const before = new Date();
      const s = await sdk('admin1').reports.createSchedule({ definitionId: defId, cadence: 'weekly', weekdayIso: 1, timeIst: '07:30', recipientRoles: ['tenant_admin'] }, idem());
      const next = new Date(s.nextRunAt);
      const wall = new Date(next.getTime() + 330 * 60_000);
      expect([wall.getUTCDay(), wall.getUTCHours(), wall.getUTCMinutes()]).toEqual([1, 7, 30]);    // Monday 07:30 IST
      expect(next.getTime()).toBeGreaterThan(before.getTime()); expect(next.getTime() - before.getTime()).toBeLessThanOrEqual(7 * 86_400_000);
      expect(next.toISOString()).toBe(nextRunAt({ cadence: 'weekly', weekdayIso: 1, timeIst: '07:30' }, new Date(next.getTime() - 7 * 86_400_000 + 1000)).toISOString());
      expect(await codeOf(sdk('admin1').reports.createSchedule({ definitionId: platformDef, cadence: 'daily', timeIst: '07:00', recipientRoles: ['tenant_admin'] }, idem()))).toBe('PLATFORM_DEFINITION_READ_ONLY');
      await admin.query(`UPDATE report_schedules SET next_run_at = now() - interval '1 minute' WHERE id=$1`, [s.id]);
      expect(await app.get(ReportRunner).materialiseDue(T)).toBe(1);
      const queued = await q1(`SELECT id, requested_by FROM report_runs WHERE schedule_id=$1`, [s.id]);
      expect(queued.requested_by).toBe(U.admin1);
      expect((await q1(`SELECT next_run_at > now() AS f FROM report_schedules WHERE id=$1`, [s.id])).f).toBe(true);
      expect(await app.get(ReportRunner).runQueued(T, 20)).toMatchObject({ failed: 0 });
      const ev = await q1(`SELECT payload FROM outbox_events WHERE tenant_id=$1 AND event_type='insights.report_ready' AND payload->>'runId'=$2`, [T, queued.id]);
      expect(ev.payload.recipientUserIds).toEqual(expect.arrayContaining([U.admin1, U.admin2]));
      expect(await codeOf(sdk('admin1').reports.deactivateSchedule(s.id, 'board moved to monthly packs', idem()))).toBe('ok');
      expect(await codeOf(sdk('admin1').reports.deactivateSchedule(s.id, 'board moved to monthly packs', idem()))).toBe('REPORT_SCHEDULE_FINAL');
    });
    it('archive a definition with a reason — final; µs paging of runs', async () => {
      await sdk('admin1').reports.archiveDefinition(defId, 'replaced by the board pack definition', idem());
      expect(await codeOf(sdk('admin1').reports.requestRun({ definitionId: defId }, idem()))).toBe('REPORT_DEFINITION_ARCHIVED');
      const pg = await sdk('admin1').reports.runs({ limit: 1 });
      expect(cursorInstant(pg.nextCursor!)).toMatch(/\.\d{6}Z$/);
    });
  });

  /* ═══════════════════════════════════════════ E · OFFLINE ═══════════════════════════════════════════ */
  describe('E · verify-before-write (W318 §3) — the shared chain\'s re-read, live, on the SW-e carrier act', () => {
    const FIELDS = ['id', 'isActive', 'statusReason', 'defaultName'];
    it('a row changed between the confirm screen and the press → STALE_ROW with the diff (field · was · now); a fresh confirm passes', async () => {
      const c = await sdk('admin1').carriers.create({ partnerKind: '3pl', defaultName: 'Shree Transport' }, idem());
      const seen = seenToken((await sdk('admin1').carriers.get(c.id)) as never, FIELDS);           // what the confirm step showed admin1
      await sdk('admin2').carriers.setActive(c.id, false, 'Contract paused for the monsoon');         // meanwhile, someone else acts
      const v = await verifyBeforeWrite(seen, async () => (await sdk('admin1').carriers.get(c.id)) as never);
      expect(v).toEqual({ ok: false, code: 'STALE_ROW', diffs: [
        { field: 'isActive', was: 'true', now: 'false' },
        { field: 'statusReason', was: '—', now: 'Contract paused for the monsoon' }] });
      const fresh = seenToken((await sdk('admin1').carriers.get(c.id)) as never, FIELDS);
      expect(await verifyBeforeWrite(fresh, async () => (await sdk('admin1').carriers.get(c.id)) as never)).toEqual({ ok: true });
      expect((await verifyBeforeWrite(undefined, async () => ({}))).ok).toBe(false);                  // no snapshot carried → never a blind write
    });
  });

  /* ═══════════════════════════════════════════ F · LEARNER INSIGHTS ═══════════════════════════════════════════ */
  describe('F · learner insights (W417) — the capture and the 50-learner floor', () => {
    let course = ''; let course2 = ''; let quiz = ''; let video = ''; const learners: string[] = []; const enrol: Record<string, string> = {};
    beforeAll(async () => {
      const instr = randomUUID(); course = randomUUID(); course2 = randomUUID(); quiz = randomUUID(); video = randomUUID();
      await history(async (c) => {
        await c.query(`INSERT INTO instructors (id, user_id, tenant_id, is_verified) VALUES ($1,$2,$3,false)`, [instr, U.instructor, T]);
        await c.query(`INSERT INTO courses (id, tenant_id, instructor_id, default_title, status, published_at, created_at) VALUES ($1,$3,$4,'Clean Milk Production','published', now(), now() - interval '1 minute'), ($2,$3,$4,'Buffalo Dairy Nutrition','published', now(), now())`, [course, course2, T, instr]);
        await c.query(`INSERT INTO course_lessons (id, course_id, module_no, lesson_no, default_title, content_kind, quiz, quiz_passing_pct, tenant_id, status, ready_at, ready_by) VALUES
                       ($1,$3,1,1,'Lesson 6 — Clean hands, clean pail','video',NULL,NULL,$4,'ready',now(),$5),
                       ($2,$3,1,2,'Quiz — mastitis','quiz',$6::jsonb,60,$4,'ready',now(),$5)`,
          [video, quiz, course, T, U.instructor, JSON.stringify({ questions: [
            { q: 'Q1', options: ['a', 'b'], answer: 0, explanations: ['x', 'y'] }, { q: 'Q2', options: ['a', 'b'], answer: 1, explanations: ['x', 'y'] }, { q: 'Q3', options: ['a', 'b', 'c'], answer: 2, explanations: ['x', 'y', 'z'] }] })]);
      });
      for (let i = 0; i < 50; i++) {
        const u = await makeUser(admin); learners.push(u);
        enrol[u] = (await q1(`INSERT INTO enrollments (tenant_id, course_id, learner_user_id) VALUES ($1,$2,$3) RETURNING id`, [T, course, u])).id;
      }
      for (const u of learners.slice(0, 2)) tok[`l:${u}`] = mintToken(app, { userId: u, tenantId: T, perms: await permsOf('farmer'), roles: ['farmer'] });
    });
    it('a quiz submit writes quiz_answers AND the progress in ONE transaction (server-scored); a bad watch interval rolls back both', async () => {
      const l = learners[0];
      const bad = sdk(`l:${l}`).enrollments.markProgress(enrol[l], quiz, { answers: [0, 0, null], completed: true, watch: { startedAt: new Date(Date.now() + 3_600_000).toISOString(), endedAt: new Date(Date.now() + 7_200_000).toISOString() } });
      expect(await codeOf(bad)).toBe('WATCH_INTERVAL_INVALID');
      expect(await n(`SELECT count(*) n FROM quiz_answers WHERE enrollment_id=$1`, [enrol[l]])).toBe(0);
      expect(await n(`SELECT count(*) n FROM lesson_progress WHERE enrollment_id=$1`, [enrol[l]])).toBe(0);
      await sdk(`l:${l}`).enrollments.markProgress(enrol[l], quiz, { answers: [0, 0, null], completed: true, quizScore: 100 });
      expect((await admin.query(`SELECT question_no, chosen, correct FROM quiz_answers WHERE enrollment_id=$1 ORDER BY question_no`, [enrol[l]])).rows)
        .toEqual([{ question_no: 1, chosen: 0, correct: true }, { question_no: 2, chosen: 0, correct: false }, { question_no: 3, chosen: null, correct: false }]);
      expect(await q1(`SELECT quiz_score::int s, completed_at IS NOT NULL c FROM lesson_progress WHERE enrollment_id=$1 AND lesson_id=$2`, [enrol[l], quiz])).toEqual({ s: 33, c: true });  // the server's 1/3, not the 100 sent
      expect(await codeOf(sdk(`l:${l}`).enrollments.markProgress(enrol[l], video, { answers: [0] }))).toBe('QUIZ_ANSWERS_NOT_A_QUIZ');
    });
    it('watch events: the growth of seconds watched (an unchanged client) and the app\'s own interval; IST hour generated', async () => {
      const l = learners[1];
      await sdk(`l:${l}`).enrollments.markProgress(enrol[l], video, { secondsWatched: 120 });
      await sdk(`l:${l}`).enrollments.markProgress(enrol[l], video, { secondsWatched: 120 });            // no growth → no event
      const started = new Date(Date.now() - 300_000); const ended = new Date(Date.now() - 120_000);
      await sdk(`l:${l}`).enrollments.markProgress(enrol[l], video, { secondsWatched: 300, watch: { startedAt: started.toISOString(), endedAt: ended.toISOString() } });
      const rows = (await admin.query(`SELECT source, seconds, ist_hour FROM watch_events WHERE enrollment_id=$1 ORDER BY created_at`, [enrol[l]])).rows;
      expect(rows.map((r) => [r.source, r.seconds])).toEqual([['progress_delta', 120], ['client_interval', 180]]);
      expect(rows[1].ist_hour).toBe(new Date(started.getTime() + 330 * 60_000).getUTCHours());
    });
    it('the heatmap is REFUSED below 50 learners (with the real count) and PRINTED at 50; the funnel is real; advisory refused; µs paging', async () => {
      const below = await sdk('instructor').studioInsights.course(course);
      const qz = below.lessons.find((x) => x.lessonId === quiz)!;
      expect(qz.quizMiss).toEqual({ kind: 'refused', code: 'BELOW_LEARNER_FLOOR', learners: 1, floor: 50 });
      expect(below.lessons.find((x) => x.lessonId === video)!.watchCurve).toEqual({ kind: 'refused', code: 'BELOW_LEARNER_FLOOR', learners: 1, floor: 50 });
      expect(below.advisory).toEqual({ kind: 'refused', code: 'NO_ADVISORY_GENERATOR' });
      expect(below.captureBegan).toEqual(expect.any(String));
      expect(qz).toMatchObject({ started: 1, completed: 1 });
      // 49 more learners' captured answers (each wrong on Q2) — the 50th distinct learner prints the heatmap
      await history(async (c) => {
        for (const u of learners.slice(1)) {
          const at = randomUUID();
          await c.query(`INSERT INTO quiz_answers (tenant_id, enrollment_id, course_id, lesson_id, attempt_id, question_no, learner_user_id, chosen, correct)
                         VALUES ($1,$2,$3,$4,$5,1,$6,0,true), ($1,$2,$3,$4,$5,2,$6,0,false), ($1,$2,$3,$4,$5,3,$6,2,true)`, [T, enrol[u], course, quiz, at, u]);
        }
      });
      const at50 = await sdk('instructor').studioInsights.course(course);
      const shown = at50.lessons.find((x) => x.lessonId === quiz)!.quizMiss as { kind: string; learners: number; questions: Array<{ questionNo: number; missBps: number | null }> };
      expect(shown.kind).toBe('shown'); expect(shown.learners).toBe(50);
      expect(shown.questions.map((q) => [q.questionNo, q.missBps])).toEqual([[1, 0], [2, 10000], [3, 200]]);
      expect(at50.methods.quiz_miss.en).toContain('at least 50 distinct learners');
      const pg = await sdk('instructor').studioInsights.courses({ limit: 1 });
      expect(pg.items[0].id).toBe(course2); expect(cursorInstant(pg.nextCursor!)).toMatch(/\.\d{6}Z$/);
      expect((await sdk('instructor').studioInsights.courses({ limit: 1, cursor: pg.nextCursor! })).items[0].id).toBe(course);
      const emptyLesson = (await sdk('instructor').studioInsights.course(course2)).lessons;
      expect(emptyLesson).toEqual([]);
      expect(await codeOf(sdk('staff').studioInsights.course(course))).toBe('FORBIDDEN');
    });
  });
});
