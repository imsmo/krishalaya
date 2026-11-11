// apps/api/src/__tests__/hotfix15-gov-reader.integration.spec.ts · PC-56 HOTFIX-15 · A GOVERNMENT OFFICER IS NOT THE ORGANISATION'S
// READER, LIVE. GOV-1 Q2-A and Q3-A, applied by the lead on 2026-11-10 under the founder's instruction of that day (his to reopen).
// The real AppModule over HTTP (listening ONCE on 127.0.0.1, the HOTFIX-5 pin), real Postgres + RLS + 0238 (the DELETE and
// trg_utr_no_gov_role) + seed core/0004 (edited in the same commit).
// FLAGS: `schemes` (the field-visit read) and `memberships` (the governance register, one of the routes `report.view` opened) are seeded
// OFF and switched ON for THIS organisation only (an allow-list fixture, `rules.tenant_ids`), restored in afterAll — those routes answer
// 404 otherwise, before any permission is judged. Every other formerly-open route carries no flag.
// TOKENS are minted from the REAL resolver (RoleCacheService.effectiveAccess over user_tenant_roles × role_permissions), never typed by
// hand — so "the officer's token" is exactly what sign-in would give her.
//
// Survey GOV-1 §7, red-today probes (proved red at 65871403 in a detached worktree, then removed):
//   1. Admin A assigns `gov_officer` to HERSELF and approves it → both succeeded; now GOV_ROLE_LIVES_IN_AN_AUTHORITY, nothing written.
//   2. A `gov_officer` reads the roster, a member's file, a user record, the console home … → 200 then; now 403 (404 on the finance
//      routes, which answer 404 to anyone without finance scope BY THEIR OWN DESIGN — invoices.controller.ts:44, :92).
//   3. With `schemes` ON, another farmer of the same organisation reads an application's field visits → 200 with the GPS points then;
//      now 404 with no data, the same answer as for an id that does not exist.
// Survey §7 `hotfix15-gov-reader`, the Q2-A list verbatim: no report.view after migrate + seed ×2; every formerly-open route 403; assign /
// approve gov_officer → GOV_ROLE_LIVES_IN_AN_AUTHORITY; a kv_app direct INSERT of an active gov_officer row → refused by the trigger;
// field visits: applicant 200, scheme.process 200, any other member 404 empty.
// EXISTING ROWS: the officer G below is an ACTIVE gov_officer row written in the admin realm (as a database that predates 0238 would hold
// one) — it is LEFT AS IT IS by 0238 and keeps `scheme.process` only.
// Run under TZ=Asia/Kolkata and TZ=UTC: nothing here reads a local day.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { bootstrapE2EApp, mintToken } from '../../test/e2e/bootstrap';
import { makeTenant, makeUser } from '../../test/helpers/fixtures';
import { CACHE_SERVICE, CacheService } from '../core/cache/cache.service';
import { RoleCacheService } from '../core/rbac/role-cache.service';

const APP_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DATABASE_ADMIN_URL;
const run = APP_URL && ADMIN_URL ? describe : describe.skip;
const idem = () => `idem-${randomUUID()}`;
const FLAGS = ['schemes', 'memberships'];
const SEED_0004 = join(__dirname, '..', '..', '..', '..', 'db', 'seeds', 'core', '0004_roles_permissions.sql');
const REFUSAL = 'GOV_ROLE_LIVES_IN_AN_AUTHORITY';

run('PC-56 HOTFIX-15 · a government officer is not the organisation\'s reader (integration, real AppModule over HTTP, 0238)', () => {
  let app: INestApplication; let admin: Pool; let base = ''; let cache: CacheService; let roleCache: RoleCacheService;
  const T = randomUUID();
  let A = ''; let G = ''; let F1 = ''; let F2 = ''; let X = '';
  let gUtr = ''; let xUtr = ''; let f2Utr = ''; let govRoleId = ''; let farmerRoleId = '';
  let appId = ''; let visitId = '';
  const tok: Record<string, string> = {};
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];

  const q1 = async (sql: string, p: unknown[] = []) => (await admin.query(sql, p)).rows[0];
  const n = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);
  const api = async (who: string, method: string, path: string, body?: unknown, idemKey?: string) => {
    const res = await fetch(`${base}/v1/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${tok[who]}`, 'x-tenant-id': T, ...(idemKey ? { 'idempotency-key': idemKey } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json = (() => { try { return JSON.parse(text); } catch { return {}; } })() as { data?: any; error?: { code?: string } };   // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, data: json.data, code: json.error?.code ?? null, text };
  };
  /** Mint a token from the REAL resolver — what sign-in would hand this person in this organisation now. */
  const tokenFor = async (who: string, userId: string) => {
    await roleCache.invalidate(userId, T);
    const acc = await roleCache.effectiveAccess(userId, T);
    tok[who] = mintToken(app, { userId, tenantId: T, perms: [...acc.permissions], roles: [...acc.roles] });
    return acc;
  };
  /** A statement as kv_app, in a session of THIS organisation and person — 'ok:<rows>' or the SQLSTATE and the guard's code. */
  const asApp = async (userId: string, sql: string, p: unknown[] = []): Promise<string> => {
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE kv_app');
      await c.query(`SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`, [T, userId]);
      const r = await c.query(sql, p); return `ok:${r.rowCount}`;
    } catch (e) {
      const m = /\[([A-Z_]+)\]/.exec(String((e as Error).message)); return `${(e as { code?: string }).code}${m ? `:${m[1]}` : ''}`;
    } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
  };
  const govPerms = async () => (await admin.query(`SELECT rp.permission_code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'gov_officer' ORDER BY 1`)).rows.map((x) => x.permission_code as string);
  const utrRow = (id: string) => q1(`SELECT is_active, approved_at, approved_by, revoked_at FROM user_tenant_roles WHERE id = $1`, [id]);

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, T, `HF15 ${T.slice(0, 4)}`);
    A = await makeUser(admin); G = await makeUser(admin); F1 = await makeUser(admin); F2 = await makeUser(admin); X = await makeUser(admin);
    govRoleId = (await q1(`SELECT id FROM roles WHERE code = 'gov_officer'`)).id;
    farmerRoleId = (await q1(`SELECT id FROM roles WHERE code = 'farmer'`)).id;
    const role = async (u: string, code: string, active: boolean) => (await q1(
      `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at) SELECT $1, $2, id, $4, CASE WHEN $4 THEN now() END FROM roles WHERE code = $3 RETURNING id`, [u, T, code, active])).id as string;
    await role(A, 'tenant_admin', true);
    // G: an ACTIVE gov_officer written in the ADMIN REALM (exempt from 0238 — a row that predates it). X: a PENDING gov_officer row.
    gUtr = await role(G, 'gov_officer', true);
    xUtr = await role(X, 'gov_officer', false);
    await role(F1, 'farmer', true); f2Utr = await role(F2, 'farmer', true);
    for (const flag of FLAGS) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [flag])).rows[0];
      expect([b?.key, b?.is_enabled]).toEqual([flag, false]);
      backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [flag, JSON.stringify({ tenant_ids: [T] })]);
    }
    // F1's application to a SEEDED scheme (no shared-table row is written), and one submitted field visit by G with a farm's GPS point.
    const scheme = await q1(`SELECT id FROM schemes ORDER BY code LIMIT 1`);
    appId = randomUUID();
    await admin.query(`INSERT INTO scheme_applications (id, tenant_id, scheme_id, scheme_version, applicant_user_id, status) VALUES ($1,$2,$3,1,$4,'under_verification')`, [appId, T, scheme.id, F1]);
    visitId = randomUUID();
    await admin.query(`INSERT INTO field_verifications (id, tenant_id, application_id, officer_id, status, geotag, measured_values, farmer_otp_signoff)
      VALUES ($1,$2,$3,$4,'pending_otp','[{"media_id":null,"lat":21.4712,"lng":70.3301,"captured_at":"2026-11-01T04:30:00Z"}]','{"measured_ha":1.44}','sent')`, [visitId, T, appId, G]);

    app = await bootstrapE2EApp();
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    cache = app.get<CacheService>(CACHE_SERVICE);
    roleCache = app.get(RoleCacheService);
    for (const f of FLAGS) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache.del(c);
    for (const c of ['flags:all', `flagctx:${T}`]) await cache.del(c);
    await tokenFor('A', A); await tokenFor('G', G); await tokenFor('F1', F1); await tokenFor('F2', F2);
  }, 240_000);

  afterAll(async () => {
    // [lead QA, GOV-3a] the legacy officer written in the F-3 test stayed ACTIVE in the shared test database and turned GOV-2a's
    // "(P4) … by no live row" red whenever jest ran it after this spec; every gov_officer row of THIS organisation is now retired here.
    await admin?.query(`UPDATE user_tenant_roles SET is_active = false, deleted_at = now() WHERE tenant_id = $1 AND role_id = (SELECT id FROM roles WHERE code = 'gov_officer')`, [T]).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status='published', published_at=now() WHERE status='pending' AND tenant_id = $1`, [T]).catch(() => undefined);
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled=$2, rollout_pct=$3, rules=$4::jsonb WHERE key=$1`, [b.key, b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {})]).catch(() => undefined);
    for (const f of FLAGS) for (const c of [`flag:${f}`, `flagstale:${f}`]) await cache?.del(c).catch(() => undefined);
    await app?.close().catch(() => undefined); await admin?.end().catch(() => undefined);
  });

  it('Q3-A / F-1: after migrate + seed, gov_officer holds exactly scheme.process — and still after seed core/0004 is applied AGAIN (seed ×2)', async () => {
    expect(await govPerms()).toEqual(['scheme.process']);
    await admin.query(readFileSync(SEED_0004, 'utf8'));
    await admin.query(readFileSync(SEED_0004, 'utf8'));
    expect(await govPerms()).toEqual(['scheme.process']);
    // the officer's real token: exactly what the resolver gives an EXISTING active gov_officer row (left as it was)
    const acc = await tokenFor('G', G);
    expect([[...acc.roles], [...acc.permissions].sort()]).toEqual([['gov_officer'], ['scheme.process']]);
    // the trigger exists, as 0238 names it
    expect(await n(`SELECT count(*)::int n FROM pg_trigger WHERE tgrelid = 'user_tenant_roles'::regclass AND tgname = 'trg_utr_no_gov_role' AND NOT tgisinternal`)).toBe(1);
  });

  it('F-1 (red-today probe 2): every route report.view opened is closed to the officer — 403 (404 on the finance routes, by their design); the administrator still reads them', async () => {
    const closed: Array<[string, string, unknown?]> = [
      ['GET', 'members/roster'],                                   // member-roster.controller.ts:42-43
      ['GET', `members/roster/${F1}`],                             // :78-79 — the member's file
      ['GET', `members/roster/${F1}/suspension`],                  // :147-148
      ['GET', `users/${F1}`],                                      // users.controller.ts:38-39
      ['GET', 'rbac/assignments'],                                 // roles.controller.ts:44-45
      ['GET', 'tenancy/console/dashboard'],                        // console-home.controller.ts:41-42
      ['GET', 'tenancy/console/go-live'],                          // :53-54
      ['GET', 'governance/resolutions/register'],                  // governance.controller.ts:124-128 (memberships ON for this organisation)
      ['GET', 'insights/mandi-pulse'],                             // insights.controller.ts:50 (the permission guard runs before the flag guard)
      ['POST', 'insights/mandi-pulse/export', {}],                 // :52
      ['GET', 'insights/demand-map'],                              // :58
      ['POST', 'insights/demand-map/export', {}],                  // :60
      ['GET', 'insights/wastage'],                                 // :66
      ['GET', 'insights/wastage/events'],                          // :68
      ['POST', 'insights/wastage/export', {}],                     // :70
      ['POST', 'invoices/gstr1', { period: '2026-10' }],           // invoices.controller.ts:60-62 → GSTR1_FORBIDDEN
    ];
    const seen: string[] = []; const got: Array<[string, number, boolean]> = [];
    for (const [m, p, b] of closed) {
      const r = await api('G', m, p, b, m === 'POST' ? idem() : undefined);
      seen.push(`${m} ${p} → ${r.status}`); got.push([`${m} ${p}`, r.status, r.text.includes(F1)]);
    }
    const fin: Array<[string, number, unknown]> = [];
    for (const p of ['invoices', `invoices/${randomUUID()}`]) {      // invoices.controller.ts:42-44, :90-92 — 404 to anyone without finance scope
      const r = await api('G', 'GET', p);
      seen.push(`GET ${p} → ${r.status}`); fin.push([p, r.status, r.data]);
    }
    // eslint-disable-next-line no-console
    console.log(`[hf15 F-1] gov_officer token perms=${[...(await roleCache.effectiveAccess(G, T)).permissions].sort().join(',')}:\n  ${seen.join('\n  ')}`);
    for (const [k, status, leaked] of got) expect([k, status, leaked]).toEqual([k, 403, false]);
    for (const [k, status, data] of fin) expect([k, status, data]).toEqual([k, 404, undefined]);
    // the same routes are open to the organisation's administrator (the route exists; only the officer lost it)
    for (const p of ['members/roster', `members/roster/${F1}`, `users/${F1}`, 'rbac/assignments']) {
      expect([p, (await api('A', 'GET', p)).status]).toEqual([p, 200]);
    }
    // the console home passes the permission guard for the administrator (not 403); on this bare fixture organisation its read model
    // answers 500 — found on the way, the same at the base, not this wave's (reported).
    const home = await api('A', 'GET', 'tenancy/console/dashboard');
    // eslint-disable-next-line no-console
    console.log(`[hf15 F-1] administrator GET tenancy/console/dashboard → ${home.status} ${home.text.slice(0, 300)}`);
    expect(home.status).not.toBe(403);
  });

  it('Q2-A / F-2 (red-today probe 1): A assigning gov_officer to HERSELF or anyone → GOV_ROLE_LIVES_IN_AN_AUTHORITY; no row, no idempotency record, no audit', async () => {
    const rowsBefore = await n(`SELECT count(*)::int n FROM user_tenant_roles WHERE tenant_id = $1`, [T]);
    for (const target of [A, F2]) {
      const k = idem();
      const r = await api('A', 'POST', 'rbac/assignments', { userId: target, roleCode: 'gov_officer' }, k);
      // eslint-disable-next-line no-console
      console.log(`[hf15 probe 1] A assigns gov_officer to ${target === A ? 'HERSELF' : 'a farmer'} → ${r.status} ${r.code}`);
      expect([r.status, r.code]).toEqual([409, REFUSAL]);
      expect(r.text).toContain('The government officer role cannot be given or approved inside an organisation. Nothing was changed.');
      expect(await n(`SELECT count(*)::int n FROM idempotency_keys WHERE key LIKE '%' || $1`, [k])).toBe(0);   // the key may be stored scoped
    }
    expect(await n(`SELECT count(*)::int n FROM user_tenant_roles WHERE tenant_id = $1`, [T])).toBe(rowsBefore);
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'role.assigned'`, [T])).toBe(0);
    // A's own token never gained scheme.process
    expect([...(await tokenFor('A', A)).permissions]).not.toContain('scheme.process');
    // the refusal is narrow: another role is still assigned (201) — keyed and recorded as before
    const ok = await api('A', 'POST', 'rbac/assignments', { userId: X, roleCode: 'farmer' }, idem());
    expect(ok.status).toBe(201);
  });

  it('Q2-A: approving a PENDING gov_officer row → GOV_ROLE_LIVES_IN_AN_AUTHORITY; the row stays pending, nothing audited', async () => {
    const r = await api('A', 'POST', `rbac/assignments/${xUtr}/approve`, {});
    // eslint-disable-next-line no-console
    console.log(`[hf15 probe 1b] A approves a pending gov_officer row → ${r.status} ${r.code}`);
    expect([r.status, r.code]).toEqual([409, REFUSAL]);
    expect(await utrRow(xUtr)).toMatchObject({ is_active: false, approved_at: null, approved_by: null });
    expect(await n(`SELECT count(*)::int n FROM audit_log WHERE tenant_id = $1 AND action = 'role.approved' AND entity_id = $2`, [T, xUtr])).toBe(0);
  });

  it('Q2-A: an EXISTING active officer is left as she is; once removed (with a reason, recorded) she is never re-activated by approval', async () => {
    expect(await utrRow(gUtr)).toMatchObject({ is_active: true, revoked_at: null });
    // kv_app may still write what leaves her row as it is (her KYC status) — 0238 does not touch existing rows
    expect(await asApp(A, `UPDATE user_tenant_roles SET kyc_status = kyc_status WHERE id = $1`, [gUtr])).toBe('ok:1');
    const rm = await api('A', 'DELETE', `rbac/assignments/${gUtr}`, { reason: 'Government access moves to the authority' });
    expect(rm.status).toBe(200);
    expect(await utrRow(gUtr)).toMatchObject({ is_active: false });
    const again = await api('A', 'POST', `rbac/assignments/${gUtr}/approve`, {});
    expect([again.status, again.code]).toEqual([409, REFUSAL]);
    expect(await utrRow(gUtr)).toMatchObject({ is_active: false });
    expect((await utrRow(gUtr)).revoked_at).not.toBeNull();
  });

  it('Q2-A, the database wall (0238 trg_utr_no_gov_role), as kv_app: no active gov_officer row is born, approved, re-activated or moved onto', async () => {
    const insert = await asApp(A, `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at) VALUES ($1, $2, $3, true, now())`, [F2, T, govRoleId]);
    // eslint-disable-next-line no-console
    console.log(`[hf15 wall] kv_app INSERT of an ACTIVE gov_officer row → ${insert}`);
    expect(insert).toBe(`23514:${REFUSAL}`);
    // an INACTIVE (pending) row is no grant — the wall lets it be written; the service refuses it before the database is asked
    expect(await asApp(A, `INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active) VALUES ($1, $2, $3, false)`, [F2, T, govRoleId])).toBe('ok:1');
    // an approval of the pending row (is_active), and approved_at alone with is_active
    expect(await asApp(A, `UPDATE user_tenant_roles SET is_active = true, approved_at = now(), approved_by = $2 WHERE id = $1`, [xUtr, A])).toBe(`23514:${REFUSAL}`);
    expect(await asApp(A, `UPDATE user_tenant_roles SET is_active = true WHERE id = $1`, [xUtr])).toBe(`23514:${REFUSAL}`);
    // a re-activation of the removed officer
    expect(await asApp(A, `UPDATE user_tenant_roles SET is_active = true, revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL WHERE id = $1`, [gUtr])).toBe(`23514:${REFUSAL}`);
    // an active farmer row moved onto the role
    expect(await asApp(A, `UPDATE user_tenant_roles SET role_id = $2 WHERE id = $1`, [f2Utr, govRoleId])).toBe(`23514:${REFUSAL}`);
    // [lead QA] an un-delete of a soft-deleted, still-active legacy officer row (the resolver reads `is_active AND deleted_at IS NULL`)
    const ghost = await makeUser(admin);
    const ghostUtr = (await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at, deleted_at) VALUES ($1, $2, $3, true, now(), now()) RETURNING id`, [ghost, T, govRoleId])).rows[0].id as string;
    expect(await asApp(A, `UPDATE user_tenant_roles SET deleted_at = NULL WHERE id = $1`, [ghostUtr])).toBe(`23514:${REFUSAL}`);
    // …while an active farmer row is untouched by the wall, and the admin realm (an operator's repair, the fixtures) is exempt
    expect(await asApp(A, `UPDATE user_tenant_roles SET role_id = $2 WHERE id = $1`, [f2Utr, farmerRoleId])).toBe('ok:1');
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query(`UPDATE user_tenant_roles SET is_active = true WHERE id = $1`, [xUtr]); } finally { await c.query('ROLLBACK'); c.release(); }
    expect(await utrRow(xUtr)).toMatchObject({ is_active: false });
  });

  it('F-3 (red-today probe 3): field visits — the applicant 200, a scheme.process holder 200, any other member 404 with no data (the same as an unknown id)', async () => {
    // the stranger first (the red-today probe): another farmer of the same organisation
    const stranger = await api('F2', 'GET', `schemes/applications/${appId}/field-visits`);
    // eslint-disable-next-line no-console
    console.log(`[hf15 F-3] another farmer reads the visits → ${stranger.status} ${stranger.code}`);
    expect([stranger.status, stranger.code, stranger.data]).toEqual([404, 'SCHEME_APPLICATION_NOT_FOUND', undefined]);
    for (const leak of ['21.4712', '70.3301', 'geotag', 'measured', visitId, F1]) expect(stranger.text).not.toContain(leak);
    // G was removed above; the scheme.process holder here is another EXISTING active gov_officer row, written in the admin realm
    const officer = await makeUser(admin);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at) VALUES ($1, $2, $3, true, now())`, [officer, T, govRoleId]);
    const acc = await tokenFor('P', officer);
    expect([...acc.permissions]).toEqual(['scheme.process']);

    const own = await api('F1', 'GET', `schemes/applications/${appId}/field-visits`);
    expect(own.status).toBe(200);
    expect(own.data).toHaveLength(1);
    expect(own.data[0]).toMatchObject({ id: visitId, geotag: [{ lat: 21.4712, lng: 70.3301 }] });
    const proc = await api('P', 'GET', `schemes/applications/${appId}/field-visits`);
    expect([proc.status, proc.data?.length]).toEqual([200, 1]);

    const unknown = await api('F2', 'GET', `schemes/applications/${randomUUID()}/field-visits`);
    expect([unknown.status, unknown.code, unknown.data]).toEqual([404, 'SCHEME_APPLICATION_NOT_FOUND', undefined]);
    // no existence oracle: the stranger's answer and the unknown id's answer differ only in the id they echo
    const shape = (t: string) => t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>').replace(/"(requestId|timestamp|traceId)":"[^"]*"/g, '"$1":"<x>"');
    expect(shape(stranger.text)).toBe(shape(unknown.text));
  });
});
