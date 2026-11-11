// apps/api/src/__tests__/gov2c-clarify-closed.integration.spec.ts · PC-56 GOV-2c · THE ORGANISATION'S CLARIFY CLOSES TOO — LIVE (the real
// AppModule over HTTP on 127.0.0.1, real Postgres + RLS). brief_gov2c.md §D (the lead's conservative call carried from GOV-2a; the founder may
// reopen): the tenant `POST /v1/schemes/applications/:id/clarify` is refused `SCHEME_DECISIONS_ARE_THE_AUTHORITYS` (403) for EVERY signed-in
// caller — a legacy `gov_officer` who holds `scheme.process` included — and NOTHING is written: the application keeps its status, no event row,
// no audit row, no outbox row. The authority asks for a clarification through its own act (gov2a-decide covers it). Resubmit and appeal stay.
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
const SENTENCE = 'Please upload the second page of the land papers again.';

run('PC-56 GOV-2c · the organisation\'s clarify is the authority\'s (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let roleCache: RoleCacheService;
  const X = randomUUID(); const AUTH = randomUUID();
  let schemeId = '';
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
  const application = async (status: string) => (await admin.query(
    `INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, applicant_user_id, status, form_data, submitted_at)
     VALUES ($1, $2, 2, $3, $4::application_status, '{"cropName":"bajra"}'::jsonb, now()) RETURNING id`, [X, schemeId, people.F, status])).rows[0].id as string;
  /** Everything a clarify would write, for one application. */
  const written = async (id: string) => ({
    status: (await admin.query(`SELECT status::text AS s FROM scheme_applications WHERE id = $1`, [id])).rows[0].s,
    events: (await admin.query(`SELECT count(*)::int AS n FROM scheme_application_events WHERE application_id = $1`, [id])).rows[0].n,
    audit: (await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1`, [id])).rows[0].n,
    outbox: (await admin.query(`SELECT count(*)::int AS n FROM outbox_events WHERE aggregate_id = $1`, [id])).rows[0].n,
  });

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, X, 'Gov Two C FPO X');
    await admin.query(`INSERT INTO scheme_authorities (id, default_name, level) VALUES ($1, 'Gov Two C Test Authority', 'state')`, [AUTH]);
    const category = (await admin.query(`SELECT category_id FROM schemes ORDER BY code LIMIT 1`)).rows[0].category_id;
    schemeId = (await admin.query(
      `INSERT INTO schemes (code, default_name, authority_id, category_id, benefit_summary, eligibility_rules, version)
       VALUES ($1, 'Gov Two C Scheme', $2, $3, '{"type":"in_kind"}'::jsonb, '{"roles":["farmer"]}'::jsonb, 2) RETURNING id`,
      [`gov2c_${randomUUID().replace(/-/g, '').slice(0, 10)}`, AUTH, category])).rows[0].id;
    await user('F', 'Applicant F', 'farmer');
    await user('M', 'Member M', 'tenant_admin');
    await user('G', 'Legacy officer G', 'gov_officer');          // the frozen tenant role that holds scheme.process (written by the owner)
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

  it('a legacy officer holding scheme.process asks for a clarification → SCHEME_DECISIONS_ARE_THE_AUTHORITYS (403); nothing is written', async () => {
    const g = await tenantTok('G');
    expect(g.perms).toContain('scheme.process');                 // the caller COULD clarify before GOV-2c
    const id = await application('under_verification');
    const before = await written(id);
    expect(before).toEqual({ status: 'under_verification', events: 0, audit: 0, outbox: 0 });
    const r = await request(http).post(`/v1/schemes/applications/${id}/clarify`).set(g.headers).send({ note: SENTENCE });
    expect([r.status, r.body.error?.code, r.body.error?.details?.act]).toEqual([403, 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS', 'clarify']);
    expect(r.body.error?.message).toBe('Applications are checked and decided by the government authority that runs the scheme, not by the organisation.');
    expect(await written(id)).toEqual(before);
  });

  it('every other signed-in member (no scheme.process) hears the same NAME, not a permission refusal; with no note too', async () => {
    const m = await tenantTok('M');
    expect(m.perms).not.toContain('scheme.process');
    const f = await tenantTok('F');
    const id = await application('under_verification');
    for (const [who, h, body] of [['M', m.headers, { note: SENTENCE }], ['M', m.headers, {}], ['F', f.headers, { note: SENTENCE }]] as const) {
      const r = await request(http).post(`/v1/schemes/applications/${id}/clarify`).set(h).send(body);
      expect([who, r.status, r.body.error?.code]).toEqual([who, 403, 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS']);
    }
    expect(await written(id)).toEqual({ status: 'under_verification', events: 0, audit: 0, outbox: 0 });
  });

  it('an unknown application id answers the same name (refused before anything is read)', async () => {
    const g = await tenantTok('G');
    const r = await request(http).post(`/v1/schemes/applications/${randomUUID()}/clarify`).set(g.headers).send({ note: SENTENCE });
    expect([r.status, r.body.error?.code]).toEqual([403, 'SCHEME_DECISIONS_ARE_THE_AUTHORITYS']);
  });

  it('the farmer\'s own steps stay: an application in clarification_needed is resubmitted by its applicant (201/200, under_verification)', async () => {
    const f = await tenantTok('F');
    const id = await application('clarification_needed');
    const r = await request(http).post(`/v1/schemes/applications/${id}/resubmit`).set(f.headers).send({});
    expect([r.status < 300, r.body.data?.status]).toEqual([true, 'under_verification']);
  });
});
