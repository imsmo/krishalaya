// apps/api/src/__tests__/gov3a-dbt-closed.integration.spec.ts · PC-56 GOV-3a · NOBODY RECORDS PAYMENTS HERE — LIVE (the real AppModule over
// HTTP on 127.0.0.1, real Postgres + RLS). brief_gov3a.md §D Q2-A / Q4-A (lead-applied; the founder may reopen) and §E B3: every tenant DBT act
// and read but the applicant's own — record a credit, the monitor, the recent list, the exports, record / resolve / list a returned payment,
// one application's returns, the returns desk — is refused `DBT_IS_NOT_RECORDED_HERE` (403) for EVERY signed-in caller (a legacy `gov_officer`
// who holds `scheme.process` included), with or without a body or an Idempotency-Key, and NOTHING is written: dbt_transfers, dbt_bounces,
// audit_log and outbox_events unchanged, and an APPROVED application STAYS approved. The applicant's own read (GET :id/dbt) stays.
// No hour-of-day literal; runs under IST and UTC.
import 'reflect-metadata';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { RoleCacheService } from '../core/rbac/role-cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const phoneOf = () => `+9196${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const MESSAGE = 'Payments and returned payments are not recorded on this platform. Benefits are paid by PFMS and the banks, outside this platform.';

run('PC-56 GOV-3a · the tenant DBT routes are closed by name (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let roleCache: RoleCacheService;
  const X = randomUUID(); const AUTH = randomUUID();
  let schemeId = ''; let appId = ''; let transferId = '';
  const people: Record<string, string> = {};
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];
  const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`];

  const user = async (k: string, name: string, role: string) => {
    const id = randomUUID();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phoneOf(), name]);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) SELECT $1, $2, id, true FROM roles WHERE code = $3`, [id, X, role]);
    people[k] = id;
  };
  const tenantTok = async (k: string) => {
    await roleCache.invalidate(people[k], X);
    const acc = await roleCache.effectiveAccess(people[k], X);
    return { perms: [...acc.permissions], headers: { authorization: `Bearer ${mintToken(app, { userId: people[k], tenantId: X, perms: [...acc.permissions], roles: [...acc.roles] })}`, 'x-tenant-id': X } };
  };
  /** Everything a DBT act could write, for this tenant / scheme / application. */
  const written = async () => ({
    status: (await admin.query(`SELECT status::text AS s FROM scheme_applications WHERE id = $1`, [appId])).rows[0].s,
    transfers: (await admin.query(`SELECT count(*)::int AS n FROM dbt_transfers WHERE scheme_id = $1`, [schemeId])).rows[0].n,
    bounces: (await admin.query(`SELECT count(*)::int AS n FROM dbt_bounces WHERE scheme_id = $1`, [schemeId])).rows[0].n,
    events: (await admin.query(`SELECT count(*)::int AS n FROM scheme_application_events WHERE application_id = $1`, [appId])).rows[0].n,
    audit: (await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [X])).rows[0].n,
    outbox: (await admin.query(`SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id = $1`, [X])).rows[0].n,
  });
  const today = () => new Date().toISOString().slice(0, 10);
  /** The nine closed routes (some twice: with and without the body / key a caller might send). [act, method, path, body, idempotency key] */
  const closed = (): Array<[string, 'get' | 'post', string, object | undefined, string | undefined]> => [
    ['record_credit', 'post', `/v1/schemes/applications/${appId}/dbt`, { amountMinor: '600000', creditedOn: today(), instalmentNo: 1, pfmsRef: 'TEST-REF-1' }, undefined],
    ['record_credit', 'post', `/v1/schemes/applications/${appId}/dbt`, {}, undefined],
    ['monitor', 'get', '/v1/schemes/applications/dbt/monitor', undefined, undefined],
    ['recent', 'get', `/v1/schemes/applications/dbt/recent?schemeId=${schemeId}`, undefined, undefined],
    ['export', 'post', '/v1/schemes/applications/exports', { report: 'dbt_recent', schemeId }, undefined],
    ['export', 'post', '/v1/schemes/applications/exports', { report: 'no_such_report' }, undefined],
    ['record_return', 'post', `/v1/schemes/applications/dbt/${transferId}/bounce`, { reasonCode: 'account_closed', bouncedOn: today() }, `k-${randomUUID()}`],
    ['record_return', 'post', `/v1/schemes/applications/dbt/${transferId}/bounce`, { reasonCode: 'account_closed', bouncedOn: today() }, undefined],
    ['resolve_return', 'post', `/v1/schemes/applications/dbt/bounces/${randomUUID()}/resolve`, { resolution: 'abandoned', note: 'a written reason' }, undefined],
    ['list_returns', 'get', '/v1/schemes/applications/dbt/bounces', undefined, undefined],
    ['returns_desk', 'get', '/v1/schemes/applications/dbt/bounce-desk', undefined, undefined],
    ['application_returns', 'get', `/v1/schemes/applications/${appId}/dbt-bounces`, undefined, undefined],
  ];
  const call = (m: 'get' | 'post', p: string, headers: Record<string, string>, body?: object, key?: string) => {
    const r = request(http)[m](p).set(headers);
    if (key) r.set('idempotency-key', key);
    return m === 'post' ? r.send(body ?? {}) : r;
  };

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, X, 'Gov Three A FPO X');
    await admin.query(`INSERT INTO scheme_authorities (id, default_name, level) VALUES ($1, 'Gov Three A Test Authority', 'state')`, [AUTH]);
    const category = (await admin.query(`SELECT category_id FROM schemes ORDER BY code LIMIT 1`)).rows[0].category_id;
    schemeId = (await admin.query(
      `INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, version)
       VALUES ($1, 'Gov Three A Scheme', $2, $3, '{"type":"in_kind"}'::jsonb, '{"roles":["farmer"]}'::jsonb, 2) RETURNING id`,
      [`gov3a_${randomUUID().replace(/-/g, '').slice(0, 10)}`, AUTH, category])).rows[0].id;
    await user('F', 'Applicant F', 'farmer');
    await user('M', 'Member M', 'tenant_admin');
    await user('G', 'Legacy officer G', 'gov_officer');          // the frozen tenant role that holds scheme.process (written by the owner)
    appId = (await admin.query(
      `INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, applicant_user_id, status, form_data, submitted_at, decided_at)
       VALUES ($1, $2, 2, $3, 'approved'::application_status, '{"cropName":"bajra"}'::jsonb, now(), now()) RETURNING id`, [X, schemeId, people.F])).rows[0].id;
    // One credit record typed BEFORE GOV-3a (written here by the owner), so the returns routes have a real transfer to name and the kept read
    // has a row to return.
    transferId = (await admin.query(
      `INSERT INTO dbt_transfers (tenant_id, application_id, user_id, scheme_id, amount_minor, instalment_no, credited_on, pfms_ref)
       VALUES ($1, $2, $3, $4, 100000, 1, current_date, 'TEST-BEFORE') RETURNING id`, [X, appId, people.F, schemeId])).rows[0].id;
    for (const key of ['schemes']) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      if (b) backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 100, rules = '{}'::jsonb WHERE key = $1`, [key]);
    }
    app = await bootstrapE2EApp(); await app.listen(0, '127.0.0.1'); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); roleCache = app.get(RoleCacheService);
    for (const k of flagKeys('schemes')) await cache.del(k);
  }, 180_000);

  afterAll(async () => {
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = $4`, [b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {}), b.key]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_applications SET deleted_at = now() WHERE scheme_id = $1 AND deleted_at IS NULL`, [schemeId]).catch(() => undefined);
    await admin?.query(`UPDATE schemes SET is_active = false, deleted_at = now() WHERE id = $1`, [schemeId]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_authorities SET deleted_at = now() WHERE id = $1`, [AUTH]).catch(() => undefined);
    await admin?.query(`UPDATE user_tenant_roles SET is_active = false, deleted_at = now() WHERE user_id = ANY($1::uuid[])`, [Object.values(people)]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 30_000);

  it('red-today fact pinned: the legacy officer holds scheme.process (every closed route answered it before GOV-3a); the application is approved', async () => {
    const g = await tenantTok('G');
    expect(g.perms).toContain('scheme.process');
    expect((await written()).status).toBe('approved');
  });

  it('a legacy officer holding scheme.process → DBT_IS_NOT_RECORDED_HERE (403) on every closed route; nothing is written; approved stays approved', async () => {
    const g = await tenantTok('G');
    const before = await written();
    expect([before.status, before.transfers, before.bounces]).toEqual(['approved', 1, 0]);
    for (const [act, m, p, body, key] of closed()) {
      const r = await call(m, p, g.headers, body, key);
      expect([act, p, r.status, r.body.error?.code, r.body.error?.details?.act]).toEqual([act, p, 403, 'DBT_IS_NOT_RECORDED_HERE', act]);
      expect([act, r.body.error?.message]).toEqual([act, MESSAGE]);
    }
    expect(await written()).toEqual(before);
  });

  it('every other signed-in member (no scheme.process) — the organisation\'s admin and the applicant herself — hears the same NAME, not a permission refusal', async () => {
    const m = await tenantTok('M'); const f = await tenantTok('F');
    expect(m.perms).not.toContain('scheme.process'); expect(f.perms).not.toContain('scheme.process');
    const before = await written();
    for (const [who, h] of [['M', m.headers], ['F', f.headers]] as const) for (const [act, meth, p, body, key] of closed()) {
      const r = await call(meth, p, h, body, key);
      expect([who, act, r.status, r.body.error?.code]).toEqual([who, act, 403, 'DBT_IS_NOT_RECORDED_HERE']);
    }
    expect(await written()).toEqual(before);
    expect(before.status).toBe('approved');
  });

  it('an unknown application or transfer id answers the same name (refused before anything is read)', async () => {
    const g = await tenantTok('G');
    for (const p of [`/v1/schemes/applications/${randomUUID()}/dbt`, `/v1/schemes/applications/dbt/${randomUUID()}/bounce`]) {
      const r = await request(http).post(p).set(g.headers).send({ amountMinor: '1', creditedOn: today() });
      expect([p, r.status, r.body.error?.code]).toEqual([p, 403, 'DBT_IS_NOT_RECORDED_HERE']);
    }
  });

  it('KEPT: the applicant reads her own application\'s credit records (the one typed before); another member is answered not found', async () => {
    const f = await tenantTok('F'); const m = await tenantTok('M');
    const r = await request(http).get(`/v1/schemes/applications/${appId}/dbt`).set(f.headers);
    expect([r.status, Array.isArray(r.body.data) ? r.body.data.length : -1]).toEqual([200, 1]);
    const o = await request(http).get(`/v1/schemes/applications/${appId}/dbt`).set(m.headers);
    expect(o.status).toBe(404);
    expect((await written()).status).toBe('approved');
  });
});
