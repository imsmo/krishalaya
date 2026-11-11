// apps/api/src/__tests__/gov4a-visits-closed.integration.spec.ts · PC-56 GOV-4a · FIELD VISITS ARE NOT RECORDED HERE — LIVE (the real AppModule over
// HTTP on 127.0.0.1, real Postgres + RLS). brief_gov4a.md §D Q2-A (lead-applied; the founder may reopen) and §C: the organisation's schedule
// (`POST schemes/applications/:id/field-visits`) and submit (`POST schemes/applications/field-visits/:visitId/submit`) are refused
// `FIELD_VISITS_ARE_NOT_RECORDED_HERE` (403) for EVERY signed-in caller — a legacy `gov_officer` who holds `scheme.process` (and is the visit's
// officer of record), the organisation's admin and a farmer (the applicant herself) — with or without a body, for a real or an unknown id, and
// NOTHING is written: field_verifications (rows, status, version, geotag), audit_log and outbox_events unchanged. KEPT: the applicant's own read
// of the visit recorded before (HOTFIX-15) — 200 to her, 404 to another farmer.
// FIXTURE HYGIENE (the HOTFIX-15 leak lesson): every row this spec writes is retired in afterAll — the visit, the application, every role row
// of this organisation — and the flag is restored. No hour-of-day literal; runs under IST and UTC.
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
const MESSAGE = 'Field visits are not scheduled or recorded on this platform.';

run('PC-56 GOV-4a · the organisation\'s field-visit writes are closed by name (integration, real AppModule over HTTP)', () => {
  let app: INestApplication; let http: any; let admin: Pool; let cache: CacheService; let roleCache: RoleCacheService;   // eslint-disable-line @typescript-eslint/no-explicit-any
  const X = randomUUID();
  let appId = ''; let visitId = '';
  const people: Record<string, string> = {};
  const backups: Array<{ key: string; is_enabled: boolean; rollout_pct: number; rules: unknown }> = [];
  const flagKeys = (k: string) => [`flag:${k}`, 'flags:all', `flagstale:${k}`, `flagctx:${X}`];

  const user = async (k: string, name: string, role: string) => {
    const id = randomUUID();
    await admin.query(`INSERT INTO users (id, phone, full_name) VALUES ($1, $2, $3)`, [id, phoneOf(), name]);
    await admin.query(`INSERT INTO user_tenant_roles (user_id, tenant_id, role_id, is_active, approved_at) SELECT $1, $2, id, true, now() FROM roles WHERE code = $3`, [id, X, role]);
    people[k] = id;
  };
  const tenantTok = async (k: string) => {
    await roleCache.invalidate(people[k], X);
    const acc = await roleCache.effectiveAccess(people[k], X);
    return { perms: [...acc.permissions], headers: { authorization: `Bearer ${mintToken(app, { userId: people[k], tenantId: X, perms: [...acc.permissions], roles: [...acc.roles] })}`, 'x-tenant-id': X } };
  };
  /** Everything a visit act could write, for this organisation. */
  const written = async () => ({
    visits: (await admin.query(`SELECT count(*)::int AS n FROM field_verifications WHERE tenant_id = $1`, [X])).rows[0].n,
    visit: (await admin.query(`SELECT status::text AS status, version, geotag, measured_values, walk_trace, farmer_otp_signoff::text AS signoff, submitted_at FROM field_verifications WHERE id = $1`, [visitId])).rows[0],
    appStatus: (await admin.query(`SELECT status::text AS s FROM scheme_applications WHERE id = $1`, [appId])).rows[0].s,
    events: (await admin.query(`SELECT count(*)::int AS n FROM scheme_application_events WHERE application_id = $1`, [appId])).rows[0].n,
    audit: (await admin.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [X])).rows[0].n,
    outbox: (await admin.query(`SELECT count(*)::int AS n FROM outbox_events WHERE tenant_id = $1`, [X])).rows[0].n,
  });
  const GEOTAG = [{ mediaId: randomUUID(), lat: 21.123456, lng: 70.654321, capturedAt: new Date().toISOString() }];
  /** The two closed routes, each with the bodies a caller might send. [act, path, body] */
  const closed = (): Array<[string, string, object | undefined]> => [
    ['schedule_visit', `/v1/schemes/applications/${appId}/field-visits`, { scheduledFor: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) }],
    ['schedule_visit', `/v1/schemes/applications/${appId}/field-visits`, {}],
    ['schedule_visit', `/v1/schemes/applications/${appId}/field-visits`, { scheduledFor: 'not-a-date', extra: true }],
    ['submit_visit', `/v1/schemes/applications/field-visits/${visitId}/submit`, { geotag: GEOTAG, measuredValues: { measured_ha: 1.2 } }],
    ['submit_visit', `/v1/schemes/applications/field-visits/${visitId}/submit`, {}],
    ['submit_visit', `/v1/schemes/applications/field-visits/${visitId}/submit`, undefined],
  ];

  beforeAll(async () => {
    process.env.JOBS_ENABLED = 'false'; process.env.RELAY_ENABLED = 'false';
    admin = new Pool({ connectionString: ADMIN_URL });
    await makeTenant(admin, X, 'Gov Four A FPO X');
    await user('G', 'Legacy officer G', 'gov_officer');          // the frozen tenant role that holds scheme.process (written by the owner)
    await user('M', 'Admin M', 'tenant_admin');
    await user('F', 'Applicant F', 'farmer');
    await user('F2', 'Other farmer F2', 'farmer');
    // F's application to a SEEDED scheme (no shared-table row is written), and one visit recorded BEFORE GOV-4a with G as its officer of
    // record — scheduled, so the old submit would have accepted it (written here by the owner).
    const scheme = (await admin.query(`SELECT id FROM schemes ORDER BY code LIMIT 1`)).rows[0];
    appId = (await admin.query(
      `INSERT INTO scheme_applications (tenant_id, scheme_id, scheme_version, applicant_user_id, status, submitted_at)
       VALUES ($1, $2, 1, $3, 'under_verification', now()) RETURNING id`, [X, scheme.id, people.F])).rows[0].id;
    visitId = (await admin.query(
      `INSERT INTO field_verifications (tenant_id, application_id, officer_id, status, scheduled_for, geotag, measured_values)
       VALUES ($1, $2, $3, 'scheduled', current_date, '[{"media_id":null,"lat":21.4712,"lng":70.3301,"captured_at":"2026-11-01T04:30:00Z"}]', '{}') RETURNING id`,
      [X, appId, people.G])).rows[0].id;
    for (const key of ['schemes']) {
      const b = (await admin.query(`SELECT key, is_enabled, rollout_pct, rules FROM feature_flags WHERE key = $1`, [key])).rows[0];
      if (b) backups.push(b);
      await admin.query(`UPDATE feature_flags SET is_enabled = true, rollout_pct = 0, rules = $2::jsonb WHERE key = $1`, [key, JSON.stringify({ tenant_ids: [X] })]);
    }
    app = await bootstrapE2EApp(); await app.listen(0, '127.0.0.1'); http = app.getHttpServer();
    cache = app.get<CacheService>(CACHE_SERVICE); roleCache = app.get(RoleCacheService);
    for (const k of flagKeys('schemes')) await cache.del(k);
  }, 180_000);

  afterAll(async () => {
    for (const b of backups) await admin?.query(`UPDATE feature_flags SET is_enabled = $1, rollout_pct = $2, rules = $3::jsonb WHERE key = $4`, [b.is_enabled, b.rollout_pct, JSON.stringify(b.rules ?? {}), b.key]).catch(() => undefined);
    for (const k of flagKeys('schemes')) await cache?.del(k).catch(() => undefined);
    // retire every row this spec wrote (the HOTFIX-15 lesson: a live legacy officer leaked into the shared test database once)
    await admin?.query(`UPDATE field_verifications SET deleted_at = now() WHERE tenant_id = $1 AND deleted_at IS NULL`, [X]).catch(() => undefined);
    await admin?.query(`UPDATE scheme_applications SET deleted_at = now() WHERE tenant_id = $1 AND deleted_at IS NULL`, [X]).catch(() => undefined);
    await admin?.query(`UPDATE user_tenant_roles SET is_active = false, deleted_at = now() WHERE tenant_id = $1`, [X]).catch(() => undefined);
    await admin?.query(`UPDATE outbox_events SET status = 'published', published_at = now() WHERE status = 'pending' AND tenant_id = $1`, [X]).catch(() => undefined);
    await Promise.race([app?.close().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
    await admin?.end();
  }, 30_000);

  it('red-today fact pinned: the legacy officer holds scheme.process and is the visit\'s officer of record; the visit is scheduled, unsigned', async () => {
    const g = await tenantTok('G');
    expect(g.perms).toContain('scheme.process');
    const w = await written();
    expect([w.visits, w.visit.status, w.visit.signoff, w.visit.submitted_at]).toEqual([1, 'scheduled', 'pending', null]);
    expect((await admin.query(`SELECT officer_id FROM field_verifications WHERE id = $1`, [visitId])).rows[0].officer_id).toBe(people.G);
  });

  it('a legacy officer (scheme.process, officer of record), the organisation\'s admin and a farmer — the applicant herself — each hear FIELD_VISITS_ARE_NOT_RECORDED_HERE on schedule and submit; nothing is written', async () => {
    const before = await written();
    for (const who of ['G', 'M', 'F'] as const) {
      const t = await tenantTok(who);
      if (who !== 'G') expect(t.perms).not.toContain('scheme.process');
      for (const [act, p, body] of closed()) {
        const r = await request(http).post(p).set(t.headers).send(body as object);
        expect([who, act, p, r.status, r.body.error?.code, r.body.error?.details?.act]).toEqual([who, act, p, 403, 'FIELD_VISITS_ARE_NOT_RECORDED_HERE', act]);
        expect([who, act, r.body.error?.message]).toEqual([who, act, MESSAGE]);
      }
    }
    const after = await written();
    expect(after).toEqual(before);
    expect([after.visits, after.visit.status, after.visit.version, after.appStatus]).toEqual([1, 'scheduled', before.visit.version, 'under_verification']);
    expect(JSON.stringify(after.visit.geotag)).not.toContain('21.123456');
  });

  it('an unknown application or visit id answers the same name (refused before anything is read)', async () => {
    const g = await tenantTok('G');
    for (const p of [`/v1/schemes/applications/${randomUUID()}/field-visits`, `/v1/schemes/applications/field-visits/${randomUUID()}/submit`, '/v1/schemes/applications/not-a-uuid/field-visits']) {
      const r = await request(http).post(p).set(g.headers).send({ geotag: GEOTAG });
      expect([p, r.status, r.body.error?.code]).toEqual([p, 403, 'FIELD_VISITS_ARE_NOT_RECORDED_HERE']);
    }
    expect((await written()).visits).toBe(1);
  });

  it('KEPT: the applicant reads her own application\'s visit recorded before; another farmer is answered not found, with nothing of the visit', async () => {
    const f = await tenantTok('F'); const o = await tenantTok('F2');
    const r = await request(http).get(`/v1/schemes/applications/${appId}/field-visits`).set(f.headers);
    expect([r.status, Array.isArray(r.body.data) ? r.body.data.length : -1, r.body.data?.[0]?.id, r.body.data?.[0]?.status]).toEqual([200, 1, visitId, 'scheduled']);
    const x = await request(http).get(`/v1/schemes/applications/${appId}/field-visits`).set(o.headers);
    expect([x.status, x.body.error?.code, x.body.data]).toEqual([404, 'SCHEME_APPLICATION_NOT_FOUND', undefined]);
    for (const leak of ['21.4712', '70.3301', visitId]) expect(JSON.stringify(x.body)).not.toContain(leak);
  });
});
