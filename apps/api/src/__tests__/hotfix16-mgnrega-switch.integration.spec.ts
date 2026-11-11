// apps/api/src/__tests__/hotfix16-mgnrega-switch.integration.spec.ts · PC-56 HOTFIX-16 · MGNREGA BEHIND ITS SWITCH, LIVE.
// GOV-5 Q4-A, applied by the lead on 2026-11-11 under the founder's instructions (06_GOV.md "GOV-5 SPLIT"; his to reopen): the
// organisation's MGNREGA records stay switched off until the platform is connected to NREGASoft; nothing is deleted.
// The real AppModule over HTTP (listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS + seed core/0009 (edited in the same
// change: the `mgnrega` row, OFF). No migration.
//
// THE ROUTE LIST IS NOT TYPED BY HAND: it is read from MgnregaController's own Nest metadata (method + path per handler), and the first
// test asserts that the walk below covers exactly those routes (and that the source declares no route the metadata does not show).
// A route added to the controller later turns this spec red until it is walked.
//
// THE CALLER is a `tenant_admin` (holds booking.manage) with a token minted from the REAL resolver, so a 404 here is the flag's answer,
// never a permission's.
//
// PHASES (each route, in order):
//   1. the seed flags (`labour` OFF, `mgnrega` OFF)              → 404 NOT_FOUND each, nothing written   [red at 1f945841]
//   2. `labour` ON for this organisation, `mgnrega` as seeded    → 404 each, nothing written
//   3. `mgnrega` ON for this organisation, `labour` OFF          → 404 each, nothing written
//   4. both ON                                                   → each route its normal (non-404) shape
//   5. `mgnrega` switched OFF again, `labour` still ON           → 404 each (the kill-switch), nothing written
// FLAGS are switched with an allow-list fixture (`rules.tenant_ids`, rollout 0), restored in afterAll; every MGNREGA row this spec
// created is retired in afterAll. The defects behind the switch (survey_gov5 F-3, F-5, F-6, F-8, F-11) are recorded, not fixed.
// Run under TZ=Asia/Kolkata and TZ=UTC: the dates sent are three days back (UTC), inside every window either zone computes.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { RoleCacheService } from '../core/rbac/role-cache.service';
import { MgnregaController } from '../modules/labour/controllers/v1/mgnrega.controller';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const FLAGS = ['labour', 'mgnrega'] as const;
const CONTROLLER_SRC = join(__dirname, '..', 'modules', 'labour', 'controllers', 'v1', 'mgnrega.controller.ts');
const ymd = (daysBack: number) => new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
const D = ymd(3);

type Route = { name: string; method: string; path: string };
/** The controller's routes, from its own metadata. */
const declaredRoutes = (): Route[] => Object.getOwnPropertyNames(MgnregaController.prototype)
  .filter((k) => k !== 'constructor')
  .map((k) => ({ k, fn: (MgnregaController.prototype as unknown as Record<string, object>)[k] }))
  .filter(({ fn }) => typeof fn === 'function' && Reflect.getMetadata(PATH_METADATA, fn) !== undefined)
  .map(({ k, fn }) => ({ name: k, method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, fn) as number], path: String(Reflect.getMetadata(PATH_METADATA, fn)) }))
  .sort((a, b) => a.name.localeCompare(b.name));

run('PC-56 HOTFIX-16 · MGNREGA behind `labour` AND `mgnrega` (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let admin: Pool; let base = ''; let cache: CacheService; let roleCache: RoleCacheService;
  const T = randomUUID();
  let A = ''; let tok = '';
  const backups: Array<{ key: string; row: { is_enabled: boolean; rollout_pct: number; rules: unknown } | null }> = [];
  const cardNo = `HF16-${randomUUID().slice(0, 8)}`;
  // The ids every walk uses. They start as FIXTURE rows of this organisation (a card held by its admin, a work, an open demand — written
  // in the admin realm in beforeAll), so that in every OFF phase a route that escaped the switch would answer 200/201 on a REAL row
  // instead of the service's own 404 for an unknown id (which would look like the flag's answer). The BOTH-ON walk replaces them with
  // the rows it creates through the routes themselves.
  const ids: { card?: string; work?: string; demand?: string } = {};
  const createdCards: string[] = [];

  const api = async (method: string, path: string, body?: unknown, idemKey?: string) => {
    const res = await fetch(`${base}/v1/labour/mgnrega/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, 'x-tenant-id': T, ...(idemKey ? { 'idempotency-key': idemKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json = (() => { try { return JSON.parse(text); } catch { return {}; } })() as { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, data: json.data, code: json.error?.code ?? null, text };
  };
  const idem = () => `idem-${randomUUID()}`;

  /** THE WALK — one entry per controller handler: the request, and what a normal (flags ON) answer looks like. */
  const WALK: Record<string, { method: string; path: string; req: () => { path: string; body?: unknown; idem?: string }; on: (r: Awaited<ReturnType<typeof api>>) => void }> = {
    register: { method: 'POST', path: 'job-cards', req: () => ({ path: 'job-cards', body: { jobCardNo: cardNo }, idem: idem() }),
      on: (r) => { expect([r.status, r.data?.jobCardNo]).toEqual([201, cardNo]); ids.card = r.data.id; createdCards.push(r.data.id); } },
    mine: { method: 'GET', path: 'job-cards/mine', req: () => ({ path: 'job-cards/mine' }),
      on: (r) => { expect(r.status).toBe(200); expect((r.data as Array<{ id: string }>).map((c) => c.id)).toContain(ids.card); } },
    list: { method: 'GET', path: 'job-cards', req: () => ({ path: 'job-cards?limit=50' }),
      on: (r) => { expect(r.status).toBe(200); expect((r.data as Array<{ id: string }>).map((c) => c.id)).toContain(ids.card); } },
    createWork: { method: 'POST', path: 'works', req: () => ({ path: 'works', body: { workCode: `HF16-W-${randomUUID().slice(0, 6)}`, workName: 'HF16 fixture work' }, idem: idem() }),
      on: (r) => { expect([r.status, r.data?.status]).toEqual([201, 'active']); ids.work = r.data.id; } },
    works: { method: 'GET', path: 'works', req: () => ({ path: 'works' }),
      on: (r) => { expect(r.status).toBe(200); expect((r.data as Array<{ id: string }>).map((w) => w.id)).toContain(ids.work); } },
    updateWork: { method: 'PATCH', path: 'works/:id', req: () => ({ path: `works/${ids.work!}`, body: { workName: 'HF16 fixture work (renamed)' } }),
      on: (r) => { expect([r.status, r.data?.id]).toEqual([200, ids.work]); } },
    recordMuster: { method: 'POST', path: 'musters', req: () => ({ path: 'musters', body: { workId: ids.work, jobCardId: ids.card, attendedOn: D }, idem: idem() }),
      on: (r) => { expect(r.status).toBe(201); expect(typeof r.data?.id).toBe('string'); expect(r.data?.observedDays).toBe(1); } },
    cardLedger: { method: 'GET', path: 'job-cards/:id/ledger', req: () => ({ path: `job-cards/${ids.card!}/ledger` }),
      on: (r) => { expect([r.status, r.data?.authoritative, r.data?.observedByPlatform?.musterCount]).toEqual([200, 'state_ledger', 1]); } },
    recordDemand: { method: 'POST', path: 'demands', req: () => ({ path: 'demands', body: { jobCardId: ids.card!, demandedOn: D, daysRequested: 5 }, idem: idem() }),
      on: (r) => { expect([r.status, r.data?.status, r.data?.demandedOn]).toEqual([201, 'demanded', D]); ids.demand = r.data.id; } },
    demands: { method: 'GET', path: 'demands', req: () => ({ path: 'demands' }),
      on: (r) => { expect([r.status, r.data?.authoritative]).toEqual([200, 'state_register']); expect((r.data.demands as Array<{ id: string }>).map((d) => d.id)).toContain(ids.demand); } },
    transitionDemand: { method: 'PATCH', path: 'demands/:id', req: () => ({ path: `demands/${ids.demand!}`, body: { to: 'allotted', workId: ids.work!, allottedOn: D } }),
      on: (r) => { expect([r.status, r.data?.status, r.data?.allottedOn]).toEqual([200, 'allotted', D]); } },
    summary: { method: 'GET', path: 'summary', req: () => ({ path: 'summary' }),
      on: (r) => { expect([r.status, r.data?.authoritative, r.data?.jobCards]).toEqual([200, 'state_ledger', 2]); } },   // the fixture card + the one registered
    export: { method: 'POST', path: 'exports', req: () => ({ path: 'exports', body: { report: 'works' } }),
      on: (r) => { expect([r.status, r.data?.receipt?.report, r.data?.receipt?.rowCount]).toEqual([201, 'works', 2]); } },   // the fixture work + the one created
  };
  const ORDER = ['register', 'mine', 'list', 'createWork', 'works', 'updateWork', 'recordMuster', 'cardLedger', 'recordDemand', 'demands', 'transitionDemand', 'summary', 'export'];

  /** Every row an MGNREGA route could write, and the generic trails (audit, idempotency, outbox) — whole-table counts. */
  const footprint = async () => {
    const out: Record<string, number> = {};
    for (const t of ['mgnrega_job_cards', 'mgnrega_works', 'mgnrega_musters', 'mgnrega_work_demands', 'audit_log', 'idempotency_keys', 'outbox_events']) {
      out[t] = Number((await admin.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n);
    }
    return out;
  };
  const clearFlagCache = async () => {
    for (const f of FLAGS) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`]) await cache.del(c);
  };
  /** ON for THIS organisation only (allow-list), or back to OFF. A missing row (a database seeded before HOTFIX-16) is created. */
  const setFlag = async (key: string, on: boolean) => {
    await admin.query(`INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES ($1, 'hotfix16 fixture', $2, 0, $3::jsonb)
      ON CONFLICT (key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled, rollout_pct = 0, rules = EXCLUDED.rules`, [key, on, JSON.stringify(on ? { tenant_ids: [T] } : {})]);
    await clearFlagCache();
  };
  /** Walk every route expecting the flag-off answer; nothing may be written. */
  const walkOff = async () => {
    const before = await footprint();
    const answers: Array<[string, number, string | null, unknown]> = [];
    for (const name of ORDER) {
      const w = WALK[name]; const q = w.req();
      const r = await api(w.method, q.path, q.body, q.idem);
      answers.push([name, r.status, r.code, r.data ?? null]);
    }
    expect(answers).toEqual(ORDER.map((n) => [n, 404, 'NOT_FOUND', null]));
    expect(await footprint()).toEqual(before);
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, T, `HF16 ${T.slice(0, 4)}`);
    A = await makeUser(admin);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at) SELECT $1, $2, id, true, now() FROM roles WHERE code = 'tenant_admin'`, [A, T]);
    ids.card = (await admin.query(`INSERT INTO mgnrega_job_cards (user_id, job_card_no) VALUES ($1, $2) RETURNING id`, [A, `HF16F-${randomUUID().slice(0, 8)}`])).rows[0].id;
    ids.work = (await admin.query(`INSERT INTO mgnrega_works (tenant_id, work_code, work_name) VALUES ($1, 'HF16-F', 'HF16 fixture work (admin realm)') RETURNING id`, [T])).rows[0].id;
    ids.demand = (await admin.query(`INSERT INTO mgnrega_work_demands (tenant_id, job_card_id, demanded_on, days_requested, recorded_by) VALUES ($1, $2, $3::date, 5, $4) RETURNING id`, [T, ids.card, ymd(5), A])).rows[0].id;
    for (const key of FLAGS) {
      const row = (await admin.query(`SELECT is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0] ?? null;
      backups.push({ key, row });
    }
    app = await bootstrapE2EApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    cache = app.get<CacheService>(CACHE_SERVICE);
    roleCache = app.get(RoleCacheService);
    await clearFlagCache();
    await roleCache.invalidate(A, T);
    const acc = await roleCache.effectiveAccess(A, T);
    tok = mintToken(app, { userId: A, tenantId: T, perms: [...acc.permissions], roles: [...acc.roles] });
    expect([...acc.permissions]).toContain('booking.manage');
  }, 240_000);

  afterAll(async () => {
    // retire every MGNREGA row this organisation / this spec's card wrote (children first), then the admin's role row
    await admin?.query(`DELETE FROM mgnrega_work_demands WHERE tenant_id = $1`, [T]).catch(() => undefined);
    await admin?.query(`DELETE FROM mgnrega_musters WHERE tenant_id = $1`, [T]).catch(() => undefined);
    await admin?.query(`DELETE FROM mgnrega_works WHERE tenant_id = $1`, [T]).catch(() => undefined);
    await admin?.query(`DELETE FROM mgnrega_job_cards WHERE job_card_no = $1 OR user_id = $2`, [cardNo, A]).catch(() => undefined);
    await admin?.query(`UPDATE user_tenant_roles SET is_active = false, deleted_at = now() WHERE tenant_id = $1`, [T]).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = $1`, [T]).catch(() => undefined);
    for (const b of backups) {
      if (b.row) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [b.key, b.row.is_enabled, b.row.rollout_pct, JSON.stringify(b.row.rules ?? {})]).catch(() => undefined);
      else await admin?.query(`DELETE FROM feature_flags WHERE key = $1`, [b.key]).catch(() => undefined);
    }
    if (cache) await clearFlagCache().catch(() => undefined);
    await app?.close().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  it('the walk is EVERY route of MgnregaController — read from its metadata, and the source declares no other', () => {
    const declared = declaredRoutes();
    const walked = Object.entries(WALK).map(([name, w]) => ({ name, method: w.method, path: w.path })).sort((a, b) => a.name.localeCompare(b.name));
    expect(walked).toEqual(declared);
    expect([...ORDER].sort()).toEqual(declared.map((r) => r.name));
    const src = readFileSync(CONTROLLER_SRC, 'utf8');
    expect((src.match(/@(Get|Post|Patch|Put|Delete|All|Options|Head)\(/g) ?? []).length).toBe(declared.length);
    expect(declared.length).toBe(13);
  });

  it('F-1 (red at 1f945841): with the SEED flags — `labour` OFF, `mgnrega` OFF — every route answers 404 NOT_FOUND and nothing is written', async () => {
    await walkOff();
    // and the seed carries both rows, OFF — the `mgnrega` row is HOTFIX-16's (a flag with no row reads OFF too; the row lets an operator see it)
    const seeded = (await admin.query(`SELECT key, is_enabled FROM feature_flags WHERE key = ANY($1) ORDER BY key`, [[...FLAGS]])).rows;
    expect(seeded).toEqual([{ key: 'labour', is_enabled: false }, { key: 'mgnrega', is_enabled: false }]);
  });

  it('`labour` ON for this organisation and `mgnrega` AS SEEDED → every route 404, nothing written', async () => {
    await setFlag('labour', true);
    await walkOff();
  });

  it('`mgnrega` ON for this organisation and `labour` OFF → every route 404, nothing written', async () => {
    await setFlag('labour', false);
    await setFlag('mgnrega', true);
    await walkOff();
  });

  it('BOTH ON → every route answers its normal shape (201 for a POST, 200 otherwise)', async () => {
    await setFlag('labour', true);
    for (const name of ORDER) {
      const w = WALK[name]; const q = w.req();
      const r = await api(w.method, q.path, q.body, q.idem);
      try { w.on(r); } catch (e) { throw new Error(`${name} → ${r.status} ${r.text.slice(0, 300)}\n${(e as Error).message}`); }
    }
  });

  it('the kill-switch: `mgnrega` OFF again with `labour` still ON → every route 404 at once (even for the rows that now exist), nothing written', async () => {
    await setFlag('mgnrega', false);
    await walkOff();
  });
});
