// apps/api/src/__tests__/ops5b-insights.integration.spec.ts · PC-56 OPS-5b · THE ORGANISATION'S MILK, IN NUMBERS — LIVE.
// The real AppModule over HTTP (listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS as kv_app; fixtures written by the admin pool
// (the pours are this spec's INPUT — the counter's own write path is TENANT-6a's and has its own live suite). FIXTURE: `dairy`, `dairy_insights` and
// `tenant_exports` are seeded OFF and switched ON here for THIS spec's two organisations only (`rules.tenant_ids`), restored in afterAll. The object
// store is an in-memory stand-in patched onto the app's own OBJECT_STORE (the store5b / export-plane spec seam — the one seam not crossed).
//
// Survey §7 `ops5b-insights`, VERBATIM where it applies, ADJUSTED where named:
//   (1) the organisation's day (E9 / OPS5-B6) — ADJUSTED: the survey's "at 00:30 IST (= 19:00 UTC the day before)" needs a clock this spec cannot
//       move (and 00:00–05:30 IST is inside the night hold), so — as OPS-5a's maintenance_due probe — the organisation's zone and the database
//       session's zone are set 25 hours apart: a fixture country on Pacific/Kiritimati (+14) and the test database's sessions on Pacific/Pago_Pago
//       (−11), whose calendar days ALWAYS differ. A pour recorded "today" by the organisation's day is inside the current window; at the OPS-5a
//       commit (`SELECT current_date`) the window ended on the session's yesterday and the pour fell out (red there — proven in a worktree);
//   (2) the read never returns a membership id, a member code, a person's id or name, or a per-member row (the JSON is WALKED);
//   (3) the payout streak is `not_recorded` with its three missing columns;
//   (4) `dairy_insights` OFF → `not_enabled` (never zeroes);
//   (5) export enqueue → ONE `exports.enqueued` audit row; the file made; the receipt's sha256 is the stored bytes' and the requester is the person;
//       the link mint audited (`exports.link_minted`, with its jti); the fetch served and LOGGED (and a refused one logged too); the file names no
//       member; `tenant_exports` OFF → EXPORT_PLANE_DISABLED (the enqueue and the job read);
//   (6) a `dairy.collect`-only person → 403 on the read and on the export.
// Run under TZ=Asia/Kolkata and TZ=UTC: every day here is the database's clock in a named zone.
import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { OBJECT_STORE } from '../core/media/s3-presign.service';
import { ExportWorker } from '../core/exports-plane/export-worker';
import { DairyQualityRepository } from '../modules/dairy/repositories/dairy-quality.repository';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['dairy', 'dairy_insights', 'tenant_exports'];
const ORG_ZONE = 'Pacific/Kiritimati';       // UTC+14
const SESSION_ZONE = 'Pacific/Pago_Pago';    // UTC−11 — 25 h behind: its calendar day is ALWAYS earlier than the organisation's
const ZONE_COUNTRY = 'XK';                   // a FIXTURE country for the far-ahead organisation; deleted in afterAll (the 5a lesson)

class MemoryStore {
  readonly objects = new Map<string, Buffer>();
  async putObjectStream(k: string, body: Readable, _ct: string, len: number): Promise<void> {
    const chunks: Buffer[] = []; for await (const c of body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    const b = Buffer.concat(chunks); if (b.length !== len) throw new Error('length'); this.objects.set(k, b);
  }
  async getObjectStream(k: string): Promise<Readable> { const b = this.objects.get(k); if (!b) throw new Error('S3 getObject failed (404)'); return Readable.from([b]); }
}

/** Every key path and every string value in a JSON tree. */
function walk(v: unknown, at = '$', out: Array<{ path: string; key: string; value: unknown }> = []): typeof out {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push({ path: `${at}.${k}`, key: k, value: x }); walk(x, `${at}.${k}`, out); }
  return out;
}

run('PC-56 OPS-5b · the organisation\'s milk, in numbers (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let admin: Pool; let base = ''; let cache: CacheService; let dbName = '';
  const store = new MemoryStore();
  const T = randomUUID(); const TK = randomUUID();
  let tkCountry: string | null = null; let zoneInserted = false;
  let desk = ''; let collector = '';
  const farmers: string[] = []; const members: string[] = []; const codes: string[] = [];
  const tok: Record<string, string> = {};
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];
  let jobId = '';

  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const api = async (who: string, method: string, path: string, opts: { tenant?: string; body?: unknown; key?: string; query?: string } = {}) => {
    const res = await fetch(`${base}/v1/${path}${opts.query ? `?${opts.query}` : ''}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok[who]}`, 'x-tenant-id': opts.tenant ?? T, ...(opts.key ? { 'idempotency-key': opts.key } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const raw = Buffer.from(await res.arrayBuffer());
    let json: { data?: any; error?: { code?: string } } = {};   // eslint-disable-line @typescript-eslint/no-explicit-any
    try { json = JSON.parse(raw.toString('utf8')); } catch { /* bytes */ }
    return { status: res.status, data: json.data, code: json.error?.code ?? null, raw, headers: res.headers };
  };
  const clearFlags = async () => {
    for (const f of FLAGS) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`, `flagctx:${TK}`]) await cache.del(c);
  };
  const setFlagFor = async (key: string, tenants: string[]) => {
    await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = 0, rules = $3::jsonb WHERE key = $1`, [key, tenants.length > 0, JSON.stringify({ tenant_ids: tenants })]);
    await clearFlags();
  };
  const orgDay = async (zone: string, minus = 0) => String((await q1(`SELECT ((now() AT TIME ZONE $1)::date - $2::int)::text AS d`, [zone, minus])).d);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    // E9 fixture: every NEW session of this test database runs 25 h behind the far-ahead organisation's zone — set BEFORE the app opens its pools.
    dbName = (await q1(`SELECT current_database() AS d`)).d;
    await admin.query(`ALTER DATABASE "${dbName.replace(/"/g, '')}" SET timezone TO '${SESSION_ZONE}'`);

    await makeTenant(admin, T, `O5B ${T.slice(0, 4)}`); await makeTenant(admin, TK, `O5B-zone ${TK.slice(0, 4)}`);
    tkCountry = (await q1(`SELECT country_code FROM tenants WHERE id=$1`, [TK])).country_code;
    zoneInserted = ((await admin.query(`INSERT INTO countries (code, default_name, currency_code, phone_prefix, timezone, is_active) VALUES ($1, 'Test zone +14', 'INR', '+999', $2, false) ON CONFLICT (code) DO NOTHING`, [ZONE_COUNTRY, ORG_ZONE])).rowCount ?? 0) === 1;
    expect(zoneInserted).toBe(true);
    await admin.query(`UPDATE tenants SET country_code=$2 WHERE id=$1`, [TK, ZONE_COUNTRY]);

    desk = await makeUser(admin); collector = await makeUser(admin);
    const role = (u: string, t: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, t, code]);
    await role(desk, T, 'tenant_admin'); await role(desk, TK, 'tenant_admin');

    for (const flag of FLAGS) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [flag])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([flag, false]);   // seeded OFF
      backups.push(b);
    }
    for (const flag of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [flag, JSON.stringify({ tenant_ids: [T, TK] })]);

    // The organisation T (India, Asia/Kolkata): one centre, three WEEKLY members, sixty days of pours by its own day.
    const mcc = randomUUID(); const mccK = randomUUID();
    await admin.query(`INSERT INTO mcc_centres (id, tenant_id, code, default_name, is_active) VALUES ($1, $2, $3, 'Test centre', true)`, [mcc, T, `C-5B-${T.slice(0, 4)}`]);
    await admin.query(`INSERT INTO mcc_centres (id, tenant_id, code, default_name, is_active) VALUES ($1, $2, $3, 'Test centre K', true)`, [mccK, TK, `C-5BK-${TK.slice(0, 4)}`]);
    const card = async (tenant: string) => (await q1(
      `INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, bonus_rules, effective_from, is_active, created_by, approved_before_rule, approved_at)
       VALUES ($1, 'Test card', 'buffalo', 'two_axis', 70000, 30000, '[{"metric":"fat","minCentiPct":620,"bonusMinorPerLitre":50}]'::jsonb, CURRENT_DATE - 500, true, $2, true, now()) RETURNING id`, [tenant, desk])).id as string;
    const cardT = await card(T); const cardK = await card(TK);
    for (let i = 0; i < 3; i++) {
      const f = await makeUser(admin); farmers.push(f); const id = randomUUID(); members.push(id); codes.push(`O5B-${String(i + 1).padStart(4, '0')}`);
      await admin.query(`INSERT INTO dairy_memberships (id, tenant_id, farmer_user_id, mcc_id, member_code, payment_cycle, default_animal_type, is_active, created_by) VALUES ($1,$2,$3,$4,$5,'weekly','buffalo',true,$6)`,
        [id, T, f, mcc, codes[i], desk]);
    }
    for (let i = 0; i < 3; i++) {
      await admin.query(
        `INSERT INTO milk_collections (tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor, bonus_minor, bonus_applied, entered_by)
         SELECT $1, $2, $3, 'morning', (now() AT TIME ZONE 'Asia/Kolkata')::date - g, 4.125 + $4::numeric, 6.40, 8.60, $5, 21000 + $6::int, 0, false, $7
           FROM generate_series(0, 59, $8::int) g`, [T, mcc, members[i], String(i), cardT, i * 100, desk, i + 1]);
    }
    // The far-ahead organisation TK: one member, ONE pour, on ITS day (which is the session's tomorrow).
    const fk = await makeUser(admin); const mk = randomUUID();
    await admin.query(`INSERT INTO dairy_memberships (id, tenant_id, farmer_user_id, mcc_id, member_code, payment_cycle, default_animal_type, is_active, created_by) VALUES ($1,$2,$3,$4,'O5BK-0001','weekly','buffalo',true,$5)`, [mk, TK, fk, mccK, desk]);
    await admin.query(
      `INSERT INTO milk_collections (tenant_id, mcc_id, membership_id, shift, collected_on, weight_kg, fat_pct, snf_pct, rate_card_id, amount_minor, bonus_minor, bonus_applied, entered_by)
       VALUES ($1, $2, $3, 'morning', (now() AT TIME ZONE $4)::date, 5.000, 6.40, 8.60, $5, 22000, 0, false, $6)`, [TK, mccK, mk, ORG_ZONE, cardK, desk]);

    app = await bootstrapE2EApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    cache = app.get<CacheService>(CACHE_SERVICE);
    await clearFlags();
    const os = app.get(OBJECT_STORE) as unknown as Record<string, unknown>;
    os.putObjectStream = store.putObjectStream.bind(store); os.getObjectStream = store.getObjectStream.bind(store);
    const perms = (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'tenant_admin'`)).rows.map((x) => x.permission_code as string);
    expect(perms).toContain('dairy.manage');
    tok.desk = mintToken(app, { userId: desk, tenantId: T, perms, roles: ['tenant_admin'] });
    tok.deskK = mintToken(app, { userId: desk, tenantId: TK, perms, roles: ['tenant_admin'] });
    tok.collector = mintToken(app, { userId: collector, tenantId: T, perms: ['dairy.collect'], roles: ['mcc_operator'] });
  }, 240_000);

  afterAll(async () => {
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    if (cache) await clearFlags().catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id IN ($1,$2)`, [T, TK]).catch(() => undefined);
    if (dbName) await admin?.query(`ALTER DATABASE "${dbName.replace(/"/g, '')}" RESET timezone`).catch(() => undefined);
    if (tkCountry) await admin?.query(`UPDATE tenants SET country_code=$2 WHERE id=$1`, [TK, tkCountry]).catch(() => undefined);
    if (zoneInserted) await admin?.query(`DELETE FROM countries WHERE code=$1`, [ZONE_COUNTRY]).catch(() => undefined);
    await app?.close().catch(() => undefined); await admin?.end().catch(() => undefined);
  }, 60_000);

  it('(1) E9 · a pour recorded TODAY by the organisation\'s day is inside the current window — never the session\'s current_date', async () => {
    const z = app.get(DairyQualityRepository);
    const org = await orgDay(ORG_ZONE);
    // preconditions: a NEW session runs in the far-behind zone, and its day disagrees with the organisation's NOW — the probe has teeth
    const fresh = new Pool({ connectionString: ADMIN_URL, max: 1 });
    const s = (await fresh.query(`SELECT current_setting('TimeZone') AS tz, CURRENT_DATE::text AS d`)).rows[0]; await fresh.end();
    expect(s.tz).toBe(SESSION_ZONE); expect(s.d < org).toBe(true);
    const r = await api('deskK', 'GET', 'dairy/insights', { tenant: TK, query: 'window=30' });
    expect(r.status).toBe(200);
    expect(r.data.kind).toBe('not_enough_history');
    expect(r.data.ranges.current.to).toBe(org);
    expect(r.data.pourersSoFar).toBe(1);                                         // the pour is IN the window
    expect(await z.today(TK)).toBe(org);                                       // the shared function: the organisation's day
    expect(await z.today(T)).toBe(await orgDay('Asia/Kolkata'));                // and India's organisation reads IST's day
  });

  it('(2)(3) the ready read: the whole organisation\'s figures; NO member anywhere in the JSON (walked); the payout streak not_recorded with its three columns', async () => {
    const r = await api('desk', 'GET', 'dairy/insights', { query: 'window=30' });
    expect(r.status).toBe(200);
    expect(r.data.kind).toBe('ready');
    expect(r.data.currencyCode).toBe('INR');
    expect(r.data.ranges.current.to).toBe(await orgDay('Asia/Kolkata'));
    expect(r.data.pourers.active).toBe(3);
    expect(r.data.payoutStreak).toEqual({ kind: 'not_recorded', missing: ['dairy_bill_cycles.paid_at', 'milk_bills.paid_at', 'payouts.settled_at'], cyclesClosed: 0, cyclesAllBillsApproved: 0 });
    const nodes = walk(r.data);
    expect(nodes.length).toBeGreaterThan(50);
    const forbiddenValues = new Set([...members, ...farmers, ...codes, desk, 'Test User']);
    for (const x of nodes) {
      expect([x.path, /member(ship)?_?id|farmer|user_?id|member_?code|full_?name|phone|requested_?by/i.test(x.key)]).toEqual([x.path, false]);
      if (typeof x.value === 'string') expect([x.path, forbiddenValues.has(x.value)]).toEqual([x.path, false]);
    }
    expect(JSON.stringify(r.data)).not.toMatch(/O5B-\d{4}|Test User/);
    // no per-member row: the only arrays of objects in the read are the shift buckets, the rate cards and their slabs
    const objectArrays = nodes.filter((x) => Array.isArray(x.value) && (x.value as unknown[]).some((e) => e && typeof e === 'object')).map((x) => x.key);
    for (const k of objectArrays) expect([k, ['buckets', 'byAnimal', 'cards', 'slabs'].includes(k)]).toEqual([k, true]);
  });

  it('(4) dairy_insights OFF → not_enabled (never zeroes); back ON → ready', async () => {
    await setFlagFor('dairy_insights', [TK]);
    const off = await api('desk', 'GET', 'dairy/insights', { query: 'window=30' });
    expect([off.status, off.data]).toEqual([200, { kind: 'not_enabled', flag: 'dairy_insights' }]);
    await setFlagFor('dairy_insights', [T, TK]);
    expect((await api('desk', 'GET', 'dairy/insights', { query: 'window=30' })).data.kind).toBe('ready');
  });

  it('(5) export: one exports.enqueued row; the file made; the receipt\'s sha256 is the stored bytes\' and the requester the person; the mint audited; the fetch logged; no member in the file', async () => {
    expect((await api('desk', 'POST', 'dairy/insights/export', { body: { window: 30 } })).status).toBe(400);   // no key
    const key = `idem-${randomUUID()}`;
    const q = await api('desk', 'POST', 'dairy/insights/export', { body: { window: 30 }, key });
    expect([q.status, q.data.status, q.data.datasetCode, q.data.requestedBy]).toEqual([201, 'queued', 'dairy.insights', desk]);
    jobId = q.data.id;
    expect((await admin.query(`SELECT actor_user_id FROM audit_log WHERE entity_id=$1 AND action='exports.enqueued'`, [jobId])).rows).toEqual([{ actor_user_id: desk }]);
    expect(await app.get(ExportWorker).generate({ id: jobId, tenantId: T })).toBe('ready');
    const job = await q1(`SELECT status, content_sha256, storage_key FROM tenant_export_jobs WHERE id=$1`, [jobId]);
    const bytes = store.objects.get(job.storage_key) as Buffer;
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(job.content_sha256);
    const v = await api('desk', 'GET', `exports/${jobId}`);
    expect([v.status, v.data.status, v.data.receipt.sha256, v.data.receipt.requestedBy]).toEqual([200, 'ready', job.content_sha256, desk]);
    const csv = bytes.toString('utf8').replace(/^﻿/, '');
    expect(csv.split(/\r?\n/)[0]).toBe('section,metric,value,unit,basis,note');
    for (const s of [...members, ...farmers, ...codes, 'Test User']) expect([s, csv.includes(s)]).toEqual([s, false]);

    const link = await api('desk', 'POST', `exports/${jobId}/link`);
    expect([link.status, link.data.ttlSec]).toEqual([201, 900]);
    const minted = (await admin.query(`SELECT actor_user_id, new_value FROM audit_log WHERE entity_id=$1 AND action='exports.link_minted'`, [jobId])).rows;
    expect(minted).toHaveLength(1);
    expect([minted[0].actor_user_id, minted[0].new_value.jti]).toEqual([desk, link.data.jti]);
    const dl = await api('desk', 'GET', `exports/${jobId}/download`, { query: `token=${encodeURIComponent(link.data.token)}` });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('x-export-sha256')).toBe(job.content_sha256);
    expect(createHash('sha256').update(dl.raw).digest('hex')).toBe(job.content_sha256);
    await new Promise((r) => setTimeout(r, 300));
    const bad = await api('desk', 'GET', `exports/${jobId}/download`, { query: 'token=not-a-token' });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const log = (await admin.query(`SELECT outcome, digest_matched, fetched_by FROM tenant_export_downloads WHERE job_id=$1 ORDER BY fetched_at, id`, [jobId])).rows;
    expect(log.map((x) => [x.outcome, x.fetched_by])).toEqual([['served', desk], [expect.stringMatching(/^refused_/), desk]]);
    expect(log[0].digest_matched).toBe(true);
  }, 120_000);

  it('(5b) tenant_exports OFF → EXPORT_PLANE_DISABLED on the enqueue and on the job read; nothing queued', async () => {
    await setFlagFor('tenant_exports', [TK]);
    const before = await n(`SELECT count(*)::int n FROM tenant_export_jobs WHERE tenant_id=$1`, [T]);
    const q = await api('desk', 'POST', 'dairy/insights/export', { body: { window: 90 }, key: `idem-${randomUUID()}` });
    expect([q.status, q.code]).toEqual([404, 'EXPORT_PLANE_DISABLED']);
    expect(await n(`SELECT count(*)::int n FROM tenant_export_jobs WHERE tenant_id=$1`, [T])).toBe(before);
    const v = await api('desk', 'GET', `exports/${jobId}`);
    expect([v.status, v.code]).toEqual([404, 'EXPORT_PLANE_DISABLED']);
    await setFlagFor('tenant_exports', [T, TK]);
  });

  it('(6) a dairy.collect-only person → 403 on the read and on the export; nothing queued', async () => {
    const before = await n(`SELECT count(*)::int n FROM tenant_export_jobs WHERE tenant_id=$1`, [T]);
    expect((await api('collector', 'GET', 'dairy/insights', { query: 'window=30' })).status).toBe(403);
    expect((await api('collector', 'POST', 'dairy/insights/export', { body: { window: 30 }, key: `idem-${randomUUID()}` })).status).toBe(403);
    expect(await n(`SELECT count(*)::int n FROM tenant_export_jobs WHERE tenant_id=$1`, [T])).toBe(before);
  });
});
