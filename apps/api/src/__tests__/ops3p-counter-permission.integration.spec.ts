// apps/api/src/__tests__/ops3p-counter-permission.integration.spec.ts · PC-56 OPS-3p — THE COUNTER IS NOT THE PRICE, LIVE (founder Q6-A,
// 2026-11-08: "the person weighing her milk should not be the person who can change what it is worth"). The real AppModule over HTTP
// (supertest, listening ONCE on 127.0.0.1 — the HOTFIX-5 pin), real Postgres + RLS as kv_app, a database built from EMPTY by the
// harness (0001–0235 + seeds). `dairy` and the three board flags are seeded OFF and switched ON for THESE organisations only (an
// allow-list fixture), restored in afterAll. EVERY TOKEN CARRIES WHAT THE DATABASE GRANTS: `RoleCacheService.effectiveAccess` (the
// login / refresh path) → `TokenService.mintAccessToken`, never a hand-written permission list.
//   (1) a user holding ONLY dairy.collect: a pour → 201; a manual cooler reading → 201; the boards and the roll → 200; refused BY NAME
//       (403 FORBIDDEN, details.required = ['dairy.manage']) on rate-card create/approve, bill generate/preview/approve/pay, enrolment,
//       a quality decision and a cooler band — and on every other dairy.manage route
//   (2) a user holding ONLY dairy.read: every board → 200; a pour / a reading → 403 naming the any-of set; everything else → 403
//   (3) tenant_admin keeps every act it had: no dairy route refuses it on permission (a sweep of the whole table); it records and reads
//   (4) dairy_farmer cannot record a pour (403), unchanged; it holds no dairy operator verb
//   (5) the dairy desk template installed through the REAL desk service (two administrators) → its member holds dairy.collect +
//       dairy.read and NOT dairy.manage, and records a pour; desks made the OLD way are remapped by 0235's own SQL (run here from the
//       file), a hand-made desk and a hand-re-added row are NOT touched
//   (6) the role cache: dairy.collect granted to a custom role → the next resolution, and the next token, carry it
//   (7) kv_app cannot grant itself either code (role_permissions / permissions are SELECT-only for it); the seeded catalogue is exact
import 'reflect-metadata';
import * as fs from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Pool } from 'pg';
import { bootstrapE2EApp } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { RoleCacheService } from '../core/rbac/role-cache.service';
import { TokenService } from '../core/auth/token.service';
import { DeskService } from '../modules/identity/services/desk.service';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../core/auth/permissions.guard';
import { BillCyclesController } from '../modules/dairy/controllers/v1/bill-cycles.controller';
import { BillDisputesController } from '../modules/dairy/controllers/v1/bill-disputes.controller';
import { BmcController } from '../modules/dairy/controllers/v1/bmc.controller';
import { CollectionsController } from '../modules/dairy/controllers/v1/collections.controller';
import { D2cController } from '../modules/dairy/controllers/v1/d2c.controller';
import { DairyCounterController } from '../modules/dairy/controllers/v1/dairy-counter.controller';
import { DairyInsightsController } from '../modules/dairy/controllers/v1/dairy-insights.controller';
import { DairyQualityController } from '../modules/dairy/controllers/v1/dairy-quality.controller';
import { DeductionInstructionsController } from '../modules/dairy/controllers/v1/deduction-instructions.controller';
import { DiversionsController } from '../modules/dairy/controllers/v1/diversions.controller';
import { MccController } from '../modules/dairy/controllers/v1/mcc.controller';
import { MemberCreditsController } from '../modules/dairy/controllers/v1/member-credits.controller';
import { MilkBillsController } from '../modules/dairy/controllers/v1/milk-bills.controller';
import { QualityReviewsController } from '../modules/dairy/controllers/v1/quality-reviews.controller';
import { RateCardsController } from '../modules/dairy/controllers/v1/rate-cards.controller';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['dairy', 'dairy_counter_board', 'dairy_quality_desk', 'dairy_bmc_monitor'] as const;
const MIGRATION = join(__dirname, '../../../../db/migrations/0235_ops3p_dairy_counter_permission.sql');
const CONTROLLERS = [BillCyclesController, BillDisputesController, BmcController, CollectionsController, D2cController, DairyCounterController,
  DairyInsightsController, DairyQualityController, DeductionInstructionsController, DiversionsController, MccController, MemberCreditsController,
  MilkBillsController, QualityReviewsController, RateCardsController];

interface Route { verb: string; path: string; all: string[]; any: string[] }
/** Every permission-gated dairy route, by reflection (the metadata the guard reads). */
function gatedRoutes(): Route[] {
  const out: Route[] = [];
  for (const C of CONTROLLERS) {
    const base = String(Reflect.getMetadata(PATH_METADATA, C) ?? '');
    for (const name of Object.getOwnPropertyNames(C.prototype)) {
      const h = (C.prototype as unknown as Record<string, unknown>)[name];
      if (name === 'constructor' || typeof h !== 'function') continue;
      const p = Reflect.getMetadata(PATH_METADATA, h); const m = Reflect.getMetadata(METHOD_METADATA, h);
      if (p === undefined || m === undefined) continue;
      const all: string[] = Reflect.getMetadata(PERMISSIONS_KEY, h) ?? [];
      const any: string[] = Reflect.getMetadata(ANY_PERMISSIONS_KEY, h) ?? [];
      if (!all.length && !any.length) continue;
      const sub = String(p) === '/' ? '' : `/${String(p).replace(/^\//, '')}`;
      out.push({ verb: RequestMethod[m as number], path: `/v1/${base}${sub}`, all, any });
    }
  }
  return out;
}
const COLLECT_ROUTES = ['POST /v1/dairy/collections', 'POST /v1/dairy/bmc/readings'];
const READ_ROUTES = ['GET /v1/dairy/counter/board', 'GET /v1/dairy/quality', 'GET /v1/dairy/bmc/monitor', 'GET /v1/dairy/d2c/mccs/:mccId/day-summary'];

run('PC-56 OPS-3p · the counter is not the price (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let appPool: Pool; let cache: CacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  let roleCache: RoleCacheService; let tokens: TokenService; let desks: DeskService;
  const T = randomUUID();
  let A1 = ''; let A2 = ''; let C = ''; let R = ''; let F = ''; let F2 = ''; let F3 = ''; let D = ''; let L = '';
  let mccId = ''; let mem1 = ''; let mem2 = ''; let mem3 = ''; let unitId = ''; let today = '';
  const tok: Record<string, string> = {};
  const backups: { key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }[] = [];
  const H = (token: string) => ({ authorization: `Bearer ${token}`, 'x-tenant-id': T });
  const call = (token: string, verb: string, path: string, body: object = {}) => {
    const r = verb === 'GET' ? request(http).get(path) : verb === 'DELETE' ? request(http).delete(path) : request(http).post(path);
    return verb === 'GET' ? r.set(H(token)) : r.set({ ...H(token), 'idempotency-key': randomUUID() }).send(body);
  };
  const fill = (path: string) => path.replace(':mccId', mccId).replace(/:id\b/g, randomUUID());
  const role = (u: string, code: string) => admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3 ON CONFLICT DO NOTHING`, [u, T, code]);
  /** The login path: what the database grants, resolved fresh, minted into a token. */
  async function login(u: string): Promise<{ token: string; perms: string[] }> {
    await roleCache.invalidate(u, T);
    const a = await roleCache.effectiveAccess(u, T);
    return { token: tokens.mintAccessToken({ sub: u, tid: T, sid: 'ops3p', roles: a.roles, perms: a.permissions }), perms: a.permissions };
  }
  const refusedByName = (r: { status: number; body: any }, codes: { required?: string[]; anyOf?: string[] }) => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    expect({ status: r.status, code: r.body?.error?.code, details: r.body?.error?.details }).toEqual({ status: 403, code: 'FORBIDDEN', details: codes });
  };
  const permissionRefused = (r: { status: number; body: any }) => r.status === 403 && r.body?.error?.code === 'FORBIDDEN'   // eslint-disable-line @typescript-eslint/no-explicit-any
    && (Array.isArray(r.body?.error?.details?.required) || Array.isArray(r.body?.error?.details?.anyOf));
  async function clearFlagCache(): Promise<void> {
    for (const k of FLAGS) for (const c of [`flag:${k}`, `flagstale:${k}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`]) await cache.del(c);
  }
  const pour = (token: string, membershipId: string, shift: 'morning' | 'evening') =>
    call(token, 'POST', '/v1/dairy/collections', { membershipId, shift, collectedOn: today, weightKg: '10.500', fatPct: '4.10', snfPct: '8.50' });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    (BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () { return this.toString(); };
    admin = new Pool({ connectionString: ADMIN_URL }); appPool = new Pool({ connectionString: APP_URL });
    await makeTenant(admin, T, `OPS3p dairy ${T.slice(0, 4)}`);
    [A1, A2, C, R, F, F2, F3, D, L] = await Promise.all(Array.from({ length: 9 }, () => makeUser(admin)));
    // Two CUSTOM roles (roles are data — Law 6): one holding ONLY dairy.collect, one ONLY dairy.read.
    const suffix = T.slice(0, 8).replace(/-/g, '');
    for (const [code, perm] of [[`ops3p_counter_${suffix}`, 'dairy.collect'], [`ops3p_reader_${suffix}`, 'dairy.read']]) {
      await admin.query(`INSERT INTO roles (code, default_name, scope) VALUES ($1, $1, 'tenant')`, [code]);
      await admin.query(`INSERT INTO role_permissions (role_id, permission_code) SELECT id, $2 FROM roles WHERE code = $1`, [code, perm]);
    }
    await role(A1, 'tenant_admin'); await role(A2, 'tenant_admin');
    await role(C, `ops3p_counter_${suffix}`); await role(R, `ops3p_reader_${suffix}`);
    await role(F, 'dairy_farmer'); await role(F2, 'dairy_farmer'); await role(F3, 'dairy_farmer');
    await role(D, 'tenant_staff'); await role(L, 'tenant_staff');

    for (const k of FLAGS) backups.push((await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [k])).rows[0]);
    expect(backups.map((b) => [b?.key, b?.is_enabled])).toEqual(FLAGS.map((k) => [k, false]));
    for (const k of FLAGS) await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [k, JSON.stringify({ tenant_ids: [T] })]);

    app = await bootstrapE2EApp(); http = app.getHttpServer(); cache = app.get<CacheService>(CACHE_SERVICE);
    roleCache = app.get(RoleCacheService); tokens = app.get(TokenService); desks = app.get(DeskService);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', () => resolve()));   // the HOTFIX-5 pin
    await clearFlagCache();
    for (const [k, u] of Object.entries({ A1, C, R, F, D, L })) tok[k] = (await login(u)).token;

    today = (await admin.query(`SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS d`)).rows[0].d;
    mccId = randomUUID();
    await admin.query(`INSERT INTO mcc_centres (id, tenant_id, code, default_name, is_active) VALUES ($1, $2, 'C-OPS3P', 'OPS3p centre', true)`, [mccId, T]);
    // Enrolment through the REAL route as the administrator (it opens the first route period).
    const enrol = async (u: string, code: string) => {
      const r = await call(tok.A1, 'POST', '/v1/dairy/mccs/memberships', { farmerUserId: u, mccId, memberCode: code });
      expect(r.status).toBe(201); return r.body.data.id as string;
    };
    mem1 = await enrol(F, 'M-1'); mem2 = await enrol(F2, 'M-2'); mem3 = await enrol(F3, 'M-3');
    // A card in force today: exactly the stamp 0234 writes on pre-rule rows (the ops3c / HOTFIX-12 fixture shape).
    await admin.query(`INSERT INTO milk_rate_cards (tenant_id, default_name, animal_type, pricing_model, rate_per_kg_fat_minor, rate_per_kg_snf_minor, effective_from, is_active, approved_before_rule, approved_at)
                       VALUES ($1, 'OPS3p mixed', 'mixed', 'two_axis', 64900, 21700, CURRENT_DATE - 30, true, true, now())`, [T]);
    const u = await call(tok.A1, 'POST', '/v1/dairy/bmc', { mccId, capacityLitres: '1000' });
    expect(u.status).toBe(201); unitId = u.body.data.id;
  }, 240_000);

  afterAll(async () => {
    try { for (const b of backups) if (b) await admin.query(`UPDATE feature_flags SET is_enabled = $2, rollout_pct = $3, rules = $4::jsonb WHERE key = $1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]); } catch { /* teardown only */ }
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending'`).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await appPool?.end(); await admin?.end();
  }, 40_000);

  it('(1) ONLY dairy.collect: a pour 201, a manual reading 201, the boards and the roll 200; every money / settings act refused by name', async () => {
    const perms = (await login(C)).perms;
    expect(perms.filter((p) => p.startsWith('dairy.'))).toEqual(['dairy.collect']);
    const p = await pour(tok.C, mem1, 'morning');
    expect([p.status, p.body.data?.membershipId]).toEqual([201, mem1]);
    expect((await admin.query(`SELECT entered_by FROM milk_collections WHERE tenant_id = $1 AND id = $2`, [T, p.body.data.id])).rows).toEqual([{ entered_by: C }]);
    const rd = await call(tok.C, 'POST', '/v1/dairy/bmc/readings', { unitId, tempC: '3.8' });
    expect([rd.status, rd.body.data?.unitId]).toEqual([201, unitId]);
    expect((await call(tok.C, 'GET', '/v1/dairy/counter/board')).status).toBe(200);
    expect((await call(tok.C, 'GET', '/v1/dairy/quality')).status).toBe(200);
    expect((await call(tok.C, 'GET', '/v1/dairy/bmc/monitor')).status).toBe(200);
    expect((await call(tok.C, 'GET', `/v1/dairy/d2c/mccs/${mccId}/day-summary?date=${today}`)).status).toBe(200);
    const roll = await call(tok.C, 'GET', `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mccId}`);
    expect([roll.status, (roll.body.data as Array<{ id: string }>).map((m) => m.id).sort()]).toEqual([200, [mem1, mem2, mem3].sort()]);
    // refused BY NAME — the brief's list, each with the body a real client would send
    const M = { required: ['dairy.manage'] };
    const S = { required: ['dairy.manage', 'settlement.close'] };
    refusedByName(await call(tok.C, 'POST', '/v1/dairy/rate-cards', { defaultName: 'x', animalType: 'cow', pricingModel: 'fat_pooled', ratePerKgFatMinor: '1', effectiveFrom: today }), M);
    refusedByName(await call(tok.C, 'POST', `/v1/dairy/rate-cards/${randomUUID()}/approve`), M);
    refusedByName(await call(tok.C, 'POST', '/v1/dairy/milk-bills/generate', { membershipId: mem1, periodStart: today, periodEnd: today }), M);
    refusedByName(await call(tok.C, 'POST', `/v1/dairy/milk-bills/${randomUUID()}/preview`), M);
    refusedByName(await call(tok.C, 'POST', `/v1/dairy/milk-bills/${randomUUID()}/approve`), S);
    refusedByName(await call(tok.C, 'POST', `/v1/dairy/milk-bills/${randomUUID()}/pay`), M);
    refusedByName(await call(tok.C, 'POST', '/v1/dairy/mccs/memberships', { farmerUserId: L, mccId, memberCode: 'M-X' }), M);
    refusedByName(await call(tok.C, 'POST', `/v1/dairy/quality-reviews/${randomUUID()}/decide`, { decision: 'rejected' }), M);
    refusedByName(await call(tok.C, 'POST', `/v1/dairy/bmc/${unitId}/band`, { minTempC: '0.0', targetTempC: '4.0', toleranceC: '0.5' }), M);
    // …and every other gated route outside the counter's and the boards' sets
    for (const rt of gatedRoutes()) {
      const key = `${rt.verb} ${rt.path}`;
      if (COLLECT_ROUTES.includes(key) || READ_ROUTES.includes(key)) continue;
      const r = await call(tok.C, rt.verb, fill(rt.path));
      expect({ key, refused: permissionRefused(r) }).toEqual({ key, refused: true });
    }
    // the pour carries the counter person; no money row, rate card or bill changed hands
    expect((await admin.query(`SELECT count(*)::int AS n FROM milk_bills WHERE tenant_id = $1`, [T])).rows[0].n).toBe(0);
    expect((await admin.query(`SELECT count(*)::int AS n FROM milk_rate_cards WHERE tenant_id = $1`, [T])).rows[0].n).toBe(1);
  });

  it('(2) ONLY dairy.read: every board 200; a pour and a reading 403 naming the counter set; everything else 403', async () => {
    expect((await login(R)).perms.filter((p) => p.startsWith('dairy.'))).toEqual(['dairy.read']);
    expect((await call(tok.R, 'GET', '/v1/dairy/counter/board')).status).toBe(200);
    expect((await call(tok.R, 'GET', '/v1/dairy/quality')).status).toBe(200);
    expect((await call(tok.R, 'GET', '/v1/dairy/bmc/monitor')).status).toBe(200);
    const day = await call(tok.R, 'GET', `/v1/dairy/d2c/mccs/${mccId}/day-summary?date=${today}`);
    expect(day.status).toBe(200);
    expect((await call(tok.R, 'GET', `/v1/dairy/mccs/memberships/list?box=mcc&mccId=${mccId}`)).status).toBe(200);
    refusedByName(await pour(tok.R, mem2, 'morning'), { anyOf: ['dairy.collect', 'dairy.manage'] });
    refusedByName(await call(tok.R, 'POST', '/v1/dairy/bmc/readings', { unitId, tempC: '3.9' }), { anyOf: ['dairy.collect', 'dairy.manage'] });
    for (const rt of gatedRoutes()) {
      const key = `${rt.verb} ${rt.path}`;
      if (READ_ROUTES.includes(key)) continue;
      const r = await call(tok.R, rt.verb, fill(rt.path));
      expect({ key, refused: permissionRefused(r) }).toEqual({ key, refused: true });
    }
    expect((await admin.query(`SELECT count(*)::int AS n FROM milk_collections WHERE tenant_id = $1 AND membership_id = $2`, [T, mem2])).rows[0].n).toBe(0);
  });

  it('(3) tenant_admin keeps every act it had: no dairy route refuses it on permission; it records, reads and holds all four verbs', async () => {
    expect((await login(A1)).perms.filter((p) => p.startsWith('dairy.')).sort()).toEqual(['dairy.collect', 'dairy.manage', 'dairy.override', 'dairy.read']);
    for (const rt of gatedRoutes()) {
      if (rt.all.includes('settlement.close')) continue;   // tenant_admin holds settlement.close too (0144) — swept below
      const key = `${rt.verb} ${rt.path}`;
      const r = await call(tok.A1, rt.verb, fill(rt.path));
      expect({ key, refused: permissionRefused(r) }).toEqual({ key, refused: false });
    }
    for (const rt of gatedRoutes().filter((x) => x.all.includes('settlement.close'))) {
      const r = await call(tok.A1, rt.verb, fill(rt.path));
      expect({ key: `${rt.verb} ${rt.path}`, refused: permissionRefused(r) }).toEqual({ key: `${rt.verb} ${rt.path}`, refused: false });
    }
    expect((await pour(tok.A1, mem2, 'evening')).status).toBe(201);
    expect((await call(tok.A1, 'POST', '/v1/dairy/bmc/readings', { unitId, tempC: '4.0' })).status).toBe(201);
    expect((await call(tok.A1, 'GET', '/v1/dairy/counter/board')).status).toBe(200);
  });

  it('(4) dairy_farmer cannot record a pour (403), unchanged; the role holds no dairy operator verb', async () => {
    const perms = (await login(F)).perms;
    for (const p of ['dairy.collect', 'dairy.read', 'dairy.manage', 'dairy.override']) expect({ p, held: perms.includes(p) }).toEqual({ p, held: false });
    refusedByName(await pour(tok.F, mem1, 'evening'), { anyOf: ['dairy.collect', 'dairy.manage'] });
    const held = (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'dairy_farmer' AND rp.permission_code LIKE 'dairy.%'`)).rows;
    expect(held).toEqual([]);
  });

  it('(5) the dairy desk template (installed by two administrators) gives dairy.collect + dairy.read, never dairy.manage; its member records a pour', async () => {
    const p = await desks.propose(T, { userId: A2, canManage: true }, randomUUID(), { kind: 'install_templates', reason: 'Install the standard desks before the flush season starts' }, '127.0.0.1');
    const dairy = (p.diff.desks as Array<{ code: string; permissions: string[] }>).find((d) => d.code === 'dairy')!;
    expect([...dairy.permissions].sort()).toEqual(['dairy.collect', 'dairy.read']);
    await desks.confirm(T, { userId: A1, canManage: true }, randomUUID(), p.id, '127.0.0.1');
    const deskId = (await admin.query(`SELECT id FROM desks WHERE tenant_id = $1 AND code = 'dairy'`, [T])).rows[0].id;
    const live = (await admin.query(`SELECT permission_code FROM desk_permissions WHERE desk_id = $1 AND removed_at IS NULL ORDER BY 1`, [deskId])).rows.map((x) => x.permission_code);
    expect(live).toEqual(['dairy.collect', 'dairy.read']);
    await desks.addMember(T, { userId: A1, canManage: true }, randomUUID(), deskId, D, 'counter operator for the morning shift', '127.0.0.1');
    const d = await login(D);
    expect(d.perms.filter((x) => x.startsWith('dairy.')).sort()).toEqual(['dairy.collect', 'dairy.read']);
    expect((await pour(d.token, mem3, 'morning')).status).toBe(201);
    refusedByName(await call(d.token, 'POST', '/v1/dairy/rate-cards', { defaultName: 'x', animalType: 'cow', pricingModel: 'fat_pooled', ratePerKgFatMinor: '1', effectiveFrom: today }), { required: ['dairy.manage'] });
  });

  it('(5b) 0235\'s REMAP, run from the file: a desk the OLD template made is remapped; a hand-made desk and a hand-re-added row are not', async () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    const block = sql.slice(sql.indexOf('-- >>> 235.3 REMAP'), sql.indexOf('-- <<< 235.3 REMAP'));
    expect(block).toContain('CREATE TEMP TABLE ops3p_remap');
    // three organisations, each with two administrators and a desk member, built the way the database would have held them
    const mk = async () => {
      const t = randomUUID(); await makeTenant(admin, t, `OPS3p remap ${t.slice(0, 4)}`);
      const [x, y, m] = await Promise.all([makeUser(admin), makeUser(admin), makeUser(admin)]);
      for (const [u, c] of [[x, 'tenant_admin'], [y, 'tenant_admin'], [m, 'tenant_staff']]) {
        await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [u, t, c]);
      }
      return { t, x, y, m };
    };
    const proposal = async (t: string, x: string, y: string, kind: string, deskId: string | null, diff: object) => {
      const id = (await admin.query(`INSERT INTO desk_change_proposals (tenant_id, kind, desk_id, diff, reason, proposed_by, expires_at)
                                     VALUES ($1, $2, $3, $4::jsonb, 'ops3p fixture: a desk as the database held it', $5, now() + interval '7 days') RETURNING id`,
        [t, kind, deskId, JSON.stringify(diff), x])).rows[0].id as string;
      await admin.query(`UPDATE desk_change_proposals SET status = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1`, [id, y]);
      return id;
    };
    const desk = async (t: string, x: string, y: string, pid: string, template: string | null) => (await admin.query(
      `INSERT INTO desks (tenant_id, code, name, template_code, created_by, confirmed_by, created_by_proposal) VALUES ($1, 'dairy', 'dairy', $2, $3, $4, $5) RETURNING id`,
      [t, template, x, y, pid])).rows[0].id as string;
    const grant = (t: string, deskId: string, code: string, pid: string) =>
      admin.query(`INSERT INTO desk_permissions (tenant_id, desk_id, permission_code, added_by_proposal) VALUES ($1, $2, $3, $4)`, [t, deskId, code, pid]);
    const member = (t: string, deskId: string, m: string, by: string) =>
      admin.query(`INSERT INTO desk_members (tenant_id, desk_id, user_id, added_by) VALUES ($1, $2, $3, $4)`, [t, deskId, m, by]);
    const liveCodes = async (deskId: string) => (await admin.query(`SELECT permission_code FROM desk_permissions WHERE desk_id = $1 AND removed_at IS NULL ORDER BY 1`, [deskId])).rows.map((r) => r.permission_code);
    const resolved = async (u: string, t: string) => { await roleCache.invalidate(u, t); return (await roleCache.effectiveAccess(u, t)).permissions.filter((p) => p.startsWith('dairy.')).sort(); };

    // (a) THE OLD TEMPLATE: an install proposal whose diff lists dairy.manage for the dairy desk; the row was copied by that install.
    const a = await mk();
    const pa = await proposal(a.t, a.x, a.y, 'install_templates', null, { desks: [{ code: 'dairy', name: 'dairy', templateCode: 'dairy', permissions: ['dairy.manage'] }], add: [], remove: [], members: { add: [], remove: [] } });
    const da = await desk(a.t, a.x, a.y, pa, 'dairy'); await grant(a.t, da, 'dairy.manage', pa); await member(a.t, da, a.m, a.x);
    // (b) HAND-MADE: an administrator's `create` proposal that named the dairy template label but chose dairy.manage by hand.
    const b = await mk();
    const pb = await proposal(b.t, b.x, b.y, 'create', null, { code: 'dairy', name: 'dairy', description: null, templateCode: 'dairy', add: ['dairy.manage'], remove: [], members: { add: [], remove: [] } });
    const db = await desk(b.t, b.x, b.y, pb, 'dairy'); await grant(b.t, db, 'dairy.manage', pb); await member(b.t, db, b.m, b.x);
    // (c) RE-ADDED BY HAND: a template desk whose dairy.manage was removed and then added again by an EDIT proposal.
    const c = await mk();
    const pc = await proposal(c.t, c.x, c.y, 'install_templates', null, { desks: [{ code: 'dairy', name: 'dairy', templateCode: 'dairy', permissions: ['dairy.manage'] }], add: [], remove: [], members: { add: [], remove: [] } });
    const dc = await desk(c.t, c.x, c.y, pc, 'dairy');
    const ec = await proposal(c.t, c.x, c.y, 'edit', dc, { add: ['dairy.manage'], remove: [], members: { add: [], remove: [] } });
    await grant(c.t, dc, 'dairy.manage', ec); await member(c.t, dc, c.m, c.x);

    expect(await resolved(a.m, a.t)).toEqual(['dairy.manage']);
    const cl = await admin.connect();
    try { await cl.query('BEGIN'); await cl.query(block); await cl.query('COMMIT'); }
    catch (e) { await cl.query('ROLLBACK'); throw e; } finally { cl.release(); }

    expect(await liveCodes(da)).toEqual(['dairy.collect', 'dairy.read']);
    expect(await resolved(a.m, a.t)).toEqual(['dairy.collect', 'dairy.read']);
    const removed = (await admin.query(`SELECT removed_by_proposal, added_by_proposal FROM desk_permissions WHERE desk_id = $1 AND permission_code = 'dairy.manage'`, [da])).rows;
    expect(removed).toEqual([{ removed_by_proposal: pa, added_by_proposal: pa }]);   // the one signature only 0235 writes; the row is kept
    expect(await liveCodes(db)).toEqual(['dairy.manage']);
    expect(await resolved(b.m, b.t)).toEqual(['dairy.manage']);
    expect(await liveCodes(dc)).toEqual(['dairy.manage']);
    expect(await resolved(c.m, c.t)).toEqual(['dairy.manage']);
    // re-running the remap changes nothing (idempotent)
    const before = (await admin.query(`SELECT count(*)::int AS n FROM desk_permissions`)).rows[0].n;
    const cl2 = await admin.connect();
    try { await cl2.query('BEGIN'); await cl2.query(block); await cl2.query('COMMIT'); } finally { cl2.release(); }
    expect((await admin.query(`SELECT count(*)::int AS n FROM desk_permissions`)).rows[0].n).toBe(before);
  });

  it('(6) the role cache: dairy.collect granted to a custom role → the next resolution AND the next token carry it', async () => {
    const code = `ops3p_late_${T.slice(0, 8).replace(/-/g, '')}`;
    await admin.query(`INSERT INTO roles (code, default_name, scope) VALUES ($1, $1, 'tenant')`, [code]);
    await role(L, code);
    const before = await login(L);
    expect(before.perms).not.toContain('dairy.collect');
    refusedByName(await pour(before.token, mem3, 'evening'), { anyOf: ['dairy.collect', 'dairy.manage'] });
    await admin.query(`INSERT INTO role_permissions (role_id, permission_code) SELECT id, 'dairy.collect' FROM roles WHERE code = $1`, [code]);
    const after = await login(L);
    expect(after.perms).toContain('dairy.collect');
    const decoded = JSON.parse(Buffer.from(after.token.split('.')[1], 'base64url').toString('utf8'));
    expect(decoded.perms).toContain('dairy.collect');
    expect((await pour(after.token, mem3, 'evening')).status).toBe(201);
    // a staff override of dairy.collect is not refused as ungrantable: the resolver compiles it out of a desk too (5 above)
  });

  it('(7) kv_app cannot grant itself either code; the catalogue and the seeded grants are exactly 0235\'s', async () => {
    for (const t of ['role_permissions', 'permissions']) {
      const r = (await admin.query(`SELECT has_table_privilege('kv_app', $1, 'INSERT') AS i, has_table_privilege('kv_app', $1, 'UPDATE') AS u, has_table_privilege('kv_app', $1, 'DELETE') AS d`, [t])).rows[0];
      expect({ t, ...r }).toEqual({ t, i: false, u: false, d: false });
    }
    await expect(appPool.query(`INSERT INTO role_permissions (role_id, permission_code) SELECT id, 'dairy.collect' FROM roles WHERE code = 'dairy_farmer'`))
      .rejects.toMatchObject({ code: '42501' });
    await expect(appPool.query(`INSERT INTO permissions (code, default_name) VALUES ('dairy.collect2', 'x')`)).rejects.toMatchObject({ code: '42501' });
    const cat = (await admin.query(`SELECT code, default_name, module_code FROM permissions WHERE code IN ('dairy.collect', 'dairy.read') ORDER BY code`)).rows;
    expect(cat).toEqual([
      { code: 'dairy.collect', default_name: 'Record milk pours and cooler readings', module_code: 'M16' },
      { code: 'dairy.read', default_name: 'Read dairy boards', module_code: 'M16' }]);
    const seeded = (await admin.query(`SELECT r.code AS role, rp.permission_code AS perm FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
                                        WHERE rp.permission_code IN ('dairy.collect', 'dairy.read') AND r.code NOT LIKE 'ops3p_%' ORDER BY 1, 2`)).rows;
    expect(seeded).toEqual([{ role: 'tenant_admin', perm: 'dairy.collect' }, { role: 'tenant_admin', perm: 'dairy.read' }]);
  });
});
